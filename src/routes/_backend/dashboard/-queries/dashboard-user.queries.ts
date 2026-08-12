import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  getDashboardUser,
  listDashboardUsers,
} from "@/server/auth/dashboard-users.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

export interface DashboardUserListParams {
  query?: string;
  sortBy:
    | "name"
    | "email"
    | "firstName"
    | "lastName"
    | "createdAt"
    | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}

export const normalizeDashboardUserListParams = (
  search: DashboardSearch = {},
): DashboardUserListParams => {
  const sortBy = Array.isArray(search.sortBy)
    ? search.sortBy[0]
    : search.sortBy;
  const sortOrder = Array.isArray(search.sortOrder)
    ? search.sortOrder[0]
    : search.sortOrder;
  return {
    query: search.q,
    sortBy:
      sortBy === "name" ||
      sortBy === "email" ||
      sortBy === "firstName" ||
      sortBy === "lastName" ||
      sortBy === "updatedAt"
        ? sortBy
        : "createdAt",
    sortOrder: sortOrder ?? "desc",
    page: Number(search.page) || 1,
    limit: Number(search.limit) || 20,
  };
};

export const dashboardUserQueries = {
  all: () => ["dashboard-users"] as const,
  list: (params: DashboardUserListParams) =>
    queryOptions({
      queryKey: [...dashboardUserQueries.all(), "list", params],
      queryFn: () => listDashboardUsers({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...dashboardUserQueries.all(), "detail", id],
      queryFn: () => getDashboardUser({ data: { id } }),
    }),
};
