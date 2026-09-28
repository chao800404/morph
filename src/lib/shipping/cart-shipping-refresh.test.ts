import { describe, expect, it } from "vitest";
import { planCartShippingRefresh } from "./cart-shipping-refresh";

const selected = {
  id: "method-1",
  shippingOptionId: "standard",
  name: "Standard",
  amount: 100,
  updatedAt: "2026-09-27T00:00:00.000Z",
};

describe("planCartShippingRefresh", () => {
  it("updates the saved quote when the current rate or label changes", () => {
    expect(
      planCartShippingRefresh(
        [selected],
        [{ id: "standard", name: "Standard delivery", amount: 140 }],
      ),
    ).toEqual([
      {
        methodId: "method-1",
        expectedUpdatedAt: selected.updatedAt,
        expectedOptionId: "standard",
        expectedAmount: 100,
        kind: "update",
        name: "Standard delivery",
        amount: 140,
      },
    ]);
  });

  it("removes a selected method when its option is no longer available", () => {
    expect(planCartShippingRefresh([selected], [])).toEqual([
      {
        methodId: "method-1",
        expectedUpdatedAt: selected.updatedAt,
        expectedOptionId: "standard",
        expectedAmount: 100,
        kind: "remove",
      },
    ]);
  });

  it("leaves unchanged rates and unlinked methods untouched", () => {
    expect(
      planCartShippingRefresh(
        [selected, { ...selected, id: "custom", shippingOptionId: null }],
        [{ id: "standard", name: "Standard", amount: 100 }],
      ),
    ).toEqual([]);
  });
});
