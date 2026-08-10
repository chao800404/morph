import {
  listAllFolders,
  listItemsServerFn,
} from "@/server/asset/list-items.serverFn";
import { getAssetItems } from "@/server/asset/get-items.serverFn";
import type { AssetEditSelectionItem } from "@/lib/asset/edit-selection";
import { normalizeAssetSorts } from "@/lib/asset/sort";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import type { AssetType } from "@/db/asset.schema";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

/** Params the assets list query and its server function agree on. */
export interface AssetListParams {
  folderId: string | null;
  query?: string;
  type?: AssetType;
  size?: "under-1mb" | "1mb-10mb" | "over-10mb";
  createdWithin?: "24h" | "7d" | "30d" | "90d";
  sortBy: Array<"name" | "extension" | "size" | "createdAt" | "updatedAt">;
  sortOrder: Array<"asc" | "desc">;
  page: number;
  limit: number;
}

export interface AssetItemsParams {
  items: AssetEditSelectionItem[];
}

// Normalize raw route search into the exact params the assets list query uses.
// Both the route loader (prefetch) and the component must call this so they
// produce the same query key — otherwise the loader primes a different cache
// entry than the component reads, causing a redundant fetch and a loading flash.
export const normalizeAssetListParams = (
  search: DashboardSearch = {},
): AssetListParams => {
  const sorts = normalizeAssetSorts(search.sortBy, search.sortOrder);

  return {
    folderId: search.folderId || null,
    query: search.q,
    type: search.assetType,
    size: search.assetSize,
    createdWithin: search.assetCreatedWithin,
    sortBy: sorts.map((sort) => sort.key),
    sortOrder: sorts.map((sort) => sort.direction),
    page: Number(search.page) || 1,
    limit: Number(search.limit) || 15,
  };
};

export const assetQueries = {
  all: () => ["assets"] as const,
  list: (params: AssetListParams) =>
    queryOptions({
      queryKey: [...assetQueries.all(), "list", params],
      queryFn: async () => {
        const result = await listItemsServerFn({ data: params });
        return result;
      },
      placeholderData: keepPreviousData,
    }),
  items: (params: AssetItemsParams) =>
    queryOptions({
      queryKey: [...assetQueries.all(), "items", params],
      queryFn: () => getAssetItems({ data: params }),
    }),
  folders: () =>
    queryOptions({
      queryKey: [...assetQueries.all(), "all-folders"],
      queryFn: async () => {
        const result = await listAllFolders();
        return result;
      },
    }),
};
