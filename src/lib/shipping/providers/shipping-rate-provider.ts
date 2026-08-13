import type { JsonValue } from "@/db/json";

export interface ShippingRateContext {
  cartId: string;
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

export interface ShippingRateProvider {
  readonly id: string;
  calculate(input: {
    optionId: string;
    data: JsonValue;
    context: ShippingRateContext;
  }): Promise<number | null>;
}
