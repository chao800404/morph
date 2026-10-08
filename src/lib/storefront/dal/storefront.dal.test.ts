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

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  listFiles: vi.fn(),
  initStarterTheme: vi.fn(),
  getSourceGeneration: vi.fn(),
  saveFilesBatch: vi.fn(),
}));

vi.mock("@/db", () => ({ getDb: mocks.getDb }));
vi.mock("./storefront-theme-file.dal", () => ({
  storefrontThemeFileDal: {
    listFiles: mocks.listFiles,
    initStarterTheme: mocks.initStarterTheme,
    getSourceGeneration: mocks.getSourceGeneration,
    saveFilesBatch: mocks.saveFilesBatch,
  },
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

  describe("a Theme on Starter version 27", () => {
    // The version before morph.pages.get. Without the bump to 28 the upgrade
    // never ran for these, however exact the byte match below.
    const workspace = (content: string) => [
      {
        id: "manifest-file",
        path: "morph.theme.json",
        content: JSON.stringify({
          name: "Starter",
          entry: "src/routes/index.tsx",
          router: { framework: "tanstack-start" },
          components: {},
        }),
        version: 3,
      },
      { id: "content-file", path: "src/morph/content.ts", content, version: 5 },
    ];
    const savedContentModule = () =>
      (mocks.saveFilesBatch.mock.calls[0]?.[2] as
        | { path: string; content?: string; expectedFileId?: string; expectedVersion?: number }[]
        | undefined)?.find((file) => file.path === "src/morph/content.ts");

    it("upgrades an untouched content module, guarded by its id and version", async () => {
      mocks.getDb.mockResolvedValue(createLegacyStarterDb(27));
      mocks.listFiles.mockResolvedValue(
        workspace(LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE),
      );

      await expect(
        storefrontDal.ensureStoredStarterPreview({
          storefrontId: "storefront-a",
          themeId: "theme-a",
          createdBy: "user-a",
        }),
      ).resolves.toBe(true);

      expect(savedContentModule()).toMatchObject({
        content: STARTER_THEME_CONTENT_MODULE_SOURCE,
        expectedFileId: "content-file",
        expectedVersion: 5,
      });
    });

    it("leaves a content module the author edited as it is", async () => {
      mocks.getDb.mockResolvedValue(createLegacyStarterDb(27));
      mocks.listFiles.mockResolvedValue(
        workspace(LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE + "\n// mine"),
      );

      await storefrontDal.ensureStoredStarterPreview({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        createdBy: "user-a",
      });

      expect(savedContentModule()).toBeUndefined();
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
