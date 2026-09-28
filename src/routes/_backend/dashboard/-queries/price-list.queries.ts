import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  getPriceList,
  listPriceListPrices,
  listPriceLists,
  searchPriceListVariants,
} from "@/server/pricing/price-lists.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

const scalar = <T>(value: T | T[] | undefined): T | undefined =>
  Array.isArray(value) ? value[0] : value;

export const normalizePriceListParams = (search: DashboardSearch = {}) => ({
  query: search.q,
  sortBy: scalar(search.sortBy) === "name" ? ("title" as const) : scalar(search.sortBy) === "updatedAt" ? ("updatedAt" as const) : ("createdAt" as const),
  sortOrder: scalar(search.sortOrder) ?? ("desc" as const),
  page: Number(search.page) || 1,
  limit: Number(search.limit) || 20,
});

export const normalizePriceListPriceParams = (
  priceListId: string,
  search: DashboardSearch = {},
) => ({
  priceListId,
  query: search.q,
  sortBy: scalar(search.sortBy) === "name" ? ("product" as const) : ("createdAt" as const),
  sortOrder: scalar(search.sortOrder) ?? ("desc" as const),
  page: Number(search.page) || 1,
  limit: Number(search.limit) || 20,
});

export const priceListQueries = {
  all: () => ["price-lists"] as const,
  list: (params: ReturnType<typeof normalizePriceListParams>) =>
    queryOptions({
      queryKey: [...priceListQueries.all(), "list", params],
      queryFn: () => listPriceLists({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...priceListQueries.all(), "detail", id],
      queryFn: () => getPriceList({ data: { id } }),
    }),
  prices: (params: ReturnType<typeof normalizePriceListPriceParams>) =>
    queryOptions({
      queryKey: [...priceListQueries.all(), "prices", params],
      queryFn: () => listPriceListPrices({ data: params }),
      placeholderData: keepPreviousData,
    }),
  searchVariants: (query: string) =>
    queryOptions({
      queryKey: [...priceListQueries.all(), "variant-search", query],
      queryFn: () => searchPriceListVariants({ data: { query, limit: 20 } }),
      enabled: query.trim().length > 0,
    }),
};
