import { getTableViewConfiguration } from "@/server/table-view/table-views.serverFn";
import { queryOptions } from "@tanstack/react-query";

export const tableViewQueries = {
  all: () => ["table-views"] as const,
  detail: (tableKey: string) =>
    queryOptions({
      queryKey: [...tableViewQueries.all(), tableKey],
      queryFn: () => getTableViewConfiguration({ data: { tableKey } }),
      staleTime: Number.POSITIVE_INFINITY,
    }),
};
