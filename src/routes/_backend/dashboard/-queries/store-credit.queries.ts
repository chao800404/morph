import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  getStoreCreditAccount,
  listStoreCreditAccounts,
  listStoreCreditTransactions,
} from "@/server/store-credit/store-credit.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

const scalar = <T>(value: T | T[] | undefined): T | undefined =>
  Array.isArray(value) ? value[0] : value;

export const normalizeStoreCreditListParams = (
  search: DashboardSearch = {},
) => {
  const page = Math.max(1, Number(search.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(search.limit) || 20));
  const sortBy = scalar(search.sortBy);
  const sortOrder = scalar(search.sortOrder) === "asc" ? "asc" : "desc";
  return {
    q: search.q,
    status: search.storeCreditStatus ? search.storeCreditStatus : undefined,
    order:
      sortBy === "createdAt" && sortOrder === "asc"
        ? ("created_at" as const)
        : ("-created_at" as const),
    offset: (page - 1) * limit,
    limit,
  };
};

export const normalizeStoreCreditTransactionParams = (
  id: string,
  search: DashboardSearch = {},
) => {
  const page = Math.max(1, Number(search.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(search.limit) || 20));
  return { id, offset: (page - 1) * limit, limit };
};

export const storeCreditQueries = {
  all: () => ["store-credit-accounts"] as const,
  list: (params: ReturnType<typeof normalizeStoreCreditListParams>) =>
    queryOptions({
      queryKey: [...storeCreditQueries.all(), "list", params],
      queryFn: () => listStoreCreditAccounts({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...storeCreditQueries.all(), "detail", id],
      queryFn: () => getStoreCreditAccount({ data: { id } }),
    }),
  transactions: (
    params: ReturnType<typeof normalizeStoreCreditTransactionParams>,
  ) =>
    queryOptions({
      queryKey: [...storeCreditQueries.all(), "transactions", params],
      queryFn: () => listStoreCreditTransactions({ data: params }),
      placeholderData: keepPreviousData,
    }),
};
