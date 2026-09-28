import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  getReservation,
  listReservations,
} from "@/server/inventory/inventory.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

export const normalizeReservationListParams = (
  search: DashboardSearch = {},
) => ({
  query: search.q,
  inventoryItemId: search.inventoryItemId,
  sortBy:
    search.sortBy === "updatedAt"
      ? ("updatedAt" as const)
      : ("createdAt" as const),
  sortOrder: search.sortOrder === "asc" ? ("asc" as const) : ("desc" as const),
  page: Number(search.page) || 1,
  limit: Number(search.limit) || 20,
  manualOnly: false,
});

export const reservationQueries = {
  all: () => ["reservations"] as const,
  list: (
    params: ReturnType<typeof normalizeReservationListParams> & {
      inventoryItemId?: string;
    },
  ) =>
    queryOptions({
      queryKey: [...reservationQueries.all(), "list", params],
      queryFn: () => listReservations({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...reservationQueries.all(), "detail", id],
      queryFn: () => getReservation({ data: { id } }),
    }),
};
