import { z } from "zod";
import type { JsonValue } from "@/db/json";
import { countryCodeSchema, idSchema } from "./commerce";

export const getLocationShippingOptionsInputSchema = z.object({
  locationId: idSchema("stock location"),
});

const provinceCodeSchema = z
  .string()
  .trim()
  .min(1, "Enter a province or state code")
  .max(32)
  .transform((value) => value.toUpperCase());

const citySchema = z.string().trim().min(1, "Enter a city").max(120);

const isProviderJsonData = (
  value: unknown,
): value is Record<string, JsonValue> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rootPrototype = Object.getPrototypeOf(value);
  if (rootPrototype !== Object.prototype && rootPrototype !== null) return false;

  const pending: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ];
  let visited = 0;
  while (pending.length) {
    const current = pending.pop()!;
    visited += 1;
    if (visited > 2_000 || current.depth > 20) return false;
    if (
      current.value === null ||
      typeof current.value === "string" ||
      typeof current.value === "boolean"
    )
      continue;
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) return false;
      continue;
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > 1_000) return false;
      pending.push(
        ...current.value.map((item) => ({
          value: item,
          depth: current.depth + 1,
        })),
      );
      continue;
    }
    if (typeof current.value !== "object") return false;
    const prototype = Object.getPrototypeOf(current.value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const entries = Object.values(current.value);
    if (entries.length > 1_000) return false;
    pending.push(
      ...entries.map((item) => ({ value: item, depth: current.depth + 1 })),
    );
  }
  return true;
};

const shippingProviderDataSchema = z
  .custom<Record<string, JsonValue>>(isProviderJsonData, {
    message: "Provider data must be a bounded JSON object",
  })
  .refine((value) => {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 16_384;
    } catch {
      return false;
    }
  }, {
    message: "Provider data must be 16 KB or smaller",
  });

const shippingProviderIdSchema = z
  .string()
  .trim()
  .min(1, "Choose a fulfillment provider")
  .max(128)
  .nullable()
  .default(null);

export const shippingGeoZoneInputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("country"),
      countryCode: countryCodeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("province"),
      countryCode: countryCodeSchema,
      provinceCode: provinceCodeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("city"),
      countryCode: countryCodeSchema,
      provinceCode: provinceCodeSchema,
      city: citySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("zip"),
      countryCode: countryCodeSchema,
      provinceCode: provinceCodeSchema,
      city: citySchema,
      postalExpression: z
        .string()
        .trim()
        .min(1, "Enter a postal code pattern")
        .max(200)
        .transform((value) => {
          const patterns = value
            .split(/\r?\n/)
            .map((pattern) => pattern.trim())
            .filter(Boolean);
          const expressions = patterns.map((pattern) => {
            const range = /^(.+)\.\.(.+)$/.exec(pattern);
            return range?.[1] && range[2]
              ? { from: range[1].trim(), to: range[2].trim() }
              : pattern;
          });
          if (expressions.length > 1) return expressions;
          return expressions[0] ?? "";
        }),
    })
    .strict(),
]);

const shippingGeoZonesSchema = z
  .array(shippingGeoZoneInputSchema)
  .min(1, "Add at least one geographic area")
  .max(250)
  .refine(
    (zones) =>
      new Set(zones.map((zone) => JSON.stringify(zone))).size === zones.length,
    { message: "Each geographic area can only be added once" },
  );

