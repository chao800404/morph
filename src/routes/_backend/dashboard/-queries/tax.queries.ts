import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  getTaxRate,
  getTaxRegion,
  listTaxRegionOptions,
  listTaxRegions,
} from "@/server/tax/tax-regions.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

export interface TaxRegionListParams {
  query?: string;
  sortBy: "name" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}
export const normalizeTaxRegionListParams = (
  search: DashboardSearch = {},
): TaxRegionListParams => {
  const sortBy = Array.isArray(search.sortBy)
    ? search.sortBy[0]
    : search.sortBy;
  const sortOrder = Array.isArray(search.sortOrder)
    ? search.sortOrder[0]
    : search.sortOrder;
  return {
    query: search.q,
    sortBy: sortBy === "name" || sortBy === "updatedAt" ? sortBy : "createdAt",
    sortOrder: sortOrder ?? "desc",
    page: Number(search.page) || 1,
    limit: Number(search.limit) || 20,
  };
};
export const taxQueries = {
  all: () => ["tax-regions"] as const,
  list: (params: TaxRegionListParams) =>
    queryOptions({
      queryKey: [...taxQueries.all(), "list", params],
      queryFn: () => listTaxRegions({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...taxQueries.all(), "detail", id],
      queryFn: () => getTaxRegion({ data: { id } }),
    }),
  rate: (id: string) =>
    queryOptions({
      queryKey: [...taxQueries.all(), "rate", id],
      queryFn: () => getTaxRate({ data: { id } }),
    }),
  options: () =>
    queryOptions({
      queryKey: [...taxQueries.all(), "options"],
      queryFn: () => listTaxRegionOptions(),
    }),
};
