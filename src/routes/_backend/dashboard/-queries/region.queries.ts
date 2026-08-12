import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  getRegion,
  listAssignableCountries,
  listRegionPaymentProviders,
  listRegions,
} from "@/server/region/regions.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

export interface RegionListParams {
  query?: string;
  sortBy: "name" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}

/** Loader and component must call this so both build the same query key. */
export const normalizeRegionListParams = (
  search: DashboardSearch = {},
): RegionListParams => {
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

export const regionQueries = {
  all: () => ["regions"] as const,
  list: (params: RegionListParams) =>
    queryOptions({
      queryKey: [...regionQueries.all(), "list", params],
      queryFn: () => listRegions({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...regionQueries.all(), "detail", id],
      queryFn: () => getRegion({ data: { id } }),
    }),
  /**
   * Keyed by region because the answer differs: the create form asks for the
   * unassigned countries, an editor also gets its own back.
   */
  assignableCountries: (regionId: string | null) =>
    queryOptions({
      queryKey: [...regionQueries.all(), "assignable-countries", regionId],
      queryFn: () => listAssignableCountries({ data: { regionId } }),
    }),
  paymentProviders: () =>
    queryOptions({
      queryKey: [...regionQueries.all(), "payment-providers"],
      queryFn: () => listRegionPaymentProviders(),
    }),
};
