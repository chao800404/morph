// @vitest-environment node
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fencedWriteScriptSource,
  type FencedWriteRequest,
  type FencedWriteResult,
} from "./preview-write-fence-sandbox";

/**
 * The container script, run by a real `node` against a temporary directory:
 * the same source the preview container receives, only with its ledger and
 * lock moved out of `/tmp`.
 */
let dir: string;
let root: string;
let scriptSource: string;
let ledger: string;
let counter = 0;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "morph-fence-"));
  root = path.join(dir, "workspace");
  ledger = path.join(dir, "fences.json");
  spawnSync("mkdir", ["-p", path.join(root, "src")]);
  scriptSource = fencedWriteScriptSource({
    ledger,
    lock: path.join(dir, "fences.lock"),
  });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A script and a request of their own, as each production request gets. */
function prepare(request: FencedWriteRequest): string[] {
  const id = counter++;
  const script = path.join(dir, `fence-${id}.cjs`);
  const file = path.join(dir, `request-${id}.json`);
  writeFileSync(script, scriptSource);
  writeFileSync(file, JSON.stringify(request));
  return [script, file];
}

function run(request: FencedWriteRequest): FencedWriteResult {
  const result = spawnSync("node", prepare(request), {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

function runAsync(request: FencedWriteRequest): Promise<FencedWriteResult> {
  const args = prepare(request);
  return new Promise((resolve, reject) => {
    const child = spawn("node", args);
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("close", (code) =>
      code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)),
    );
  });
}

const HERO = "src/Hero.tsx";
const readLedger = () =>
  JSON.parse(readFileSync(ledger, "utf8")) as {
    files: Record<string, number>;
    generation: number;
  };
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("the container's fenced write", () => {
  it("writes, and records the version written", () => {
    expect(
      run({
        op: "write",
        root,
        files: [{ path: HERO, content: "hero v3", fence: 3 }],
        marker: { path: path.join(root, ".marker"), content: "dirty:x" },
      }),
    ).toEqual({ refused: [], changed: [HERO], unchanged: [] });
    expect(read(HERO)).toBe("hero v3");
    expect(read(".marker")).toBe("dirty:x");
    expect(readLedger().files).toEqual({ [HERO]: 3 });
  });

  it("refuses a write older than one already made, and leaves the file", () => {
    run({
      op: "write",
      root,
      files: [{ path: HERO, content: "hero v4 by A", fence: 4 }],
    });
    expect(
      run({
        op: "write",
        root,
        files: [{ path: HERO, content: "hero v3 edited by B", fence: 3 }],
      }),
    ).toEqual({ refused: [HERO], changed: [], unchanged: [] });
    expect(read(HERO)).toBe("hero v4 by A");
  });

  it("will not write outside its root", () => {
    expect(() =>
      run({
        op: "write",
        root,
        files: [{ path: "../escaped.txt", content: "x", fence: 1 }],
      }),
    ).toThrow(/PREVIEW_FENCE_PATH_ESCAPE/);
  });

  it("ends on the newest version however concurrent writes interleave", async () => {
    // Ten processes race to write versions 1..10 in shuffled order. Whatever
    // order they take the lock in, a lower version can never land after a
    // higher one, so the file ends as version 10.
    const versions = [7, 2, 10, 4, 9, 1, 6, 3, 8, 5];
    const results = await Promise.all(
      versions.map((version) =>
        runAsync({
          op: "write",
          root,
          files: [{ path: HERO, content: `hero v${version}`, fence: version }],
        }),
      ),
    );
    expect(read(HERO)).toBe("hero v10");
    expect(readLedger().files).toEqual({ [HERO]: 10 });
    // Every write either went through or was refused; none half-happened.
    for (const result of results) {
      expect(result.changed.length + result.refused.length).toBe(1);
    }
  });
});

/**
 * A start, as the preview server sends it: files staged beside the
 * workspace, then one request that judges and applies them under the lock.
 */
describe("the container's fenced start", () => {
  const MARKER = () => path.join(root, ".morph-preview-workspace");
  const MANIFEST = () => path.join(root, ".morph-preview-manifest.json");
  let stagings = 0;

  function stage(files: Record<string, string>): string {
    const staging = path.join(dir, `staging-${stagings++}`);
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(staging, file)), { recursive: true });
      writeFileSync(path.join(staging, file), content);
    }
    return staging;
  }

  function startRequest(
    files: Record<string, string>,
    versions: Record<string, number>,
    options: { prune?: string[]; expected?: string | null } = {},
  ): FencedWriteRequest {
    return {
      op: "start",
      root,
      staging: stage(files),
      files: Object.keys(files),
      prune: options.prune ?? [],
      versions,
      marker: {
        path: MARKER(),
        dirty: "dirty:start",
        expected: options.expected ?? null,
      },
      commit: {
        marker: "fingerprint-new",
        manifest: { path: MANIFEST(), content: "manifest-new" },
      },
    };
  }

  it("lays out its files, removes what the plan dropped, records and commits", () => {
    writeFileSync(path.join(root, "src/Old.tsx"), "old");
    const request = startRequest(
      { [HERO]: "hero v2", "src/Other.tsx": "other v1" },
      { [HERO]: 2, "src/Other.tsx": 1 },
      { prune: ["src/Old.tsx"] },
    );

    expect(run(request)).toEqual({
      refused: [],
      changed: [HERO, "src/Other.tsx"],
      unchanged: [],
      committed: true,
    });
    expect(read(HERO)).toBe("hero v2");
    expect(existsSync(path.join(root, "src/Old.tsx"))).toBe(false);
    expect(readLedger().files).toEqual({
      [HERO]: 2,
      "src/Other.tsx": 1,
    });
    expect(read(".morph-preview-workspace")).toBe("fingerprint-new");
    expect(read(".morph-preview-manifest.json")).toBe("manifest-new");
    expect(existsSync((request as { staging: string }).staging)).toBe(false);
  });

  it("is refused whole when a newer sync has already landed, and changes nothing", () => {
    // The newer save's sync completed first; the start was read before it.
    run({
      op: "write",
      root,
      files: [{ path: HERO, content: "hero v4 saved", fence: 4 }],
      marker: { path: MARKER(), content: "dirty:sync" },
    });
    writeFileSync(path.join(root, "src/Keep.tsx"), "keep");
    const request = startRequest(
      { [HERO]: "hero v3", "src/Other.tsx": "other v1" },
      { [HERO]: 3, "src/Other.tsx": 1 },
      { prune: ["src/Keep.tsx"] },
    );

    expect(run(request)).toEqual({
      refused: [HERO],
      changed: [],
      unchanged: [],
      committed: false,
    });
    expect(read(HERO)).toBe("hero v4 saved");
    // Refused whole: not one of its files, and nothing pruned.
    expect(existsSync(path.join(root, "src/Other.tsx"))).toBe(false);
    expect(read("src/Keep.tsx")).toBe("keep");
    expect(read(".morph-preview-workspace")).toBe("dirty:sync");
    expect(readLedger().files).toEqual({ [HERO]: 4 });
    expect(existsSync((request as { staging: string }).staging)).toBe(false);
  });

  it("applies but does not vouch for a workspace another writer marked since it read", () => {
    writeFileSync(MARKER(), "dirty:sync-after-read");
    const request = startRequest(
      { [HERO]: "hero v2" },
      { [HERO]: 2 },
      { expected: "fingerprint-old" },
    );

    expect(run(request).committed).toBe(false);
    expect(read(HERO)).toBe("hero v2");
    expect(read(".morph-preview-workspace")).toBe("dirty:start");
    expect(existsSync(MANIFEST())).toBe(false);
  });

  it("lets an equal version through: the later write wins, as for a sync", () => {
    run({
      op: "write",
      root,
      files: [{ path: HERO, content: "hero v3 from tab A", fence: 3 }],
    });
    expect(
      run(startRequest({ [HERO]: "hero v3 from tab B" }, { [HERO]: 3 }))
        .refused,
    ).toEqual([]);
    expect(read(HERO)).toBe("hero v3 from tab B");
  });

  it("will not remove or place a file outside its root", () => {
    expect(() =>
      run(startRequest({}, {}, { prune: ["../outside.txt"] })),
    ).toThrow(/PREVIEW_FENCE_PATH_ESCAPE/);
  });

  it("ends on the newer save whichever of a start and a sync takes the lock first", async () => {
    // An older start (v3) and a newer save's sync (v4) racing, as real
    // processes contending for the one lock. If the sync goes first, the
    // start is refused; if the start goes first, the sync lands after it.
    // Either way the newer content stands.
    for (let round = 0; round < 6; round += 1) {
      rmSync(ledger, { force: true });
      writeFileSync(path.join(root, HERO), "hero v2");
      const [, sync] = await Promise.all([
        runAsync(startRequest({ [HERO]: "hero v3" }, { [HERO]: 3 })),
        runAsync({
          op: "write",
          root,
          files: [{ path: HERO, content: "hero v4", fence: 4 }],
        }),
      ]);
      expect(read(HERO), `round ${round}`).toBe("hero v4");
      expect(sync.refused).toEqual([]);
    }
  });
});

