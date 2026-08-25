import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultStorefrontHomeDocument,
  STOREFRONT_STARTER_TEMPLATE_VERSION,
} from "../default-storefront-document";
import { LEGACY_STARTER_THEME_INDEX_SOURCE } from "../starter-theme-v3-files";

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

function createExistingStorefrontDb() {
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
  };
  return db;
}

function createLegacyStarterDb() {
  const results = [
    [{ metadata: { starterTemplateVersion: 2 } }],
    [{ metadata: { starterTemplateVersion: 2 } }],
    [{ id: "home-template", document: createDefaultStorefrontHomeDocument() }],
    [{ id: "product-template" }],
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
