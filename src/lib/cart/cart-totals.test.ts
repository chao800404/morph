import { describe, expect, it } from "vitest";

import { calculateAmountLine, sumCartTotals } from "./cart-totals";

describe("cart totals", () => {
  it("calculates discount before tax", () => {
    expect(
      calculateAmountLine({
        quantity: 2,
        unitPrice: 1_000,
        adjustments: [250],
        taxes: [{ rate: 10 }],
      }),
    ).toEqual({
      subtotal: 2_000,
      discountTotal: 250,
      taxTotal: 175,
      total: 1_925,
    });
  });

  it("caps adjustments at the line subtotal", () => {
    expect(
      calculateAmountLine({
        quantity: 1,
        unitPrice: 500,
        adjustments: [300, 400, -100],
        taxes: [{ rate: 5 }],
      }),
    ).toEqual({
      subtotal: 500,
      discountTotal: 500,
      taxTotal: 0,
      total: 0,
    });
  });

  it("extracts included tax without adding it to the line total", () => {
    expect(
      calculateAmountLine({
        quantity: 1,
        unitPrice: 1_100,
        isTaxInclusive: true,
        adjustments: [],
        taxes: [{ rate: 10 }],
      }),
    ).toEqual({
      subtotal: 1_100,
      discountTotal: 0,
      taxTotal: 100,
      total: 1_100,
    });
  });

  it("sums item and shipping totals without allowing a negative total", () => {
    expect(
      sumCartTotals({
        items: [
          {
            quantity: 2,
            unitPrice: 1_000,
            adjustments: [200],
            taxes: [{ rate: 10 }],
          },
        ],
        shipping: [
          {
            quantity: 1,
            unitPrice: 100,
            adjustments: [],
            taxes: [{ rate: 5 }],
          },
        ],
        credits: [3_000, -10],
      }),
    ).toEqual({
      itemSubtotal: 2_000,
      itemDiscountTotal: 200,
      itemTaxTotal: 180,
      shippingSubtotal: 100,
      shippingDiscountTotal: 0,
      shippingTaxTotal: 5,
      creditTotal: 3_000,
      subtotal: 2_100,
      discountTotal: 200,
      taxTotal: 185,
      total: 0,
    });
  });
});
