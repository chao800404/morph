// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SavedThemeFile } from "../preview-sync-guard";
import { syncPreviewFiles } from "./preview-file-sync";

const HERO = "src/components/Hero.tsx";

/**
 * A database and a preview disk, and `syncPreviewFiles` wired to them the way
 * the handler wires it to D1 and the sandbox: read what is saved, then write
 * what differs. `holdBeforeWrite` keeps one request between its check and its
 * write for as long as a test wants.
 */
function world(initial: { version: number; content: string }) {
  const database = new Map<string, SavedThemeFile>([[HERO, initial]]);
  const disk = new Map<string, string>([[HERO, initial.content]]);

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
        const changed: string[] = [];
        const unchanged: string[] = [];
        for (const file of files) {
          if (disk.get(file.path) === file.content) unchanged.push(file.path);
          else {
            disk.set(file.path, file.content);
            changed.push(file.path);
          }
        }
        return { changed, unchanged };
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
 * B's edit of v3 is checked while v3 is still what is saved, so it passes.
 * Before it reaches the preview, A saves v4 and syncs it. When B's write goes
 * ahead it replaces A's newer file: the preview is rewound while the database
 * keeps v4. This runs the handler's own sequence, not a model of it.
 *
 * Expected to fail until the preview's writes are fenced or serialised; it
 * will start passing — and `it.fails` will then report it — once they are.
 */
describe("syncPreviewFiles interleaved", () => {
  it.fails(
    "does not let a request checked before a newer save rewind it",
    async () => {
      const w = world({ version: 3, content: "hero v3" });
      const hold = gate();

      const b = w.sync("hero v3 edited by B", 3, hold.opened);
      // B has read the database and is waiting to write.
      await Promise.resolve();
      await Promise.resolve();

      w.save("hero v4 by A");
      expect(await w.sync("hero v4 by A", 4)).toMatchObject({ ok: true });
      expect(w.disk.get(HERO)).toBe("hero v4 by A");

      hold.open();
      await b;

      expect(w.database.get(HERO)?.content).toBe("hero v4 by A");
      expect(w.disk.get(HERO)).toBe("hero v4 by A");
    },
  );

  it("does rewind today: B's older edit is what the preview ends up with", async () => {
    // The same interleaving, asserting what actually happens, so the
    // reproduction is visible as a passing test and not only as an expected
    // failure.
    const w = world({ version: 3, content: "hero v3" });
    const hold = gate();

    const b = w.sync("hero v3 edited by B", 3, hold.opened);
    await Promise.resolve();
    await Promise.resolve();

    w.save("hero v4 by A");
    await w.sync("hero v4 by A", 4);

    hold.open();
    expect(await b).toMatchObject({ ok: true, changed: [HERO] });
    expect(w.disk.get(HERO)).toBe("hero v3 edited by B");
    expect(w.database.get(HERO)).toEqual({
      version: 4,
      content: "hero v4 by A",
    });
  });
});
