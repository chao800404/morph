import {
  listAllFolders,
  listItemsServerFn,
} from "@/server/asset/list-items.serverFn";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

/** Params the assets list query and its server function agree on. */
export interface AssetListParams {
  folderId: string | null;
  query?: string;
  sortBy: "name" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}

// Normalize raw route search into the exact params the assets list query uses.
// Both the route loader (prefetch) and the component must call this so they
// produce the same query key — otherwise the loader primes a different cache
// entry than the component reads, causing a redundant fetch and a loading flash.
export const normalizeAssetListParams = (
  search: DashboardSearch = {},
): AssetListParams => ({
  folderId: search.folderId || null,
  query: search.q,
  sortBy: search.sortBy || "createdAt",
  sortOrder: search.sortOrder || "desc",
  page: Number(search.page) || 1,
  limit: Number(search.limit) || 15,
});

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
  folders: () =>
    queryOptions({
      queryKey: [...assetQueries.all(), "all-folders"],
      queryFn: async () => {
        const result = await listAllFolders();
        return result;
      },
    }),
};
