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
  metadata: Metadata;
  customerId: string | null;
  regionId: string | null;
  salesChannelId: string | null;
  hasUnfulfilledItems: boolean;
  shippingAddress: AddressDTO | null;
  billingAddress: AddressDTO | null;
  payment: {
    authorizedAmount: number;
    capturedAmount: number;
    refundedAmount: number;
    status: string;
  } | null;
}

export interface OrderItemDTO {
  id: string;
  title: string;
  thumbnail: string | null;
  sku: string | null;
  quantity: number;
  fulfilledQuantity: number;
  unitPrice: number;
}

export interface OrderFulfillmentDTO {
  id: string;
  locationId: string;
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
