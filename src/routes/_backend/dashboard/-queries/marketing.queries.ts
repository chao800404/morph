import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  getOrder,
  getOrderFulfillableItems,
  listOrderFulfillments,
  listOrderItems,
  listOrders,
} from "@/server/marketing/orders.serverFn";
import {
  getPromotion,
  listPromotions,
} from "@/server/marketing/promotions.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

const scalar = <T>(value: T | T[] | undefined): T | undefined =>
  Array.isArray(value) ? value[0] : value;

export const normalizeOrderListParams = (search: DashboardSearch = {}) => ({
  query: search.q,
  sortBy:
    scalar(search.sortBy) === "updatedAt"
      ? ("updatedAt" as const)
      : ("createdAt" as const),
  sortOrder: scalar(search.sortOrder) ?? ("desc" as const),
  page: Number(search.page) || 1,
  limit: Number(search.limit) || 20,
});

export const normalizePromotionListParams = (search: DashboardSearch = {}) => ({
  query: search.q,
  sortBy:
    scalar(search.sortBy) === "code"
      ? ("code" as const)
      : scalar(search.sortBy) === "updatedAt"
        ? ("updatedAt" as const)
        : ("createdAt" as const),
  sortOrder: scalar(search.sortOrder) ?? ("desc" as const),
  page: Number(search.page) || 1,
  limit: Number(search.limit) || 20,
});

export const normalizeOrderItemListParams = (
  orderId: string,
  search: DashboardSearch = {},
) => ({
  orderId,
  page: Number(search.orderItemPage) || 1,
  limit: 10,
});

export const normalizeOrderFulfillmentListParams = (
  orderId: string,
  search: DashboardSearch = {},
) => ({
  orderId,
  page: Number(search.orderFulfillmentPage) || 1,
  limit: 10,
});

export const orderQueries = {
  all: () => ["orders"] as const,
  list: (params: ReturnType<typeof normalizeOrderListParams>) =>
    queryOptions({
      queryKey: [...orderQueries.all(), "list", params],
      queryFn: () => listOrders({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...orderQueries.all(), "detail", id],
      queryFn: () => getOrder({ data: { id } }),
    }),
  items: (params: ReturnType<typeof normalizeOrderItemListParams>) =>
    queryOptions({
      queryKey: [...orderQueries.all(), "items", params],
      queryFn: () => listOrderItems({ data: params }),
      placeholderData: keepPreviousData,
    }),
  fulfillments: (
    params: ReturnType<typeof normalizeOrderFulfillmentListParams>,
  ) =>
    queryOptions({
      queryKey: [...orderQueries.all(), "fulfillments", params],
      queryFn: () => listOrderFulfillments({ data: params }),
      placeholderData: keepPreviousData,
    }),
  fulfillableItems: (id: string) =>
    queryOptions({
      queryKey: [...orderQueries.all(), "fulfillable-items", id],
      queryFn: () => getOrderFulfillableItems({ data: { id } }),
    }),
};

export const promotionQueries = {
  all: () => ["promotions"] as const,
  list: (params: ReturnType<typeof normalizePromotionListParams>) =>
    queryOptions({
      queryKey: [...promotionQueries.all(), "list", params],
      queryFn: () => listPromotions({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...promotionQueries.all(), "detail", id],
      queryFn: () => getPromotion({ data: { id } }),
    }),
};
