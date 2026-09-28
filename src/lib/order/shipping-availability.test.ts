import { describe, expect, it } from "vitest";
import { selectedShippingMethodsAreAvailable } from "./shipping-availability";

describe("checkout shipping availability", () => {
  it("allows selected methods that remain in the current availability result", () => {
    expect(
      selectedShippingMethodsAreAvailable(
        [
          { shippingOptionId: "standard", amount: 100 },
          { shippingOptionId: "express", amount: 250 },
        ],
        [
          { id: "standard", amount: 100 },
          { id: "express", amount: 250 },
        ],
      ),
    ).toBe(true);
  });

  it("rejects missing or newly unavailable selected methods", () => {
    expect(
      selectedShippingMethodsAreAvailable(
        [{ shippingOptionId: "removed", amount: 100 }],
        [{ id: "standard", amount: 100 }],
      ),
    ).toBe(false);
    expect(
      selectedShippingMethodsAreAvailable(
        [{ shippingOptionId: null, amount: 100 }],
        [{ id: "standard", amount: 100 }],
      ),
    ).toBe(false);
  });

  it("rejects a selected method whose saved amount differs from the current quote", () => {
    expect(
      selectedShippingMethodsAreAvailable(
        [{ shippingOptionId: "standard", amount: 100 }],
        [{ id: "standard", amount: 140 }],
      ),
    ).toBe(false);
  });
});
