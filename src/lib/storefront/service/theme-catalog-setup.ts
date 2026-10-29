import { buildThemeRouteRegistry } from "../compiler/theme-route-registry";
import {
  STARTER_THEME_CATALOG_FILES,
  STARTER_THEME_CATALOG_UPGRADES,
  starterThemeCatalogSource,
} from "../starter-theme-catalog-files";
import {
  reviewPlanDigest,
  type StarterUpgradeChange,
} from "../starter-theme-upgrade-review";

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

/**
 * Why a catalog file is left as it is.
 *
 * - `changed`: an installed catalog file whose bytes match no copy Morph
 *   wrote. It is the author's now.
 * - `missing`: part of an installed catalog the Theme no longer has. Not added
 *   back.
 * - `products-route-exists`: the Theme has its own `/products` route, so the
 *   catalog is not installed over it.
 * - `route-conflict`: installing would make the Theme's routes invalid, or
 *   its routes are already invalid, so nothing is installed.
 */
export type ThemeCatalogKeptReason =
  "changed" | "missing" | "products-route-exists" | "route-conflict";

export type ThemeCatalogReview = {
  /** False when the store's channel has no products: no catalog is offered. */
  applies: boolean;
  /** Install or update; never both, as before. */
  plan: {
    files:
      | ReturnType<typeof planThemeCatalogFiles>
      | ReturnType<typeof planThemeCatalogUpgrades>;
    deletions: [];
  };
  kind: "install" | "update" | null;
  changes: StarterUpgradeChange[];
  kept: { path: string; reason: ThemeCatalogKeptReason }[];
  digest: string;
};

/**
 * What installing or updating the product catalog would do to these files,
 * and what it leaves alone. Read only.
 *
 * The plans are the ones the editor used to write on open: an install is
 * additive (`expectMissing`) and only where no catalog file and no products
 * route exist; an update replaces only bytes Morph wrote.
 */
export function reviewThemeCatalog(
  files: readonly {
    id: string;
    path: string;
    content: string;
    version: number;
  }[],
  options: { hasProducts: boolean },
): ThemeCatalogReview {
  const empty = { files: [], deletions: [] as [] };
  if (!options.hasProducts) {
    return {
      applies: false,
      plan: empty,
      kind: null,
      changes: [],
      kept: [],
      digest: reviewPlanDigest(empty),
    };
  }
  const existing = new Map(files.map((file) => [file.path, file]));
  const install = planThemeCatalogFiles(files);
  const writes = install.length ? install : planThemeCatalogUpgrades(files);
  const plan = { files: writes, deletions: [] as [] };
  const changes: StarterUpgradeChange[] = writes
    .map((file) => ({
      path: file.path,
      operation: install.length ? ("create" as const) : ("update" as const),
      before: existing.get(file.path)?.content ?? null,
      after: file.content,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const planned = new Set(writes.map((file) => file.path));
  const installed = STARTER_THEME_CATALOG_FILES.some((seed) =>
    existing.has(seed.path),
  );
  const kept: ThemeCatalogReview["kept"] = [];
  if (!install.length && !installed) {
    // Nothing of the catalog is here, and it could not be installed.
    const registry = buildThemeRouteRegistry([...files]);
    const reason: ThemeCatalogKeptReason =
      registry.valid &&
      registry.routes.some(
        (route) =>
          route.path === "/products" || route.path.startsWith("/products/"),
      )
        ? "products-route-exists"
        : "route-conflict";
    for (const seed of STARTER_THEME_CATALOG_FILES) {
      kept.push({ path: seed.path, reason });
    }
  } else if (installed) {
    for (const seed of STARTER_THEME_CATALOG_FILES) {
      if (planned.has(seed.path)) continue;
      const file = existing.get(seed.path);
      if (!file) kept.push({ path: seed.path, reason: "missing" });
      else if (file.content !== starterThemeCatalogSource(seed.path)) {
        kept.push({ path: seed.path, reason: "changed" });
      }
    }
  }
  return {
    applies: true,
    plan,
    kind: install.length ? "install" : writes.length ? "update" : null,
    changes,
    kept: kept.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    digest: reviewPlanDigest(plan),
  };
}
