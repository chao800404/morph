import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import type { ProductOptionCreatedWithin } from "@/lib/product/config/product-option-list";
import {
  getCollection,
  listCollections,
} from "@/server/product/collections.serverFn";
import {
  getProduct,
  listProducts,
} from "@/server/product/list-products.serverFn";
import {
  getProductOption,
  listProductOptions,
} from "@/server/product/options.serverFn";
import {
  getProductCategory,
  listProductCategories,
} from "@/server/product/categories.serverFn";
import { listProductTaxonomy } from "@/server/product/taxonomy.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { getVariantDetail } from "@/server/product/variants.serverFn";

/** Params the product list query and its server function agree on. */
export interface ProductListParams {
  query?: string;
  status?: "draft" | "published" | "archived";
  createdWithin?: "24h" | "7d" | "30d" | "90d";
  updatedWithin?: "24h" | "7d" | "30d" | "90d";
  /** Narrows the list to one category, used by the category detail page. */
  categoryId?: string;
  /** Narrows the list to products built on one option. */
  optionId?: string;
  /** Narrows the list to one collection. */
  collectionId?: string;
  /** Narrows the list to products published in one sales channel. */
  salesChannelId?: string;
  /** Excludes products already assigned to a channel, used by selectors. */
  excludeSalesChannelId?: string;
  sortBy: "title" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}

export type CollectionListParams = ProductListParams;
export interface ProductOptionListParams extends ProductListParams {
  createdWithin?: ProductOptionCreatedWithin;
}

// Route loader (prefetch) and component must call these so they build the same
// query key; otherwise the loader primes a different cache entry than the
// component reads, causing a redundant fetch and a loading flash.
export const normalizeProductListParams = (
  search: DashboardSearch = {},
): ProductListParams => {
  const routeSortBy = Array.isArray(search.sortBy)
    ? search.sortBy[0]
    : search.sortBy;
  const routeSortOrder = Array.isArray(search.sortOrder)
    ? search.sortOrder[0]
    : search.sortOrder;

  return {
    query: search.q,
    status: search.productStatus,
    createdWithin: search.productCreatedWithin,
    updatedWithin: search.productUpdatedWithin,
    sortBy:
      routeSortBy === "name"
        ? "title"
        : routeSortBy === "updatedAt"
          ? "updatedAt"
          : "createdAt",
    sortOrder: routeSortOrder ?? "desc",
    page: Number(search.page) || 1,
    limit: Number(search.limit) || 20,
  };
};

export const normalizeCollectionListParams = normalizeProductListParams;

/** Params the category list query and its server function agree on. */
export interface ProductCategoryListParams {
  query?: string;
  sortBy: "name" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}

/**
 * Categories default to name ascending rather than newest first.
 *
 * The DAL sorts that column by `mpath`, which puts a parent immediately before
 * its children — a newest-first default would shuffle the tree apart.
 */
export const normalizeProductCategoryListParams = (
  search: DashboardSearch = {},
): ProductCategoryListParams => {
  const routeSortBy = Array.isArray(search.sortBy)
    ? search.sortBy[0]
    : search.sortBy;
  const routeSortOrder = Array.isArray(search.sortOrder)
    ? search.sortOrder[0]
    : search.sortOrder;

  return {
    query: search.q,
    sortBy:
      routeSortBy === "createdAt"
        ? "createdAt"
        : routeSortBy === "updatedAt"
          ? "updatedAt"
          : "name",
    sortOrder: routeSortOrder ?? "asc",
    page: Number(search.page) || 1,
    limit: Number(search.limit) || 20,
  };
};

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

export const productVariantQueries = {
  all: () => ["product-variants"] as const,
  detail: (id: string) =>
    queryOptions({
      queryKey: [...productVariantQueries.all(), "detail", id],
      queryFn: () => getVariantDetail({ data: { id } }),
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
  detail: (id: string) =>
    queryOptions({
      queryKey: [...collectionQueries.all(), "detail", id],
      queryFn: () => getCollection({ data: { id } }),
    }),
};

export const productOptionQueries = {
  all: () => ["product-options"] as const,
  list: (params: ProductOptionListParams) =>
    queryOptions({
      queryKey: [...productOptionQueries.all(), "list", params],
      queryFn: () => listProductOptions({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...productOptionQueries.all(), "detail", id],
      queryFn: () => getProductOption({ data: { id } }),
    }),
};

export const normalizeProductOptionListParams = (
  search: DashboardSearch = {},
): ProductOptionListParams => ({
  ...normalizeProductListParams(search),
  createdWithin: search.optionCreatedWithin,
});

/**
 * Types, tags and categories in one entry.
 *
 * They are always read together by the Organize step and change rarely, so one
 * cache entry keeps the wizard to a single request.
 */
export const productTaxonomyQueries = {
  all: () => ["product-taxonomy"] as const,
  list: () =>
    queryOptions({
      queryKey: productTaxonomyQueries.all(),
      queryFn: () => listProductTaxonomy(),
    }),
};

export const productCategoryQueries = {
  all: () => ["product-categories"] as const,
  list: (params: ProductCategoryListParams) =>
    queryOptions({
      queryKey: [...productCategoryQueries.all(), "list", params],
      queryFn: () => listProductCategories({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...productCategoryQueries.all(), "detail", id],
      queryFn: () => getProductCategory({ data: { id } }),
    }),
};
