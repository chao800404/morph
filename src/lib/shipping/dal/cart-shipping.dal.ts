import { getDb } from "@/db";
import { cartLineItems, carts, cartShippingMethods } from "@/db/cart.schema";
import {
  fulfillmentProviders,
  fulfillmentSets,
  geoZones,
  serviceZones,
  shippingOptionRules,
  shippingOptions,
} from "@/db/fulfillment.schema";
import {
  locationFulfillmentSets,
  productShippingProfiles,
  salesChannelStockLocations,
  shippingOptionPriceSets,
} from "@/db/link.schema";
import { regions } from "@/db/region.schema";
import { cartDal } from "@/lib/cart/dal/cart.dal";
import { pricingDal } from "@/lib/pricing/dal/pricing.dal";
import { cartPromotionDal } from "@/lib/promotion/dal/cart-promotion.dal";
import { cartTaxDal } from "@/lib/tax/dal/cart-tax.dal";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import type { StoreShippingOptionDTO } from "../dto/shipping-option.dto";
import { matchesGeoZone, matchesShippingRules } from "../match-shipping";
import { shippingRateProviderRegistry } from "../providers/shipping-rate-provider-registry.server";

type ShippingMutationResult =
  | { success: true }
  | {
      success: false;
      reason: "NOT_FOUND" | "ADDRESS_REQUIRED" | "UNAVAILABLE";
    };

export const cartShippingDal = {
  async listAvailable(
    cartId: string,
    salesChannelId: string,
  ): Promise<StoreShippingOptionDTO[]> {
    const cart = await cartDal.findById(cartId, salesChannelId);
    if (!cart?.shippingAddress?.countryCode) return [];
    const db = await getDb();
    const rawItems = await db
      .select({
        productId: cartLineItems.productId,
        requiresShipping: cartLineItems.requiresShipping,
      })
      .from(cartLineItems)
      .where(
        and(eq(cartLineItems.cartId, cartId), isNull(cartLineItems.deletedAt)),
      );
    const productIds = [
      ...new Set(
        rawItems.flatMap((item) =>
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
      return [];
    const requiredProfiles = new Set(
      profileLinks.map((link) => link.shippingProfileId),
    );
    const rows = await db
      .select({
        option: shippingOptions,
        geoZone: geoZones,
        providerEnabled: fulfillmentProviders.isEnabled,
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
          eq(salesChannelStockLocations.salesChannelId, salesChannelId),
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
        !matchesGeoZone(
          {
            type: row.geoZone.type,
            countryCode: row.geoZone.countryCode,
            provinceCode: row.geoZone.provinceCode,
            city: row.geoZone.city,
            postalExpression: row.geoZone.postalExpression,
          },
          {
            countryCode: cart.shippingAddress.countryCode,
            provinceCode: cart.shippingAddress.province,
            city: cart.shippingAddress.city,
            postalCode: cart.shippingAddress.postalCode,
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
    if (!optionIds.length) return [];
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
    const attributes = {
      total: cart.itemSubtotal - cart.itemDiscountTotal,
      subtotal: cart.itemSubtotal,
      item_count: cart.items.reduce((sum, item) => sum + item.quantity, 0),
      currency_code: cart.currencyCode,
      region_id: cart.regionId,
      sales_channel_id: cart.salesChannelId,
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
      const amount =
        option.priceType === "flat"
          ? (
              await pricingDal.resolvePriceSets({
                priceSetIds: priceLinks
                  .filter((link) => link.shippingOptionId === option.id)
                  .map((link) => link.priceSetId),
                baseAmount: null,
                context: {
                  currencyCode: cart.currencyCode,
                  quantity: 1,
                  regionId: cart.regionId,
                  salesChannelId: cart.salesChannelId,
                },
              })
            )?.amount
          : option.providerId
            ? await shippingRateProviderRegistry
                .get(option.providerId)
                ?.calculate({
                  optionId: option.id,
                  data: option.data,
                  context: {
                    cartId,
                    currencyCode: cart.currencyCode,
                    itemSubtotal: attributes.total,
                    itemCount: attributes.item_count,
                    address: {
                      countryCode: cart.shippingAddress.countryCode,
                      provinceCode: cart.shippingAddress.province,
                      city: cart.shippingAddress.city,
                      postalCode: cart.shippingAddress.postalCode,
                    },
                  },
                })
            : null;
      if (amount === null || amount === undefined) continue;
      available.push({
        id: option.id,
        name: option.name,
        priceType: option.priceType,
        shippingProfileId: option.shippingProfileId,
        providerId: option.providerId,
        amount,
        currencyCode: cart.currencyCode,
      });
    }
    return available;
  },

  async select(
    cartId: string,
    salesChannelId: string,
    shippingOptionId: string,
  ): Promise<ShippingMutationResult> {
    const cart = await cartDal.findById(cartId, salesChannelId);
    if (!cart) return { success: false, reason: "NOT_FOUND" };
    if (!cart.shippingAddress)
      return { success: false, reason: "ADDRESS_REQUIRED" };
    const available = await this.listAvailable(cartId, salesChannelId);
    const option = available.find((item) => item.id === shippingOptionId);
    if (!option) return { success: false, reason: "UNAVAILABLE" };
    const db = await getDb();
    const [region] = await db
      .select({ isTaxInclusive: regions.isTaxInclusive })
      .from(regions)
      .where(and(eq(regions.id, cart.regionId), isNull(regions.deletedAt)))
      .limit(1);
    const existing = await db
      .select({
        methodId: cartShippingMethods.id,
        profileId: shippingOptions.shippingProfileId,
      })
      .from(cartShippingMethods)
      .leftJoin(
        shippingOptions,
        eq(shippingOptions.id, cartShippingMethods.shippingOptionId),
      )
      .where(
        and(
          eq(cartShippingMethods.cartId, cartId),
          isNull(cartShippingMethods.deletedAt),
        ),
      );
    const replaceIds = existing
      .filter((item) => item.profileId === option.shippingProfileId)
      .map((item) => item.methodId);
    const now = new Date().toISOString();
    if (replaceIds.length)
      await db
        .update(cartShippingMethods)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(cartShippingMethods.id, replaceIds));
    await db.insert(cartShippingMethods).values({
      id: crypto.randomUUID(),
      cartId,
      name: option.name,
      amount: option.amount,
      isTaxInclusive: region?.isTaxInclusive ?? false,
      shippingOptionId: option.id,
      data: {},
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    await db.update(carts).set({ updatedAt: now }).where(eq(carts.id, cartId));
    await cartPromotionDal.refresh(cartId);
    await cartTaxDal.refresh(cartId);
    return { success: true };
  },
};
