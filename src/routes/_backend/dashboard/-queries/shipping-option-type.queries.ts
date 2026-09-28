import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  getShippingOptionType,
  listShippingOptionTypeChoices,
  listShippingOptionTypes,
} from "@/server/shipping/shipping-option-types.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

const scalar = <T>(value: T | T[] | undefined): T | undefined =>
  Array.isArray(value) ? value[0] : value;

export const normalizeShippingOptionTypeListParams = (
  search: DashboardSearch = {},
) => ({
  query: search.q,
  sortBy:
    scalar(search.sortBy) === "code"
      ? ("code" as const)
      : scalar(search.sortBy) === "createdAt"
        ? ("createdAt" as const)
        : scalar(search.sortBy) === "updatedAt"
          ? ("updatedAt" as const)
          : ("label" as const),
  sortOrder: scalar(search.sortOrder) ?? ("asc" as const),
  page: Number(search.page) || 1,
  limit: Number(search.limit) || 20,
});

export const shippingOptionTypeQueries = {
  all: () => ["shipping-option-types"] as const,
  list: (params: ReturnType<typeof normalizeShippingOptionTypeListParams>) =>
    queryOptions({
      queryKey: [...shippingOptionTypeQueries.all(), "list", params],
      queryFn: () => listShippingOptionTypes({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...shippingOptionTypeQueries.all(), "detail", id],
      queryFn: () => getShippingOptionType({ data: { id } }),
    }),
  choices: () =>
    queryOptions({
      queryKey: [...shippingOptionTypeQueries.all(), "choices"],
      queryFn: () => listShippingOptionTypeChoices({ data: {} }),
      staleTime: 60_000,
    }),
};
