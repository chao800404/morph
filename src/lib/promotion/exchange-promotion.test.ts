import { describe, expect, it } from "vitest";
import { evaluateExchangePromotionCarryOver } from "./exchange-promotion";

describe("evaluateExchangePromotionCarryOver", () => {
  it("recalculates only source promotions on the outbound items", () => {
    const adjustments = evaluateExchangePromotionCarryOver({
      sourcePromotionIds: [
        "fixed-each",
        "percent-across",
        "fixed-across",
        "shipping-only",
      ],
      promotions: [
        {
          id: "fixed-each",
          code: "FIXED",
          type: "standard",
          methodType: "fixed",
          targetType: "items",
          allocation: "each",
          value: 75,
          currencyCode: null,
          maxQuantity: null,
          applyToQuantity: null,
          buyRulesMinQuantity: null,
          rules: [],
          targetRules: [],
          buyRules: [],
          isTaxInclusive: false,
        },
        {
          id: "percent-across",
          code: "PERCENT",
          type: "standard",
          methodType: "percentage",
          targetType: "items",
          allocation: "across",
          value: 10,
          currencyCode: null,
          maxQuantity: null,
          applyToQuantity: null,
          buyRulesMinQuantity: null,
          rules: [],
          targetRules: [],
          buyRules: [],
          isTaxInclusive: true,
        },
        {
          id: "fixed-across",
          code: "UNSUPPORTED",
          type: "standard",
          methodType: "fixed",
          targetType: "items",
          allocation: "across",
          value: 500,
          currencyCode: null,
          maxQuantity: null,
          applyToQuantity: null,
          buyRulesMinQuantity: null,
          rules: [],
          targetRules: [],
          buyRules: [],
        },
        {
          id: "shipping-only",
          code: "SHIPPING",
          type: "standard",
          methodType: "percentage",
          targetType: "shipping_methods",
          allocation: "each",
          value: 10,
          currencyCode: null,
          maxQuantity: null,
          applyToQuantity: null,
          buyRulesMinQuantity: null,
          rules: [],
          targetRules: [],
          buyRules: [],
        },
      ],
      cartAttributes: { currency_code: "twd" },
      lines: [
        {
          id: "replacement-a",
          quantity: 2,
          unitPrice: 500,
          isDiscountable: true,
          attributes: {},
        },
      ],
    });

    expect(adjustments).toEqual([
      {
        itemId: "replacement-a",
        promotionId: "fixed-each",
        code: "FIXED",
        amount: 150,
        isTaxInclusive: false,
      },
      {
        itemId: "replacement-a",
        promotionId: "percent-across",
        code: "PERCENT",
        amount: 100,
        isTaxInclusive: true,
      },
    ]);
  });

  it("does not carry unrecorded or shipping-only promotions", () => {
    const adjustments = evaluateExchangePromotionCarryOver({
      sourcePromotionIds: [],
      promotions: [
        {
          id: "unrecorded",
          code: "UNRECORDED",
          type: "standard",
          methodType: "fixed",
          targetType: "items",
          allocation: "each",
          value: 10,
          currencyCode: null,
          maxQuantity: null,
          applyToQuantity: null,
          buyRulesMinQuantity: null,
          rules: [],
          targetRules: [],
          buyRules: [],
        },
      ],
      cartAttributes: { currency_code: "twd" },
      lines: [],
    });

    expect(adjustments).toEqual([]);
  });
});
