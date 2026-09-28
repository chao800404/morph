import { getDb } from "@/db";
import { shippingOptions } from "@/db/fulfillment.schema";
import {
  promotionApplicationMethods,
  promotionCampaignBudgetUsages,
  promotionCampaignBudgets,
  promotionCampaigns,
  promotions,
} from "@/db/promotion.schema";
import {
  evaluatePromotion,
  SHIPPING_OPTION_TYPE_TARGET_RULE_ATTRIBUTE,
  type PromotionLineInput,
} from "@/lib/promotion/promotion-engine";
import { loadPromotionRules } from "@/lib/promotion/dal/promotion-rules.dal";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";

export type DraftPromotionLine = PromotionLineInput;

export interface DraftPromotionShippingLine extends DraftPromotionLine {
  shippingOptionId: string | null;
}

export interface DraftPromotionEvaluationInput {
  codes: readonly string[];
  currencyCode: string;
  regionId: string | null;
  salesChannelId: string | null;
  customerId: string | null;
  email: string | null;
  items: readonly DraftPromotionLine[];
  shipping: readonly DraftPromotionShippingLine[];
}

export type DraftPromotionEvaluation =
  | {
      success: true;
      promotionIds: string[];
      promotionCodes: string[];
      itemAdjustments: Array<{
        itemId: string;
        promotionId: string;
        code: string;
        amount: number;
      }>;
      shippingAdjustments: Array<{
        shippingMethodId: string;
        promotionId: string;
        code: string;
        amount: number;
      }>;
    }
  | { success: false; reason: "NOT_FOUND" | "INACTIVE" | "INVALID_CODES" };

