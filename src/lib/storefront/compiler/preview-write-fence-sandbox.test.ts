// @vitest-environment node
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect(JSON.parse(readFileSync(ledger, "utf8"))).toEqual({ [HERO]: 3 });
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

  it("seeds by raising, never lowering, what is recorded", () => {
    run({
      op: "write",
      root,
      files: [{ path: HERO, content: "hero v5", fence: 5 }],
    });
    run({ op: "seed", versions: { [HERO]: 4, "src/Other.tsx": 2 } });
    expect(JSON.parse(readFileSync(ledger, "utf8"))).toEqual({
      [HERO]: 5,
      "src/Other.tsx": 2,
    });
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
    expect(JSON.parse(readFileSync(ledger, "utf8"))).toEqual({ [HERO]: 10 });
    // Every write either went through or was refused; none half-happened.
    for (const result of results) {
      expect(result.changed.length + result.refused.length).toBe(1);
    }
  });
});
