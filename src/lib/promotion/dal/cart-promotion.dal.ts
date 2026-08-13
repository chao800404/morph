import { getDb } from "@/db";
import {
  cartLineItemAdjustments,
  cartLineItems,
  carts,
  cartShippingMethodAdjustments,
  cartShippingMethods,
} from "@/db/cart.schema";
import { cartPromotions } from "@/db/link.schema";
import { chunkForInsert } from "@/lib/product/dal/d1-batch";
import {
  promotionApplicationMethodBuyRules,
  promotionApplicationMethods,
  promotionApplicationMethodTargetRules,
  promotionCampaignBudgets,
  promotionCampaignBudgetUsages,
  promotionCampaigns,
  promotionPromotionRules,
  promotionRules,
  promotionRuleValues,
  promotions,
} from "@/db/promotion.schema";
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";

import type { PromotionRuleInput } from "../promotion-engine";
import { evaluatePromotion } from "../promotion-engine";

type ApplyPromotionResult =
  | { success: true }
  | { success: false; reason: "NOT_FOUND" | "INACTIVE" };

const loadRules = async (promotionIds: string[], methodIds: string[]) => {
  const db = await getDb();
  const [promotionLinks, targetLinks, buyLinks] = await Promise.all([
    promotionIds.length
      ? db
          .select()
          .from(promotionPromotionRules)
          .where(inArray(promotionPromotionRules.promotionId, promotionIds))
      : [],
    methodIds.length
      ? db
          .select()
          .from(promotionApplicationMethodTargetRules)
          .where(
            inArray(
              promotionApplicationMethodTargetRules.applicationMethodId,
              methodIds,
            ),
          )
      : [],
    methodIds.length
      ? db
          .select()
          .from(promotionApplicationMethodBuyRules)
          .where(
            inArray(
              promotionApplicationMethodBuyRules.applicationMethodId,
              methodIds,
            ),
          )
      : [],
  ]);
  const ruleIds = [
    ...new Set([
      ...promotionLinks.map((link) => link.promotionRuleId),
      ...targetLinks.map((link) => link.promotionRuleId),
      ...buyLinks.map((link) => link.promotionRuleId),
    ]),
  ];
  const [ruleRows, valueRows] = await Promise.all([
    ruleIds.length
      ? db
          .select()
          .from(promotionRules)
          .where(
            and(
              inArray(promotionRules.id, ruleIds),
              isNull(promotionRules.deletedAt),
            ),
          )
      : [],
    ruleIds.length
      ? db
          .select()
          .from(promotionRuleValues)
          .where(
            and(
              inArray(promotionRuleValues.promotionRuleId, ruleIds),
              isNull(promotionRuleValues.deletedAt),
            ),
          )
      : [],
  ]);
  const byId = new Map<string, PromotionRuleInput>(
    ruleRows.map((rule) => [
      rule.id,
      {
        attribute: rule.attribute,
        operator: rule.operator,
        values: valueRows
          .filter((value) => value.promotionRuleId === rule.id)
          .map((value) => value.value),
      },
    ]),
  );
  const collect = (ids: string[]) =>
    ids.flatMap((id) => {
      const rule = byId.get(id);
      return rule ? [rule] : [];
    });
  return {
    promotion: new Map(
      promotionIds.map((id) => [
        id,
        collect(
          promotionLinks
            .filter((link) => link.promotionId === id)
            .map((link) => link.promotionRuleId),
        ),
      ]),
    ),
    target: new Map(
      methodIds.map((id) => [
        id,
        collect(
          targetLinks
            .filter((link) => link.applicationMethodId === id)
            .map((link) => link.promotionRuleId),
        ),
      ]),
    ),
    buy: new Map(
      methodIds.map((id) => [
        id,
        collect(
          buyLinks
            .filter((link) => link.applicationMethodId === id)
            .map((link) => link.promotionRuleId),
        ),
      ]),
    ),
  };
};

