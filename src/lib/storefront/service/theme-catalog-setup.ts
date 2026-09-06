import { buildThemeRouteRegistry } from "../compiler/theme-route-registry";
import {
  STARTER_THEME_CATALOG_FILES,
  STARTER_THEME_CATALOG_UPGRADES,
  starterThemeCatalogSource,
} from "../starter-theme-catalog-files";
import { storeCatalogDal } from "../dal/store-catalog.dal";
import { storeContextDal } from "../dal/store-context.dal";
import { themeSourceStore } from "../storage/theme-storage.server";

/** Additive only. Route/source collisions are never resolved by overwriting authors. */
export function planThemeCatalogFiles(
  files: readonly { path: string; content: string }[],
) {
  const registry = buildThemeRouteRegistry([...files]);
  if (
    !registry.valid ||
    registry.routes.some(
      (route) =>
        route.path === "/products" || route.path.startsWith("/products/"),
    )
  )
    return [];
  if (
    STARTER_THEME_CATALOG_FILES.some((seed) =>
      files.some((file) => file.path === seed.path),
    )
  )
    return [];
  const next = buildThemeRouteRegistry([
    ...files,
    ...STARTER_THEME_CATALOG_FILES,
  ]);
  if (!next.valid) return [];
  return STARTER_THEME_CATALOG_FILES.map((file) => ({
    ...file,
    expectMissing: true as const,
  }));
}

/**
 * Catalog files a Theme installed before their generated content changed.
 *
 * Byte-exact: a file whose bytes still match what Morph wrote is Morph's to
 * correct, and anything else is the author's and is left alone. Returns an
 * empty list once every file is current, so the caller writes nothing.
 */
export function planThemeCatalogUpgrades(
  files: readonly {
    id: string;
    path: string;
    content: string;
    version: number;
  }[],
) {
  const upgrades = [];
  for (const upgrade of STARTER_THEME_CATALOG_UPGRADES) {
    const existing = files.find((file) => file.path === upgrade.path);
    if (!existing || existing.content !== upgrade.legacyContent) continue;
    const content = starterThemeCatalogSource(upgrade.path);
    if (content === null) continue;
    upgrades.push({
      path: upgrade.path,
      content,
      mimeType: "text/tsx",
      expectedFileId: existing.id,
      expectedVersion: existing.version,
    });
  }
  return upgrades;
}

/** Called only after CMS admin authorization; never publishes or mutates product records. */
export async function ensureThemeCatalog(data: {
  storefrontId: string;
  themeId: string;
  createdBy: string;
}): Promise<boolean> {
  const context = await storeContextDal.resolveForTheme(
    data.storefrontId,
    data.themeId,
  );
  if (
    !context ||
    !(await storeCatalogDal.hasChannelProducts(context.salesChannelId))
  )
    return false;
  const generation = await themeSourceStore.getSourceGeneration(
    data.storefrontId,
    data.themeId,
  );
  if (generation === null) return false;
  const files = await themeSourceStore.listFiles(
    data.storefrontId,
    data.themeId,
  );
  // A Theme that already has the routes still needs its files kept current, so
  // the two plans are exclusive: install, or upgrade what was installed before.
  const planned = planThemeCatalogFiles(files);
  const writes = planned.length ? planned : planThemeCatalogUpgrades(files);
  if (!writes.length) return false;
  await themeSourceStore.saveFilesBatch(
    data.storefrontId,
    data.themeId,
    writes,
    {
      expectedSourceGeneration: generation,
      createdBy: data.createdBy,
      createRevision: true,
      revisionMessage: planned.length
        ? "Create storefront product catalog routes"
        : "Update storefront product catalog routes",
    },
  );
  return true;
}
