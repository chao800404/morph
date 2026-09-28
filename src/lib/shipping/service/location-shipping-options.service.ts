import type { JsonValue } from "@/db/json";
import { currencyDal } from "@/lib/currency/dal/currency.dal";
import { findCurrency, type CurrencyDefinition } from "@/lib/currency/catalog";
import type { StoreCurrencyDTO } from "@/lib/currency/dto/currency.dto";
import { fail, failure, ok, type ServerFailure } from "@/lib/db/server-result";
import { findCountry } from "@/lib/region/countries";
import { shippingAdminDal } from "@/lib/shipping/dal/shipping-admin.dal";
import { shippingOptionTypeDal } from "@/lib/shipping/dal/shipping-option-type.dal";
import { shippingProfileDal } from "@/lib/shipping/dal/shipping-profile.dal";
import type {
  ShippingAdminGeoZoneInput,
  ShippingAdminRuleDTO,
} from "@/lib/shipping/dto/shipping-admin.dto";
import { fulfillmentProviderRegistry } from "@/lib/fulfillment/providers/fulfillment-provider-registry.server";
import { shippingRateProviderRegistry } from "@/lib/shipping/providers/shipping-rate-provider-registry.server";
import { stockLocationDal } from "@/lib/stock-location/dal/stock-location.dal";
import { getConfig } from "@/server/get-config";
import type {
  createLocationShippingRateInputSchema,
  deleteLocationShippingRateInputSchema,
  updateLocationShippingRateInputSchema,
} from "@/lib/validations/shipping-admin";
import type { z } from "zod";

export type CreateLocationShippingRateInput = z.infer<
  typeof createLocationShippingRateInputSchema
>;
export type UpdateLocationShippingRateInput = z.infer<
  typeof updateLocationShippingRateInputSchema
>;
export type DeleteLocationShippingRateInput = z.infer<
  typeof deleteLocationShippingRateInputSchema
>;

type PriceInput =
  CreateLocationShippingRateInput | UpdateLocationShippingRateInput;
type PriceRow = { id: string; currencyCode: string; amount: number };

type ServiceResult<TData> =
  { success: true; message: string; data: TData } | ServerFailure;

export type LocationShippingOptionsDependencies = {
  assertConfig(): unknown;
  findLocation(id: string): Promise<{ id: string; name: string } | null>;
  findProfile(id: string): Promise<{ id: string } | null>;
  findOptionType(id: string): Promise<{ id: string } | null>;
  listOptionTypes(): ReturnType<typeof shippingOptionTypeDal.listActiveChoices>;
  getCurrencySettings(): Promise<{
    supportedCurrencies: StoreCurrencyDTO[];
  }>;
  listForLocation(
    locationId: string,
  ): ReturnType<typeof shippingAdminDal.listForLocation>;
  findActiveZoneByName(name: string, excludingId?: string): Promise<boolean>;
  createShippingOption: typeof shippingAdminDal.createShippingOption;
  updateShippingOption: typeof shippingAdminDal.updateShippingOption;
  softDeleteFlatRate: typeof shippingAdminDal.softDeleteFlatRate;
  fulfillmentProvider(id: string | null): { id: string } | null;
  shippingRateProvider(id: string): unknown | null;
  fulfillmentProviders(): ReturnType<typeof fulfillmentProviderRegistry.list>;
  listAssignedFulfillmentProviderIds(locationId: string): Promise<string[]>;
  shippingRateProviders(): ReturnType<typeof shippingRateProviderRegistry.list>;
  findCountry(code: string): boolean;
  findCurrency(code: string): CurrencyDefinition | undefined;
  createId(): string;
  now(): string;
};

