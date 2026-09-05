import { getDb } from "@/db";
import { firstOrNull } from "@/lib/db/single-row";
import {
  cartAddresses,
  cartCreditLines,
  cartLineItemAdjustments,
  cartLineItems,
  cartLineItemTaxLines,
  carts,
  cartShippingMethodAdjustments,
  cartShippingMethods,
  cartShippingMethodTaxLines,
} from "@/db/cart.schema";
import { reservationItems } from "@/db/inventory.schema";
import {
  cartPaymentCollections,
  cartPromotions,
  orderCarts,
  orderPaymentCollections,
  orderPromotions,
  productShippingProfiles,
  productVariantInventoryItems,
} from "@/db/link.schema";
import { shippingOptions } from "@/db/fulfillment.schema";
import {
  orderAddresses,
  orderCreditLines,
  orderItems,
  orderLineItemAdjustments,
  orderLineItems,
  orderLineItemTaxLines,
  orders,
  orderShippingMethodAdjustments,
  orderShippingMethods,
  orderShippingMethodTaxLines,
  orderShippings,
  orderSummaries,
} from "@/db/order.schema";
import { paymentCollections } from "@/db/payment.schema";
import {
  promotionCampaignBudgets,
  promotionCampaignBudgetUsages,
  promotions,
} from "@/db/promotion.schema";
import { cartDal } from "@/lib/cart/dal/cart.dal";
import { and, eq, inArray, isNull, max, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  databaseErrorMessage,
  isOrderDisplayIdConflict,
} from "../database-error";

type CheckoutResult =
  | { success: true; orderId: string; displayId: number }
  | {
      success: false;
      reason:
        | "NOT_FOUND"
        | "EMPTY_CART"
        | "EMAIL_REQUIRED"
        | "ADDRESS_REQUIRED"
        | "SHIPPING_REQUIRED"
        | "PAYMENT_REQUIRED"
        | "PAYMENT_MISMATCH"
        | "PROMOTION_EXHAUSTED"
        | "RESERVATION_EXPIRED";
    };

