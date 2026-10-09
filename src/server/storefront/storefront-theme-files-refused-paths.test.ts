// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The platform's build files are refused by the server, not only by the
 * editor's new-file and rename dialogs. These tests call the real handlers:
 * `createServerFn` is replaced with a stand-in that runs the validator and
 * the handler, and the store records whether anything reached it.
 */

const store = vi.hoisted(() => ({
  saveFile: vi.fn(),
  saveFilesBatch: vi.fn(),
  deleteFile: vi.fn(),
  getSourceGeneration: vi.fn(),
  listFiles: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => {
  type Validator = (data: unknown) => unknown;
  type Handler = (args: {
    data: unknown;
    context: { user: { id: string } };
  }) => unknown;
  function builder(validator: Validator = (data) => data) {
    return {
      validator: (next: Validator) => builder(next),
      middleware: () => builder(validator),
      handler:
        (handler: Handler) =>
        ({ data }: { data: unknown }) =>
          handler({ data: validator(data), context: { user: { id: "u1" } } }),
    };
  }
  return { createServerFn: () => builder() };
});

vi.mock("../middleware/auth.middleware", () => ({
  commerceAdminMiddleware: {},
}));

vi.mock("@/lib/storefront/storage/theme-storage.server", () => ({
  themeSourceStore: store,
  themeRevisionStore: {},
}));

const {
  deleteStorefrontThemeFile,
  saveStorefrontThemeFile,
  saveStorefrontThemeFilesBatch,
} = await import("./storefront-theme-files.serverFn");

type Result = { success: boolean; error?: string; message: string };
const call = (fn: unknown, data: unknown) =>
  (fn as (args: { data: unknown }) => Promise<Result>)({ data });

const theme = {
  storefrontId: "sf1",
  themeId: "th1",
  expectedSourceGeneration: 3,
};
const fileId = "00000000-0000-4000-8000-000000000001";
const REFUSED = [
  "__entry.tsx",
  "__morph_preview_worker.ts",
  "__morph_preview_client.ts",
];

function expectRefused(result: Result, path: string) {
  expect(result.success).toBe(false);
  expect(result.error).toBe("THEME_PATH_REFUSED");
  expect(result.message).toContain(path);
  expect(store.saveFile).not.toHaveBeenCalled();
  expect(store.saveFilesBatch).not.toHaveBeenCalled();
  expect(store.deleteFile).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveStorefrontThemeFile", () => {
  it.each(REFUSED)("refuses creating %s", async (path) => {
    const result = await call(saveStorefrontThemeFile, {
      ...theme,
      path,
      content: "export {}",
      expectMissing: true,
    });
    expectRefused(result, path);
  });

  it("refuses overwriting an existing platform file", async () => {
    const result = await call(saveStorefrontThemeFile, {
      ...theme,
      path: "__entry.tsx",
      content: "export {}",
      expectedFileId: fileId,
      expectedVersion: 1,
    });
    expectRefused(result, "__entry.tsx");
  });

  it.each(["vite.config.ts", "wrangler.jsonc", "src/routeTree.gen.ts"])(
    "still saves the author-owned source-only file %s",
    async (path) => {
      store.saveFile.mockResolvedValue({ path, sourceGeneration: 4 });
      const result = await call(saveStorefrontThemeFile, {
        ...theme,
        path,
        content: "export default {}",
        expectMissing: true,
      });
      expect(result.success).toBe(true);
      expect(store.saveFile).toHaveBeenCalledWith(
        "sf1",
        "th1",
        path,
        "export default {}",
        undefined,
        expect.objectContaining({ expectMissing: true }),
      );
    },
  );
});

describe("saveStorefrontThemeFilesBatch", () => {
  const batch = (extra: Record<string, unknown>) => ({
    ...theme,
    files: [],
    ...extra,
  });

  it("refuses a written file", async () => {
    const result = await call(
      saveStorefrontThemeFilesBatch,
      batch({
        files: [
          { path: "src/ok.ts", content: "", expectMissing: true },
          {
            path: "__morph_preview_worker.ts",
            content: "",
            expectMissing: true,
          },
        ],
      }),
    );
    expectRefused(result, "__morph_preview_worker.ts");
  });

  it("refuses a deletion", async () => {
    const result = await call(
      saveStorefrontThemeFilesBatch,
      batch({
        deletions: [
          { path: "__entry.tsx", expectedFileId: fileId, expectedVersion: 1 },
        ],
      }),
    );
    expectRefused(result, "__entry.tsx");
  });

  it("refuses a route move onto a platform file", async () => {
    const result = await call(
      saveStorefrontThemeFilesBatch,
      batch({
        files: [{ path: "src/x.ts", content: "", expectMissing: true }],
        routePathMoves: [
          {
            fromSourcePath: "src/routes/about.tsx",
            toSourcePath: "__morph_preview_client.ts",
          },
        ],
      }),
    );
    expectRefused(result, "__morph_preview_client.ts");
  });

  it("refuses a route move away from a platform file", async () => {
    const result = await call(
      saveStorefrontThemeFilesBatch,
      batch({
        files: [{ path: "src/x.ts", content: "", expectMissing: true }],
        routePathMoves: [
          {
            fromSourcePath: "__entry.tsx",
            toSourcePath: "src/routes/entry.tsx",
          },
        ],
      }),
    );
    expectRefused(result, "__entry.tsx");
  });

  it("refuses a binary copy onto a platform file", async () => {
    const result = await call(
      saveStorefrontThemeFilesBatch,
      batch({
        binaryCopies: [
          {
            from: "public/hero.png",
            to: "__entry.tsx",
            expectedFileId: fileId,
            expectedVersion: 1,
          },
        ],
      }),
    );
    expectRefused(result, "__entry.tsx");
  });

  it("still saves source-only files in a batch", async () => {
    store.saveFilesBatch.mockResolvedValue({ sourceGeneration: 4 });
    const result = await call(
      saveStorefrontThemeFilesBatch,
      batch({
        files: [
          { path: "vite.config.ts", content: "", expectMissing: true },
          { path: "src/routeTree.gen.ts", content: "", expectMissing: true },
        ],
        deletions: [
          { path: "wrangler.json", expectedFileId: fileId, expectedVersion: 1 },
        ],
      }),
    );
    expect(result.success).toBe(true);
    expect(store.saveFilesBatch).toHaveBeenCalledTimes(1);
  });
});

describe("deleteStorefrontThemeFile", () => {
  it.each(REFUSED)("refuses deleting %s", async (path) => {
    const result = await call(deleteStorefrontThemeFile, {
      ...theme,
      path,
      expectedFileId: fileId,
      expectedVersion: 1,
    });
    expectRefused(result, path);
  });

  it("still deletes a source-only file", async () => {
    store.deleteFile.mockResolvedValue(true);
    store.getSourceGeneration.mockResolvedValue(4);
    const result = await call(deleteStorefrontThemeFile, {
      ...theme,
      path: "vite.config.ts",
      expectedFileId: fileId,
      expectedVersion: 1,
    });
    expect(result.success).toBe(true);
    expect(store.deleteFile).toHaveBeenCalledTimes(1);
  });
});
