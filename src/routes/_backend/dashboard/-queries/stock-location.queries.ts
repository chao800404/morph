import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  getStockLocation,
  listStockLocations,
} from "@/server/stock-location/stock-locations.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

export interface StockLocationListParams {
  query?: string;
  sortBy: "name" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}

/** Loader and component must call this so both build the same query key. */
export const normalizeStockLocationListParams = (
  search: DashboardSearch = {},
): StockLocationListParams => {
  const routeSortBy = Array.isArray(search.sortBy)
    ? search.sortBy[0]
    : search.sortBy;
  const routeSortOrder = Array.isArray(search.sortOrder)
    ? search.sortOrder[0]
    : search.sortOrder;

  return {
    query: search.q,
    sortBy:
      routeSortBy === "name"
        ? "name"
        : routeSortBy === "updatedAt"
          ? "updatedAt"
          : "createdAt",
    sortOrder: routeSortOrder ?? "desc",
    page: Number(search.page) || 1,
    limit: Number(search.limit) || 20,
  };
};

export const stockLocationQueries = {
  all: () => ["stock-locations"] as const,
  list: (params: StockLocationListParams) =>
    queryOptions({
      queryKey: [...stockLocationQueries.all(), "list", params],
      queryFn: () => listStockLocations({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...stockLocationQueries.all(), "detail", id],
      queryFn: () => getStockLocation({ data: { id } }),
    }),
};
