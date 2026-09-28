import type { AssetActionResult } from "@/lib/asset/action-result";
import {
  createLocationShippingRate,
  deleteLocationShippingRate,
  updateLocationShippingRate,
} from "@/server/shipping/shipping-admin.serverFn";

const text = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const jsonValue = (data: FormData, key: string): unknown | undefined => {
  const raw = data.get(key);
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const providerDataValue = (data: FormData): unknown => {
  const raw = data.get("providerData");
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
};

const shippingRulesValue = (data: FormData): unknown => {
  const rules = jsonValue(data, "rules");
  if (!Array.isArray(rules)) return rules ?? null;
  return rules.map((rule) => {
    if (
      rule &&
      typeof rule === "object" &&
      ["item_count", "subtotal", "total"].includes(
        String((rule as { attribute?: unknown }).attribute),
      )
    ) {
      const item = rule as { value?: unknown };
      return {
        ...rule,
        value:
          typeof item.value === "string" && item.value.trim()
            ? Number(item.value)
            : item.value,
      };
    }
    return rule;
  });
};

const result = (value: {
  success: boolean;
  message: string;
  errors?: Partial<Record<string, string[]>>;
}): AssetActionResult => ({
  success: value.success,
  message: value.message,
  errors: value.errors
    ? Object.fromEntries(
        Object.entries(value.errors).filter(
          (entry): entry is [string, string[]] => Boolean(entry[1]),
        ),
      )
    : undefined,
});

export const createLocationShippingOptionAction = async (data: FormData) => {
  const serviceZoneId = text(data, "serviceZoneId");
  const rates = [...data.entries()]
    .filter(([key]) => key.startsWith("rate_"))
    .map(([key, value]) => ({
      currencyCode: key.slice("rate_".length).toLowerCase(),
      amount: typeof value === "string" && value.trim() ? Number(value) : NaN,
    }));
  return result(
    await createLocationShippingRate({
      data: {
        locationId: text(data, "locationId") ?? "",
        serviceZoneId: serviceZoneId ?? null,
        ...(serviceZoneId
          ? {}
          : {
              zoneName: text(data, "zoneName") ?? "",
              geoZones: jsonValue(data, "geoZones"),
            }),
        optionName: text(data, "optionName") ?? "",
        shippingProfileId: text(data, "shippingProfileId") ?? "",
        shippingOptionTypeId:
          text(data, "shippingOptionTypeId") === "none"
            ? null
            : (text(data, "shippingOptionTypeId") ?? null),
        providerId: text(data, "providerId") ?? null,
        priceType: text(data, "priceType") ?? "flat",
        providerData: providerDataValue(data),
        rules: shippingRulesValue(data),
        rates,
      },
    }),
  );
};

export const updateLocationShippingOptionAction = async (data: FormData) => {
  const rates = [...data.entries()]
    .filter(([key]) => key.startsWith("rate_"))
    .map(([key, value]) => ({
      currencyCode: key.slice("rate_".length).toLowerCase(),
      amount: typeof value === "string" && value.trim() ? Number(value) : NaN,
    }));
  return result(
    await updateLocationShippingRate({
      data: {
        locationId: text(data, "locationId") ?? "",
        optionId: text(data, "optionId") ?? "",
        expectedOptionUpdatedAt: text(data, "expectedOptionUpdatedAt") ?? "",
        expectedZoneUpdatedAt: text(data, "expectedZoneUpdatedAt") ?? "",
        zoneName: text(data, "zoneName") ?? "",
        geoZones: jsonValue(data, "geoZones"),
        optionName: text(data, "optionName") ?? "",
        shippingProfileId: text(data, "shippingProfileId") ?? "",
        shippingOptionTypeId:
          text(data, "shippingOptionTypeId") === "none"
            ? null
            : (text(data, "shippingOptionTypeId") ?? null),
        priceType: text(data, "priceType") ?? "flat",
        providerData: providerDataValue(data),
        rules: shippingRulesValue(data),
        rates,
      },
    }),
  );
};

export const deleteLocationShippingOptionAction = async (input: {
  locationId: string;
  optionId: string;
  expectedOptionUpdatedAt: string;
}) => result(await deleteLocationShippingRate({ data: input }));
