import { describe, expect, it } from "vitest";
import { calculateOrderClaimRefundAmount } from "./order-claim-refund";

describe("calculateOrderClaimRefundAmount", () => {
  it("uses the historical item price after discounts and tax", () => {
    expect(
      calculateOrderClaimRefundAmount([
        {
          quantity: 2,
          unitPrice: 1_000,
          isTaxInclusive: false,
          adjustments: [200],
          taxes: [{ rate: 5 }],
        },
      ]),
    ).toBe(1_890);
  });

  it("keeps the tax-inclusive price the customer actually paid", () => {
    expect(
      calculateOrderClaimRefundAmount([
        {
          quantity: 1,
          unitPrice: 1_050,
          isTaxInclusive: true,
          adjustments: [],
          taxes: [{ rate: 5 }],
        },
      ]),
    ).toBe(1_050);
  });

  it("sums multiple claim lines", () => {
    expect(
      calculateOrderClaimRefundAmount([
        {
          quantity: 1,
          unitPrice: 500,
          isTaxInclusive: false,
          adjustments: [],
          taxes: [],
        },
        {
          quantity: 1,
          unitPrice: 300,
          isTaxInclusive: false,
          adjustments: [50],
          taxes: [],
        },
      ]),
    ).toBe(750);
  });
});
