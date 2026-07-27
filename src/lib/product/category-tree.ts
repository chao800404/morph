import type { ProductCategoryDTO } from "./dto/product-taxonomy.dto";

/**
 * Pure helpers for reading a category's materialised path.
 *
 * `mpath` is `/ancestor/…/own-id`, matching `asset_folders.idPath`. These live
 * outside the DAL so they can be tested without a database, and outside the
 * table config so pickers can use them without importing a table's columns.
 */

/** Ancestor ids, excluding the row's own id. */
export const ancestorIdsOf = (mpath: string): string[] =>
  mpath.split("/").filter(Boolean).slice(0, -1);

/** `/root` is depth 0, `/root/child` is depth 1. */
export const categoryDepth = (mpath: string): number =>
  Math.max(0, mpath.split("/").filter(Boolean).length - 1);

/**
 * Depth-first order: each parent immediately followed by its children, with
 * siblings sorted by name.
 *
 * Done in memory because no single `ORDER BY` expresses it. Sorting on `mpath`
 * groups a subtree correctly but orders siblings by their uuid, which is
 * arbitrary — the reason this exists.
 *
 * A row whose parent is absent from the input is treated as a root, so a
 * bounded read that cuts off mid-tree still lists everything it fetched.
 */
export const sortCategoryTree = <T extends ProductCategoryDTO>(
  categories: T[],
): T[] => {
  const present = new Set(categories.map((category) => category.id));
  const byParent = new Map<string | null, T[]>();

  for (const category of categories) {
    const parent =
      category.parentCategoryId && present.has(category.parentCategoryId)
        ? category.parentCategoryId
        : null;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(category);
    byParent.set(parent, siblings);
  }

  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.name.localeCompare(b.name));
  }

  const ordered: T[] = [];
  const walk = (parent: string | null) => {
    for (const category of byParent.get(parent) ?? []) {
      ordered.push(category);
      walk(category.id);
    }
  };
  walk(null);
  return ordered;
};
