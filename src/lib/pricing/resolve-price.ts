import type {
  PriceListStatus,
  PriceListType,
  PricingRuleOperator,
} from "@/db/pricing.schema";

export interface PricingContext {
  currencyCode: string;
  quantity: number;
  regionId?: string;
  customerGroupId?: string;
  salesChannelId?: string;
  [attribute: string]: string | number | undefined;
}

export interface PriceRuleCandidate {
  attribute: string;
  value: string;
  operator: PricingRuleOperator;
  priority: number;
}

export interface PriceListRuleCandidate {
  attribute: string;
  values: string[];
}

export interface PriceCandidate {
  id: string;
  amount: number;
  currencyCode: string;
  minQuantity: number | null;
  maxQuantity: number | null;
  priceList: {
    id: string;
    status: PriceListStatus;
    type: PriceListType;
    startsAt: string | null;
    endsAt: string | null;
    rules: PriceListRuleCandidate[];
  } | null;
  rules: PriceRuleCandidate[];
}

export interface ResolvedPrice {
  amount: number;
  originalAmount: number;
  currencyCode: string;
  priceId: string | null;
  priceListId: string | null;
  priceListType: PriceListType | null;
}

const compare = (
  actual: string | number | undefined,
  expected: string,
  operator: PricingRuleOperator,
) => {
  if (actual === undefined) return false;
  if (operator === "eq") return String(actual) === expected;
  const left = Number(actual);
  const right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (operator === "gt") return left > right;
  if (operator === "gte") return left >= right;
  if (operator === "lt") return left < right;
  return left <= right;
};

const isEligible = (
  candidate: PriceCandidate,
  context: PricingContext,
  now: Date,
) => {
  if (candidate.currencyCode !== context.currencyCode) return false;
  if (
    candidate.minQuantity !== null &&
    context.quantity < candidate.minQuantity
  )
    return false;
  if (
    candidate.maxQuantity !== null &&
    context.quantity > candidate.maxQuantity
  )
    return false;
  if (
    !candidate.rules.every((rule) =>
      compare(context[rule.attribute], rule.value, rule.operator),
    )
  )
    return false;
  if (!candidate.priceList) return true;
  const list = candidate.priceList;
  if (list.status !== "active") return false;
  if (list.startsAt && new Date(list.startsAt) > now) return false;
  if (list.endsAt && new Date(list.endsAt) < now) return false;
  return list.rules.every((rule) => {
    const value = context[rule.attribute];
    return value !== undefined && rule.values.includes(String(value));
  });
};

const score = (candidate: PriceCandidate) => ({
  priority: candidate.rules.reduce(
    (highest, rule) => Math.max(highest, rule.priority),
    0,
  ),
  specificity:
    candidate.rules.length +
    (candidate.priceList?.rules.length ?? 0) +
    Number(candidate.minQuantity !== null) +
    Number(candidate.maxQuantity !== null),
  listRank: candidate.priceList
    ? candidate.priceList.type === "override"
      ? 2
      : 1
    : 0,
});

export const resolvePrice = (input: {
  baseAmount: number | null;
  candidates: PriceCandidate[];
  context: PricingContext;
  now?: Date;
}): ResolvedPrice | null => {
  const eligible = input.candidates.filter((candidate) =>
    isEligible(candidate, input.context, input.now ?? new Date()),
  );
  eligible.sort((left, right) => {
    const a = score(left);
    const b = score(right);
    return (
      b.priority - a.priority ||
      b.specificity - a.specificity ||
      b.listRank - a.listRank ||
      left.amount - right.amount ||
      left.id.localeCompare(right.id)
    );
  });
  const selected = eligible[0];
  if (!selected && input.baseAmount === null) return null;
  const amount = selected?.amount ?? input.baseAmount!;
  return {
    amount,
    originalAmount: input.baseAmount ?? amount,
    currencyCode: input.context.currencyCode,
    priceId: selected?.id ?? null,
    priceListId: selected?.priceList?.id ?? null,
    priceListType: selected?.priceList?.type ?? null,
  };
};
