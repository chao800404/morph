import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  getOrder,
  getOrderFulfillableItems,
  listDraftShippingOptions,
  listOrderFulfillments,
  listOrderItems,
  listOrders,
  searchDraftOrderVariants,
} from "@/server/marketing/orders.serverFn";
import { listOrderNotifications } from "@/server/marketing/notifications.serverFn";
import {
  getOrderReturn,
  getOrderReturnableItems,
  listOrderReturns as fetchOrderReturns,
} from "@/server/marketing/order-return.serverFn";
import { listOrderClaims } from "@/server/marketing/order-claim.serverFn";
import {
  listOrderExchanges,
  searchOrderExchangeVariants,
} from "@/server/marketing/order-exchange.serverFn";
import {
  getPromotion,
  listPromotions,
} from "@/server/marketing/promotions.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { z } from "zod";

const adminOrderEditSchema = z.object({
  id: z.uuid(),
  order_id: z.uuid(),
  version: z.number().int(),
  status: z.string().nullable(),
  created_by: z.string().nullable(),
  requested_by: z.string().nullable(),
  requested_at: z.string().nullable(),
  updated_at: z.string(),
  actions: z.array(
    z.object({
      id: z.uuid(),
      action: z.string(),
      ordering: z.number().int(),
      reference: z.string().nullable(),
      reference_id: z.string().nullable(),
      details: z.record(z.string(), z.unknown()),
      applied: z.boolean(),
    }),
  ),
});
const adminOrderEditResponseSchema = z.object({
  order_edit: adminOrderEditSchema.nullable(),
});

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

export const normalizePromotionListParams = (
  search: DashboardSearch = {},
  relation: { campaignId?: string; unassigned?: boolean } = {},
) => ({
  query: search.q,
  ...relation,
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

export const normalizeOrderReturnListParams = (
  orderId: string,
  search: DashboardSearch = {},
) => ({
  orderId,
  page: Number(search.orderReturnPage) || 1,
  limit: 10,
});

export const normalizeOrderNotificationListParams = (
  orderId: string,
  search: DashboardSearch = {},
) => ({
  orderId,
  page: Number(search.orderNotificationPage) || 1,
  limit: 20,
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
  editRequest: (id: string) =>
    queryOptions({
      queryKey: [...orderQueries.all(), "edit-request", id],
      queryFn: async () => {
        const response = await fetch(
          `/api/admin/orders/${encodeURIComponent(id)}/edit`,
          { headers: { accept: "application/json" } },
        );
        const body: unknown = await response.json().catch(() => null);
        const parsed = adminOrderEditResponseSchema.safeParse(body);
        if (!response.ok || !parsed.success)
          throw new Error("The order edit request could not be loaded");
        return parsed.data.order_edit;
      },
    }),
  draftShippingOptions: (params: { id: string; expectedVersion: number }) =>
    queryOptions({
      queryKey: [...orderQueries.all(), "draft-shipping-options", params],
      queryFn: () => listDraftShippingOptions({ data: params }),
      staleTime: 0,
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
  returnableItems: (id: string) =>
    queryOptions({
      queryKey: [...orderQueries.all(), "returnable-items", id],
      queryFn: () => getOrderReturnableItems({ data: { id } }),
    }),
  returns: (params: ReturnType<typeof normalizeOrderReturnListParams>) =>
    queryOptions({
      queryKey: [...orderQueries.all(), "returns", params],
      queryFn: () => fetchOrderReturns({ data: params }),
      placeholderData: keepPreviousData,
    }),
  notifications: (
    params: ReturnType<typeof normalizeOrderNotificationListParams>,
  ) =>
    queryOptions({
      queryKey: [...orderQueries.all(), "notifications", params],
      queryFn: () => listOrderNotifications({ data: params }),
      placeholderData: keepPreviousData,
    }),
  returnDetail: (returnId: string) =>
    queryOptions({
      queryKey: [...orderQueries.all(), "return", returnId],
      queryFn: () => getOrderReturn({ data: { returnId } }),
    }),
  claims: (orderId: string) =>
    queryOptions({
      queryKey: [...orderQueries.all(), "claims", orderId],
      queryFn: () => listOrderClaims({ data: { id: orderId } }),
    }),
  exchanges: (orderId: string) =>
    queryOptions({
      queryKey: [...orderQueries.all(), "exchanges", orderId],
      queryFn: () => listOrderExchanges({ data: { id: orderId } }),
    }),
  exchangeVariants: (orderId: string, query: string) =>
    queryOptions({
      queryKey: [...orderQueries.all(), "exchange-variants", orderId, query],
      queryFn: () =>
        searchOrderExchangeVariants({ data: { orderId, query, limit: 20 } }),
      staleTime: 15_000,
    }),
  draftVariants: (params: {
    query: string;
    currencyCode: string;
    quantity: number;
    customerId?: string;
    regionId?: string;
    salesChannelId?: string;
    limit?: number;
  }) =>
    queryOptions({
      queryKey: [...orderQueries.all(), "draft-variants", params],
      queryFn: () => searchDraftOrderVariants({ data: params }),
      staleTime: 15_000,
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
