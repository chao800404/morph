import { matchesGeoZone } from "@/lib/shipping/match-shipping";
import {
  createLocationShippingRateInputSchema,
  shippingGeoZoneInputSchema,
} from "./shipping-admin";
import { describe, expect, it } from "vitest";

const baseInput = {
  locationId: "00000000-0000-4000-8000-000000000001",
  serviceZoneId: null,
  zoneName: "Taiwan metro",
  optionName: "Standard delivery",
  shippingProfileId: "00000000-0000-4000-8000-000000000002",
  rates: [{ currencyCode: "twd", amount: 80 }],
};

describe("shipping service zone inputs", () => {
  it("normalizes countries and province codes and parses postal ranges", () => {
    const parsed = createLocationShippingRateInputSchema.parse({
      ...baseInput,
      geoZones: [
        { type: "country", countryCode: "TW" },
        {
          type: "province",
          countryCode: "tw",
          provinceCode: "tpe",
        },
        {
          type: "zip",
          countryCode: "tw",
          provinceCode: "tpe",
          city: "Taipei",
          postalExpression: "100*\n10400..10499",
        },
      ],
    });

    expect(parsed.geoZones).toEqual([
      { type: "country", countryCode: "tw" },
      { type: "province", countryCode: "tw", provinceCode: "TPE" },
      {
        type: "zip",
        countryCode: "tw",
        provinceCode: "TPE",
        city: "Taipei",
        postalExpression: ["100*", { from: "10400", to: "10499" }],
      },
    ]);
  });

  it("makes saved city and postal areas available to the checkout matcher", () => {
    const postalZone = shippingGeoZoneInputSchema.parse({
      type: "zip",
      countryCode: "tw",
      provinceCode: "tpe",
      city: "Taipei",
      postalExpression: "100*",
    });

    expect(
      matchesGeoZone(postalZone, {
        countryCode: "TW",
        provinceCode: "TPE",
        city: "taipei",
        postalCode: "10058",
      }),
    ).toBe(true);
    expect(
      matchesGeoZone(postalZone, {
        countryCode: "TW",
        provinceCode: "TPE",
        city: "Taipei",
        postalCode: "10400",
      }),
    ).toBe(false);
  });

  it("requires a province for city areas and rejects duplicate geographic clauses", () => {
    expect(
      shippingGeoZoneInputSchema.safeParse({
        type: "city",
        countryCode: "tw",
        city: "Taipei",
      }).success,
    ).toBe(false);

    expect(
      createLocationShippingRateInputSchema.safeParse({
        ...baseInput,
        geoZones: [
          { type: "country", countryCode: "tw" },
          { type: "country", countryCode: "TW" },
        ],
      }).success,
    ).toBe(false);
  });

  it("lets an option join an existing service zone without resubmitting its geography", () => {
    const parsed = createLocationShippingRateInputSchema.parse({
      ...baseInput,
      serviceZoneId: "00000000-0000-4000-8000-000000000003",
      zoneName: undefined,
      geoZones: undefined,
    });

    expect(parsed.serviceZoneId).toBe(
      "00000000-0000-4000-8000-000000000003",
    );
    expect(parsed.geoZones).toBeUndefined();
  });

  it("accepts checkout-supported shipping rules with typed values", () => {
    const parsed = createLocationShippingRateInputSchema.parse({
      ...baseInput,
      geoZones: [{ type: "country", countryCode: "tw" }],
      rules: [
        { attribute: "item_count", operator: "gte", value: 2 },
        { attribute: "subtotal", operator: "gte", value: 8000 },
        { attribute: "currency_code", operator: "in", value: ["TWD", "usd"] },
      ],
    });

    expect(parsed.rules).toHaveLength(3);
    expect(parsed.rules[0]?.value).toBe(2);
    expect(parsed.rules[2]?.value).toEqual(["twd", "usd"]);
  });

  it("accepts calculated options without fixed currency prices", () => {
    const parsed = createLocationShippingRateInputSchema.parse({
      ...baseInput,
      serviceZoneId: "00000000-0000-4000-8000-000000000003",
      zoneName: undefined,
      rates: [],
      priceType: "calculated",
      providerId: "manual_manual",
      providerData: { service: "same-day" },
    });

    expect(parsed.priceType).toBe("calculated");
    expect(parsed.rates).toEqual([]);
    expect(parsed.providerData).toEqual({ service: "same-day" });
  });

  it("keeps flat rates required and rejects fixed prices on calculated options", () => {
    const withZone = {
      ...baseInput,
      serviceZoneId: "00000000-0000-4000-8000-000000000003",
      zoneName: undefined,
      rates: [],
    };

    expect(
      createLocationShippingRateInputSchema.safeParse(withZone).success,
    ).toBe(false);
    expect(
      createLocationShippingRateInputSchema.safeParse({
        ...withZone,
        priceType: "calculated",
        rates: [{ currencyCode: "twd", amount: 80 }],
      }).success,
    ).toBe(false);
  });

  it("requires provider options to be a bounded JSON object", () => {
    expect(
      createLocationShippingRateInputSchema.safeParse({
        ...baseInput,
        geoZones: [{ type: "country", countryCode: "tw" }],
        providerData: ["not", "an", "object"],
      }).success,
    ).toBe(false);
    expect(
      createLocationShippingRateInputSchema.safeParse({
        ...baseInput,
        geoZones: [{ type: "country", countryCode: "tw" }],
        providerData: { payload: "x".repeat(16_385) },
      }).success,
    ).toBe(false);
  });

  it("rejects rules that use operators or values unsupported by their attribute", () => {
    const base = {
      ...baseInput,
      geoZones: [{ type: "country", countryCode: "tw" }],
    };
    expect(
      createLocationShippingRateInputSchema.safeParse({
        ...base,
        rules: [{ attribute: "item_count", operator: "gte", value: "2" }],
      }).success,
    ).toBe(false);
    expect(
      createLocationShippingRateInputSchema.safeParse({
        ...base,
        rules: [{ attribute: "currency_code", operator: "gt", value: "twd" }],
      }).success,
    ).toBe(false);
  });
});
