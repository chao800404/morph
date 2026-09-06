import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  resolveForTheme: vi.fn(),
  hasChannelProducts: vi.fn(),
  getSourceGeneration: vi.fn(),
  listFiles: vi.fn(),
  saveFilesBatch: vi.fn(),
}));
vi.mock("../dal/store-context.dal", () => ({ storeContextDal: mocks }));
vi.mock("../dal/store-catalog.dal", () => ({ storeCatalogDal: mocks }));
vi.mock("../storage/theme-storage.server", () => ({ themeSourceStore: mocks }));
import {
  ensureThemeCatalog,
  planThemeCatalogFiles,
} from "./theme-catalog-setup";
import { STARTER_THEME_FILES } from "../starter-theme-files";
import { STARTER_THEME_CATALOG_FILES } from "../starter-theme-catalog-files";
const input = {
  storefrontId: "storefront",
  themeId: "theme",
  createdBy: "verified-admin",
};
describe("automatic catalog source setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveForTheme.mockResolvedValue({ salesChannelId: "sc" });
    mocks.hasChannelProducts.mockResolvedValue(true);
    mocks.getSourceGeneration.mockResolvedValue(8);
    mocks.listFiles.mockResolvedValue(STARTER_THEME_FILES);
    mocks.saveFilesBatch.mockResolvedValue([]);
  });
  it("adds one shared pair of routes with atomic OCC and a revision", async () => {
    expect(await ensureThemeCatalog(input)).toBe(true);
    expect(mocks.saveFilesBatch).toHaveBeenCalledWith(
      "storefront",
      "theme",
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/routes/products.$slug.tsx",
          expectMissing: true,
        }),
      ]),
      {
        expectedSourceGeneration: 8,
        createdBy: "verified-admin",
        createRevision: true,
        revisionMessage: "Create storefront product catalog routes",
      },
    );
    expect(mocks.getSourceGeneration.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.listFiles.mock.invocationCallOrder[0],
    );
  });
  it("is idempotent and preserves existing source", () => {
    expect(
      planThemeCatalogFiles([
        ...STARTER_THEME_FILES,
        ...STARTER_THEME_CATALOG_FILES,
      ]),
    ).toEqual([]);
    expect(
      planThemeCatalogFiles([
        ...STARTER_THEME_FILES,
        {
          path: "src/routes/products.tsx",
          content:
            'import {createFileRoute} from "@tanstack/react-router"; export const Route=createFileRoute("/products")({component: Custom}); function Custom(){return <p>Authored</p>}',
        },
      ]),
    ).toEqual([]);
    expect(
      planThemeCatalogFiles([
        ...STARTER_THEME_FILES,
        {
          path: "src/components/ProductList.tsx",
          content: "export default function Custom(){return null}",
        },
      ]),
    ).toEqual([]);
  });
  it("does not generate source for an unrelated theme or an empty channel", async () => {
    mocks.resolveForTheme.mockResolvedValue(null);
    expect(await ensureThemeCatalog(input)).toBe(false);
    expect(mocks.hasChannelProducts).not.toHaveBeenCalled();
    mocks.resolveForTheme.mockResolvedValue({ salesChannelId: "sc" });
    mocks.hasChannelProducts.mockResolvedValue(false);
    expect(await ensureThemeCatalog(input)).toBe(false);
    expect(mocks.saveFilesBatch).not.toHaveBeenCalled();
  });
  it("propagates conflicts without overwrite, retry or publish", async () => {
    mocks.saveFilesBatch.mockRejectedValue(new Error("SOURCE_CONFLICT"));
    await expect(ensureThemeCatalog(input)).rejects.toThrow("SOURCE_CONFLICT");
    expect(mocks.saveFilesBatch).toHaveBeenCalledTimes(1);
  });
});