export const checkoutDal = {
  async complete(
    cartId: string,
    salesChannelId: string,
    displayIdRetry = 0,
  ): Promise<CheckoutResult> {
    const db = await getDb();
    // Scoped to the caller's channel like every other read here. Answering by
    // cart id alone made this idempotent return a cross-channel order's id and
    // display id — the completed-cart path skips the channel-scoped cart lookup
    // below, so nothing else would have caught it.
    const existingOrder = firstOrNull(
      await db
        .select({ id: orders.id, displayId: orders.displayId })
        .from(orderCarts)
        .innerJoin(orders, eq(orders.id, orderCarts.orderId))
        .where(
          and(
            eq(orderCarts.cartId, cartId),
            eq(orders.salesChannelId, salesChannelId),
            isNull(orders.deletedAt),
          ),
        )
        .limit(1),
    );
    if (existingOrder)
      return {
        success: true,
        orderId: existingOrder.id,
        displayId: existingOrder.displayId,
      };
    const cartDto = await cartDal.findById(cartId, salesChannelId);
    if (!cartDto) return { success: false, reason: "NOT_FOUND" };
    if (!cartDto.items.length) return { success: false, reason: "EMPTY_CART" };
    if (!cartDto.email) return { success: false, reason: "EMAIL_REQUIRED" };
    const [cart] = await db
      .select()
      .from(carts)
      .where(
        and(
          eq(carts.id, cartId),
          eq(carts.salesChannelId, salesChannelId),
          isNull(carts.deletedAt),
        ),
      )
      .limit(1);
    if (!cart) return { success: false, reason: "NOT_FOUND" };
    const [items, shipping, credits, promotionLinks, paymentLinks] =
      await Promise.all([
        db
          .select()
          .from(cartLineItems)
          .where(
            and(
              eq(cartLineItems.cartId, cartId),
              isNull(cartLineItems.deletedAt),
            ),
          ),
        db
          .select()
          .from(cartShippingMethods)
          .where(
            and(
              eq(cartShippingMethods.cartId, cartId),
              isNull(cartShippingMethods.deletedAt),
            ),
          ),
        db
          .select()
          .from(cartCreditLines)
          .where(
            and(
              eq(cartCreditLines.cartId, cartId),
              isNull(cartCreditLines.deletedAt),
            ),
          ),
        db
          .select()
          .from(cartPromotions)
          .where(eq(cartPromotions.cartId, cartId)),
        db
          .select({ id: cartPaymentCollections.paymentCollectionId })
          .from(cartPaymentCollections)
          .where(eq(cartPaymentCollections.cartId, cartId)),
      ]);
    if (items.some((item) => item.requiresShipping)) {
      if (!cart.shippingAddressId)
        return { success: false, reason: "ADDRESS_REQUIRED" };
      if (!shipping.length)
        return { success: false, reason: "SHIPPING_REQUIRED" };
      const shippingProductIds = [
        ...new Set(
          items.flatMap((item) =>
            item.requiresShipping && item.productId ? [item.productId] : [],
          ),
        ),
      ];
      const [requiredProfileLinks, selectedOptions] = await Promise.all([
        shippingProductIds.length
          ? db
              .select()
              .from(productShippingProfiles)
              .where(
                inArray(productShippingProfiles.productId, shippingProductIds),
              )
          : [],
        db
          .select({
            id: shippingOptions.id,
            profileId: shippingOptions.shippingProfileId,
          })
          .from(shippingOptions)
          .where(
            inArray(
              shippingOptions.id,
              shipping.flatMap((method) =>
                method.shippingOptionId ? [method.shippingOptionId] : [],
              ),
            ),
          ),
      ]);
      if (
        shippingProductIds.some(
          (productId) =>
            !requiredProfileLinks.some((link) => link.productId === productId),
        ) ||
        requiredProfileLinks.some(
          (link) =>
            !selectedOptions.some(
              (option) => option.profileId === link.shippingProfileId,
            ),
        )
      )
        return { success: false, reason: "SHIPPING_REQUIRED" };
    }
    let paymentCollectionId: string | null = null;
    if (cartDto.total > 0) {
      paymentCollectionId = paymentLinks[0]?.id ?? null;
      if (!paymentCollectionId)
        return { success: false, reason: "PAYMENT_REQUIRED" };
      const [collection] = await db
        .select()
        .from(paymentCollections)
        .where(
          and(
            eq(paymentCollections.id, paymentCollectionId),
            isNull(paymentCollections.deletedAt),
          ),
        )
        .limit(1);
      if (!collection || (collection.authorizedAmount ?? 0) < cartDto.total)
        return { success: false, reason: "PAYMENT_REQUIRED" };
      if (
        collection.amount !== cartDto.total ||
        collection.currencyCode !== cartDto.currencyCode
      )
        return { success: false, reason: "PAYMENT_MISMATCH" };
    }
    const variantIds = items.flatMap((item) =>
      item.variantId ? [item.variantId] : [],
    );
    const inventoryLinks = variantIds.length
      ? await db
          .select()
          .from(productVariantInventoryItems)
          .where(inArray(productVariantInventoryItems.variantId, variantIds))
      : [];
    const reservations = await db
      .select()
      .from(reservationItems)
      .where(
        and(
          eq(reservationItems.cartId, cartId),
          isNull(reservationItems.deletedAt),
        ),
      );
    const now = new Date();
    for (const item of items) {
      const links = inventoryLinks.filter(
        (link) => link.variantId === item.variantId,
      );
      for (const link of links) {
        const reserved = reservations
          .filter(
            (reservation) =>
              reservation.lineItemId === item.id &&
              reservation.inventoryItemId === link.inventoryItemId &&
              (!reservation.expiresAt || new Date(reservation.expiresAt) > now),
          )
          .reduce((sum, reservation) => sum + reservation.quantity, 0);
        if (reserved < item.quantity * link.requiredQuantity)
          return { success: false, reason: "RESERVATION_EXPIRED" };
      }
    }
    const itemIds = items.map((item) => item.id);
    const shippingIds = shipping.map((method) => method.id);
    const [itemAdjustments, itemTaxes, shippingAdjustments, shippingTaxes] =
      await Promise.all([
        itemIds.length
          ? db
              .select()
              .from(cartLineItemAdjustments)
              .where(
                and(
                  inArray(cartLineItemAdjustments.itemId, itemIds),
                  isNull(cartLineItemAdjustments.deletedAt),
                ),
              )
          : [],
        itemIds.length
          ? db
              .select()
              .from(cartLineItemTaxLines)
              .where(
                and(
                  inArray(cartLineItemTaxLines.itemId, itemIds),
                  isNull(cartLineItemTaxLines.deletedAt),
                ),
              )
          : [],
        shippingIds.length
          ? db
              .select()
              .from(cartShippingMethodAdjustments)
              .where(
                and(
                  inArray(
                    cartShippingMethodAdjustments.shippingMethodId,
                    shippingIds,
                  ),
                  isNull(cartShippingMethodAdjustments.deletedAt),
                ),
              )
          : [],
        shippingIds.length
          ? db
              .select()
              .from(cartShippingMethodTaxLines)
              .where(
                and(
                  inArray(
                    cartShippingMethodTaxLines.shippingMethodId,
                    shippingIds,
                  ),
                  isNull(cartShippingMethodTaxLines.deletedAt),
                ),
              )
          : [],
      ]);
    const effectivePromotionIds = [
      ...new Set(
        [...itemAdjustments, ...shippingAdjustments].flatMap((adjustment) =>
          adjustment.promotionId ? [adjustment.promotionId] : [],
        ),
      ),
    ];
    const effectivePromotions = effectivePromotionIds.length
      ? await db
          .select({ promotion: promotions, budget: promotionCampaignBudgets })
          .from(promotions)
          .leftJoin(
            promotionCampaignBudgets,
            and(
              eq(promotionCampaignBudgets.campaignId, promotions.campaignId),
              isNull(promotionCampaignBudgets.deletedAt),
            ),
          )
          .where(inArray(promotions.id, effectivePromotionIds))
      : [];
    const addressIds = [cart.shippingAddressId, cart.billingAddressId].filter(
      (value): value is string => Boolean(value),
    );
    const addresses = addressIds.length
      ? await db
          .select()
          .from(cartAddresses)
          .where(inArray(cartAddresses.id, addressIds))
      : [];
    const orderId = crypto.randomUUID();
    const displayRows = await db
      .select({ value: max(orders.displayId) })
      .from(orders);
    const displayId = Number(displayRows[0]?.value ?? 0) + 1;
    const timestamp = now.toISOString();
    const lineIdMap = new Map(
      items.map((item) => [item.id, crypto.randomUUID()]),
    );
    const shippingIdMap = new Map(
      shipping.map((method) => [method.id, crypto.randomUUID()]),
    );
    const addressIdMap = new Map(
      addresses.map((address) => [address.id, crypto.randomUUID()]),
    );
    const statements: BatchItem<"sqlite">[] = [];
    for (const address of addresses) {
      const { id: _id, deletedAt: _deletedAt, ...snapshot } = address;
      statements.push(
        db.insert(orderAddresses).values({
          ...snapshot,
          id: addressIdMap.get(address.id)!,
          updatedAt: timestamp,
        }),
      );
    }
    statements.push(
      db.insert(orders).values({
        id: orderId,
        displayId,
        status: "pending",
        regionId: cart.regionId,
        customerId: cart.customerId,
        salesChannelId: cart.salesChannelId,
        email: cart.email,
        currencyCode: cart.currencyCode,
        locale: cart.locale,
        isDraftOrder: false,
        noNotification: false,
        shippingAddressId: cart.shippingAddressId
          ? addressIdMap.get(cart.shippingAddressId)
          : null,
        billingAddressId: cart.billingAddressId
          ? addressIdMap.get(cart.billingAddressId)
          : null,
        metadata: cart.metadata,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      db.insert(orderSummaries).values({
        id: crypto.randomUUID(),
        orderId,
        version: 1,
        totals: {
          itemSubtotal: cartDto.itemSubtotal,
          itemDiscountTotal: cartDto.itemDiscountTotal,
          itemTaxTotal: cartDto.itemTaxTotal,
          shippingSubtotal: cartDto.shippingSubtotal,
          shippingDiscountTotal: cartDto.shippingDiscountTotal,
          shippingTaxTotal: cartDto.shippingTaxTotal,
          creditTotal: cartDto.creditTotal,
          subtotal: cartDto.subtotal,
          discountTotal: cartDto.discountTotal,
          taxTotal: cartDto.taxTotal,
          total: cartDto.total,
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    for (const item of items) {
      const orderLineId = lineIdMap.get(item.id)!;
      statements.push(
        db.insert(orderLineItems).values({
          id: orderLineId,
          title: item.title,
          subtitle: item.subtitle,
          thumbnail: item.thumbnail,
          variantId: item.variantId,
          productId: item.productId,
          productTitle: item.productTitle,
          productDescription: item.productDescription,
          productSubtitle: item.productSubtitle,
          productType: item.productType,
          productTypeId: item.productTypeId,
          productCollectionId: item.productCollectionId,
          productCollection: item.productCollection,
          productHandle: item.productHandle,
          variantSku: item.variantSku,
          variantBarcode: item.variantBarcode,
          variantTitle: item.variantTitle,
          variantOptionValues: item.variantOptionValues,
          requiresShipping: item.requiresShipping,
          isDiscountable: item.isDiscountable,
          isGiftcard: item.isGiftcard,
          isTaxInclusive: item.isTaxInclusive,
          isCustomPrice: item.isCustomPrice,
          unitPrice: item.unitPrice,
          compareAtUnitPrice: item.compareAtUnitPrice,
          metadata: item.metadata,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
        db.insert(orderItems).values({
          id: crypto.randomUUID(),
          orderId,
          itemId: orderLineId,
          version: 1,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          compareAtUnitPrice: item.compareAtUnitPrice,
          metadata: {},
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      );
      for (const adjustment of itemAdjustments.filter(
        (value) => value.itemId === item.id,
      ))
        statements.push(
          db.insert(orderLineItemAdjustments).values({
            id: crypto.randomUUID(),
            itemId: orderLineId,
            version: 1,
            description: adjustment.description,
            code: adjustment.code,
            amount: adjustment.amount,
            providerId: adjustment.providerId,
            promotionId: adjustment.promotionId,
            isTaxInclusive: adjustment.isTaxInclusive,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        );
      for (const tax of itemTaxes.filter((value) => value.itemId === item.id))
        statements.push(
          db.insert(orderLineItemTaxLines).values({
            id: crypto.randomUUID(),
            itemId: orderLineId,
            description: tax.description,
            code: tax.code,
            rate: tax.rate,
            providerId: tax.providerId,
            taxRateId: tax.taxRateId,
            data: tax.data,
            metadata: tax.metadata,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        );
    }
    for (const method of shipping) {
      const orderShippingId = shippingIdMap.get(method.id)!;
      statements.push(
        db.insert(orderShippingMethods).values({
          id: orderShippingId,
          name: method.name,
          description: method.description,
          amount: method.amount,
          isTaxInclusive: method.isTaxInclusive,
          shippingOptionId: method.shippingOptionId,
          data: method.data,
          metadata: method.metadata,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
        db.insert(orderShippings).values({
          id: crypto.randomUUID(),
          orderId,
          shippingMethodId: orderShippingId,
          version: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      );
      for (const adjustment of shippingAdjustments.filter(
        (value) => value.shippingMethodId === method.id,
      ))
        statements.push(
          db.insert(orderShippingMethodAdjustments).values({
            id: crypto.randomUUID(),
            shippingMethodId: orderShippingId,
            version: 1,
            description: adjustment.description,
            code: adjustment.code,
            amount: adjustment.amount,
            providerId: adjustment.providerId,
            promotionId: adjustment.promotionId,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        );
      for (const tax of shippingTaxes.filter(
        (value) => value.shippingMethodId === method.id,
      ))
        statements.push(
          db.insert(orderShippingMethodTaxLines).values({
            id: crypto.randomUUID(),
            shippingMethodId: orderShippingId,
            description: tax.description,
            code: tax.code,
            rate: tax.rate,
            providerId: tax.providerId,
            taxRateId: tax.taxRateId,
            data: tax.data,
            metadata: tax.metadata,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        );
    }
    for (const credit of credits)
      statements.push(
        db.insert(orderCreditLines).values({
          id: crypto.randomUUID(),
          orderId,
          version: 1,
          reference: credit.reference,
          referenceId: credit.referenceId,
          amount: credit.amount,
          metadata: credit.metadata,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      );
    statements.push(
      db.insert(orderCarts).values({
        orderId,
        cartId,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      db
        .update(carts)
        .set({ completedAt: timestamp, updatedAt: timestamp })
        .where(and(eq(carts.id, cartId), isNull(carts.completedAt))),
    );
    for (const link of promotionLinks.filter((item) =>
      effectivePromotionIds.includes(item.promotionId),
    ))
      statements.push(
        db.insert(orderPromotions).values({
          orderId,
          promotionId: link.promotionId,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      );
    for (const row of effectivePromotions) {
      const promotionDiscount = [...itemAdjustments, ...shippingAdjustments]
        .filter((adjustment) => adjustment.promotionId === row.promotion.id)
        .reduce((sum, adjustment) => sum + adjustment.amount, 0);
      statements.push(
        db
          .update(promotions)
          .set({ used: sql`${promotions.used} + 1`, updatedAt: timestamp })
          .where(eq(promotions.id, row.promotion.id)),
      );
      if (!row.budget) continue;
      const budgetUse = row.budget.type.includes("spend")
        ? promotionDiscount
        : 1;
      statements.push(
        db
          .update(promotionCampaignBudgets)
          .set({
            used: sql`${promotionCampaignBudgets.used} + ${budgetUse}`,
            updatedAt: timestamp,
          })
          .where(eq(promotionCampaignBudgets.id, row.budget.id)),
      );
      if (
        (row.budget.type === "use_by_attribute" ||
          row.budget.type === "spend_by_attribute") &&
        row.budget.attribute
      ) {
        const attributeValue =
          row.budget.attribute === "customer_id"
            ? cart.customerId
            : row.budget.attribute === "email"
              ? cart.email
              : null;
        if (attributeValue) {
          const [existingUsage] = await db
            .select({ id: promotionCampaignBudgetUsages.id })
            .from(promotionCampaignBudgetUsages)
            .where(
              and(
                eq(promotionCampaignBudgetUsages.budgetId, row.budget.id),
                eq(
                  promotionCampaignBudgetUsages.attributeValue,
                  attributeValue,
                ),
                isNull(promotionCampaignBudgetUsages.deletedAt),
              ),
            )
            .limit(1);
          statements.push(
            existingUsage
              ? db
                  .update(promotionCampaignBudgetUsages)
                  .set({
                    used: sql`${promotionCampaignBudgetUsages.used} + ${budgetUse}`,
                    updatedAt: timestamp,
                  })
                  .where(eq(promotionCampaignBudgetUsages.id, existingUsage.id))
              : db.insert(promotionCampaignBudgetUsages).values({
                  id: crypto.randomUUID(),
                  budgetId: row.budget.id,
                  attributeValue,
                  used: budgetUse,
                  limit: row.budget.limit,
                  createdAt: timestamp,
                  updatedAt: timestamp,
                }),
          );
        }
      }
    }
    if (paymentCollectionId)
      statements.push(
        db.insert(orderPaymentCollections).values({
          orderId,
          paymentCollectionId,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      );
    for (const reservation of reservations) {
      const orderLineId = reservation.lineItemId
        ? lineIdMap.get(reservation.lineItemId)
        : null;
      statements.push(
        db
          .update(reservationItems)
          .set({
            cartId: null,
            lineItemId: orderLineId ?? reservation.lineItemId,
            expiresAt: null,
            updatedAt: timestamp,
          })
          .where(eq(reservationItems.id, reservation.id)),
      );
    }
    try {
      await db.batch(
        statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
    } catch (error) {
      const message = databaseErrorMessage(error);
      if (displayIdRetry < 3 && isOrderDisplayIdConflict(error))
        return this.complete(cartId, salesChannelId, displayIdRetry + 1);
      if (
        message.includes("promotions_limit_check") ||
        message.includes("promotion_campaign_budgets_limit_check") ||
        message.includes("promotion_campaign_budget_usages_limit_check")
      )
        return { success: false, reason: "PROMOTION_EXHAUSTED" };
      throw error;
    }
    return { success: true, orderId, displayId };
  },
};
