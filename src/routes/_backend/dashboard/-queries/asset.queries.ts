import {
  listAllFolders,
  listItemsServerFn,
} from "@/server/asset/list-items.serverFn";
import { queryOptions } from "@tanstack/react-query";

export const assetQueries = {
  all: () => ["assets"] as const,
  list: (params: any = {}) =>
    queryOptions({
      queryKey: [...assetQueries.all(), "list", params],
      queryFn: async () => {
        const result = await listItemsServerFn({ data: params });
        return result;
      },
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
