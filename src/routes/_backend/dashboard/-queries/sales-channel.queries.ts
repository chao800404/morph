import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  getProductSalesChannels,
  getSalesChannel,
  listSalesChannels,
} from "@/server/sales-channel/sales-channels.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

export interface SalesChannelListParams {
  query?: string;
  sortBy: "name" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}

/**
 * Route loader (prefetch) and component must both call this so they build the
 * same query key; otherwise the loader primes a different cache entry than the
 * component reads and the page flashes a spinner it already had data for.
 */
export const normalizeSalesChannelListParams = (
  search: DashboardSearch = {},
): SalesChannelListParams => {
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

export const salesChannelQueries = {
  all: () => ["sales-channels"] as const,
  list: (params: SalesChannelListParams) =>
    queryOptions({
      queryKey: [...salesChannelQueries.all(), "list", params],
      queryFn: () => listSalesChannels({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...salesChannelQueries.all(), "detail", id],
      queryFn: () => getSalesChannel({ data: { id } }),
    }),
  /** Keyed under the product, so editing a product invalidates only its own. */
  forProduct: (productId: string) =>
    queryOptions({
      queryKey: [...salesChannelQueries.all(), "for-product", productId],
      queryFn: () => getProductSalesChannels({ data: { productId } }),
    }),
};
