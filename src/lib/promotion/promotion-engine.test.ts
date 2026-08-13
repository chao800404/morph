import { describe, expect, it } from "vitest";

import type { PromotionInput } from "./promotion-engine";
import { evaluatePromotion } from "./promotion-engine";

const promotion = (
  overrides: Partial<PromotionInput> = {},
): PromotionInput => ({
  id: "promo",
  code: "SAVE10",
  type: "standard",
  methodType: "percentage",
  targetType: "items",
  allocation: "across",
  value: 10,
  currencyCode: "usd",
  maxQuantity: null,
  applyToQuantity: null,
  buyRulesMinQuantity: null,
  rules: [],
  targetRules: [],
  buyRules: [],
  ...overrides,
});

const lines = [
  {
    id: "expensive",
    quantity: 2,
    unitPrice: 1_000,
    isDiscountable: true,
    attributes: { product_id: "a", collection_id: "summer" },
  },
  {
    id: "cheap",
    quantity: 1,
    unitPrice: 500,
    isDiscountable: true,
    attributes: { product_id: "b", collection_id: "summer" },
  },
];

describe("evaluatePromotion", () => {
  it("applies a percentage to matching lines", () => {
    expect(
      evaluatePromotion({
        promotion: promotion(),
        cartAttributes: { currency_code: "usd" },
        lines,
      }),
    ).toEqual([
      { itemId: "expensive", amount: 200 },
      { itemId: "cheap", amount: 50 },
    ]);
  });

  it("allocates a fixed order discount without exceeding subtotals", () => {
    const result = evaluatePromotion({
      promotion: promotion({
        methodType: "fixed",
        targetType: "order",
        value: 1_000,
      }),
      cartAttributes: { currency_code: "usd" },
      lines,
    });
    expect(result.reduce((sum, adjustment) => sum + adjustment.amount, 0)).toBe(
      1_000,
    );
  });

  it("discounts the cheapest target for buy-get", () => {
    expect(
      evaluatePromotion({
        promotion: promotion({
          type: "buyget",
          value: 100,
          applyToQuantity: 1,
          buyRulesMinQuantity: 2,
          buyRules: [
            { attribute: "collection_id", operator: "eq", values: ["summer"] },
          ],
        }),
        cartAttributes: { currency_code: "usd" },
        lines,
      }),
    ).toEqual([{ itemId: "cheap", amount: 500 }]);
  });

  it("caps discounted quantity across the whole cart", () => {
    expect(
      evaluatePromotion({
        promotion: promotion({ maxQuantity: 2 }),
        cartAttributes: { currency_code: "usd" },
        lines,
      }),
    ).toEqual([{ itemId: "expensive", amount: 200 }]);
  });
});
