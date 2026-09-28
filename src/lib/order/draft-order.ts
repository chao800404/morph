import { sumCartTotals } from "@/lib/cart/cart-totals";
import type { TaxLine } from "@/lib/tax/providers/tax-provider";

export type DraftOrderConversionFailure =
  "NOT_DRAFT" | "INVALID_STATUS" | "CANCELED" | "EMPTY";

export interface DraftShippingOption {
  id: string;
  name: string;
  amount: number;
  shippingProfileId: string | null;
  isCustomAmount?: boolean;
}

export const resolveDraftShippingOptions = (input: {
  selectedOptionIds: readonly string[];
  availableOptions: readonly DraftShippingOption[];
  requiredShippingProfiles: readonly { id: string }[];
  customAmounts?: readonly { shippingOptionId: string; amount: number }[];
}): DraftShippingOption[] | null => {
  if (new Set(input.selectedOptionIds).size !== input.selectedOptionIds.length)
    return null;
  const availableById = new Map(
    input.availableOptions.map((option) => [option.id, option]),
  );
  const selected = input.selectedOptionIds.map((id) => availableById.get(id));
  if (selected.some((option) => !option)) return null;
  const resolved = selected as DraftShippingOption[];
  const customAmounts = input.customAmounts ?? [];
  const customAmountByOptionId = new Map(
    customAmounts.map(({ shippingOptionId, amount }) => [
      shippingOptionId,
      amount,
    ]),
  );
  if (
    customAmountByOptionId.size !== customAmounts.length ||
    customAmounts.some(
      ({ shippingOptionId, amount }) =>
        !input.selectedOptionIds.includes(shippingOptionId) ||
        !Number.isSafeInteger(amount) ||
        amount < 0,
    )
  )
    return null;
  const selectedProfileIds = new Set(
    resolved.flatMap((option) =>
      option.shippingProfileId ? [option.shippingProfileId] : [],
    ),
  );
  if (
    selectedProfileIds.size !==
      resolved.filter((option) => option.shippingProfileId).length ||
    input.requiredShippingProfiles.some(
      (profile) => !selectedProfileIds.has(profile.id),
    ) ||
    (!input.requiredShippingProfiles.length && resolved.length > 1)
  )
    return null;
  return resolved.map((option) =>
    customAmountByOptionId.has(option.id)
      ? {
          ...option,
          amount: customAmountByOptionId.get(option.id)!,
          isCustomAmount: true,
        }
      : option,
  );
};

export const calculateDraftOrderSummary = (input: {
  items: Array<{
    id: string;
    quantity: number;
    unitPrice: number;
    isTaxInclusive: boolean;
  }>;
  shippingMethods: Array<{
    id: string;
    amount: number;
    isTaxInclusive: boolean;
  }>;
  itemAdjustments?: readonly { itemId: string; amount: number }[];
  shippingAdjustments?: readonly {
    shippingMethodId: string;
    amount: number;
  }[];
  taxLines: readonly TaxLine[];
}) => {
  const itemIds = new Set(input.items.map((item) => item.id));
  const shippingIds = new Set(input.shippingMethods.map((method) => method.id));
  const itemAdjustments = input.itemAdjustments ?? [];
  const shippingAdjustments = input.shippingAdjustments ?? [];
  if (
    itemIds.size !== input.items.length ||
    shippingIds.size !== input.shippingMethods.length ||
    itemAdjustments.some(
      (adjustment) =>
        !itemIds.has(adjustment.itemId) ||
        !Number.isSafeInteger(adjustment.amount) ||
        adjustment.amount < 0,
    ) ||
    shippingAdjustments.some(
      (adjustment) =>
        !shippingIds.has(adjustment.shippingMethodId) ||
        !Number.isSafeInteger(adjustment.amount) ||
        adjustment.amount < 0,
    ) ||
    input.shippingMethods.some(
      (method) => !Number.isSafeInteger(method.amount) || method.amount < 0,
    ) ||
    input.taxLines.some(
      (line) =>
        !Number.isFinite(line.rate) ||
        line.rate < 0 ||
        ("lineItemId" in line
          ? !itemIds.has(line.lineItemId)
          : !shippingIds.has(line.shippingLineId)),
    )
  )
    return null;
  const itemTaxRates = new Map<string, number[]>();
  const shippingTaxRates = new Map<string, number[]>();
  const itemAdjustmentAmounts = new Map<string, number[]>();
  const shippingAdjustmentAmounts = new Map<string, number[]>();
  for (const adjustment of itemAdjustments)
    itemAdjustmentAmounts.set(adjustment.itemId, [
      ...(itemAdjustmentAmounts.get(adjustment.itemId) ?? []),
      adjustment.amount,
    ]);
  for (const adjustment of shippingAdjustments)
    shippingAdjustmentAmounts.set(adjustment.shippingMethodId, [
      ...(shippingAdjustmentAmounts.get(adjustment.shippingMethodId) ?? []),
      adjustment.amount,
    ]);
  for (const line of input.taxLines) {
    if ("lineItemId" in line) {
      itemTaxRates.set(line.lineItemId, [
        ...(itemTaxRates.get(line.lineItemId) ?? []),
        line.rate,
      ]);
    } else {
      shippingTaxRates.set(line.shippingLineId, [
        ...(shippingTaxRates.get(line.shippingLineId) ?? []),
        line.rate,
      ]);
    }
  }
  const itemsTotal = calculateDraftOrderTotal(input.items);
  if (itemsTotal === null) return null;
  const totals = sumCartTotals({
    items: input.items.map((item) => ({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      isTaxInclusive: item.isTaxInclusive,
      adjustments: itemAdjustmentAmounts.get(item.id) ?? [],
      taxes: (itemTaxRates.get(item.id) ?? []).map((rate) => ({ rate })),
    })),
    shipping: input.shippingMethods.map((method) => ({
      quantity: 1,
      unitPrice: method.amount,
      isTaxInclusive: method.isTaxInclusive,
      adjustments: shippingAdjustmentAmounts.get(method.id) ?? [],
      taxes: (shippingTaxRates.get(method.id) ?? []).map((rate) => ({ rate })),
    })),
    credits: [],
  });
  if (
    !Number.isSafeInteger(totals.subtotal) ||
    !Number.isSafeInteger(totals.taxTotal) ||
    !Number.isSafeInteger(totals.total)
  )
    return null;
  return {
    ...totals,
    itemsTotal,
    shippingTotal: totals.shippingSubtotal,
  };
};

/** Returns null when any amount is invalid or the aggregate would overflow. */
export const calculateDraftOrderTotal = (
  items: readonly { quantity: number; unitPrice: number }[],
): number | null => {
  let total = 0;
  for (const item of items) {
    if (
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      !Number.isSafeInteger(item.unitPrice) ||
      item.unitPrice < 0
    )
      return null;
    const lineTotal = item.quantity * item.unitPrice;
    if (!Number.isSafeInteger(lineTotal)) return null;
    total += lineTotal;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
};

export const draftOrderConversionFailure = (input: {
  isDraftOrder: boolean;
  status: string;
  canceledAt: string | null;
  hasLineItems: boolean;
}): DraftOrderConversionFailure | null => {
  if (!input.isDraftOrder) return "NOT_DRAFT";
  if (input.status !== "draft") return "INVALID_STATUS";
  if (input.canceledAt) return "CANCELED";
  if (!input.hasLineItems) return "EMPTY";
  return null;
};
