import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A Theme created from Starter 30 records the full Start preview (R-0, R1).
 * Starter 30 does not exist yet, so the current version is replaced with it
 * here; everything else is the real `ensureDefault`.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  listFiles: vi.fn(),
  initStarterTheme: vi.fn(),
}));

vi.mock("../default-storefront-document", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../default-storefront-document")>()),
  STOREFRONT_STARTER_TEMPLATE_VERSION: 30,
}));
vi.mock("@/db", () => ({ getDb: mocks.getDb }));
// The Starter upgrade record is SQL handed to D1 directly (#260); it lands.
vi.mock("cloudflare:workers", () => ({
  env: {
    DATABASE: {
      prepare: () => ({
        bind: () => ({
          run: async () => ({ meta: { changes: 1 } }),
          first: async () => null,
        }),
      }),
    },
  },
}));
vi.mock("./storefront-theme-file.dal", () => ({
  storefrontThemeFileDal: {
    listFiles: mocks.listFiles,
    initStarterTheme: mocks.initStarterTheme,
    getSourceGeneration: vi.fn(),
  },
}));
vi.mock("../storage/theme-storage.server", () => ({
  themeSourceStore: { saveFilesBatch: vi.fn() },
}));

const { storefrontDal } = await import("./storefront.dal");
const {
  STOREFRONT_STARTER_TEMPLATE_VERSION,
  createDefaultStorefrontHomeDocument,
} = await import("../default-storefront-document");

function createNewStorefrontDb() {
  const results = [
    [],
    [{ metadata: {} }],
    [{ id: "home-template", document: createDefaultStorefrontHomeDocument() }],
    [{ id: "product-template" }],
    [{ id: "layout-template" }],
  ];
  const values = vi.fn((_rows: unknown) => ({
    onConflictDoNothing: vi.fn(async () => ({ meta: { changes: 1 } })),
  }));
  const db = {
    select: vi.fn(() => {
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => results.shift() ?? []),
      };
      return chain;
    }),
    insert: vi.fn(() => ({ values })),
    update: vi.fn(() => {
      const chain = {
        set: vi.fn(() => chain),
        where: vi.fn(async () => ({ meta: { changes: 1 } })),
      };
      return chain;
    }),
  };
  return { db, values };
}

describe("a Theme created from Starter 30", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listFiles.mockResolvedValue([]);
    mocks.initStarterTheme.mockResolvedValue([]);
  });

  it("records the full Start preview", async () => {
    expect(STOREFRONT_STARTER_TEMPLATE_VERSION).toBe(30);
    const { db, values } = createNewStorefrontDb();
    mocks.getDb.mockResolvedValue(db);

    await storefrontDal.ensureDefault("sales-channel-new");

    const themes = values.mock.calls
      .flatMap((call) => call[0] as unknown)
      .filter(
        (row): row is Record<string, unknown> =>
          typeof row === "object" &&
          row !== null &&
          "storefrontId" in row &&
          "status" in row &&
          !("type" in row),
      );
    expect(themes).toEqual([
      expect.objectContaining({ name: "Default", previewRuntime: "start" }),
    ]);
  });
});
