import type { Metadata } from "@/db/json";
import type { OrderStatus as DbOrderStatus } from "@/db/schema";

export type OrderStatus = DbOrderStatus;

export interface OrderListDTO {
  id: string;
  displayId: number;
  status: OrderStatus;
  email: string | null;
  currencyCode: string;
  isDraftOrder: boolean;
  total: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderDetailDTO extends OrderListDTO {
  version: number;
  noNotification: boolean;
  metadata: Metadata;
  customerId: string | null;
  regionId: string | null;
  salesChannelId: string | null;
  hasUnfulfilledItems: boolean;
  shippingAddress: AddressDTO | null;
  billingAddress: AddressDTO | null;
  creditLines: Array<{
    id: string;
    reference: string | null;
    referenceId: string | null;
    amount: number;
    metadata: Metadata;
    createdAt: string;
    updatedAt: string;
  }>;
  payment: {
    authorizedAmount: number;
    capturedAmount: number;
    refundedAmount: number;
    status: string;
  } | null;
}

export interface OrderItemDTO {
  id: string;
  variantId: string | null;
  title: string;
  thumbnail: string | null;
  sku: string | null;
  isGiftcard?: boolean;
  isCustomPrice: boolean;
  quantity: number;
  fulfilledQuantity: number;
  unitPrice: number;
  compareAtUnitPrice?: number | null;
}

export interface OrderFulfillmentDTO {
  id: string;
  locationId: string;
  labels: Array<{
    id: string;
    trackingNumber: string;
    trackingUrl: string;
    labelUrl: string;
  }>;
  shippedAt: string | null;
  deliveredAt: string | null;
  canceledAt: string | null;
  items: Array<{
    id: string;
    lineItemId: string | null;
    title: string;
    quantity: number;
  }>;
}

export interface OrderReturnItemDTO {
  id: string;
  itemId: string;
  reasonId: string | null;
  title: string;
  sku: string | null;
  quantity: number;
  receivedQuantity: number;
  damagedQuantity: number;
  reason: string | null;
  note: string | null;
}

export interface OrderReturnDTO {
  id: string;
  orderId: string;
  displayId: number;
  claimId: string | null;
  exchangeId: string | null;
  status: "open" | "requested" | "received" | "partially_received" | "canceled";
  locationId: string | null;
  requestedAt: string | null;
  receivedAt: string | null;
  canceledAt: string | null;
  items: OrderReturnItemDTO[];
}

export interface OrderExchangeDTO {
  id: string;
  displayId: number;
  returnId: string | null;
  differenceDue: number;
  allowBackorder: boolean;
  createdAt: string;
  canceledAt: string | null;
  returnStatus: OrderReturnDTO["status"] | null;
  locationName: string | null;
  returnShipping: { name: string; amount: number } | null;
  outboundShipping: { name: string; amount: number } | null;
  inboundItems: Array<{
    id: string;
    itemId: string;
    title: string;
    sku: string | null;
    quantity: number;
    receivedQuantity: number;
  }>;
  items: Array<{
    id: string;
    itemId: string;
    title: string;
    sku: string | null;
    quantity: number;
    unitPrice: number;
  }>;
}

export interface OrderExchangeableItemDTO {
  id: string;
  productId: string | null;
  title: string;
  sku: string | null;
  deliveredQuantity: number;
  returnableQuantity: number;
  unitPrice: number;
}

export interface OrderClaimDTO {
  id: string;
  displayId: number;
  returnId: string | null;
  returnShipping: { name: string; amount: number } | null;
  outboundShipping: { name: string; amount: number } | null;
  type: "refund" | "replace";
  refundAmount: number | null;
  orderVersion: number;
  createdAt: string;
  canceledAt: string | null;
  items: Array<{
    id: string;
    itemId: string;
    title: string;
    sku: string | null;
    quantity: number;
    reason:
      "missing_item" | "wrong_item" | "production_failure" | "other" | null;
    note: string | null;
    isAdditionalItem: boolean;
  }>;
}

export interface AddressDTO {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  countryCode: string | null;
  phone: string | null;
}
