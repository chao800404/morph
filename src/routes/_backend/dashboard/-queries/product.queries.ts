import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { listCollections } from "@/server/product/collections.serverFn";
import { getProduct, listProducts } from "@/server/product/list-products.serverFn";
import { listProductOptions } from "@/server/product/options.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

/** Params the product list query and its server function agree on. */
export interface ProductListParams {
  query?: string;
  sortBy: "title" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}

export type CollectionListParams = ProductListParams;

// Route loader (prefetch) and component must call these so they build the same
// query key; otherwise the loader primes a different cache entry than the
// component reads, causing a redundant fetch and a loading flash.
export const normalizeProductListParams = (
  search: DashboardSearch = {},
): ProductListParams => ({
  query: search.q,
  sortBy: search.sortBy === "name" ? "title" : (search.sortBy ?? "createdAt"),
  sortOrder: search.sortOrder ?? "desc",
  page: Number(search.page) || 1,
  limit: Number(search.limit) || 20,
});

export const normalizeCollectionListParams = normalizeProductListParams;

export const productQueries = {
  all: () => ["products"] as const,
  list: (params: ProductListParams) =>
    queryOptions({
      queryKey: [...productQueries.all(), "list", params],
      queryFn: () => listProducts({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...productQueries.all(), "detail", id],
      queryFn: () => getProduct({ data: { id } }),
    }),
};

export const collectionQueries = {
  all: () => ["product-collections"] as const,
  list: (params: CollectionListParams) =>
    queryOptions({
      queryKey: [...collectionQueries.all(), "list", params],
      queryFn: () => listCollections({ data: params }),
      placeholderData: keepPreviousData,
    }),
};

export const productOptionQueries = {
  all: () => ["product-options"] as const,
  list: (params: CollectionListParams) =>
    queryOptions({
      queryKey: [...productOptionQueries.all(), "list", params],
      queryFn: () => listProductOptions({ data: params }),
      placeholderData: keepPreviousData,
    }),
};

export const normalizeProductOptionListParams = normalizeProductListParams;
