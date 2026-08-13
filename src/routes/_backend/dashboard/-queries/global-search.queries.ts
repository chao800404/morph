import {
  GLOBAL_SEARCH_DEFAULT_LIMIT,
  type GlobalSearchArea,
} from "@/lib/search/global-search";
import { globalSearch } from "@/server/search/global-search.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

export const globalSearchQueries = {
  all: () => ["global-search"] as const,
  results: ({
    query,
    area,
    limit = GLOBAL_SEARCH_DEFAULT_LIMIT,
  }: {
    query: string;
    area: GlobalSearchArea;
    limit?: number;
  }) =>
    queryOptions({
      queryKey: [...globalSearchQueries.all(), area, limit, query],
      queryFn: () => globalSearch({ data: { query, area, limit } }),
      placeholderData: keepPreviousData,
      staleTime: 30_000,
      retry: false,
    }),
};
