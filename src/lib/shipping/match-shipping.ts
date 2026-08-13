import type {
  FulfillmentRuleOperator,
  GeoZoneType,
} from "@/db/fulfillment.schema";

export interface ShippingAddressInput {
  countryCode: string;
  provinceCode?: string | null;
  city?: string | null;
  postalCode?: string | null;
}

export interface GeoZoneInput {
  type: GeoZoneType;
  countryCode: string;
  provinceCode?: string | null;
  city?: string | null;
  postalExpression?: unknown;
}

const postalMatches = (postalCode: string, expression: unknown): boolean => {
  if (typeof expression === "string") {
    const escaped = expression
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*");
    return new RegExp(`^${escaped}$`, "i").test(postalCode);
  }
  if (Array.isArray(expression))
    return expression.some((value) => postalMatches(postalCode, value));
  if (expression && typeof expression === "object") {
    const value = expression as Record<string, unknown>;
    if (typeof value.pattern === "string")
      return postalMatches(postalCode, value.pattern);
    if (typeof value.from === "string" && typeof value.to === "string")
      return postalCode >= value.from && postalCode <= value.to;
  }
  return false;
};

export const matchesGeoZone = (
  zone: GeoZoneInput,
  address: ShippingAddressInput,
) => {
  if (zone.countryCode.toLowerCase() !== address.countryCode.toLowerCase())
    return false;
  if (zone.type === "country") return true;
  if (zone.provinceCode?.toUpperCase() !== address.provinceCode?.toUpperCase())
    return false;
  if (zone.type === "province") return true;
  if (zone.city?.toLowerCase() !== address.city?.toLowerCase()) return false;
  if (zone.type === "city") return true;
  return Boolean(
    address.postalCode &&
    postalMatches(address.postalCode, zone.postalExpression),
  );
};

export interface ShippingRuleInput {
  attribute: string;
  operator: FulfillmentRuleOperator;
  value: unknown;
}

const valuesOf = (value: unknown) =>
  Array.isArray(value) ? value.map(String) : [String(value)];

export const matchesShippingRules = (
  rules: ShippingRuleInput[],
  attributes: Record<string, string | number | undefined>,
) =>
  rules.every((rule) => {
    const actual = attributes[rule.attribute];
    if (actual === undefined) return false;
    const values = valuesOf(rule.value);
    if (rule.operator === "in") return values.includes(String(actual));
    if (rule.operator === "nin") return !values.includes(String(actual));
    if (rule.operator === "eq") return values.includes(String(actual));
    if (rule.operator === "ne") return !values.includes(String(actual));
    const left = Number(actual);
    const right = Number(values[0]);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (rule.operator === "gt") return left > right;
    if (rule.operator === "gte") return left >= right;
    if (rule.operator === "lt") return left < right;
    return left <= right;
  });
