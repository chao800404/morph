// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { planNewThemePage } from "@/lib/storefront/compiler/theme-page-scaffold";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";

/**
 * Adding and deleting a page writes TanStack Start route files, so the
 * server refuses both for a Theme whose record names another framework,
 * before anything is planned or written. The real handlers run: as in
 * storefront-theme-files-refused-paths.test.ts, `createServerFn` is a
 * stand-in that runs the validator and the handler, and the stores record
 * whether anything reached them.
 */

const store = vi.hoisted(() => ({
  saveFile: vi.fn(),
  deleteFile: vi.fn(),
  getSourceGeneration: vi.fn(),
  listFiles: vi.fn(),
}));
const revisions = vi.hoisted(() => ({ createRevision: vi.fn() }));
const recorded = vi.hoisted(() => ({
  readThemeFramework: vi.fn<() => Promise<string | null | undefined>>(),
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
  themeRevisionStore: revisions,
}));

vi.mock("@/lib/storefront/dal/storefront-theme-build.dal", () => ({
  storefrontThemeBuildDal: recorded,
}));

const { createStorefrontThemePage, deleteStorefrontThemePage } =
  await import("./storefront-theme-files.serverFn");

type Result = { success: boolean; error?: string; message: string };
const call = (fn: unknown, data: unknown) =>
  (fn as (args: { data: unknown }) => Promise<Result>)({ data });

const theme = {
  storefrontId: "sf1",
  themeId: "th1",
  expectedSourceGeneration: 3,
};
const fileId = "00000000-0000-4000-8000-000000000001";

// The Starter's files, which plan a page cleanly as Start: whatever is
// refused below is refused by the record, not by the files.
const ABOUT = planNewThemePage({
  requestedPath: "/about",
  existingPaths: STARTER_THEME_FILES.map((file) => file.path),
});
if (!ABOUT.ok) throw new Error(ABOUT.reason);
const withAbout = [
  ...STARTER_THEME_FILES,
  { path: ABOUT.sourcePath, content: ABOUT.content },
].map((file) => ({ ...file, id: `id-${file.path}`, version: 1 }));

const create = () =>
  call(createStorefrontThemePage, { ...theme, routePath: "/journal" });
const remove = () =>
  call(deleteStorefrontThemePage, {
    ...theme,
    sourcePath: ABOUT.sourcePath,
    expectedFileId: fileId,
    expectedVersion: 1,
  });

beforeEach(() => {
  vi.clearAllMocks();
  store.listFiles.mockResolvedValue(withAbout);
  store.getSourceGeneration.mockResolvedValue(4);
  store.saveFile.mockResolvedValue({ sourceGeneration: 4 });
  store.deleteFile.mockResolvedValue(true);
  revisions.createRevision.mockResolvedValue({});
});

describe("adding and deleting a page on a Theme of another framework", () => {
  it.each(["astro", "nuxt"])(
    "refuses both for a Theme recorded as %s, and plans or writes nothing",
    async (framework) => {
      recorded.readThemeFramework.mockResolvedValue(framework);
      for (const result of [await create(), await remove()]) {
        expect(result.success).toBe(false);
        expect(result.error).toBe("THEME_FRAMEWORK_UNAVAILABLE");
        expect(result.message).toContain(`${framework} Themes`);
      }
      expect(recorded.readThemeFramework).toHaveBeenCalledWith("sf1", "th1");
      expect(store.listFiles).not.toHaveBeenCalled();
      expect(store.saveFile).not.toHaveBeenCalled();
      expect(store.deleteFile).not.toHaveBeenCalled();
      expect(revisions.createRevision).not.toHaveBeenCalled();
    },
  );
});

describe("adding and deleting a page on a Start Theme", () => {
  it.each([null, "tanstack-start"])(
    "adds and deletes as before when the record is %s",
    async (framework) => {
      recorded.readThemeFramework.mockResolvedValue(framework);

      const created = await create();
      expect(created).toMatchObject({ success: true });
      expect(store.saveFile).toHaveBeenCalledWith(
        "sf1",
        "th1",
        "src/routes/journal.tsx",
        expect.any(String),
        "text/tsx",
        expect.objectContaining({ expectMissing: true }),
      );

      const deleted = await remove();
      expect(deleted).toMatchObject({ success: true });
      expect(revisions.createRevision).toHaveBeenCalledTimes(1);
      expect(store.deleteFile).toHaveBeenCalledWith(
        "sf1",
        "th1",
        ABOUT.sourcePath,
        fileId,
        1,
        { expectedSourceGeneration: 3 },
      );
    },
  );
});
