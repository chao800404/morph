import type { Metadata } from "@/db/json";

export interface FulfillmentProvider {
  readonly id: string;
  create(input: {
    orderId: string;
    fulfillmentId: string;
    data: Metadata;
  }): Promise<Metadata>;
  cancel(input: {
    orderId: string;
    fulfillmentId: string;
    data: Metadata;
  }): Promise<Metadata>;
}
