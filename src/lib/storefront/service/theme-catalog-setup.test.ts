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

  /** One installed workspace, sitting on exactly one past generation. */
  const workspaceOn = (upgrade: { path: string; legacyContent: string }) =>
    [
      ...STARTER_THEME_CATALOG_FILES.filter(
        (file) => file.path !== upgrade.path,
      ),
      { path: upgrade.path, content: upgrade.legacyContent },
    ].map((file) => ({
      id: `file-${file.path}`,
      path: file.path,
      content: file.content,
      version: 3,
    }));

  it("has a legacy copy to recognise, and never one that is already current", () => {
    expect(STARTER_THEME_CATALOG_UPGRADES.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const upgrade of STARTER_THEME_CATALOG_UPGRADES) {
      expect(upgrade.legacyContent).not.toBe(
        starterThemeCatalogSource(upgrade.path),
      );
      // Two generations that share bytes would make the match ambiguous, and
      // the second would be unreachable.
      expect(seen.has(upgrade.legacyContent)).toBe(false);
      seen.add(upgrade.legacyContent);
    }
  });

  // A workspace sits on one generation at a time, so each is planned alone.
  // Gallery images with no reserved space resized the page as each one landed,
  // and hand-written `data-morph-node` named elements the compiler now names
  // by position — both are Morph's own bytes to correct.
  it("replaces an untouched legacy file with the current source", () => {
    for (const upgrade of STARTER_THEME_CATALOG_UPGRADES) {
      const planned = planThemeCatalogUpgrades(workspaceOn(upgrade));
      expect(planned, upgrade.path).toHaveLength(1);
      const [file] = planned;
      expect(file.path).toBe(upgrade.path);
      expect(file.content).toBe(starterThemeCatalogSource(upgrade.path));
      expect(file.content).not.toMatch(/data-morph-node/);
      // The write must lose to a concurrent edit rather than overwrite it.
      expect(file.expectedFileId).toBe(`file-${upgrade.path}`);
      expect(file.expectedVersion).toBe(3);
    }
  });

  it("still reserves space for the gallery images it upgrades", () => {
    const detail = starterThemeCatalogSource(
      "src/components/ProductDetail.tsx",
    );
    expect(detail).toContain("aspect-square w-full bg-stone-200");
  });

  it("leaves a file the author has edited alone", () => {
    for (const upgrade of STARTER_THEME_CATALOG_UPGRADES) {
      const edited = workspaceOn(upgrade).map((file) =>
        file.path === upgrade.path
          ? { ...file, content: `${file.content}\n// author's note\n` }
          : file,
      );
      expect(planThemeCatalogUpgrades(edited), upgrade.path).toEqual([]);
    }
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
    const upgrade = STARTER_THEME_CATALOG_UPGRADES[0]!;
    mocks.listFiles.mockResolvedValue(workspaceOn(upgrade));

    await expect(ensureThemeCatalog(input)).resolves.toBe(true);

    const [, , files, options] = mocks.saveFilesBatch.mock.calls[0] ?? [];
    expect(files).toHaveLength(1);
    expect(options.revisionMessage).toBe(
      "Update storefront product catalog routes",
    );
    expect(options.expectedSourceGeneration).toBe(8);
  });
});
