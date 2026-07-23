import {
  listAllFolders,
  listItemsServerFn,
} from "@/server/asset/list-items.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

// Normalize raw route search into the exact params the assets list query uses.
// Both the route loader (prefetch) and the component must call this so they
// produce the same query key — otherwise the loader primes a different cache
// entry than the component reads, causing a redundant fetch and a loading flash.
export const normalizeAssetListParams = (search: any = {}) => ({
  folderId: search.folderId || null,
  query: search.q,
  sortBy: search.sortBy || "createdAt",
  sortOrder: search.sortOrder || "desc",
  page: Number(search.page) || 1,
  limit: Number(search.limit) || 15,
});

export const assetQueries = {
  all: () => ["assets"] as const,
  list: (params: any = {}) =>
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
