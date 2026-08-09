import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { listInventory } from "@/server/inventory/inventory.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

export const normalizeInventoryListParams = (search: DashboardSearch = {}) => ({
  query: search.q,
  sortBy:
    search.sortBy === "name" || search.sortBy === "updatedAt"
      ? search.sortBy
      : ("createdAt" as const),
  sortOrder: search.sortOrder === "asc" ? ("asc" as const) : ("desc" as const),
  page: Number(search.page) || 1,
  limit: Number(search.limit) || 20,
});

export const inventoryQueries = {
  all: () => ["inventory"] as const,
  list: (params: ReturnType<typeof normalizeInventoryListParams>) =>
    queryOptions({
      queryKey: [...inventoryQueries.all(), "list", params],
      queryFn: () => listInventory({ data: params }),
      placeholderData: keepPreviousData,
    }),
};
