import type {
  DashboardSearch,
  DashboardSortOrder,
} from "@/lib/validations/dashboard-search";

export type AssetSortKey =
  | "name"
  | "extension"
  | "size"
  | "createdAt"
  | "updatedAt";

export interface AssetSort {
  key: AssetSortKey;
  direction: DashboardSortOrder;
}

const DEFAULT_SORT: AssetSort = {
  key: "createdAt",
  direction: "desc",
};

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const assetSortKeys = new Set<AssetSortKey>([
  "name",
  "extension",
  "size",
  "createdAt",
  "updatedAt",
]);

const isAssetSortKey = (value: string): value is AssetSortKey =>
  assetSortKeys.has(value as AssetSortKey);

/**
 * Turns the route's backwards-compatible scalar/array representation into the
 * one ordered list used by the table, query key and server.
 */
export const normalizeAssetSorts = (
  sortBy: DashboardSearch["sortBy"],
  sortOrder: DashboardSearch["sortOrder"],
): AssetSort[] => {
  const keys = asArray(sortBy).filter(isAssetSortKey);
  const directions = asArray(sortOrder);

  if (keys.length === 0) return [DEFAULT_SORT];

  const seen = new Set<AssetSortKey>();
  const sorts: AssetSort[] = [];

  keys.forEach((key, index) => {
    if (seen.has(key)) return;
    seen.add(key);
    sorts.push({
      key,
      direction: directions[index] ?? "desc",
    });
  });

  return sorts.length > 0 ? sorts : [DEFAULT_SORT];
};

export const serializeAssetSorts = (
  sorts: AssetSort[],
): Pick<DashboardSearch, "sortBy" | "sortOrder"> => {
  if (sorts.length === 1) {
    return {
      sortBy: sorts[0].key,
      sortOrder: sorts[0].direction,
    };
  }

  return {
    sortBy: sorts.map((sort) => sort.key),
    sortOrder: sorts.map((sort) => sort.direction),
  };
};

/**
 * Existing fields toggle in place so their priority is stable. A newly clicked
 * field is appended, making earlier clicks the higher-priority sort criteria.
 */
export const toggleAssetSort = (
  current: AssetSort[],
  key: AssetSortKey,
  initialDirection: DashboardSortOrder,
  hasExplicitSort: boolean,
): AssetSort[] => {
  if (!hasExplicitSort) {
    return [{ key, direction: initialDirection }];
  }

  const index = current.findIndex((sort) => sort.key === key);
  if (index === -1) {
    return [...current, { key, direction: initialDirection }];
  }

  return current.map((sort, sortIndex) =>
    sortIndex === index
      ? {
          ...sort,
          direction: sort.direction === "asc" ? "desc" : "asc",
        }
      : sort,
  );
};
