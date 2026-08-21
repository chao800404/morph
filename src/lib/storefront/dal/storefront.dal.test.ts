import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultStorefrontHomeDocument,
  STOREFRONT_STARTER_TEMPLATE_VERSION,
} from "../default-storefront-document";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  listFiles: vi.fn(),
  initStarterTheme: vi.fn(),
}));

vi.mock("@/db", () => ({ getDb: mocks.getDb }));
vi.mock("./storefront-theme-file.dal", () => ({
  storefrontThemeFileDal: {
    listFiles: mocks.listFiles,
    initStarterTheme: mocks.initStarterTheme,
  },
}));

import { storefrontDal } from "./storefront.dal";

function createExistingStorefrontDb() {
  const results = [
    [{ id: "storefront-a", activeThemeId: "theme-a" }],
    [{ metadata: { starterTemplateVersion: STOREFRONT_STARTER_TEMPLATE_VERSION } }],
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

describe("storefrontDal starter workspace provisioning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockResolvedValue(createExistingStorefrontDb());
    mocks.initStarterTheme.mockResolvedValue([]);
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
});
