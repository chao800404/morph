import type { GeoZoneType } from "@/db/fulfillment.schema";
import type { JsonValue } from "@/db/json";

export interface ShippingAdminPriceDTO {
  currencyCode: string;
  amount: number;
}

export interface ShippingAdminRuleDTO {
  attribute:
    | "item_count"
    | "subtotal"
    | "total"
    | "currency_code"
    | "region_id"
    | "sales_channel_id";
  operator: "in" | "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "nin";
  value: JsonValue;
}

export interface ShippingAdminOptionTypeDTO {
  id: string;
  label: string;
  code: string;
  description: string | null;
}

export interface ShippingAdminProviderDTO {
  id: string;
  name: string;
}

export interface ShippingAdminGeoZoneInput {
  type: GeoZoneType;
  countryCode: string;
  provinceCode?: string | null;
  city?: string | null;
  postalExpression?: JsonValue | null;
}

export interface ShippingAdminGeoZoneDTO extends ShippingAdminGeoZoneInput {
  id: string;
  provinceCode: string | null;
  city: string | null;
  postalExpression: JsonValue | null;
}

export interface ShippingAdminOptionDTO {
  id: string;
  name: string;
  updatedAt: string;
  providerId: string | null;
  priceType: "flat" | "calculated";
  providerData: JsonValue;
  shippingProfileId: string | null;
  shippingProfileName: string | null;
  shippingOptionTypeId: string | null;
  shippingOptionTypeLabel: string | null;
  shippingOptionTypeCode: string | null;
  rules: ShippingAdminRuleDTO[];
  prices: ShippingAdminPriceDTO[];
}

export interface ShippingAdminZoneDTO {
  id: string;
  name: string;
  updatedAt: string;
  countries: string[];
  geoZones: ShippingAdminGeoZoneDTO[];
  options: ShippingAdminOptionDTO[];
}
