import type { JsonValue } from "@/db/json";

interface ShippingRateContextBase {
  currencyCode: string;
  itemSubtotal: number;
  itemCount: number;
  address: {
    countryCode: string;
    provinceCode: string | null;
    city: string | null;
    postalCode: string | null;
  };
}

export type ShippingRateContext = ShippingRateContextBase &
  ({ cartId: string; orderId?: never } | { orderId: string; cartId?: never });

export interface ShippingRateProvider {
  readonly id: string;
  readonly name?: string;
  /** Returns a non-negative integer in currency minor units. */
  calculate(input: {
    optionId: string;
    data: JsonValue;
    context: ShippingRateContext;
  }): Promise<number | null>;
}
