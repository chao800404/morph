import type {
  ReferenceDataKind,
  ReferenceDataListParams,
} from "@/lib/commerce/reference-data";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  getReferenceData,
  listReferenceData,
} from "@/server/settings/reference-data.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

export const normalizeReferenceDataListParams = (
  kind: ReferenceDataKind,
  search: DashboardSearch = {},
): ReferenceDataListParams => {
  const sortBy = Array.isArray(search.sortBy)
    ? search.sortBy[0]
    : search.sortBy;
  const sortOrder = Array.isArray(search.sortOrder)
    ? search.sortOrder[0]
    : search.sortOrder;
  return {
    kind,
    query: search.q,
    sortBy: sortBy === "createdAt" || sortBy === "updatedAt" ? sortBy : "name",
    sortOrder: sortOrder ?? "asc",
    page: Number(search.page) || 1,
    limit: Number(search.limit) || 20,
  };
};

export const referenceDataQueries = {
  all: (kind?: ReferenceDataKind) =>
    kind ? (["reference-data", kind] as const) : (["reference-data"] as const),
  list: (params: ReferenceDataListParams) =>
    queryOptions({
      queryKey: [...referenceDataQueries.all(params.kind), "list", params],
      queryFn: () => listReferenceData({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (kind: ReferenceDataKind, id: string) =>
    queryOptions({
      queryKey: [...referenceDataQueries.all(kind), "detail", id],
      queryFn: () => getReferenceData({ data: { kind, id } }),
    }),
};
