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
  planThemeCatalogUpgrades,
} from "./theme-catalog-setup";
import { STARTER_THEME_FILES } from "../starter-theme-files";
import {
  STARTER_THEME_CATALOG_FILES,
  STARTER_THEME_CATALOG_UPGRADES,
  starterThemeCatalogSource,
} from "../starter-theme-catalog-files";
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

describe("catalog source upgrades", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveForTheme.mockResolvedValue({ salesChannelId: "sc" });
    mocks.hasChannelProducts.mockResolvedValue(true);
    mocks.getSourceGeneration.mockResolvedValue(8);
    mocks.saveFilesBatch.mockResolvedValue([]);
  });

  const legacyFiles = () =>
    STARTER_THEME_CATALOG_UPGRADES.map((upgrade) => ({
      id: `file-${upgrade.path}`,
      path: upgrade.path,
      content: upgrade.legacyContent,
      version: 3,
    }));

  it("has a legacy copy to recognise, derived from the current source", () => {
    expect(STARTER_THEME_CATALOG_UPGRADES.length).toBeGreaterThan(0);
    for (const upgrade of STARTER_THEME_CATALOG_UPGRADES) {
      expect(upgrade.legacyContent).not.toBe(
        starterThemeCatalogSource(upgrade.path),
      );
    }
  });

  // Gallery images with no reserved space resized the page as each one landed,
  // so the editor walked the frame up image by image before settling.
  it("replaces an untouched legacy file with the current source", () => {
    const planned = planThemeCatalogUpgrades(legacyFiles());
    expect(planned).toHaveLength(STARTER_THEME_CATALOG_UPGRADES.length);
    for (const file of planned) {
      expect(file.content).toBe(starterThemeCatalogSource(file.path));
      expect(file.content).toContain("aspect-square w-full bg-stone-200");
      // The write must lose to a concurrent edit rather than overwrite it.
      expect(file.expectedFileId).toBe(`file-${file.path}`);
      expect(file.expectedVersion).toBe(3);
    }
  });

  it("leaves a file the author has edited alone", () => {
    const edited = legacyFiles().map((file) => ({
      ...file,
      content: `${file.content}\n// author's note\n`,
    }));
    expect(planThemeCatalogUpgrades(edited)).toEqual([]);
  });

  it("writes nothing once every file is current", () => {
    const current = STARTER_THEME_CATALOG_FILES.map((file) => ({
      id: `file-${file.path}`,
      path: file.path,
      content: file.content,
      version: 3,
    }));
    expect(planThemeCatalogUpgrades(current)).toEqual([]);
  });

  it("upgrades a theme that already has the catalog routes", async () => {
    mocks.listFiles.mockResolvedValue([
      ...STARTER_THEME_CATALOG_FILES.filter(
        (file) =>
          !STARTER_THEME_CATALOG_UPGRADES.some(
            (upgrade) => upgrade.path === file.path,
          ),
      ),
      ...legacyFiles(),
    ]);

    await expect(ensureThemeCatalog(input)).resolves.toBe(true);

    const [, , files, options] = mocks.saveFilesBatch.mock.calls[0] ?? [];
    expect(files).toHaveLength(STARTER_THEME_CATALOG_UPGRADES.length);
    expect(options.revisionMessage).toBe(
      "Update storefront product catalog routes",
    );
    expect(options.expectedSourceGeneration).toBe(8);
  });
});
