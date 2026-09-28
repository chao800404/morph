import { getDb } from "@/db";
import { cartLineItems, carts, cartShippingMethods } from "@/db/cart.schema";
import { shippingOptions } from "@/db/fulfillment.schema";
import { regions } from "@/db/region.schema";
import { cartDal } from "@/lib/cart/dal/cart.dal";
import { firstOrNull } from "@/lib/db/single-row";
import { cartPromotionDal } from "@/lib/promotion/dal/cart-promotion.dal";
import { cartTaxDal } from "@/lib/tax/dal/cart-tax.dal";
import { and, eq, exists, inArray, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { StoreShippingOptionDTO } from "../dto/shipping-option.dto";
import { planCartShippingRefresh } from "../cart-shipping-refresh";
import { shippingAvailabilityDal } from "./shipping-availability.dal";

type ShippingMutationResult =
  | { success: true }
  | {
      success: false;
      reason: "NOT_FOUND" | "ADDRESS_REQUIRED" | "UNAVAILABLE";
    };

type ShippingRefreshResult =
  | {
      success: true;
      changed: boolean;
      availableOptions: StoreShippingOptionDTO[];
    }
  | { success: false; reason: "NOT_FOUND" | "CONFLICT" };

export const cartShippingDal = {
  async listAvailable(
    cartId: string,
    salesChannelId: string,
  ): Promise<StoreShippingOptionDTO[]> {
    const cart = await cartDal.findById(cartId, salesChannelId);
    if (
      !cart?.shippingAddress?.countryCode ||
      !cart.regionId ||
      !cart.salesChannelId
    )
      return [];
    const db = await getDb();
    const rawItems = await db
      .select({
        productId: cartLineItems.productId,
        requiresShipping: cartLineItems.requiresShipping,
        quantity: cartLineItems.quantity,
      })
      .from(cartLineItems)
      .where(
        and(eq(cartLineItems.cartId, cartId), isNull(cartLineItems.deletedAt)),
      );
    return shippingAvailabilityDal.listAvailable({
      owner: { type: "cart", id: cartId },
      regionId: cart.regionId,
      salesChannelId: cart.salesChannelId,
      currencyCode: cart.currencyCode,
      shippingAddress: cart.shippingAddress,
      items: rawItems,
      itemSubtotal: cart.itemSubtotal,
      itemDiscountTotal: cart.itemDiscountTotal,
    });
  },

  /**
   * Requote selected cart shipping methods after cart details, lines, or
   * promotions change. The cart timestamp guards the quote against concurrent
   * mutations, and derived discounts and taxes are recalculated after a write.
   */
  async refreshSelected(
    cartId: string,
    salesChannelId: string,
  ): Promise<ShippingRefreshResult> {
    let changed = false;

    // A concurrent cart edit can invalidate a quote while a provider is being
    // called. Retry once against the new cart version; never write a quote
    // calculated from a stale snapshot.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const cart = await cartDal.findById(cartId, salesChannelId);
      if (!cart) return { success: false, reason: "NOT_FOUND" };

      const availableOptions = await this.listAvailable(cartId, salesChannelId);
      const db = await getDb();
      const selectedMethods = await db
        .select({
          id: cartShippingMethods.id,
          shippingOptionId: cartShippingMethods.shippingOptionId,
          name: cartShippingMethods.name,
          amount: cartShippingMethods.amount,
          updatedAt: cartShippingMethods.updatedAt,
        })
        .from(cartShippingMethods)
        .where(
          and(
            eq(cartShippingMethods.cartId, cartId),
            isNull(cartShippingMethods.deletedAt),
          ),
        );
      const plan = planCartShippingRefresh(selectedMethods, availableOptions);

      if (!plan.length) {
        const currentCart = firstOrNull(
          await db
            .select({ updatedAt: carts.updatedAt })
            .from(carts)
            .where(
              and(
                eq(carts.id, cartId),
                eq(carts.salesChannelId, salesChannelId),
                isNull(carts.deletedAt),
                isNull(carts.completedAt),
              ),
            )
            .limit(1),
        );
        if (!currentCart) return { success: false, reason: "NOT_FOUND" };
        if (currentCart.updatedAt !== cart.updatedAt) continue;
        if (changed) {
          await cartPromotionDal.refresh(cartId);
          await cartTaxDal.refresh(cartId);
        }
        return { success: true, changed, availableOptions };
      }

      const previousTime = Date.parse(cart.updatedAt);
      const timestamp = new Date(
        Math.max(
          Date.now(),
          Number.isFinite(previousTime) ? previousTime + 1 : Date.now(),
        ),
      ).toISOString();
      const cartVersionGuard = db
        .update(carts)
        .set({ updatedAt: timestamp })
        .where(
          and(
            eq(carts.id, cartId),
            eq(carts.salesChannelId, salesChannelId),
            eq(carts.updatedAt, cart.updatedAt),
            isNull(carts.completedAt),
            isNull(carts.deletedAt),
          ),
        );
      const sameCartVersion = exists(
        db
          .select({ id: carts.id })
          .from(carts)
          .where(
            and(
              eq(carts.id, cartId),
              eq(carts.salesChannelId, salesChannelId),
              eq(carts.updatedAt, timestamp),
              isNull(carts.completedAt),
              isNull(carts.deletedAt),
            ),
          ),
      );
      const methodUpdates = plan.map((entry) => {
        const predicates = and(
          eq(cartShippingMethods.id, entry.methodId),
          eq(cartShippingMethods.cartId, cartId),
          eq(cartShippingMethods.shippingOptionId, entry.expectedOptionId),
          eq(cartShippingMethods.amount, entry.expectedAmount),
          eq(cartShippingMethods.updatedAt, entry.expectedUpdatedAt),
          isNull(cartShippingMethods.deletedAt),
          sameCartVersion,
        );
        return entry.kind === "remove"
          ? db
              .update(cartShippingMethods)
              .set({ deletedAt: timestamp, updatedAt: timestamp })
              .where(predicates)
          : db
              .update(cartShippingMethods)
              .set({
                amount: entry.amount,
                name: entry.name,
                updatedAt: timestamp,
              })
              .where(predicates);
      });
      const results = await db.batch([cartVersionGuard, ...methodUpdates] as [
        BatchItem<"sqlite">,
        ...BatchItem<"sqlite">[],
      ]);
      const guardChanged = Number(results[0]?.meta.changes ?? 0) === 1;
      const methodsChanged = results
        .slice(1)
        .map((result) => Number(result.meta.changes ?? 0));
      if (!guardChanged || methodsChanged.some((count) => count !== 1)) {
        changed = changed || methodsChanged.some((count) => count > 0);
        continue;
      }

      changed = true;
      await cartPromotionDal.refresh(cartId);
      await cartTaxDal.refresh(cartId);
      return { success: true, changed, availableOptions };
    }

    return { success: false, reason: "CONFLICT" };
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
