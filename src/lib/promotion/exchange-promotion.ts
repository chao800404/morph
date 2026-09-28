import { evaluatePromotion } from "./promotion-engine";
import type { PromotionInput, PromotionLineInput } from "./promotion-engine";

export interface CarryOverPromotionAdjustment {
  itemId: string;
  promotionId: string;
  code: string;
  amount: number;
  isTaxInclusive: boolean;
}

/**
 * Re-evaluate only promotions recorded on the inbound order items, using the
 * exchange's outbound items. Medusa supports fixed/EACH and percentage/EACH
 * or ACROSS for exchange promotion carry-over.
 */
export const evaluateExchangePromotionCarryOver = (input: {
  sourcePromotionIds: string[];
  promotions: Array<PromotionInput & { isTaxInclusive?: boolean }>;
  cartAttributes: Record<string, string | number | boolean | null | undefined>;
  lines: PromotionLineInput[];
}): CarryOverPromotionAdjustment[] => {
  const sourceIds = new Set(input.sourcePromotionIds);
  const output: CarryOverPromotionAdjustment[] = [];
  for (const promotion of input.promotions) {
    if (
      !sourceIds.has(promotion.id) ||
      promotion.targetType === "shipping_methods"
    )
      continue;
    const supportedAllocation =
      (promotion.methodType === "fixed" && promotion.allocation === "each") ||
      (promotion.methodType === "percentage" &&
        (promotion.allocation === "each" || promotion.allocation === "across"));
    if (!supportedAllocation) continue;
    const adjustments = evaluatePromotion({
      promotion,
      cartAttributes: input.cartAttributes,
      lines: input.lines,
    });
    for (const adjustment of adjustments)
      output.push({
        itemId: adjustment.itemId,
        promotionId: promotion.id,
        code: promotion.code,
        amount: adjustment.amount,
        isTaxInclusive: promotion.isTaxInclusive ?? false,
      });
  }
  return output;
};
