import { describe, expect, it, vi } from "vitest";
import type { StoreCurrencyDTO } from "@/lib/currency/dto/currency.dto";
import type { ShippingAdminZoneDTO } from "@/lib/shipping/dto/shipping-admin.dto";
import {
  createLocationShippingOptionsService,
  type LocationShippingOptionsDependencies,
} from "./location-shipping-options.service";
import {
  createLocationShippingRateInputSchema,
  updateLocationShippingRateInputSchema,
} from "@/lib/validations/shipping-admin";

const locationId = "6fa459ea-ee8a-3ca4-894e-db77e160355e";
const optionId = "a4d7a769-5f1b-4adb-9f4f-c1b338ea3505";
const zoneId = "c9f3cc07-9a22-4c85-9b7d-0a5b7a8f23a0";
const profileId = "c45583db-4777-42ae-bc53-8c44e39776e3";
const updatedAt = "2026-09-27T00:00:00.000Z";

const currencies: StoreCurrencyDTO[] = [
  {
    code: "twd",
    symbol: "NT$",
    symbolNative: "NT$",
    name: "New Taiwan Dollar",
    decimalDigits: 0,
    rounding: 0,
    isDefault: true,
    isTaxInclusive: false,
  },
  {
    code: "usd",
    symbol: "$",
    symbolNative: "$",
    name: "US Dollar",
    decimalDigits: 2,
    rounding: 0,
    isDefault: false,
    isTaxInclusive: false,
  },
];

const zone: ShippingAdminZoneDTO = {
  id: zoneId,
  name: "Taiwan",
  updatedAt,
  countries: ["tw"],
  geoZones: [
    {
      id: "b9da65de-13d5-4c36-9a20-934e812c68ab",
      type: "country",
      countryCode: "tw",
      provinceCode: null,
      city: null,
      postalExpression: null,
    },
  ],
  options: [
    {
      id: optionId,
      name: "Home delivery",
      updatedAt,
      providerId: "manual_manual",
      priceType: "flat",
      providerData: {},
      shippingProfileId: profileId,
      shippingProfileName: "Default",
      shippingOptionTypeId: null,
      shippingOptionTypeLabel: null,
      shippingOptionTypeCode: null,
      rules: [],
      prices: [{ currencyCode: "twd", amount: 70 }],
    },
  ],
};

const createInput = (overrides: Record<string, unknown> = {}) =>
  createLocationShippingRateInputSchema.parse({
    locationId,
    zoneName: "Taiwan",
    geoZones: [{ type: "country", countryCode: "tw" }],
    optionName: "Home delivery",
    shippingProfileId: profileId,
    providerId: "manual_manual",
    priceType: "flat",
    rates: [
      { currencyCode: "twd", amount: 70 },
      { currencyCode: "usd", amount: 12.34 },
    ],
    ...overrides,
  });

const dependencies = (
  overrides: Partial<LocationShippingOptionsDependencies> = {},
): Partial<LocationShippingOptionsDependencies> => ({
  assertConfig: vi.fn(),
  findLocation: vi.fn(async () => ({ id: locationId, name: "Main warehouse" })),
  findProfile: vi.fn(async () => ({ id: profileId })),
  findOptionType: vi.fn(async () => ({ id: optionId })),
  listOptionTypes: vi.fn(async () => []),
  getCurrencySettings: vi.fn(async () => ({ supportedCurrencies: currencies })),
  listForLocation: vi.fn(async () => [zone]),
  findActiveZoneByName: vi.fn(async () => false),
  createShippingOption: vi.fn(async () => true),
  updateShippingOption: vi.fn(async () => true),
  softDeleteFlatRate: vi.fn(async () => "deleted" as const),
  fulfillmentProvider: vi.fn(() => ({ id: "manual_manual" })),
  shippingRateProvider: vi.fn(() => ({ id: "manual_manual" })),
  fulfillmentProviders: vi.fn(() => [{ id: "manual_manual", name: "Manual" }]),
  listAssignedFulfillmentProviderIds: vi.fn(async () => ["manual_manual"]),
  shippingRateProviders: vi.fn(() => [{ id: "manual_manual", name: "Manual" }]),
  findCountry: vi.fn((code: string) => code === "tw"),
  findCurrency: vi.fn(() => undefined),
  createId: vi
    .fn()
    .mockReturnValueOnce("generated-price-twd")
    .mockReturnValueOnce("generated-price-usd")
    .mockReturnValueOnce("generated-zone")
    .mockReturnValueOnce("generated-option")
    .mockReturnValueOnce("generated-price-set"),
  now: vi.fn(() => "2026-09-27T01:00:00.000Z"),
  ...overrides,
});

