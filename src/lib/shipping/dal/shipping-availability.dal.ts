import { getDb } from "@/db";
import {
  fulfillmentProviders,
  fulfillmentSets,
  geoZones,
  serviceZones,
  shippingProfiles,
  shippingOptionRules,
  shippingOptions,
} from "@/db/fulfillment.schema";
import {
  locationFulfillmentSets,
  locationFulfillmentProviders,
  productShippingProfiles,
  salesChannelStockLocations,
  shippingOptionPriceSets,
} from "@/db/link.schema";
import { pricingDal } from "@/lib/pricing/dal/pricing.dal";
import { fulfillmentProviderRegistry } from "@/lib/fulfillment/providers/fulfillment-provider-registry.server";
import { getConfig } from "@/server/get-config";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { StoreShippingOptionDTO } from "../dto/shipping-option.dto";
import { matchesGeoZone, matchesShippingRules } from "../match-shipping";
import { shippingRateProviderRegistry } from "../providers/shipping-rate-provider-registry.server";

type ShippingOwner =
  { type: "cart"; id: string } | { type: "order"; id: string };

export interface ShippingAvailabilityInput {
  owner: ShippingOwner;
  regionId: string;
  salesChannelId: string;
  currencyCode: string;
  shippingAddress: {
    countryCode: string | null;
    provinceCode?: string | null;
    city?: string | null;
    postalCode?: string | null;
  } | null;
  items: Array<{
    productId: string | null;
    requiresShipping: boolean;
    quantity: number;
  }>;
  itemSubtotal: number;
  itemDiscountTotal: number;
}

export interface ShippingAvailabilityQuote {
  availableOptions: StoreShippingOptionDTO[];
  requiredShippingProfiles: Array<{ id: string; name: string }>;
}

