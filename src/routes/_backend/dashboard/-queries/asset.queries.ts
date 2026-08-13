import type { AssetType } from "@/db/asset.schema";
import type { AssetEditSelectionItem } from "@/lib/asset/edit-selection";
import { normalizeAssetSorts } from "@/lib/asset/sort";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { getAssetItems } from "@/server/asset/get-items.serverFn";
import { listItemsServerFn } from "@/server/asset/list-items.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { ASSET_QUERY_KEY } from "@/lib/asset/query-key";

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
  all: () => ASSET_QUERY_KEY,
  list: (params: AssetListParams) =>
    queryOptions({
      queryKey: [...assetQueries.all(), "list", params],
      queryFn: () => listItemsServerFn({ data: params }),
      placeholderData: keepPreviousData,
    }),
  items: (params: AssetItemsParams) =>
    queryOptions({
      queryKey: [...assetQueries.all(), "items", params],
      queryFn: () => getAssetItems({ data: params }),
    }),
};
