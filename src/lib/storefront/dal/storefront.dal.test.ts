import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultStorefrontHomeDocument,
  STOREFRONT_STARTER_TEMPLATE_VERSION,
} from "../default-storefront-document";
import {
  LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE,
  LEGACY_STARTER_THEME_INDEX_SOURCE,
  STARTER_THEME_CONTENT_MODULE_SOURCE,
} from "../starter-theme-v3-files";
import { starterThemeWorkspaceFiles } from "../starter-theme-files";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  listFiles: vi.fn(),
  initStarterTheme: vi.fn(),
  getSourceGeneration: vi.fn(),
  /** The source store's save: the one the upgrade writes through. */
  saveFilesBatch: vi.fn(),
  /** The DAL's own save, which records a revision with no manifest. */
  dalSaveFilesBatch: vi.fn(),
}));

vi.mock("@/db", () => ({ getDb: mocks.getDb }));
vi.mock("./storefront-theme-file.dal", () => ({
  storefrontThemeFileDal: {
    listFiles: mocks.listFiles,
    initStarterTheme: mocks.initStarterTheme,
    getSourceGeneration: mocks.getSourceGeneration,
    saveFilesBatch: mocks.dalSaveFilesBatch,
  },
}));
vi.mock("../storage/theme-storage.server", () => ({
  themeSourceStore: { saveFilesBatch: mocks.saveFilesBatch },
}));

import { storefrontDal } from "./storefront.dal";

/** Rows every `db.insert(...).values(...)` in one test was given. */
function insertedRows(db: { insert: unknown }): unknown[] {
  return (db.insert as ReturnType<typeof vi.fn>).mock.results.flatMap(
    (result) =>
      (
        result.value as { values: ReturnType<typeof vi.fn> }
      ).values.mock.calls.flatMap((call) => call[0]),
  );
}

function createExistingStorefrontDb(options?: { layoutTemplate?: boolean }) {
  const results = [
    [{ id: "storefront-a", activeThemeId: "theme-a" }],
    [
      {
        metadata: {
          starterTemplateVersion: STOREFRONT_STARTER_TEMPLATE_VERSION,
        },
      },
    ],
    [
      {
        metadata: {
          starterTemplateVersion: STOREFRONT_STARTER_TEMPLATE_VERSION,
        },
      },
    ],
    [{ id: "home-template", document: createDefaultStorefrontHomeDocument() }],
    [{ id: "product-template" }],
    ...(options?.layoutTemplate === false ? [[]] : [[{ id: "layout-template" }]]),
  ];
  const db = {
    select: vi.fn(() => {
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => results.shift() ?? []),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: vi.fn(async () => ({ meta: { changes: 1 } })),
    })),
  };
  return db;
}

function createLegacyStarterDb(starterTemplateVersion = 2) {
  const results = [
    [{ metadata: { starterTemplateVersion } }],
    [{ metadata: { starterTemplateVersion } }],
    [{ id: "home-template", document: createDefaultStorefrontHomeDocument() }],
    [{ id: "product-template" }],
    [{ id: "layout-template" }],
  ];
  const db = {
    select: vi.fn(() => {
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => results.shift() ?? []),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: vi.fn(async () => ({ meta: { changes: 1 } })),
    })),
    update: vi.fn(() => {
      const chain = {
        set: vi.fn(() => chain),
        where: vi.fn(async () => ({ meta: { changes: 1 } })),
      };
      return chain;
    }),
  };
  return db;
}

