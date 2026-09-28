import { describe, expect, it, vi } from "vitest";
import type { StoreCurrencyDTO } from "@/lib/currency/dto/currency.dto";
import type {
  ShippingAdminOptionDTO,
  ShippingAdminZoneDTO,
} from "@/lib/shipping/dto/shipping-admin.dto";
import { locationShippingOptionsService } from "@/lib/shipping/service/location-shipping-options.service";
import {
  handleAdminLocationShippingOptionsRequest,
  type AdminLocationShippingOptionsApiDependencies,
} from "./location-shipping-options";

const locationId = "6fa459ea-ee8a-3ca4-894e-db77e160355e";
const optionId = "a4d7a769-5f1b-4adb-9f4f-c1b338ea3505";
const zoneId = "c9f3cc07-9a22-4c85-9b7d-0a5b7a8f23a0";
const profileId = "c45583db-4777-42ae-bc53-8c44e39776e3";
const updatedAt = "2026-09-27T00:00:00.000Z";

const option: ShippingAdminOptionDTO = {
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
};

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
  options: [option],
};

const currency: StoreCurrencyDTO = {
  code: "twd",
  symbol: "NT$",
  symbolNative: "NT$",
  name: "New Taiwan Dollar",
  decimalDigits: 0,
  rounding: 0,
  isDefault: true,
  isTaxInclusive: false,
};

type ListSuccess = Extract<
  Awaited<ReturnType<typeof locationShippingOptionsService.list>>,
  { success: true }
>;
type CreateSuccess = Extract<
  Awaited<ReturnType<typeof locationShippingOptionsService.create>>,
  { success: true }
>;
type UpdateSuccess = Extract<
  Awaited<ReturnType<typeof locationShippingOptionsService.update>>,
  { success: true }
>;
type DeleteSuccess = Extract<
  Awaited<ReturnType<typeof locationShippingOptionsService.delete>>,
  { success: true }
>;

const listResult: ListSuccess = {
  success: true,
  message: "Shipping options fetched successfully",
  data: {
    locationId,
    zones: [zone],
    fulfillmentProviders: [{ id: "manual_manual", name: "Manual" }],
    shippingRateProviders: [{ id: "manual_manual", name: "Manual" }],
    shippingOptionTypes: [],
    currencies: [currency],
  },
};

const dependencies = (
  overrides: Partial<AdminLocationShippingOptionsApiDependencies> = {},
): AdminLocationShippingOptionsApiDependencies => ({
  authorize: vi.fn(async () => ({
    allowed: true as const,
    userId: "admin-user",
    role: "admin",
  })),
  list: vi.fn(async () => listResult),
  create: vi.fn(
    async () =>
      ({
        success: true as const,
        message: "Shipping option created",
        data: { locationId, optionId, serviceZoneId: zoneId, updatedAt },
      }) satisfies CreateSuccess,
  ),
  update: vi.fn(
    async () =>
      ({
        success: true as const,
        message: "Shipping option updated",
        data: { locationId, optionId, updatedAt },
      }) satisfies UpdateSuccess,
  ),
  delete: vi.fn(
    async () =>
      ({
        success: true as const,
        message: "Shipping option deactivated",
        data: { locationId, optionId },
      }) satisfies DeleteSuccess,
  ),
  ...overrides,
});

const json = (response: Response) => response.json() as Promise<unknown>;