export const shippingAvailabilityDal = {
  async quote(
    input: ShippingAvailabilityInput,
  ): Promise<ShippingAvailabilityQuote> {
    getConfig();
    const address = input.shippingAddress;
    if (!address?.countryCode)
      return { availableOptions: [], requiredShippingProfiles: [] };
    const db = await getDb();
    const productIds = [
      ...new Set(
        input.items.flatMap((item) =>
          item.requiresShipping && item.productId ? [item.productId] : [],
        ),
      ),
    ];
    const profileLinks = productIds.length
      ? await db
          .select({
            productId: productShippingProfiles.productId,
            shippingProfileId: productShippingProfiles.shippingProfileId,
          })
          .from(productShippingProfiles)
          .where(inArray(productShippingProfiles.productId, productIds))
      : [];
    if (
      productIds.some(
        (productId) =>
          !profileLinks.some((link) => link.productId === productId),
      )
    )
      return { availableOptions: [], requiredShippingProfiles: [] };
    const requiredProfiles = new Set(
      profileLinks.map((link) => link.shippingProfileId),
    );
    const requiredProfileNames = requiredProfiles.size
      ? await db
          .select({ id: shippingProfiles.id, name: shippingProfiles.name })
          .from(shippingProfiles)
          .where(
            and(
              inArray(shippingProfiles.id, [...requiredProfiles]),
              isNull(shippingProfiles.deletedAt),
            ),
          )
      : [];
    const requiredProfileNameById = new Map(
      requiredProfileNames.map((profile) => [profile.id, profile.name]),
    );
    const requiredShippingProfiles = [...requiredProfiles].map((id) => ({
      id,
      name: requiredProfileNameById.get(id) ?? id,
    }));
    const rows = await db
      .select({
        option: shippingOptions,
        geoZone: geoZones,
        providerEnabled: fulfillmentProviders.isEnabled,
        assignedProviderId: locationFulfillmentProviders.fulfillmentProviderId,
      })
      .from(shippingOptions)
      .innerJoin(
        serviceZones,
        and(
          eq(serviceZones.id, shippingOptions.serviceZoneId),
          isNull(serviceZones.deletedAt),
        ),
      )
      .innerJoin(
        fulfillmentSets,
        and(
          eq(fulfillmentSets.id, serviceZones.fulfillmentSetId),
          eq(fulfillmentSets.type, "shipping"),
          isNull(fulfillmentSets.deletedAt),
        ),
      )
      .innerJoin(
        locationFulfillmentSets,
        eq(locationFulfillmentSets.fulfillmentSetId, fulfillmentSets.id),
      )
      .innerJoin(
        salesChannelStockLocations,
        and(
          eq(
            salesChannelStockLocations.stockLocationId,
            locationFulfillmentSets.stockLocationId,
          ),
          eq(salesChannelStockLocations.salesChannelId, input.salesChannelId),
        ),
      )
      .innerJoin(
        geoZones,
        and(
          eq(geoZones.serviceZoneId, serviceZones.id),
          isNull(geoZones.deletedAt),
        ),
      )
      .leftJoin(
        fulfillmentProviders,
        and(
          eq(fulfillmentProviders.id, shippingOptions.providerId),
          isNull(fulfillmentProviders.deletedAt),
        ),
      )
      .leftJoin(
        locationFulfillmentProviders,
        and(
          eq(
            locationFulfillmentProviders.stockLocationId,
            locationFulfillmentSets.stockLocationId,
          ),
          eq(
            locationFulfillmentProviders.fulfillmentProviderId,
            shippingOptions.providerId,
          ),
        ),
      )
      .where(
        and(
          isNull(shippingOptions.deletedAt),
          or(
            isNull(shippingOptions.providerId),
            eq(fulfillmentProviders.isEnabled, true),
          ),
        ),
      );
    const byId = new Map<string, (typeof rows)[number]["option"]>();
    for (const row of rows) {
      if (
        row.option.providerId &&
        (!row.providerEnabled ||
          row.assignedProviderId !== row.option.providerId ||
          !fulfillmentProviderRegistry.get(row.option.providerId))
      )
        continue;
      if (
        !matchesGeoZone(
          {
            type: row.geoZone.type,
            countryCode: row.geoZone.countryCode,
            provinceCode: row.geoZone.provinceCode,
            city: row.geoZone.city,
            postalExpression: row.geoZone.postalExpression,
          },
          {
            countryCode: address.countryCode,
            provinceCode: address.provinceCode,
            city: address.city,
            postalCode: address.postalCode,
          },
        )
      )
        continue;
      if (
        requiredProfiles.size &&
        (!row.option.shippingProfileId ||
          !requiredProfiles.has(row.option.shippingProfileId))
      )
        continue;
      byId.set(row.option.id, row.option);
    }
    const optionIds = [...byId.keys()];
    if (!optionIds.length)
      return { availableOptions: [], requiredShippingProfiles };
    const [rules, priceLinks] = await Promise.all([
      db
        .select()
        .from(shippingOptionRules)
        .where(
          and(
            inArray(shippingOptionRules.shippingOptionId, optionIds),
            isNull(shippingOptionRules.deletedAt),
          ),
        ),
      db
        .select()
        .from(shippingOptionPriceSets)
        .where(inArray(shippingOptionPriceSets.shippingOptionId, optionIds)),
    ]);
    const itemCount = input.items.reduce((sum, item) => sum + item.quantity, 0);
    const attributes = {
      total: input.itemSubtotal - input.itemDiscountTotal,
      subtotal: input.itemSubtotal,
      item_count: itemCount,
      currency_code: input.currencyCode,
      region_id: input.regionId,
      sales_channel_id: input.salesChannelId,
    };
    const available: StoreShippingOptionDTO[] = [];
    for (const option of byId.values()) {
      const optionRules = rules
        .filter((rule) => rule.shippingOptionId === option.id)
        .map((rule) => ({
          attribute: rule.attribute,
          operator: rule.operator,
          value: rule.value,
        }));
      if (!matchesShippingRules(optionRules, attributes)) continue;
      let amount: number | null | undefined;
      if (option.priceType === "flat") {
        amount = (
          await pricingDal.resolvePriceSets({
            priceSetIds: priceLinks
              .filter((link) => link.shippingOptionId === option.id)
              .map((link) => link.priceSetId),
            baseAmount: null,
            context: {
              currencyCode: input.currencyCode,
              quantity: 1,
              regionId: input.regionId,
              salesChannelId: input.salesChannelId,
            },
          })
        )?.amount;
      } else if (option.providerId) {
        const provider = shippingRateProviderRegistry.get(option.providerId);
        if (!provider) continue;
        try {
          amount = await provider.calculate({
            optionId: option.id,
            data: option.data,
            context: {
              ...(input.owner.type === "cart"
                ? { cartId: input.owner.id }
                : { orderId: input.owner.id }),
              currencyCode: input.currencyCode,
              itemSubtotal: attributes.subtotal,
              itemCount,
              address: {
                countryCode: address.countryCode,
                provinceCode: address.provinceCode ?? null,
                city: address.city ?? null,
                postalCode: address.postalCode ?? null,
              },
            },
          });
        } catch {
          // A rate provider outage removes its option from this quote only.
          continue;
        }
      }
      if (
        typeof amount !== "number" ||
        !Number.isSafeInteger(amount) ||
        amount < 0
      )
        continue;
      available.push({
        id: option.id,
        name: option.name,
        priceType: option.priceType,
        shippingProfileId: option.shippingProfileId,
        providerId: option.providerId,
        amount,
        currencyCode: input.currencyCode,
      });
    }
    return {
      availableOptions: available,
      requiredShippingProfiles,
    };
  },

  async listAvailable(
    input: ShippingAvailabilityInput,
  ): Promise<StoreShippingOptionDTO[]> {
    return (await this.quote(input)).availableOptions;
  },
};