export const draftOrderPromotionDal = {
  async evaluate(
    input: DraftPromotionEvaluationInput,
  ): Promise<DraftPromotionEvaluation> {
    const codes = input.codes.map((code) => code.trim().toUpperCase());
    if (new Set(codes).size !== codes.length || codes.some((code) => !code))
      return { success: false, reason: "INVALID_CODES" };

    const db = await getDb();
    const [rows, shippingTypes] = await Promise.all([
      db
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
            isNull(promotions.deletedAt),
            or(
              eq(promotions.isAutomatic, true),
              codes.length
                ? inArray(promotions.code, codes)
                : eq(promotions.isAutomatic, true),
            ),
          ),
        )
        .orderBy(asc(promotions.createdAt), asc(promotions.id)),
      input.shipping.some((line) => line.shippingOptionId)
        ? db
            .select({
              id: shippingOptions.id,
              typeId: shippingOptions.shippingOptionTypeId,
            })
            .from(shippingOptions)
            .where(
              and(
                inArray(
                  shippingOptions.id,
                  input.shipping.flatMap((line) =>
                    line.shippingOptionId ? [line.shippingOptionId] : [],
                  ),
                ),
                isNull(shippingOptions.deletedAt),
              ),
            )
        : Promise.resolve([]),
    ]);

    const manualRows = rows.filter((row) =>
      codes.includes(row.promotion.code.toUpperCase()),
    );
    if (manualRows.some((row) => row.promotion.status !== "active"))
      return { success: false, reason: "INACTIVE" };
    const resolvedCodes = new Set(
      manualRows.map((row) => row.promotion.code.toUpperCase()),
    );
    if (codes.some((code) => !resolvedCodes.has(code)))
      return { success: false, reason: "NOT_FOUND" };

    const activeRows = rows.filter((row) => row.promotion.status === "active");
    const methodIds = activeRows.map((row) => row.method.id);
    const promotionIds = activeRows.map((row) => row.promotion.id);
    const rules = await loadPromotionRules(promotionIds, methodIds);
    const budgetIds = activeRows.flatMap((row) =>
      row.budget ? [row.budget.id] : [],
    );
    const usages = budgetIds.length
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
    const itemSubtotal = input.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    );
    const cartAttributes = {
      currency_code: input.currencyCode,
      region_id: input.regionId,
      sales_channel_id: input.salesChannelId,
      customer_id: input.customerId,
      email: input.email,
      subtotal: itemSubtotal,
    };
    const typeByShippingOptionId = new Map(
      shippingTypes.map((row) => [row.id, row.typeId]),
    );
    const shippingInputs = input.shipping.map((line) => ({
      ...line,
      attributes: {
        ...line.attributes,
        shipping_option_id: line.shippingOptionId,
        [SHIPPING_OPTION_TYPE_TARGET_RULE_ATTRIBUTE]: line.shippingOptionId
          ? (typeByShippingOptionId.get(line.shippingOptionId) ?? null)
          : null,
      },
    }));
    const allocatedItems = new Map<string, number>();
    const allocatedShipping = new Map<string, number>();
    const itemAdjustments: Extract<
      DraftPromotionEvaluation,
      { success: true }
    >["itemAdjustments"] = [];
    const shippingAdjustments: Extract<
      DraftPromotionEvaluation,
      { success: true }
    >["shippingAdjustments"] = [];
    const appliedIds = new Set<string>();
    const appliedCodes = new Set<string>();
    for (const row of manualRows) {
      appliedIds.add(row.promotion.id);
      appliedCodes.add(row.promotion.code);
    }

    for (const row of activeRows) {
      const { promotion, method, campaign, budget } = row;
      const enteredCode = codes.includes(promotion.code.toUpperCase());
      if (!promotion.isAutomatic && !enteredCode) continue;
      if (promotion.limit !== null && promotion.used >= promotion.limit)
        continue;
      if (campaign?.startsAt && new Date(campaign.startsAt) > now) continue;
      if (campaign?.endsAt && new Date(campaign.endsAt) < now) continue;
      if (budget?.currencyCode && budget.currencyCode !== input.currencyCode)
        continue;

      const attributeValue =
        budget?.attribute === "customer_id"
          ? input.customerId
          : budget?.attribute === "email"
            ? input.email
            : null;
      const attributeUsage = budget
        ? (usages.find(
            (usage) =>
              usage.budgetId === budget.id &&
              usage.attributeValue === attributeValue,
          )?.used ?? 0)
        : 0;
      if (budget?.limit !== null && budget) {
        if (
          budget.type === "use_by_attribute" ||
          budget.type === "spend_by_attribute"
        ) {
          if (!attributeValue || attributeUsage >= budget.limit) continue;
        } else if (budget.used >= budget.limit) continue;
      }

      const promotionInput = {
        id: promotion.id,
        code: promotion.code,
        type: promotion.type,
        methodType: method.type,
        targetType: method.targetType,
        allocation: method.allocation,
        value: method.value ?? 0,
        currencyCode: method.currencyCode,
        maxQuantity: method.maxQuantity,
        applyToQuantity: method.applyToQuantity,
        buyRulesMinQuantity: method.buyRulesMinQuantity,
        rules: rules.promotion.get(promotion.id) ?? [],
        targetRules: rules.target.get(method.id) ?? [],
        buyRules: rules.buy.get(method.id) ?? [],
      };
      let calculated = evaluatePromotion({
        promotion: promotionInput,
        cartAttributes,
        lines:
          method.targetType === "shipping_methods"
            ? shippingInputs
            : [...input.items],
      });
      if (
        budget?.limit !== null &&
        budget &&
        (budget.type === "spend" || budget.type === "spend_by_attribute")
      ) {
        let remaining = Math.max(
          0,
          budget.limit -
            (budget.type === "spend_by_attribute"
              ? attributeUsage
              : budget.used),
        );
        calculated = calculated.flatMap((adjustment) => {
          const amount = Math.min(adjustment.amount, remaining);
          remaining -= amount;
          return amount > 0 ? [{ ...adjustment, amount }] : [];
        });
      }
      for (const adjustment of calculated) {
        const targetLines =
          method.targetType === "shipping_methods"
            ? shippingInputs
            : input.items;
        const target = targetLines.find(
          (line) => line.id === adjustment.itemId,
        );
        if (!target) continue;
        const allocations =
          method.targetType === "shipping_methods"
            ? allocatedShipping
            : allocatedItems;
        const remaining = Math.max(
          0,
          target.quantity * target.unitPrice -
            (allocations.get(target.id) ?? 0),
        );
        const amount = Math.min(adjustment.amount, remaining);
        if (!amount) continue;
        allocations.set(target.id, (allocations.get(target.id) ?? 0) + amount);
        appliedIds.add(promotion.id);
        appliedCodes.add(promotion.code);
        if (method.targetType === "shipping_methods")
          shippingAdjustments.push({
            shippingMethodId: adjustment.itemId,
            promotionId: promotion.id,
            code: promotion.code,
            amount,
          });
        else
          itemAdjustments.push({
            itemId: adjustment.itemId,
            promotionId: promotion.id,
            code: promotion.code,
            amount,
          });
      }
    }

    return {
      success: true,
      promotionIds: [...appliedIds],
      promotionCodes: [...appliedCodes],
      itemAdjustments,
      shippingAdjustments,
    };
  },
};
