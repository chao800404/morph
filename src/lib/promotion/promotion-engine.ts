import type {
  ApplicationMethodAllocation,
  ApplicationMethodTargetType,
  ApplicationMethodType,
  PromotionRuleOperator,
  PromotionType,
} from "@/db/promotion.schema";

export interface PromotionRuleInput {
  attribute: string;
  operator: PromotionRuleOperator;
  values: string[];
}

export interface PromotionLineInput {
  id: string;
  quantity: number;
  unitPrice: number;
  isDiscountable: boolean;
  attributes: Record<string, string | number | boolean | null | undefined>;
}

export interface PromotionInput {
  id: string;
  code: string;
  type: PromotionType;
  methodType: ApplicationMethodType;
  targetType: ApplicationMethodTargetType;
  allocation: ApplicationMethodAllocation | null;
  value: number;
  currencyCode: string | null;
  maxQuantity: number | null;
  applyToQuantity: number | null;
  buyRulesMinQuantity: number | null;
  rules: PromotionRuleInput[];
  targetRules: PromotionRuleInput[];
  buyRules: PromotionRuleInput[];
}

const matchesRule = (
  attributes: Record<string, string | number | boolean | null | undefined>,
  rule: PromotionRuleInput,
) => {
  const actual = attributes[rule.attribute];
  if (actual === null || actual === undefined) return false;
  const stringActual = String(actual);
  if (rule.operator === "in" || rule.operator === "eq")
    return rule.values.includes(stringActual);
  if (rule.operator === "ne") return !rule.values.includes(stringActual);
  const left = Number(actual);
  return rule.values.some((value) => {
    const right = Number(value);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (rule.operator === "gt") return left > right;
    if (rule.operator === "gte") return left >= right;
    if (rule.operator === "lt") return left < right;
    return left <= right;
  });
};

const matchesAll = (
  attributes: Record<string, string | number | boolean | null | undefined>,
  rules: PromotionRuleInput[],
) => rules.every((rule) => matchesRule(attributes, rule));

const allocateAcross = (
  lines: Array<{ id: string; subtotal: number }>,
  requested: number,
) => {
  const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
  if (total <= 0) return [];
  const capped = Math.min(total, Math.max(0, Math.round(requested)));
  let remaining = capped;
  return lines.map((line, index) => {
    const amount =
      index === lines.length - 1
        ? remaining
        : Math.min(line.subtotal, Math.round((capped * line.subtotal) / total));
    remaining -= amount;
    return { itemId: line.id, amount };
  });
};

export const evaluatePromotion = (input: {
  promotion: PromotionInput;
  cartAttributes: Record<string, string | number | boolean | null | undefined>;
  lines: PromotionLineInput[];
}) => {
  const { promotion } = input;
  if (!matchesAll(input.cartAttributes, promotion.rules)) return [];
  if (
    promotion.currencyCode &&
    promotion.currencyCode !== input.cartAttributes.currency_code
  )
    return [];
  let targets = input.lines.filter(
    (line) =>
      line.isDiscountable && matchesAll(line.attributes, promotion.targetRules),
  );
  if (!targets.length) return [];
  if (promotion.type === "buyget") {
    const qualifyingQuantity = input.lines
      .filter((line) => matchesAll(line.attributes, promotion.buyRules))
      .reduce((sum, line) => sum + line.quantity, 0);
    if (qualifyingQuantity < (promotion.buyRulesMinQuantity ?? 1)) return [];
    let remaining = promotion.applyToQuantity ?? 1;
    targets = [...targets]
      .sort((left, right) => left.unitPrice - right.unitPrice)
      .map((line) => {
        const quantity = Math.min(line.quantity, remaining);
        remaining -= quantity;
        return { ...line, quantity };
      })
      .filter((line) => line.quantity > 0);
  }
  let remainingQuantity = promotion.maxQuantity ?? Number.POSITIVE_INFINITY;
  const lineValues = targets
    .map((line) => {
      const quantity = Math.min(line.quantity, remainingQuantity);
      remainingQuantity -= quantity;
      return { id: line.id, quantity, subtotal: quantity * line.unitPrice };
    })
    .filter((line) => line.quantity > 0);
  if (promotion.methodType === "percentage") {
    return lineValues
      .map((line) => ({
        itemId: line.id,
        amount: Math.min(
          line.subtotal,
          Math.round(line.subtotal * (promotion.value / 100)),
        ),
      }))
      .filter((adjustment) => adjustment.amount > 0);
  }
  if (promotion.allocation === "each") {
    return lineValues
      .map((line) => ({
        itemId: line.id,
        amount: Math.min(
          line.subtotal,
          Math.round(promotion.value * line.quantity),
        ),
      }))
      .filter((adjustment) => adjustment.amount > 0);
  }
  return allocateAcross(lineValues, promotion.value);
};
