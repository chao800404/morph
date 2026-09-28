import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  getCustomerGroup,
  listCustomerGroupMembers,
  listCustomerGroups,
} from "@/server/customer/customer-groups.serverFn";
import {
  getCustomer,
  listCustomers,
} from "@/server/customer/customers.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

const scalar = <T>(value: T | T[] | undefined): T | undefined =>
  Array.isArray(value) ? value[0] : value;

export const normalizeCustomerListParams = (search: DashboardSearch = {}) => ({
  query: search.q,
  sortBy: scalar(search.sortBy) === "email" ? ("email" as const) : ("createdAt" as const),
  sortOrder: scalar(search.sortOrder) ?? ("desc" as const),
  page: Number(search.page) || 1,
  limit: Number(search.limit) || 20,
});

export const customerQueries = {
  all: () => ["customers"] as const,
  list: (params: ReturnType<typeof normalizeCustomerListParams>) =>
    queryOptions({
      queryKey: [...customerQueries.all(), "list", params],
      queryFn: () => listCustomers({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...customerQueries.all(), "detail", id],
      queryFn: () => getCustomer({ data: { id } }),
    }),
};

export const normalizeCustomerGroupListParams = (
  search: DashboardSearch = {},
) => ({
  query: search.q,
  sortBy:
    scalar(search.sortBy) === "name" ? ("name" as const) : ("createdAt" as const),
  sortOrder: scalar(search.sortOrder) ?? ("desc" as const),
  page: Number(search.page) || 1,
  limit: Number(search.limit) || 20,
});

export const normalizeCustomerGroupMemberListParams = (
  groupId: string,
  search: DashboardSearch = {},
) => ({
  groupId,
  query: search.q,
  page: Number(search.page) || 1,
  limit: Number(search.limit) || 20,
});

export const customerGroupQueries = {
  all: () => ["customer-groups"] as const,
  list: (params: ReturnType<typeof normalizeCustomerGroupListParams>) =>
    queryOptions({
      queryKey: [...customerGroupQueries.all(), "list", params],
      queryFn: () => listCustomerGroups({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...customerGroupQueries.all(), "detail", id],
      queryFn: () => getCustomerGroup({ data: { id } }),
    }),
  members: (
    params: ReturnType<typeof normalizeCustomerGroupMemberListParams>,
  ) =>
    queryOptions({
      queryKey: [...customerGroupQueries.all(), "members", params],
      queryFn: () => listCustomerGroupMembers({ data: params }),
      placeholderData: keepPreviousData,
    }),
};
