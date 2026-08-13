import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  getStorefrontPage,
  listStorefrontPageRevisions,
  listStorefrontPages,
} from "@/server/storefront/storefront-pages.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

export interface StorefrontPageListParams {
  query?: string;
  sortBy: "title" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}

export const normalizeStorefrontPageListParams = (
  search: DashboardSearch = {},
): StorefrontPageListParams => {
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
        ? "title"
        : sortBy === "createdAt"
          ? "createdAt"
          : "updatedAt",
    sortOrder: sortOrder ?? "desc",
    page: Number(search.page) || 1,
    limit: Number(search.limit) || 20,
  };
};

export const storefrontPageQueries = {
  all: () => ["storefront-pages"] as const,
  list: (params: StorefrontPageListParams) =>
    queryOptions({
      queryKey: [...storefrontPageQueries.all(), "list", params],
      queryFn: () => listStorefrontPages({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...storefrontPageQueries.all(), "detail", id],
      queryFn: () => getStorefrontPage({ data: { id } }),
    }),
  revisions: (id: string, page = 1, limit = 20) =>
    queryOptions({
      queryKey: [
        ...storefrontPageQueries.all(),
        "detail",
        id,
        "revisions",
        { page, limit },
      ],
      queryFn: () => listStorefrontPageRevisions({ data: { id, page, limit } }),
      placeholderData: keepPreviousData,
    }),
};
