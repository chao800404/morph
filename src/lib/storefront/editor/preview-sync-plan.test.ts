// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ThemeWorkspaceFileState } from "@/lib/storefront/store/theme-workspace-store";
import {
  awaitsOwnSave,
  planPreviewSync,
  waitForOwnSaves,
} from "./preview-sync-plan";

const saved = (
  path: string,
  content: string,
  version: number,
  overrides: Partial<ThemeWorkspaceFileState> = {},
): ThemeWorkspaceFileState =>
  ({
    path,
    serverExists: true,
    serverFileId: `id-${path}`,
    serverVersion: version,
    serverContent: content,
    localContent: content,
    dirty: false,
    saveState: "clean",
    ...overrides,
  }) as ThemeWorkspaceFileState;

const HERO = "src/hero.tsx";
const HELLO = "src/hello.tsx";

describe("planPreviewSync", () => {
  const workspace = {
    [HERO]: saved(HERO, "hero v2", 2),
    [HELLO]: saved(HELLO, "hello v5", 5),
  };

  it("sends only what this tab changed, with the version it was edited from", () => {
    expect(
      planPreviewSync(
        [
          { path: HERO, content: "hero v2" },
          { path: HELLO, content: "// RACE-B\nhello v5" },
        ],
        workspace,
        new Map(),
      ),
    ).toEqual([
      { path: HELLO, content: "// RACE-B\nhello v5", baseVersion: 5 },
    ]);
  });

  it("puts back what this tab wrote before, even once it matches the saved copy", () => {
    // Its save failed and it reverted, or it took the version another tab won.
    expect(
      planPreviewSync(
        [{ path: HERO, content: "hero v2" }],
        workspace,
        new Map([[HERO, "hero v2 with a failed edit"]]),
      ),
    ).toEqual([{ path: HERO, content: "hero v2", baseVersion: 2 }]);
  });

  it("leaves a file alone once the preview holds what this tab wrote", () => {
    expect(
      planPreviewSync(
        [{ path: HERO, content: "hero v2" }],
        workspace,
        new Map([[HERO, "hero v2"]]),
      ),
    ).toEqual([]);
  });

  it("does not claim the version a save in flight might produce", () => {
    expect(
      planPreviewSync(
        [{ path: HERO, content: "hero v2 + more" }],
        { [HERO]: saved(HERO, "hero v2", 2, { saveState: "saving" }) },
        new Map(),
      ),
    ).toEqual([{ path: HERO, content: "hero v2 + more", baseVersion: 2 }]);
  });

  it("sends a file that was never saved, from no version", () => {
    expect(
      planPreviewSync(
        [{ path: "src/New.tsx", content: "new" }],
        {
          "src/New.tsx": {
            path: "src/New.tsx",
            serverExists: false,
            serverFileId: null,
            serverVersion: null,
            serverContent: "",
            localContent: "new",
            dirty: true,
            saveState: "dirty",
          },
        },
        new Map(),
      ),
    ).toEqual([{ path: "src/New.tsx", content: "new", baseVersion: null }]);
    // Not in the workspace at all: sent, from no version.
    expect(
      planPreviewSync([{ path: "src/Copy.tsx", content: "c" }], {}, new Map()),
    ).toEqual([{ path: "src/Copy.tsx", content: "c", baseVersion: null }]);
  });
});

describe("awaitsOwnSave", () => {
  it("only when every refused file is being saved by this tab", () => {
    const workspace = {
      [HERO]: saved(HERO, "hero", 2, { saveState: "saving" }),
      [HELLO]: saved(HELLO, "hello", 5),
    };
    expect(awaitsOwnSave([HERO], workspace)).toBe(true);
    expect(awaitsOwnSave([HERO, HELLO], workspace)).toBe(false);
    expect(awaitsOwnSave([], workspace)).toBe(false);
  });
});

describe("waitForOwnSaves", () => {
  it("resolves once the save returns", async () => {
    let state: ThemeWorkspaceFileState = saved(HERO, "hero", 2, {
      saveState: "saving",
    });
    setTimeout(() => {
      state = saved(HERO, "hero", 3);
    }, 30);
    const started = Date.now();
    await waitForOwnSaves(() => ({ [HERO]: state }), [HERO], {
      intervalMs: 5,
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it("gives up after the timeout", async () => {
    await expect(
      waitForOwnSaves(
        () => ({ [HERO]: saved(HERO, "hero", 2, { saveState: "saving" }) }),
        [HERO],
        { intervalMs: 5, timeoutMs: 20 },
      ),
    ).resolves.toBeUndefined();
  });
});
