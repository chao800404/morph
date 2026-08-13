import { fulfillmentItems, fulfillments } from "@/db/fulfillment.schema";
import {
  orderAddresses,
  orderItems,
  orderLineItems,
  orders,
} from "@/db/order.schema";
import { paymentCollections } from "@/db/payment.schema";
import type {
  OrderDetailDTO,
  OrderFulfillmentDTO,
  OrderItemDTO,
  OrderListDTO,
} from "../dto/order.dto";

type OrderSummaryRow = {
  order: typeof orders.$inferSelect;
  summary: unknown;
};

type OrderItemRow = {
  item: typeof orderLineItems.$inferSelect;
  state: typeof orderItems.$inferSelect;
};

export type FulfillmentRow = {
  fulfillment: typeof fulfillments.$inferSelect;
  item: typeof fulfillmentItems.$inferSelect | null;
};

export const totalFromOrderSnapshot = (value: unknown): number => {
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  const candidate =
    record.total ?? record.current_order_total ?? record.original_order_total;
  return typeof candidate === "number" ? candidate : 0;
};

export const toOrderListDTO = ({
  order,
  summary,
}: OrderSummaryRow): OrderListDTO => ({
  id: order.id,
  displayId: order.displayId,
  status: order.status,
  email: order.email,
  currencyCode: order.currencyCode,
  isDraftOrder: order.isDraftOrder,
  total: totalFromOrderSnapshot(summary),
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
});

const toAddressDTO = (
  addresses: Array<typeof orderAddresses.$inferSelect>,
  addressId: string | null,
) => {
  const address = addresses.find((candidate) => candidate.id === addressId);
  if (!address) return null;
  return {
    firstName: address.firstName,
    lastName: address.lastName,
    company: address.company,
    address1: address.address1,
    address2: address.address2,
    city: address.city,
    province: address.province,
    postalCode: address.postalCode,
    countryCode: address.countryCode,
    phone: address.phone,
  };
};

export const toOrderFulfillmentDTOs = (
  rows: FulfillmentRow[],
): OrderFulfillmentDTO[] => {
  const grouped = new Map<string, OrderFulfillmentDTO>();
  for (const { fulfillment, item } of rows) {
    const current = grouped.get(fulfillment.id) ?? {
      id: fulfillment.id,
      locationId: fulfillment.locationId,
      shippedAt: fulfillment.shippedAt,
      deliveredAt: fulfillment.deliveredAt,
      canceledAt: fulfillment.canceledAt,
      items: [],
    };
    if (item) {
      current.items.push({
        id: item.id,
        lineItemId: item.lineItemId,
        title: item.title,
        quantity: item.quantity,
      });
    }
    grouped.set(fulfillment.id, current);
  }
  return [...grouped.values()];
};

export const toOrderItemDTO = ({
  item,
  state,
}: OrderItemRow): OrderItemDTO => ({
  id: item.id,
  title: item.title,
  thumbnail: item.thumbnail,
  sku: item.variantSku,
  quantity: state.quantity,
  fulfilledQuantity: state.fulfilledQuantity,
  unitPrice: state.unitPrice ?? item.unitPrice ?? 0,
});

export const toOrderDetailDTO = ({
  row,
  addresses,
  payment,
  hasUnfulfilledItems,
}: {
  row: OrderSummaryRow;
  addresses: Array<typeof orderAddresses.$inferSelect>;
  payment: typeof paymentCollections.$inferSelect | null;
  hasUnfulfilledItems: boolean;
}): OrderDetailDTO => ({
  ...toOrderListDTO(row),
  customerId: row.order.customerId,
  regionId: row.order.regionId,
  salesChannelId: row.order.salesChannelId,
  metadata: row.order.metadata ?? {},
  hasUnfulfilledItems,
  shippingAddress: toAddressDTO(addresses, row.order.shippingAddressId),
  billingAddress: toAddressDTO(addresses, row.order.billingAddressId),
  payment: payment
    ? {
        authorizedAmount: payment.authorizedAmount ?? 0,
        capturedAmount: payment.capturedAmount ?? 0,
        refundedAmount: payment.refundedAmount ?? 0,
        status: payment.status,
      }
    : null,
});
