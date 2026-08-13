import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { listStorefrontDomains } from "@/server/storefront/storefront-domains.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

export interface StorefrontDomainListParams {
  query?: string;
  sortBy: "hostname" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}

export const normalizeStorefrontDomainListParams = (
  search: DashboardSearch = {},
): StorefrontDomainListParams => {
  const sortBy = Array.isArray(search.sortBy)
    ? search.sortBy[0]
    : search.sortBy;
  const sortOrder = Array.isArray(search.sortOrder)
    ? search.sortOrder[0]
    : search.sortOrder;
  return {
    query: search.q,
    sortBy:
      sortBy === "name"
        ? "hostname"
        : sortBy === "updatedAt"
          ? "updatedAt"
          : "createdAt",
    sortOrder: sortOrder ?? "desc",
    page: Number(search.page) || 1,
    limit: Number(search.limit) || 20,
  };
};

export const storefrontDomainQueries = {
  all: () => ["storefront-domains"] as const,
  list: (params: StorefrontDomainListParams) =>
    queryOptions({
      queryKey: [...storefrontDomainQueries.all(), "list", params],
      queryFn: () => listStorefrontDomains({ data: params }),
      placeholderData: keepPreviousData,
    }),
};
