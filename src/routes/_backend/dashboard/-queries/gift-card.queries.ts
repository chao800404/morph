import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  getGiftCard,
  listGiftCards,
} from "@/server/gift-card/gift-card.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

const scalar = <T>(value: T | T[] | undefined): T | undefined =>
  Array.isArray(value) ? value[0] : value;

export const normalizeGiftCardListParams = (search: DashboardSearch = {}) => {
  const page = Math.max(1, Number(search.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(search.limit) || 20));
  const sortBy = scalar(search.sortBy);
  const sortOrder = scalar(search.sortOrder) === "asc" ? "asc" : "desc";
  return {
    q: search.q,
    order:
      sortBy === "createdAt" && sortOrder === "asc"
        ? ("created_at" as const)
        : ("-created_at" as const),
    offset: (page - 1) * limit,
    limit,
  };
};

export const normalizeGiftCardTransactionParams = (
  id: string,
  search: DashboardSearch = {},
) => {
  const page = Math.max(1, Number(search.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(search.limit) || 20));
  return { id, offset: (page - 1) * limit, limit };
};

export const giftCardQueries = {
  all: () => ["gift-cards"] as const,
  list: (params: ReturnType<typeof normalizeGiftCardListParams>) =>
    queryOptions({
      queryKey: [...giftCardQueries.all(), "list", params],
      queryFn: () => listGiftCards({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (params: ReturnType<typeof normalizeGiftCardTransactionParams>) =>
    queryOptions({
      queryKey: [...giftCardQueries.all(), "detail", params],
      queryFn: () => getGiftCard({ data: params }),
      placeholderData: keepPreviousData,
    }),
};