export const cartPromotionDal = {
  async applyCode(cartId: string, code: string): Promise<ApplyPromotionResult> {
    const db = await getDb();
    const [promotion] = await db
      .select({ id: promotions.id, status: promotions.status })
      .from(promotions)
      .where(
        and(
          eq(promotions.code, code.toUpperCase()),
          isNull(promotions.deletedAt),
        ),
      )
      .limit(1);
    if (!promotion) return { success: false, reason: "NOT_FOUND" };
    if (promotion.status !== "active")
      return { success: false, reason: "INACTIVE" };
    await db
      .insert(cartPromotions)
      .values({
        cartId,
        promotionId: promotion.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoNothing();
    await this.refresh(cartId);
    return { success: true };
  },

  async removeCode(cartId: string, code: string): Promise<void> {
    const db = await getDb();
    const matches = await db
      .select({ id: promotions.id })
      .from(promotions)
      .where(eq(promotions.code, code.toUpperCase()));
    if (matches.length)
      await db.delete(cartPromotions).where(
        and(
          eq(cartPromotions.cartId, cartId),
          inArray(
            cartPromotions.promotionId,
            matches.map((match) => match.id),
          ),
        ),
      );
    await this.refresh(cartId);
  },

  async refresh(cartId: string): Promise<void> {
    const db = await getDb();
    const [cart] = await db
      .select()
      .from(carts)
      .where(and(eq(carts.id, cartId), isNull(carts.deletedAt)))
      .limit(1);
    if (!cart || cart.completedAt) return;
    const [items, shipping, applied] = await Promise.all([
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
        .select({ promotionId: cartPromotions.promotionId })
        .from(cartPromotions)
        .where(eq(cartPromotions.cartId, cartId)),
    ]);
    const promotionRows = await db
      .select({
        promotion: promotions,
        method: promotionApplicationMethods,
        campaign: promotionCampaigns,
        budget: promotionCampaignBudgets,
      })
      .from(promotions)
      .innerJoin(
        promotionApplicationMethods,
        and(
          eq(promotionApplicationMethods.promotionId, promotions.id),
          isNull(promotionApplicationMethods.deletedAt),
        ),
      )
      .leftJoin(
        promotionCampaigns,
        and(
          eq(promotionCampaigns.id, promotions.campaignId),
          isNull(promotionCampaigns.deletedAt),
        ),
      )
      .leftJoin(
        promotionCampaignBudgets,
        and(
          eq(promotionCampaignBudgets.campaignId, promotionCampaigns.id),
          isNull(promotionCampaignBudgets.deletedAt),
        ),
      )
      .where(
        and(
          eq(promotions.status, "active"),
          isNull(promotions.deletedAt),
          or(
            eq(promotions.isAutomatic, true),
            applied.length
              ? inArray(
                  promotions.id,
                  applied.map((link) => link.promotionId),
                )
              : eq(promotions.isAutomatic, true),
          ),
        ),
      );
    const budgetIds = promotionRows.flatMap((row) =>
      row.budget ? [row.budget.id] : [],
    );
    const budgetUsages = budgetIds.length
      ? await db
          .select()
          .from(promotionCampaignBudgetUsages)
          .where(
            and(
              inArray(promotionCampaignBudgetUsages.budgetId, budgetIds),
              isNull(promotionCampaignBudgetUsages.deletedAt),
            ),
          )
      : [];
    const now = new Date();
    const eligible = promotionRows.filter(({ promotion, campaign, budget }) => {
      if (promotion.limit !== null && promotion.used >= promotion.limit)
        return false;
      if (campaign?.startsAt && new Date(campaign.startsAt) > now) return false;
      if (campaign?.endsAt && new Date(campaign.endsAt) < now) return false;
      if (budget?.limit !== null && budget) {
        if (
          budget.type === "use_by_attribute" ||
          budget.type === "spend_by_attribute"
        ) {
          const attributeValue =
            budget.attribute === "customer_id"
              ? cart.customerId
              : budget.attribute === "email"
                ? cart.email
                : null;
          if (!attributeValue) return false;
          const usage = budgetUsages.find(
            (item) =>
              item.budgetId === budget.id &&
              item.attributeValue === attributeValue,
          );
          if ((usage?.used ?? 0) >= budget.limit) return false;
        } else if (budget.used >= budget.limit) return false;
      }
      return true;
    });
    for (const row of eligible.filter((entry) => entry.promotion.isAutomatic)) {
      const timestamp = now.toISOString();
      await db
        .insert(cartPromotions)
        .values({
          cartId,
          promotionId: row.promotion.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .onConflictDoNothing();
    }
    const loaded = await loadRules(
      eligible.map((row) => row.promotion.id),
      eligible.map((row) => row.method.id),
    );
    const itemInputs = items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      isDiscountable: item.isDiscountable,
      attributes: {
        variant_id: item.variantId,
        product_id: item.productId,
        product_type_id: item.productTypeId,
        product_collection_id: item.productCollectionId,
        product_handle: item.productHandle,
        sku: item.variantSku,
      },
    }));
    const shippingInputs = shipping.map((method) => ({
      id: method.id,
      quantity: 1,
      unitPrice: method.amount,
      isDiscountable: true,
      attributes: {
        shipping_option_id: method.shippingOptionId,
        name: method.name,
      },
    }));
    const cartAttributes = {
      currency_code: cart.currencyCode,
      region_id: cart.regionId,
      sales_channel_id: cart.salesChannelId,
      email: cart.email,
      subtotal: items.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0,
      ),
    };
    const itemAdjustments = [];
    const shippingAdjustments = [];
    for (const row of eligible) {
      const promotion = {
        id: row.promotion.id,
        code: row.promotion.code,
        type: row.promotion.type,
        methodType: row.method.type,
        targetType: row.method.targetType,
        allocation: row.method.allocation,
        value: row.method.value ?? 0,
        currencyCode: row.method.currencyCode,
        maxQuantity: row.method.maxQuantity,
        applyToQuantity: row.method.applyToQuantity,
        buyRulesMinQuantity: row.method.buyRulesMinQuantity,
        rules: loaded.promotion.get(row.promotion.id) ?? [],
        targetRules: loaded.target.get(row.method.id) ?? [],
        buyRules: loaded.buy.get(row.method.id) ?? [],
      };
      let adjustments = evaluatePromotion({
        promotion,
        cartAttributes,
        lines:
          row.method.targetType === "shipping_methods"
            ? shippingInputs
            : itemInputs,
      });
      if (
        row.budget?.limit !== null &&
        row.budget &&
        (row.budget.type === "spend" ||
          row.budget.type === "spend_by_attribute")
      ) {
        const attributeValue =
          row.budget.attribute === "customer_id"
            ? cart.customerId
            : row.budget.attribute === "email"
              ? cart.email
              : null;
        const used =
          row.budget.type === "spend_by_attribute"
            ? (budgetUsages.find(
                (item) =>
                  item.budgetId === row.budget?.id &&
                  item.attributeValue === attributeValue,
              )?.used ?? 0)
            : row.budget.used;
        let remaining = Math.max(0, row.budget.limit - used);
        adjustments = adjustments.flatMap((adjustment) => {
          const amount = Math.min(adjustment.amount, remaining);
          remaining -= amount;
          return amount > 0 ? [{ ...adjustment, amount }] : [];
        });
      }
      for (const adjustment of adjustments) {
        const value = {
          id: crypto.randomUUID(),
          code: row.promotion.code,
          amount: adjustment.amount,
          promotionId: row.promotion.id,
          description: row.promotion.code,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        };
        if (row.method.targetType === "shipping_methods")
          shippingAdjustments.push({
            ...value,
            shippingMethodId: adjustment.itemId,
          });
        else itemAdjustments.push({ ...value, itemId: adjustment.itemId });
      }
    }
    if (items.length)
      await db.delete(cartLineItemAdjustments).where(
        and(
          inArray(
            cartLineItemAdjustments.itemId,
            items.map((item) => item.id),
          ),
          isNotNull(cartLineItemAdjustments.promotionId),
        ),
      );
    if (shipping.length)
      await db.delete(cartShippingMethodAdjustments).where(
        and(
          inArray(
            cartShippingMethodAdjustments.shippingMethodId,
            shipping.map((method) => method.id),
          ),
          isNotNull(cartShippingMethodAdjustments.promotionId),
        ),
      );
    for (const group of chunkForInsert(itemAdjustments, 8)) {
      await db.insert(cartLineItemAdjustments).values(group);
    }
    for (const group of chunkForInsert(shippingAdjustments, 8)) {
      await db.insert(cartShippingMethodAdjustments).values(group);
    }
  },
};
