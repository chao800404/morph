// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SavedThemeFile } from "../preview-sync-guard";
import { planFencedWrite } from "../compiler/preview-write-fence";
import { syncPreviewFiles } from "./preview-file-sync";

const HERO = "src/components/Hero.tsx";

/**
 * A database and a preview disk, and `syncPreviewFiles` wired to them the way
 * the handler wires it to D1 and the sandbox: read what is saved, then write
 * through the preview's fence — `planFencedWrite` over a ledger, as the
 * container script and the sidecar do. `holdBeforeWrite` keeps one request
 * between its check and its write for as long as a test wants.
 */
function world(initial: { version: number; content: string }) {
  const database = new Map<string, SavedThemeFile>([[HERO, initial]]);
  const disk = new Map<string, string>([[HERO, initial.content]]);
  let ledger: Record<string, number> = { [HERO]: initial.version };

  const sync = (
    content: string,
    baseVersion: number,
    holdBeforeWrite?: Promise<void>,
  ) =>
    syncPreviewFiles({
      files: [{ path: HERO, content, baseVersion }],
      readSaved: async (paths) =>
        new Map(
          paths.flatMap((path) => {
            const saved = database.get(path);
            return saved ? [[path, saved] as const] : [];
          }),
        ),
      prepare: (files) => files,
      isGenerated: () => false,
      write: async (files) => {
        await holdBeforeWrite;
        // The comparison and the write are one synchronous step here, as they
        // are under the container's lock.
        const plan = planFencedWrite(
          ledger,
          files,
          Object.fromEntries(
            files.map((file) => [file.path, disk.get(file.path) ?? null]),
          ),
        );
        if (plan.refused.length > 0) {
          return { changed: [], unchanged: [], refused: plan.refused };
        }
        for (const file of plan.writes) disk.set(file.path, file.content);
        ledger = plan.ledger;
        return {
          changed: plan.writes.map((file) => file.path),
          unchanged: plan.unchanged,
        };
      },
    });

  const save = (content: string) => {
    const current = database.get(HERO)!;
    database.set(HERO, { version: current.version + 1, content });
  };

  return { database, disk, sync, save };
}

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

describe("syncPreviewFiles", () => {
  it("writes an edit of the saved version", async () => {
    const w = world({ version: 3, content: "hero v3" });
    expect(await w.sync("hero v3 + edit", 3)).toMatchObject({
      ok: true,
      changed: [HERO],
    });
    expect(w.disk.get(HERO)).toBe("hero v3 + edit");
  });

  it("refuses, and writes nothing, when a newer save landed first", async () => {
    const w = world({ version: 3, content: "hero v3" });
    w.save("hero v4 by A");
    await w.sync("hero v4 by A", 4);

    expect(await w.sync("hero v3 edited by B", 3)).toEqual({
      ok: false,
      stalePaths: [HERO],
    });
    expect(w.disk.get(HERO)).toBe("hero v4 by A");
  });
});

/**
 * The window between the check and the write, held open.
 *
 * B's edit of v3 is checked while v3 is still what is saved, so it passes
 * the database check. Before it reaches the preview, A saves v4 and syncs it.
 * Without a fence, B's write then replaced A's newer file and the preview was
 * rewound while the database kept v4 (reproduced before the fence existed).
 * With it, the preview has already taken v4, so B's write — made from v3 — is
 * refused where it lands, whatever the timing.
 */
describe("syncPreviewFiles interleaved", () => {
  it("does not let a request checked before a newer save rewind it", async () => {
    const w = world({ version: 3, content: "hero v3" });
    const hold = gate();

    const b = w.sync("hero v3 edited by B", 3, hold.opened);
    // B has read the database and is waiting to write.
    await Promise.resolve();
    await Promise.resolve();

    w.save("hero v4 by A");
    expect(await w.sync("hero v4 by A", 4)).toMatchObject({ ok: true });

    hold.open();
    // Refused at the write, reported to B exactly as a stale check would be.
    expect(await b).toEqual({ ok: false, stalePaths: [HERO] });
    expect(w.database.get(HERO)).toEqual({
      version: 4,
      content: "hero v4 by A",
    });
    expect(w.disk.get(HERO)).toBe("hero v4 by A");
  });

  it("still lets two edits of the same version through, the later winning", async () => {
    const w = world({ version: 4, content: "hero v4" });
    const hold = gate();

    const b = w.sync("hero v4 edited by B", 4, hold.opened);
    await Promise.resolve();
    await Promise.resolve();
    await w.sync("hero v4 edited by A", 4);

    hold.open();
    expect(await b).toMatchObject({ ok: true, changed: [HERO] });
    expect(w.disk.get(HERO)).toBe("hero v4 edited by B");
  });
});