describe("Medusa-shaped location shipping options Admin API", () => {
  it("lists shipping options with their service zones, rates, providers, and currencies", async () => {
    const deps = dependencies();
    const response = await handleAdminLocationShippingOptionsRequest(
      new Request(
        `https://morph.test/api/admin/locations/${locationId}/shipping-options`,
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.list).toHaveBeenCalledWith(locationId);
    expect(await json(response)).toMatchObject({
      count: 1,
      shipping_options: [
        {
          id: optionId,
          service_zone_id: zoneId,
          shipping_profile_id: profileId,
          prices: [{ currency_code: "twd", amount: 70 }],
        },
      ],
      service_zones: [
        {
          id: zoneId,
          geo_zones: [{ country_code: "tw" }],
        },
      ],
      currencies: [{ code: "twd", decimal_digits: 0 }],
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("maps the Medusa-style create payload into Morph's validated location input", async () => {
    const deps = dependencies();
    const response = await handleAdminLocationShippingOptionsRequest(
      new Request(
        `https://morph.test/api/admin/locations/${locationId}/shipping-options`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Home delivery",
            service_zone_name: "Taiwan",
            geo_zones: [{ type: "country", country_code: "tw" }],
            shipping_profile_id: profileId,
            provider_id: "manual_manual",
            price_type: "flat",
            prices: [{ currency_code: "twd", amount: 70 }],
          }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(201);
    expect(deps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        locationId,
        optionName: "Home delivery",
        zoneName: "Taiwan",
        geoZones: [{ type: "country", countryCode: "tw" }],
        shippingProfileId: profileId,
        providerId: "manual_manual",
        rates: [{ currencyCode: "twd", amount: 70 }],
      }),
    );
    expect(await json(response)).toMatchObject({
      shipping_option: {
        id: optionId,
        service_zone_id: zoneId,
        name: "Home delivery",
        updated_at: updatedAt,
      },
    });
  });

  it("uses option and zone updated_at values as CAS inputs when updating", async () => {
    const deps = dependencies();
    const response = await handleAdminLocationShippingOptionsRequest(
      new Request(
        `https://morph.test/api/admin/locations/${locationId}/shipping-options/${optionId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Home delivery updated",
            updated_at: updatedAt,
            service_zone: {
              id: zoneId,
              name: "Taiwan updated",
              updated_at: updatedAt,
              geo_zones: [{ type: "country", country_code: "tw" }],
            },
            shipping_profile_id: profileId,
            provider_id: "manual_manual",
            price_type: "flat",
            prices: [{ currency_code: "twd", amount: 80 }],
          }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.update).toHaveBeenCalledWith(
      expect.objectContaining({
        locationId,
        optionId,
        expectedOptionUpdatedAt: updatedAt,
        expectedZoneUpdatedAt: updatedAt,
        optionName: "Home delivery updated",
        zoneName: "Taiwan updated",
      }),
    );
    expect(await json(response)).toEqual({
      shipping_option: { id: optionId, updated_at: updatedAt },
    });
  });

  it("requires the current updated_at value before deactivating an option", async () => {
    const deps = dependencies();
    const response = await handleAdminLocationShippingOptionsRequest(
      new Request(
        `https://morph.test/api/admin/locations/${locationId}/shipping-options/${optionId}`,
        { method: "DELETE" },
      ),
      deps,
    );

    expect(response.status).toBe(400);
    expect(deps.delete).not.toHaveBeenCalled();
  });

  it("returns a conflict when the location option is still used by an active cart", async () => {
    const deps = dependencies({
      delete: vi.fn(async () => ({
        success: false as const,
        message: "The option is used by an active cart",
        data: null,
        error: "IN_USE",
      })),
    });
    const response = await handleAdminLocationShippingOptionsRequest(
      new Request(
        `https://morph.test/api/admin/locations/${locationId}/shipping-options/${optionId}?updated_at=${encodeURIComponent(updatedAt)}`,
        { method: "DELETE" },
      ),
      deps,
    );

    expect(response.status).toBe(409);
    expect(deps.delete).toHaveBeenCalledWith({
      locationId,
      optionId,
      expectedOptionUpdatedAt: updatedAt,
    });
  });

  it("requires commerce authorization and rejects malformed identifiers", async () => {
    const denied = dependencies({
      authorize: vi.fn(async () => ({
        allowed: false as const,
        status: 403 as const,
        error: "FORBIDDEN" as const,
        message: "Forbidden",
      })),
    });
    const deniedResponse = await handleAdminLocationShippingOptionsRequest(
      new Request(
        `https://morph.test/api/admin/locations/${locationId}/shipping-options`,
      ),
      denied,
    );
    expect(deniedResponse.status).toBe(403);
    expect(denied.list).not.toHaveBeenCalled();

    const deps = dependencies();
    const invalid = await handleAdminLocationShippingOptionsRequest(
      new Request(
        "https://morph.test/api/admin/locations/not-a-uuid/shipping-options",
      ),
      deps,
    );
    expect(invalid.status).toBe(400);
  });
});
