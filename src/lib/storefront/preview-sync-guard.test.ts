// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  stalePreviewSyncPaths,
  type PreviewSyncFile,
  type SavedThemeFile,
} from "./preview-sync-guard";

const HERO = "src/components/page-sections/index/starter-hero/index.tsx";
const HELLO = "src/components/hello/hello.tsx";

const saved = (entries: Record<string, SavedThemeFile>) =>
  new Map(Object.entries(entries));

describe("stalePreviewSyncPaths", () => {
  // The reproduction: tab A saves hero at v3 with its marker; tab B, still
  // holding hero as it was at v2, edits hello and sends its whole set.
  it("refuses a copy older than what another tab saved", () => {
    const files: PreviewSyncFile[] = [
      { path: HERO, content: "hero v2", baseVersion: 2 },
      { path: HELLO, content: "// RACE-B\nhello v5", baseVersion: 5 },
    ];
    expect(
      stalePreviewSyncPaths(
        files,
        saved({
          [HERO]: { version: 3, content: "hero v3 RACE-A" },
          [HELLO]: { version: 5, content: "hello v5" },
        }),
      ),
    ).toEqual([HERO]);
  });

  it("lets an edit of the saved version through", () => {
    expect(
      stalePreviewSyncPaths(
        [{ path: HERO, content: "hero v3 + typing", baseVersion: 3 }],
        saved({ [HERO]: { version: 3, content: "hero v3" } }),
      ),
    ).toEqual([]);
  });

  it("lets a tab write what is saved, whatever its copy was based on", () => {
    // Putting back its own failed edit, or taking the version that won.
    expect(
      stalePreviewSyncPaths(
        [{ path: HERO, content: "hero v4", baseVersion: 2 }],
        saved({ [HERO]: { version: 4, content: "hero v4" } }),
      ),
    ).toEqual([]);
    // A file another request has just created with the same content.
    expect(
      stalePreviewSyncPaths(
        [{ path: HELLO, content: "copied", baseVersion: null }],
        saved({ [HELLO]: { version: 1, content: "copied" } }),
      ),
    ).toEqual([]);
  });

  // Found live: B's save of v5 was in flight when A had already taken v6. B
  // claiming v6 for its copy let it pass and rewind A's save in the preview.
  it("refuses a copy whose own save lost the version to another tab", () => {
    expect(
      stalePreviewSyncPaths(
        [{ path: HERO, content: "hero v5 RACE-B2", baseVersion: 5 }],
        saved({ [HERO]: { version: 6, content: "hero v6 RACE-A2" } }),
      ),
    ).toEqual([HERO]);
  });

  it("refuses a file deleted or created elsewhere", () => {
    expect(
      stalePreviewSyncPaths(
        [{ path: HERO, content: "hero", baseVersion: 2 }],
        saved({}),
      ),
    ).toEqual([HERO]);
    expect(
      stalePreviewSyncPaths(
        [{ path: HELLO, content: "mine", baseVersion: null }],
        saved({ [HELLO]: { version: 1, content: "theirs" } }),
      ),
    ).toEqual([HELLO]);
  });

  it("lets a file nobody has saved yet through", () => {
    expect(
      stalePreviewSyncPaths(
        [{ path: "src/components/New.tsx", content: "new", baseVersion: null }],
        saved({}),
      ),
    ).toEqual([]);
  });
});

/**
 * The window the check alone leaves open.
 *
 * The check reads the database, and the write happens afterwards, so a
 * request whose check passes before a newer save lands can still write after
 * it. This models the guard on its own — check, then an unfenced write — and
 * is expected to fail: the guard cannot close this by itself. The preview's
 * write fence does; `service/preview-file-sync.test.ts` runs the same
 * interleaving through it and passes.
 */
describe("interleaved preview syncs", () => {
  it.fails("never lets an older request rewind a newer one", async () => {
    const database = new Map<string, SavedThemeFile>([
      [HERO, { version: 3, content: "hero v3" }],
    ]);
    const previewDisk = new Map<string, string>([[HERO, "hero v3"]]);

    const sync = async (
      files: PreviewSyncFile[],
      betweenCheckAndWrite?: () => Promise<void>,
    ) => {
      if (stalePreviewSyncPaths(files, database).length > 0) return false;
      await betweenCheckAndWrite?.();
      for (const file of files) previewDisk.set(file.path, file.content);
      return true;
    };

    // B's edit of v3 passes its check; before it writes, A saves v4 and syncs.
    await sync(
      [{ path: HERO, content: "hero v3 edited by B", baseVersion: 3 }],
      async () => {
        database.set(HERO, { version: 4, content: "hero v4 by A" });
        await sync([{ path: HERO, content: "hero v4 by A", baseVersion: 4 }]);
      },
    );

    expect(previewDisk.get(HERO)).toBe("hero v4 by A");
  });
});
