import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { listDashboardInvites } from "@/server/auth/invites.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

export interface InviteListParams {
  query?: string;
  sortBy: "email" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}

export const normalizeInviteListParams = (
  search: DashboardSearch = {},
): InviteListParams => {
  const sortBy = Array.isArray(search.sortBy)
    ? search.sortBy[0]
    : search.sortBy;
  const sortOrder = Array.isArray(search.sortOrder)
    ? search.sortOrder[0]
    : search.sortOrder;
  return {
    query: search.q,
    sortBy: sortBy === "email" || sortBy === "updatedAt" ? sortBy : "createdAt",
    sortOrder: sortOrder ?? "desc",
    page: Number(search.page) || 1,
    limit: Number(search.limit) || 20,
  };
};

export const inviteQueries = {
  all: () => ["dashboard-invites"] as const,
  list: (params: InviteListParams) =>
    queryOptions({
      queryKey: [...inviteQueries.all(), "list", params],
      queryFn: () => listDashboardInvites({ data: params }),
      placeholderData: keepPreviousData,
    }),
};
