import { buildThemeRouteRegistry } from "../compiler/theme-route-registry";
import { STARTER_THEME_CATALOG_FILES } from "../starter-theme-catalog-files";
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
  const planned = planThemeCatalogFiles(files);
  if (!planned.length) return false;
  await themeSourceStore.saveFilesBatch(
    data.storefrontId,
    data.themeId,
    planned,
    {
      expectedSourceGeneration: generation,
      createdBy: data.createdBy,
      createRevision: true,
      revisionMessage: "Create storefront product catalog routes",
    },
  );
  return true;
}