describe("storefrontDal starter workspace provisioning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockResolvedValue(createExistingStorefrontDb());
    mocks.initStarterTheme.mockResolvedValue([]);
    mocks.getSourceGeneration.mockResolvedValue(4);
    mocks.saveFilesBatch.mockResolvedValue([]);
  });

  it("creates the shell template for a theme that predates it", async () => {
    // No shell row comes back, which is every theme provisioned before header
    // and footer content had a document of its own to live in.
    const db = createExistingStorefrontDb({ layoutTemplate: false });
    mocks.getDb.mockResolvedValue(db);
    mocks.listFiles.mockResolvedValue([{ path: "src/routes/index.tsx" }]);

    await storefrontDal.ensureDefault("sales-channel-a");

    expect(insertedRows(db)).toContainEqual(
      expect.objectContaining({ type: "layout" }),
    );
  });

  it("initializes an existing Default theme when its source workspace is empty", async () => {
    mocks.listFiles.mockResolvedValue([]);

    await storefrontDal.ensureDefault("sales-channel-a");

    expect(mocks.listFiles).toHaveBeenCalledWith("storefront-a", "theme-a");
    expect(mocks.initStarterTheme).toHaveBeenCalledWith(
      "storefront-a",
      "theme-a",
    );
  });

  it("preserves an existing authored workspace", async () => {
    mocks.listFiles.mockResolvedValue([{ path: "src/components/Custom.tsx" }]);

    await storefrontDal.ensureDefault("sales-channel-a");

    expect(mocks.initStarterTheme).not.toHaveBeenCalled();
  });

  it("atomically upgrades the Starter route workspace and removes its obsolete page", async () => {
    mocks.getDb.mockResolvedValue(createLegacyStarterDb());
    mocks.listFiles.mockResolvedValue([
      {
        id: "index-file",
        path: "src/pages/index.tsx",
        content: LEGACY_STARTER_THEME_INDEX_SOURCE,
        version: 1,
      },
      {
        id: "manifest-file",
        path: "morph.theme.json",
        content: JSON.stringify({
          components: {},
          sections: {},
          entry: "src/pages/index.tsx",
        }),
        version: 3,
      },
    ]);
    mocks.getSourceGeneration.mockResolvedValue(12);

    await expect(
      storefrontDal.ensureStoredStarterPreview({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        createdBy: "user-a",
      }),
    ).resolves.toBe(true);

    expect(mocks.saveFilesBatch).toHaveBeenCalledWith(
      "storefront-a",
      "theme-a",
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/components/EditorialIntro.tsx",
          expectMissing: true,
        }),
        expect.objectContaining({ path: "morph.theme.json" }),
      ]),
      expect.objectContaining({
        expectedSourceGeneration: 12,
        deletions: [
          {
            path: "src/pages/index.tsx",
            expectedFileId: "index-file",
            expectedVersion: 1,
          },
        ],
        createRevision: true,
        createdBy: "user-a",
      }),
    );
  });

  describe("a source-first Theme on Starter version 27", () => {
    // The files a store is created with: no morph.theme.json, section
    // components under `sections/`.
    const workspace = (content: string) =>
      starterThemeWorkspaceFiles().map((file, index) => ({
        id: `file-${index}`,
        path: file.path,
        content: file.path === "src/morph/content.ts" ? content : file.content,
        version: 3,
      }));
    const saved = () =>
      mocks.saveFilesBatch.mock.calls[0]?.[2] as
        | { path: string; content?: string; expectedFileId?: string }[]
        | undefined;

    it("writes exactly the untouched content module on editor load", async () => {
      mocks.getDb.mockResolvedValue(createLegacyStarterDb(27));
      const files = workspace(LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE);
      mocks.listFiles.mockResolvedValue(files);

      await expect(
        storefrontDal.ensureStoredStarterPreview({
          storefrontId: "storefront-a",
          themeId: "theme-a",
          createdBy: "user-a",
        }),
      ).resolves.toBe(true);

      expect(saved()).toEqual([
        expect.objectContaining({
          path: "src/morph/content.ts",
          content: STARTER_THEME_CONTENT_MODULE_SOURCE,
          expectedFileId: files.find(
            (file) => file.path === "src/morph/content.ts",
          )!.id,
          expectedVersion: 3,
        }),
      ]);
    });

    it("writes through the source store, never the DAL's own save", async () => {
      // The DAL's save records the revision without a manifest and refuses
      // that for a workspace holding a binary file, which failed the editor
      // load for every Theme with an uploaded image. The source store builds
      // the manifest.
      mocks.getDb.mockResolvedValue(createLegacyStarterDb(27));
      mocks.listFiles.mockResolvedValue(
        workspace(LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE),
      );

      await storefrontDal.ensureStoredStarterPreview({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        createdBy: "user-a",
      });

      expect(mocks.saveFilesBatch).toHaveBeenCalledTimes(1);
      expect(mocks.saveFilesBatch.mock.calls[0]?.[3]).toMatchObject({
        createRevision: true,
        createdBy: "user-a",
      });
      expect(mocks.dalSaveFilesBatch).not.toHaveBeenCalled();
    });

    it("writes nothing when the content module was edited", async () => {
      mocks.getDb.mockResolvedValue(createLegacyStarterDb(27));
      mocks.listFiles.mockResolvedValue(
        workspace(LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE + "\n// mine"),
      );

      await storefrontDal.ensureStoredStarterPreview({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        createdBy: "user-a",
      });

      expect(mocks.saveFilesBatch).not.toHaveBeenCalled();
    });

    it("does nothing on the next load, once the Theme is on the current version", async () => {
      const db = createLegacyStarterDb(STOREFRONT_STARTER_TEMPLATE_VERSION);
      mocks.getDb.mockResolvedValue(db);
      mocks.listFiles.mockResolvedValue(
        workspace(LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE),
      );

      await expect(
        storefrontDal.ensureStoredStarterPreview({
          storefrontId: "storefront-a",
          themeId: "theme-a",
          createdBy: "user-a",
        }),
      ).resolves.toBe(false);

      expect(mocks.listFiles).not.toHaveBeenCalled();
      expect(mocks.saveFilesBatch).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });

    it("keeps the Theme on 27 when the write is refused, so the next load plans again", async () => {
      const db = createLegacyStarterDb(27);
      mocks.getDb.mockResolvedValue(db);
      mocks.listFiles.mockResolvedValue(
        workspace(LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE),
      );
      mocks.saveFilesBatch.mockRejectedValueOnce(
        new Error("CONFLICT_VERSION_MISMATCH"),
      );

      await expect(
        storefrontDal.ensureStoredStarterPreview({
          storefrontId: "storefront-a",
          themeId: "theme-a",
          createdBy: "user-a",
        }),
      ).rejects.toThrow("CONFLICT_VERSION_MISMATCH");
      // The version is written only after the files; it was not.
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  it("does not mutate a theme outside the requested storefront", async () => {
    const db = {
      select: vi.fn(() => {
        const chain = {
          from: vi.fn(() => chain),
          where: vi.fn(() => chain),
          limit: vi.fn(async () => []),
        };
        return chain;
      }),
    };
    mocks.getDb.mockResolvedValue(db);

    await expect(
      storefrontDal.ensureStoredStarterPreview({
        storefrontId: "storefront-a",
        themeId: "theme-from-another-storefront",
        createdBy: "user-a",
      }),
    ).resolves.toBe(false);
    expect(mocks.listFiles).not.toHaveBeenCalled();
    expect(mocks.saveFilesBatch).not.toHaveBeenCalled();
  });
});