const locationShippingRateFieldsSchema = z.object({
  locationId: idSchema("stock location"),
  serviceZoneId: idSchema("service zone").nullish(),
  zoneName: z
    .string()
    .trim()
    .min(1, "Service zone name is required")
    .max(200)
    .optional(),
  geoZones: shippingGeoZonesSchema.optional(),
  optionName: z
    .string()
    .trim()
    .min(1, "Shipping option name is required")
    .max(200),
  shippingProfileId: idSchema("shipping profile"),
  shippingOptionTypeId: idSchema("shipping option type").nullish(),
  providerId: shippingProviderIdSchema,
  priceType: z.enum(["flat", "calculated"]).default("flat"),
  providerData: shippingProviderDataSchema.default({}),
  rules: z
    .array(
      z
        .object({
          attribute: z.enum([
            "item_count",
            "subtotal",
            "total",
            "currency_code",
            "region_id",
            "sales_channel_id",
          ]),
          operator: z.enum(["in", "eq", "ne", "gt", "gte", "lt", "lte", "nin"]),
          value: z.union([
            z.string().trim().min(1).max(200),
            z.number().finite().min(0).max(1_000_000_000),
            z.array(z.string().trim().min(1).max(200)).min(1).max(25),
          ]),
        })
        .strict()
        .superRefine((rule, context) => {
          const numericAttribute = ["item_count", "subtotal", "total"].includes(
            rule.attribute,
          );
          if (numericAttribute) {
            if (
              !["eq", "ne", "gt", "gte", "lt", "lte"].includes(rule.operator) ||
              typeof rule.value !== "number"
            ) {
              context.addIssue({
                code: "custom",
                path: ["value"],
                message: "Use a numeric value and comparison operator",
              });
            }
            if (
              rule.attribute === "item_count" &&
              typeof rule.value === "number" &&
              !Number.isInteger(rule.value)
            ) {
              context.addIssue({
                code: "custom",
                path: ["value"],
                message: "Item count must be a whole number",
              });
            }
            return;
          }
          const listOperator =
            rule.operator === "in" || rule.operator === "nin";
          if (
            (listOperator && !Array.isArray(rule.value)) ||
            (!listOperator &&
              (!["eq", "ne"].includes(rule.operator) ||
                typeof rule.value !== "string"))
          ) {
            context.addIssue({
              code: "custom",
              path: ["value"],
              message: "Use a text value or a list with in / not in",
            });
          }
        })
        .transform((rule) =>
          rule.attribute === "currency_code"
            ? {
                ...rule,
                value: Array.isArray(rule.value)
                  ? rule.value.map((value) => value.toLowerCase())
                  : typeof rule.value === "string"
                    ? rule.value.toLowerCase()
                    : rule.value,
              }
            : rule,
        ),
    )
    .max(20)
    .default([])
    .refine(
      (rules) =>
        new Set(rules.map((rule) => JSON.stringify(rule))).size ===
        rules.length,
      { message: "Each shipping rule can only be added once" },
    ),
  rates: z
    .array(
      z.object({
        currencyCode: z
          .string()
          .trim()
          .toLowerCase()
          .length(3)
          .regex(/^[a-z]{3}$/),
        amount: z.number().finite().min(0).max(1_000_000_000),
      }),
    )
    .max(100)
    .default([])
    .refine(
      (rates) =>
        new Set(rates.map((rate) => rate.currencyCode)).size === rates.length,
      { message: "Each currency can only be supplied once" },
    ),
});

export const createLocationShippingRateInputSchema =
  locationShippingRateFieldsSchema.superRefine((input, context) => {
    validateShippingPriceFields(input, context);
    if (input.serviceZoneId) return;
    if (!input.zoneName) {
      context.addIssue({
        code: "custom",
        path: ["zoneName"],
        message: "Service zone name is required",
      });
    }
    if (!input.geoZones?.length) {
      context.addIssue({
        code: "custom",
        path: ["geoZones"],
        message: "Add at least one geographic area",
      });
    }
  });

export const updateLocationShippingRateInputSchema =
  locationShippingRateFieldsSchema.extend({
    optionId: idSchema("shipping option"),
    expectedOptionUpdatedAt: z.iso.datetime({ offset: true }),
    expectedZoneUpdatedAt: z.iso.datetime({ offset: true }),
    zoneName: z
      .string()
      .trim()
      .min(1, "Service zone name is required")
      .max(200),
    geoZones: shippingGeoZonesSchema,
  }).superRefine(validateShippingPriceFields);

function validateShippingPriceFields(
  input: { priceType: "flat" | "calculated"; rates: unknown[] },
  context: z.RefinementCtx,
) {
  if (input.priceType === "flat" && input.rates.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["rates"],
      message: "Add at least one flat shipping rate",
    });
  }
  if (input.priceType === "calculated" && input.rates.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["rates"],
      message: "Calculated shipping options cannot include fixed rates",
    });
  }
}

export const deleteLocationShippingRateInputSchema = z.object({
  locationId: idSchema("stock location"),
  optionId: idSchema("shipping option"),
  expectedOptionUpdatedAt: z.iso.datetime({ offset: true }),
});
