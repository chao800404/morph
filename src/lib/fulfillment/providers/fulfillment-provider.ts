import type { Metadata } from "@/db/json";

export interface FulfillmentProviderAddress {
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

export interface FulfillmentProviderItem {
  lineItemId: string;
  title: string;
  sku: string;
  barcode: string;
  quantity: number;
}

export interface FulfillmentProviderLabel {
  trackingNumber: string;
  trackingUrl: string;
  labelUrl: string;
}

export interface CreateFulfillmentProviderResult {
  data: Metadata;
  labels: FulfillmentProviderLabel[];
}

export interface FulfillmentProvider {
  readonly id: string;
  readonly name?: string;
  create(input: {
    orderId: string;
    fulfillmentId: string;
    locationId: string;
    shippingOptionId: string | null;
    currencyCode: string;
    address: FulfillmentProviderAddress | null;
    items: FulfillmentProviderItem[];
    data: Metadata;
  }): Promise<CreateFulfillmentProviderResult>;
  cancel(input: {
    orderId: string;
    fulfillmentId: string;
    data: Metadata;
  }): Promise<Metadata>;
}