const defaultDependencies: LocationShippingOptionsDependencies = {
  assertConfig: () => getConfig(),
  findLocation: (id) => stockLocationDal.findById(id),
  findProfile: (id) => shippingProfileDal.findById(id),
  findOptionType: (id) => shippingOptionTypeDal.findById(id),
  listOptionTypes: () => shippingOptionTypeDal.listActiveChoices(),
  getCurrencySettings: () => currencyDal.getStoreSettings(),
  listForLocation: (locationId) => shippingAdminDal.listForLocation(locationId),
  findActiveZoneByName: (name, excludingId) =>
    shippingAdminDal.findActiveZoneByName(name, excludingId),
  createShippingOption: (input) => shippingAdminDal.createShippingOption(input),
  updateShippingOption: (input) => shippingAdminDal.updateShippingOption(input),
  softDeleteFlatRate: (input) => shippingAdminDal.softDeleteFlatRate(input),
  fulfillmentProvider: (id) => fulfillmentProviderRegistry.get(id),
  shippingRateProvider: (id) => shippingRateProviderRegistry.get(id),
  fulfillmentProviders: () => fulfillmentProviderRegistry.list(),
  listAssignedFulfillmentProviderIds: (locationId) =>
    stockLocationDal.listFulfillmentProviderIds(locationId),
  shippingRateProviders: () => shippingRateProviderRegistry.list(),
  findCountry: (code) => Boolean(findCountry(code)),
  findCurrency,
  createId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

const makePriceRows = (
  input: PriceInput,
  supportedCurrencies: StoreCurrencyDTO[],
  dependencies: LocationShippingOptionsDependencies,
):
  | { success: true; prices: PriceRow[] }
  | { success: false; error: ServerFailure } => {
  if (input.priceType !== "flat") return { success: true, prices: [] };

  const supported = new Map(
    supportedCurrencies.map((currency) => [
      currency.code.toLowerCase(),
      currency,
    ]),
  );
  const rateCodes = new Set(input.rates.map((rate) => rate.currencyCode));
  const missingCodes = [...supported.keys()].filter(
    (code) => !rateCodes.has(code),
  );
  const unsupportedCodes = input.rates
    .map((rate) => rate.currencyCode)
    .filter((code) => !supported.has(code));
  if (missingCodes.length || unsupportedCodes.length) {
    return {
      success: false,
      error: fail("Enter a shipping rate for every supported store currency", {
        errors: {
          rates: [
            ...(missingCodes.length
              ? [
                  `Missing: ${missingCodes.map((code) => code.toUpperCase()).join(", ")}`,
                ]
              : []),
            ...(unsupportedCodes.length
              ? [
                  `Unsupported: ${unsupportedCodes.map((code) => code.toUpperCase()).join(", ")}`,
                ]
              : []),
          ],
        },
      }),
    };
  }

  const prices: PriceRow[] = [];
  for (const rate of input.rates) {
    const currency =
      supported.get(rate.currencyCode) ??
      dependencies.findCurrency(rate.currencyCode);
    if (!currency) {
      return {
        success: false,
        error: fail("A currency definition is unavailable", {
          errors: {
            rates: [`${rate.currencyCode.toUpperCase()} is not available`],
          },
        }),
      };
    }
    const scaledAmount = rate.amount * 10 ** currency.decimalDigits;
    const minorAmount = Math.round(scaledAmount);
    if (
      !Number.isSafeInteger(minorAmount) ||
      Math.abs(scaledAmount - minorAmount) > 1e-6
    ) {
      return {
        success: false,
        error: fail(
          `${currency.code.toUpperCase()} supports up to ${currency.decimalDigits} decimal places`,
          { errors: { [`rate_${currency.code}`]: ["Enter a valid amount"] } },
        ),
      };
    }
    prices.push({
      id: dependencies.createId(),
      currencyCode: currency.code.toLowerCase(),
      amount: minorAmount,
    });
  }
  return { success: true, prices };
};

const invalidGeoZone = (
  geoZones: ShippingAdminGeoZoneInput[] | undefined,
  dependencies: LocationShippingOptionsDependencies,
) =>
  geoZones?.some((geoZone) => !dependencies.findCountry(geoZone.countryCode));

const findSelectedOption = (
  zones: Awaited<ReturnType<typeof shippingAdminDal.listForLocation>>,
  optionId: string,
) => {
  const zone = zones.find((candidate) =>
    candidate.options.some((option) => option.id === optionId),
  );
  const option = zone?.options.find((candidate) => candidate.id === optionId);
  return zone && option ? { zone, option } : null;
};

export const createLocationShippingOptionsService = (
  overrides: Partial<LocationShippingOptionsDependencies> = {},
) => {
  const dependencies = { ...defaultDependencies, ...overrides };
  return {
    async list(locationId: string): Promise<
      ServiceResult<{
        locationId: string;
        zones: Awaited<ReturnType<typeof shippingAdminDal.listForLocation>>;
        fulfillmentProviders: ReturnType<
          typeof fulfillmentProviderRegistry.list
        >;
        shippingRateProviders: ReturnType<
          typeof shippingRateProviderRegistry.list
        >;
        shippingOptionTypes: Awaited<
          ReturnType<typeof shippingOptionTypeDal.listActiveChoices>
        >;
        currencies: StoreCurrencyDTO[];
      }>
    > {
      dependencies.assertConfig();
      try {
        const location = await dependencies.findLocation(locationId);
        if (!location)
          return fail("Stock location not found", { error: "NOT_FOUND" });
        const [
          zones,
          currencySettings,
          shippingOptionTypes,
          assignedProviderIds,
        ] = await Promise.all([
          dependencies.listForLocation(location.id),
          dependencies.getCurrencySettings(),
          dependencies.listOptionTypes(),
          dependencies.listAssignedFulfillmentProviderIds(location.id),
        ]);
        const assignedProviders = new Set(assignedProviderIds);
        return ok("Shipping options fetched successfully", {
          locationId: location.id,
          zones,
          fulfillmentProviders: dependencies
            .fulfillmentProviders()
            .filter((provider) => assignedProviders.has(provider.id)),
          shippingRateProviders: dependencies.shippingRateProviders(),
          shippingOptionTypes,
          currencies: currencySettings.supportedCurrencies,
        });
      } catch (error) {
        return failure(
          "Get location shipping options error",
          error,
          "GET_FAILED",
          "Failed to fetch shipping options",
        );
      }
    },

    async create(input: CreateLocationShippingRateInput): Promise<
      ServiceResult<{
        locationId: string;
        optionId: string;
        serviceZoneId: string;
        updatedAt: string;
      }>
    > {
      dependencies.assertConfig();
      try {
        const [location, profile, currencySettings] = await Promise.all([
          dependencies.findLocation(input.locationId),
          dependencies.findProfile(input.shippingProfileId),
          dependencies.getCurrencySettings(),
        ]);
        if (!location)
          return fail("Stock location not found", { error: "NOT_FOUND" });
        if (!profile) {
          return fail("Shipping profile not found", {
            error: "NOT_FOUND",
            errors: {
              shippingProfileId: ["Choose an active shipping profile"],
            },
          });
        }
        if (
          input.shippingOptionTypeId &&
          !(await dependencies.findOptionType(input.shippingOptionTypeId))
        ) {
          return fail("Shipping option type not found", {
            error: "NOT_FOUND",
            errors: {
              shippingOptionTypeId: ["Choose an active shipping option type"],
            },
          });
        }
        const fulfillmentProvider = dependencies.fulfillmentProvider(
          input.providerId,
        );
        if (!fulfillmentProvider) {
          return fail("Fulfillment provider is not installed", {
            error: "NOT_FOUND",
            errors: {
              providerId: ["Choose an installed fulfillment provider"],
            },
          });
        }
        const assignedProviderIds =
          await dependencies.listAssignedFulfillmentProviderIds(location.id);
        if (!assignedProviderIds.includes(fulfillmentProvider.id)) {
          return fail(
            "Fulfillment provider is not assigned to this stock location",
            {
              errors: {
                providerId: [
                  "Assign this provider to the stock location before creating a shipping option",
                ],
              },
            },
          );
        }
        if (
          input.priceType === "calculated" &&
          (!input.providerId ||
            !dependencies.shippingRateProvider(input.providerId))
        ) {
          return fail("Shipping provider cannot calculate rates", {
            error: "NOT_FOUND",
            errors: {
              providerId: [
                "Choose a provider installed for both fulfillment and rate calculation",
              ],
            },
          });
        }
        if (invalidGeoZone(input.geoZones, dependencies)) {
          return fail("One or more geographic areas are invalid", {
            errors: { geoZones: ["Choose valid ISO country codes"] },
          });
        }
        if (
          !input.serviceZoneId &&
          input.zoneName &&
          (await dependencies.findActiveZoneByName(input.zoneName))
        ) {
          return fail(
            `A service zone named "${input.zoneName}" already exists`,
            {
              errors: { zoneName: ["This name is already in use"] },
            },
          );
        }
        const priceRows = makePriceRows(
          input,
          currencySettings.supportedCurrencies,
          dependencies,
        );
        if (!priceRows.success) return priceRows.error;

        const now = dependencies.now();
        const serviceZoneId = input.serviceZoneId ?? dependencies.createId();
        const optionId = dependencies.createId();
        const created = await dependencies.createShippingOption({
          locationId: location.id,
          locationName: location.name,
          zoneId: serviceZoneId,
          serviceZoneId: input.serviceZoneId,
          zoneName: input.zoneName,
          geoZones: input.geoZones,
          optionId,
          optionName: input.optionName,
          providerId: input.providerId,
          shippingProfileId: profile.id,
          shippingOptionTypeId: input.shippingOptionTypeId ?? null,
          rules: input.rules as ShippingAdminRuleDTO[],
          priceSetId:
            input.priceType === "flat" ? dependencies.createId() : null,
          priceType: input.priceType,
          providerData: input.providerData as Record<string, JsonValue>,
          prices: priceRows.prices,
          now,
        });
        if (!created) {
          return fail("Service zone not found for this location", {
            error: "NOT_FOUND",
          });
        }
        return ok(`Shipping option "${input.optionName}" created`, {
          locationId: location.id,
          optionId,
          serviceZoneId,
          updatedAt: now,
        });
      } catch (error) {
        return failure(
          "Create location shipping option error",
          error,
          "CREATE_FAILED",
          "Failed to create shipping option",
        );
      }
    },

    async update(
      input: UpdateLocationShippingRateInput,
    ): Promise<
      ServiceResult<{ locationId: string; optionId: string; updatedAt: string }>
    > {
      dependencies.assertConfig();
      try {
        const [location, profile, currencySettings, zones] = await Promise.all([
          dependencies.findLocation(input.locationId),
          dependencies.findProfile(input.shippingProfileId),
          dependencies.getCurrencySettings(),
          dependencies.listForLocation(input.locationId),
        ]);
        if (!location)
          return fail("Stock location not found", { error: "NOT_FOUND" });
        if (!profile) {
          return fail("Shipping profile not found", {
            error: "NOT_FOUND",
            errors: {
              shippingProfileId: ["Choose an active shipping profile"],
            },
          });
        }
        if (
          input.shippingOptionTypeId &&
          !(await dependencies.findOptionType(input.shippingOptionTypeId))
        ) {
          return fail("Shipping option type not found", {
            error: "NOT_FOUND",
            errors: {
              shippingOptionTypeId: ["Choose an active shipping option type"],
            },
          });
        }
        const selected = findSelectedOption(zones, input.optionId);
        if (!selected) {
          return fail("Shipping option not found for this location", {
            error: "NOT_FOUND",
          });
        }
        const { zone, option } = selected;
        if (option.priceType !== input.priceType) {
          return fail(
            "A shipping option's price type cannot be changed after creation",
            {
              error: "CONFLICT",
            },
          );
        }
        if (
          option.priceType === "calculated" &&
          (!option.providerId ||
            !dependencies.fulfillmentProvider(option.providerId) ||
            !dependencies.shippingRateProvider(option.providerId))
        ) {
          return fail(
            "The calculated shipping provider is no longer installed",
            {
              errors: {
                providerData: [
                  "Install the fulfillment and shipping-rate provider before editing this option",
                ],
              },
            },
          );
        }
        if (
          zone.updatedAt !== input.expectedZoneUpdatedAt ||
          option.updatedAt !== input.expectedOptionUpdatedAt
        ) {
          return fail(
            "This shipping option changed while you were editing it. Reload and try again.",
            { error: "CONFLICT" },
          );
        }
        if (invalidGeoZone(input.geoZones, dependencies)) {
          return fail("One or more geographic areas are invalid", {
            errors: { geoZones: ["Choose valid ISO country codes"] },
          });
        }
        if (
          input.zoneName !== zone.name &&
          (await dependencies.findActiveZoneByName(input.zoneName, zone.id))
        ) {
          return fail(
            `A service zone named "${input.zoneName}" already exists`,
            {
              errors: { zoneName: ["This name is already in use"] },
            },
          );
        }
        const priceRows = makePriceRows(
          input,
          currencySettings.supportedCurrencies,
          dependencies,
        );
        if (!priceRows.success) return priceRows.error;

        const now = dependencies.now();
        const updated = await dependencies.updateShippingOption({
          locationId: location.id,
          optionId: option.id,
          expectedOptionUpdatedAt: input.expectedOptionUpdatedAt,
          expectedZoneUpdatedAt: input.expectedZoneUpdatedAt,
          zoneName: input.zoneName,
          geoZones: input.geoZones,
          optionName: input.optionName,
          shippingProfileId: profile.id,
          shippingOptionTypeId: input.shippingOptionTypeId ?? null,
          priceType: input.priceType,
          providerData: input.providerData as Record<string, JsonValue>,
          rules: input.rules as ShippingAdminRuleDTO[],
          prices: priceRows.prices,
          now,
        });
        if (!updated) {
          return fail(
            "This shipping option changed while you were editing it. Reload and try again.",
            { error: "CONFLICT" },
          );
        }
        return ok(`Shipping option "${input.optionName}" updated`, {
          locationId: location.id,
          optionId: option.id,
          updatedAt: now,
        });
      } catch (error) {
        return failure(
          "Update location shipping option error",
          error,
          "UPDATE_FAILED",
          "Failed to update shipping option",
        );
      }
    },

    async delete(
      input: DeleteLocationShippingRateInput,
    ): Promise<ServiceResult<{ locationId: string; optionId: string }>> {
      try {
        const location = await dependencies.findLocation(input.locationId);
        if (!location)
          return fail("Stock location not found", { error: "NOT_FOUND" });
        const deleted = await dependencies.softDeleteFlatRate({
          locationId: location.id,
          optionId: input.optionId,
          expectedOptionUpdatedAt: input.expectedOptionUpdatedAt,
          now: dependencies.now(),
        });
        if (deleted === "not-found") {
          return fail("Shipping option not found for this location", {
            error: "NOT_FOUND",
          });
        }
        if (deleted === "conflict") {
          return fail(
            "This shipping option changed while you were editing it. Reload and try again.",
            { error: "CONFLICT" },
          );
        }
        if (deleted === "in-use") {
          return fail(
            "This option is selected in an active cart. Remove it from the cart before deactivating the option.",
            { error: "IN_USE" },
          );
        }
        return ok("Shipping option deactivated", {
          locationId: location.id,
          optionId: input.optionId,
        });
      } catch (error) {
        return failure(
          "Deactivate location shipping option error",
          error,
          "DELETE_FAILED",
          "Failed to deactivate shipping option",
        );
      }
    },
  };
};

export const locationShippingOptionsService =
  createLocationShippingOptionsService();
