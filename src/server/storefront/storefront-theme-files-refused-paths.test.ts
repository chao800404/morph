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

describe("other spellings of a platform file", () => {
  // Stored paths are the parsed input, compared exactly (no case folding, as
  // in every build and preview check). So a spelling either fails parsing or
  // parses to the refused path; none reaches the store as something else.
  const UNSAFE = [
    "./__entry.tsx",
    "src/../__entry.tsx",
    "/__entry.tsx",
    ".\\__entry.tsx",
    "src\\..\\__entry.tsx",
    "__entry.tsx\0",
  ];

  function expectNothingWritten(result: Result) {
    expect(result.success).toBe(false);
    expect(store.saveFile).not.toHaveBeenCalled();
    expect(store.saveFilesBatch).not.toHaveBeenCalled();
  }

  it.each(UNSAFE)("does not save %j", async (path) => {
    const result = await call(saveStorefrontThemeFile, {
      ...theme,
      path,
      content: "",
      expectMissing: true,
    });
    expectNothingWritten(result);
    expect(result.error).toBe("INVALID_INPUT");
  });

  it.each(UNSAFE)("does not move or copy onto %j", async (path) => {
    for (const extra of [
      {
        files: [{ path: "src/x.ts", content: "", expectMissing: true }],
        routePathMoves: [
          { fromSourcePath: "src/routes/a.tsx", toSourcePath: path },
        ],
      },
      {
        binaryCopies: [
          {
            from: "public/a.png",
            to: path,
            expectedFileId: fileId,
            expectedVersion: 1,
          },
        ],
      },
    ]) {
      const result = await call(saveStorefrontThemeFilesBatch, {
        ...theme,
        files: [],
        ...extra,
      });
      expectNothingWritten(result);
      expect(result.error).toBe("INVALID_INPUT");
    }
  });

  it("trims surrounding whitespace before checking, as the store does", async () => {
    const result = await call(saveStorefrontThemeFile, {
      ...theme,
      path: "  __entry.tsx  ",
      content: "",
      expectMissing: true,
    });
    expectRefused(result, "__entry.tsx");
  });
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

  it("writes nothing of a batch that mixes valid changes with one refused path", async () => {
    // Valid writes, a deletion, a move and a copy around the one refused file:
    // the whole batch is checked before any of it reaches the store.
    const result = await call(
      saveStorefrontThemeFilesBatch,
      batch({
        files: [
          { path: "src/components/Hero.tsx", content: "", expectMissing: true },
          { path: "vite.config.ts", content: "", expectMissing: true },
          { path: "__entry.tsx", content: "", expectMissing: true },
          { path: "src/routes/b.tsx", content: "", expectMissing: true },
        ],
        deletions: [
          { path: "src/old.ts", expectedFileId: fileId, expectedVersion: 1 },
        ],
        routePathMoves: [
          {
            fromSourcePath: "src/routes/a.tsx",
            toSourcePath: "src/routes/b.tsx",
          },
        ],
        binaryCopies: [
          {
            from: "public/a.png",
            to: "public/b.png",
            expectedFileId: fileId,
            expectedVersion: 1,
          },
        ],
      }),
    );
    expectRefused(result, "__entry.tsx");
    for (const method of Object.values(store)) {
      expect(method).not.toHaveBeenCalled();
    }
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

  // A workspace that already holds one cannot be built or previewed;
  // removing it is the only way back.
  it("lets a platform file be deleted", async () => {
    store.saveFilesBatch.mockResolvedValue({ sourceGeneration: 4 });
    const result = await call(
      saveStorefrontThemeFilesBatch,
      batch({
        deletions: [
          { path: "__entry.tsx", expectedFileId: fileId, expectedVersion: 1 },
        ],
      }),
    );
    expect(result.success).toBe(true);
    expect(store.saveFilesBatch).toHaveBeenCalledTimes(1);
  });

  // Not needed to recover, so not opened: only deletion is.
  it("refuses a route move away from a platform file", async () => {
    const result = await call(
      saveStorefrontThemeFilesBatch,
      batch({
        files: [
          { path: "src/routes/entry.tsx", content: "", expectMissing: true },
        ],
        deletions: [
          { path: "__entry.tsx", expectedFileId: fileId, expectedVersion: 1 },
        ],
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
});

describe("deleteStorefrontThemeFile", () => {
  it.each([...REFUSED, "vite.config.ts"])("deletes %s", async (path) => {
    store.deleteFile.mockResolvedValue(true);
    store.getSourceGeneration.mockResolvedValue(4);
    const result = await call(deleteStorefrontThemeFile, {
      ...theme,
      path,
      expectedFileId: fileId,
      expectedVersion: 1,
    });
    expect(result.success).toBe(true);
    expect(store.deleteFile).toHaveBeenCalledTimes(1);
  });
});
