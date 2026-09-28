import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  getShippingProfile,
  listShippingProfiles,
} from "@/server/shipping/shipping-profiles.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

const scalar = <T>(value: T | T[] | undefined): T | undefined =>
  Array.isArray(value) ? value[0] : value;

export const normalizeShippingProfileListParams = (
  search: DashboardSearch = {},
) => ({
  query: search.q,
  sortBy:
    scalar(search.sortBy) === "createdAt"
      ? ("createdAt" as const)
      : scalar(search.sortBy) === "updatedAt"
        ? ("updatedAt" as const)
        : ("name" as const),
  sortOrder: scalar(search.sortOrder) ?? ("asc" as const),
  page: Number(search.page) || 1,
  limit: Number(search.limit) || 20,
});

export const shippingProfileQueries = {
  all: () => ["shipping-profiles"] as const,
  list: (params: ReturnType<typeof normalizeShippingProfileListParams>) =>
    queryOptions({
      queryKey: [...shippingProfileQueries.all(), "list", params],
      queryFn: () => listShippingProfiles({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...shippingProfileQueries.all(), "detail", id],
      queryFn: () => getShippingProfile({ data: { id } }),
    }),
};