/**
 * The source generation a preview's writes are ordered by, beside each
 * path's version: a start read before a save that a sync has laid out is
 * refused — including when that save created a file the start never knew,
 * which no per-path version can name.
 */
describe("the container's generation watermark", () => {
  const NEW = "src/New.tsx";
  const MARKER = () => path.join(root, ".morph-preview-workspace");
  let stagings = 0;

  function start(
    files: Record<string, string>,
    versions: Record<string, number>,
    generation: number | null,
    prune: string[] = [],
  ): FencedWriteRequest {
    const staging = path.join(dir, `wm-staging-${stagings++}`);
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(staging, file)), { recursive: true });
      writeFileSync(path.join(staging, file), content);
    }
    return {
      op: "start",
      root,
      staging,
      files: Object.keys(files),
      prune,
      versions,
      generation,
      marker: { path: MARKER(), dirty: "dirty:start", expected: null },
      commit: null,
    };
  }

  const sync = (
    file: string,
    content: string,
    fence: number,
    generation: number,
  ) =>
    run({
      op: "write",
      root,
      files: [{ path: file, content, fence }],
      generation,
    });

  it("refuses an older start that would delete a file a newer save created", () => {
    run(start({ [HERO]: "hero v1" }, { [HERO]: 1 }, 4));
    // A newer save (generation 5) created a file; its sync laid it out.
    sync(NEW, "new v1", 1, 5);

    // Read before that save: it has neither the file nor anything older.
    const older = start({ [HERO]: "hero v1" }, { [HERO]: 1 }, 4, [NEW]);
    const result = run(older);

    expect(result.refused).toEqual([]);
    expect(result.staleGeneration).toEqual({ generation: 4, laidOut: 5 });
    expect(read(NEW)).toBe("new v1");
    expect(readLedger()).toEqual({
      files: { [HERO]: 1, [NEW]: 1 },
      generation: 5,
    });
    expect(existsSync((older as { staging: string }).staging)).toBe(false);
  });

  it("lets a start after the file's deletion remove it", () => {
    run(start({ [HERO]: "hero v1" }, { [HERO]: 1 }, 4));
    sync(NEW, "new v1", 1, 5);

    // The file was deleted (generation 6); a start read after it prunes it.
    expect(
      run(start({ [HERO]: "hero v1" }, { [HERO]: 1 }, 6, [NEW])).refused,
    ).toEqual([]);
    expect(existsSync(path.join(root, NEW))).toBe(false);
    expect(readLedger().generation).toBe(6);
  });

  it("keeps a file deleted and made again under the same name, against an older start", () => {
    run(start({ [HERO]: "hero v1" }, { [HERO]: 1 }, 6));
    // Created again (generation 7) as version 1 — the same version a
    // deleted file once had, which is why versions alone cannot order it.
    sync(NEW, "new again", 1, 7);

    const result = run(start({ [HERO]: "hero v1" }, { [HERO]: 1 }, 6, [NEW]));
    expect(result.staleGeneration).toEqual({ generation: 6, laidOut: 7 });
    expect(read(NEW)).toBe("new again");
  });

  it("raises nothing for a sync refused by its fence", () => {
    sync(HERO, "hero v4", 4, 5);
    expect(sync(HERO, "hero v3", 3, 9).refused).toEqual([HERO]);
    expect(readLedger().generation).toBe(5);
  });

  it("raises nothing for a start that fails halfway", () => {
    sync(HERO, "hero v1", 1, 5);
    const broken = start({ [HERO]: "hero v2" }, { [HERO]: 2 }, 8);
    // A staged file gone before the move: the start fails partway through.
    rmSync(path.join((broken as { staging: string }).staging, HERO));

    expect(() => run(broken)).toThrow();
    expect(readLedger()).toEqual({ files: { [HERO]: 1 }, generation: 5 });
  });

  it("reads a ledger written before generations were kept", () => {
    // What a warm container may still hold: a flat path-to-version map.
    writeFileSync(ledger, JSON.stringify({ [HERO]: 4 }));

    // Its versions still hold...
    expect(run(start({ [HERO]: "hero v3" }, { [HERO]: 3 }, 9)).refused).toEqual(
      [HERO],
    );
    // ...and it has seen no generation, so a current start goes through and
    // leaves it in the new shape.
    expect(run(start({ [HERO]: "hero v4" }, { [HERO]: 4 }, 9)).refused).toEqual(
      [],
    );
    expect(readLedger()).toEqual({ files: { [HERO]: 4 }, generation: 9 });
  });
});
