import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  getTaxRate,
  getTaxRegion,
  listTaxRegionOptions,
  listTaxProvinces,
  listTaxRegions,
  listTaxRates,
  listTaxRuleTargets,
} from "@/server/tax/tax-regions.serverFn";
import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
} from "@tanstack/react-query";

export interface TaxRegionListParams {
  query?: string;
  sortBy: "name" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}
export interface TaxProvinceListParams {
  parentId: string;
  query?: string;
  hasRates?: "yes" | "no";
  sortBy: "code" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}
export interface TaxRateListParams {
  taxRegionId: string;
  kind: "default" | "override";
  query?: string;
  sortBy: "name" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}
export interface TaxRuleTargetListParams {
  reference: "product" | "product_type" | "shipping_option";
  query?: string;
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
export const normalizeTaxProvinceListParams = (
  parentId: string,
  search: DashboardSearch = {},
): TaxProvinceListParams => {
  const sortBy = Array.isArray(search.sortBy)
    ? search.sortBy[0]
    : search.sortBy;
  const sortOrder = Array.isArray(search.sortOrder)
    ? search.sortOrder[0]
    : search.sortOrder;
  return {
    parentId,
    query: search.q,
    hasRates: search.taxRegionHasRates,
    sortBy: sortBy === "createdAt" || sortBy === "updatedAt" ? sortBy : "code",
    sortOrder: sortOrder ?? "asc",
    page: Number(search.page) || 1,
    limit: Number(search.limit) || 10,
  };
};
export const normalizeTaxRateListParams = (
  taxRegionId: string,
  kind: "default" | "override",
  search: DashboardSearch = {},
): TaxRateListParams => ({
  taxRegionId,
  kind,
  query: kind === "override" ? search.taxRateQ : undefined,
  sortBy:
    kind === "override" &&
    (search.taxRateSortBy === "name" || search.taxRateSortBy === "updatedAt")
      ? search.taxRateSortBy
      : "createdAt",
  sortOrder: kind === "override" ? (search.taxRateSortOrder ?? "desc") : "desc",
  page: kind === "override" ? Number(search.taxRatePage) || 1 : 1,
  limit: kind === "override" ? 10 : 1,
});
export const taxQueries = {
  all: () => ["tax-regions"] as const,
  list: (params: TaxRegionListParams) =>
    queryOptions({
      queryKey: [...taxQueries.all(), "list", params],
      queryFn: () => listTaxRegions({ data: params }),
      placeholderData: keepPreviousData,
    }),
  provinces: (params: TaxProvinceListParams) =>
    queryOptions({
      queryKey: [...taxQueries.all(), "provinces", params],
      queryFn: () => listTaxProvinces({ data: params }),
      placeholderData: keepPreviousData,
    }),
  rates: (params: TaxRateListParams) =>
    queryOptions({
      queryKey: [...taxQueries.all(), "rates", params],
      queryFn: () => listTaxRates({ data: params }),
      placeholderData: keepPreviousData,
    }),
  ruleTargets: (params: TaxRuleTargetListParams) =>
    queryOptions({
      queryKey: [...taxQueries.all(), "rule-targets", params],
      queryFn: () => listTaxRuleTargets({ data: params }),
    }),
  ruleTargetPages: (params: Omit<TaxRuleTargetListParams, "page">) =>
    infiniteQueryOptions({
      queryKey: [...taxQueries.all(), "rule-target-pages", params],
      initialPageParam: 1,
      queryFn: ({ pageParam }) =>
        listTaxRuleTargets({ data: { ...params, page: pageParam } }),
      getNextPageParam: (lastPage) =>
        lastPage.success &&
        lastPage.data.pagination.page < lastPage.data.pagination.totalPages
          ? lastPage.data.pagination.page + 1
          : undefined,
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