describe("location shipping options write service", () => {
  it("checks location, profile, provider and geographic configuration before writing", async () => {
    const deps = dependencies({
      findCountry: vi.fn(() => false),
    });
    const service = createLocationShippingOptionsService(deps);
    const result = await service.create(createInput());

    expect(result).toMatchObject({
      success: false,
      errors: { geoZones: ["Choose valid ISO country codes"] },
    });
    expect(deps.createShippingOption).not.toHaveBeenCalled();
  });

  it("normalizes supported-currency rates into minor units and creates one aggregate", async () => {
    const deps = dependencies();
    const service = createLocationShippingOptionsService(deps);
    const result = await service.create(createInput());

    expect(result).toMatchObject({
      success: true,
      data: {
        locationId,
        optionId: "generated-option",
        serviceZoneId: "generated-zone",
        updatedAt: "2026-09-27T01:00:00.000Z",
      },
    });
    expect(deps.createShippingOption).toHaveBeenCalledWith(
      expect.objectContaining({
        locationId,
        optionId: "generated-option",
        zoneId: "generated-zone",
        priceSetId: "generated-price-set",
        prices: [
          {
            id: "generated-price-twd",
            currencyCode: "twd",
            amount: 70,
          },
          {
            id: "generated-price-usd",
            currencyCode: "usd",
            amount: 1234,
          },
        ],
      }),
    );
  });

  it("requires the fulfillment provider to be assigned to the stock location", async () => {
    const deps = dependencies({
      listAssignedFulfillmentProviderIds: vi.fn(async () => []),
    });
    const service = createLocationShippingOptionsService(deps);
    const result = await service.create(createInput());

    expect(result).toMatchObject({
      success: false,
      errors: {
        providerId: [
          "Assign this provider to the stock location before creating a shipping option",
        ],
      },
    });
    expect(deps.createShippingOption).not.toHaveBeenCalled();
  });

  it("offers only providers assigned to the stock location", async () => {
    const deps = dependencies({
      fulfillmentProviders: vi.fn(() => [
        { id: "manual_manual", name: "Manual" },
        { id: "parcel_parcel", name: "Parcel" },
      ]),
      listAssignedFulfillmentProviderIds: vi.fn(async () => ["parcel_parcel"]),
    });
    const service = createLocationShippingOptionsService(deps);
    const result = await service.list(locationId);

    expect(result).toMatchObject({
      success: true,
      data: {
        fulfillmentProviders: [{ id: "parcel_parcel", name: "Parcel" }],
      },
    });
  });

  it("rejects stale option and service-zone revisions before the D1 write", async () => {
    const deps = dependencies();
    const service = createLocationShippingOptionsService(deps);
    const updateInput = updateLocationShippingRateInputSchema.parse({
      locationId,
      optionId,
      expectedOptionUpdatedAt: "2026-09-26T00:00:00.000Z",
      expectedZoneUpdatedAt: updatedAt,
      zoneName: "Taiwan",
      geoZones: [{ type: "country", countryCode: "tw" }],
      optionName: "Home delivery",
      shippingProfileId: profileId,
      providerId: "manual_manual",
      priceType: "flat",
      rates: [
        { currencyCode: "twd", amount: 70 },
        { currencyCode: "usd", amount: 12.34 },
      ],
    });
    const result = await service.update(updateInput);

    expect(result).toMatchObject({ success: false, error: "CONFLICT" });
    expect(deps.updateShippingOption).not.toHaveBeenCalled();
  });

  it("surfaces the active-cart guard from the DAL when deactivating an option", async () => {
    const deps = dependencies({
      softDeleteFlatRate: vi.fn(async () => "in-use" as const),
    });
    const service = createLocationShippingOptionsService(deps);
    const result = await service.delete({
      locationId,
      optionId,
      expectedOptionUpdatedAt: updatedAt,
    });

    expect(result).toMatchObject({ success: false, error: "IN_USE" });
    expect(deps.softDeleteFlatRate).toHaveBeenCalledWith({
      locationId,
      optionId,
      expectedOptionUpdatedAt: updatedAt,
      now: "2026-09-27T01:00:00.000Z",
    });
  });
});
