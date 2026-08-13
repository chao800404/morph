import { describe, expect, it } from "vitest";

import {
  addStoreCartItemInputSchema,
  cartIdSchema,
  createStoreCartInputSchema,
  updateStoreCartItemInputSchema,
} from "./store-cart";

const id = "123e4567-e89b-42d3-a456-426614174000";

describe("store cart validation", () => {
  it("accepts valid cart identifiers and optional customer email", () => {
    expect(cartIdSchema.safeParse(id).success).toBe(true);
    expect(createStoreCartInputSchema.safeParse({}).success).toBe(true);
    expect(
      createStoreCartInputSchema.safeParse({ email: "buyer@example.com" })
        .success,
    ).toBe(true);
  });

  it("rejects malformed identifiers and customer email", () => {
    expect(cartIdSchema.safeParse("cart_123").success).toBe(false);
    expect(
      createStoreCartInputSchema.safeParse({ email: "not-an-email" }).success,
    ).toBe(false);
  });

  it("enforces line item quantity boundaries", () => {
    expect(
      addStoreCartItemInputSchema.safeParse({ variantId: id, quantity: 1 })
        .success,
    ).toBe(true);
    expect(
      updateStoreCartItemInputSchema.safeParse({ quantity: 999 }).success,
    ).toBe(true);
    expect(
      addStoreCartItemInputSchema.safeParse({ variantId: id, quantity: 0 })
        .success,
    ).toBe(false);
    expect(
      updateStoreCartItemInputSchema.safeParse({ quantity: 1_000 }).success,
    ).toBe(false);
  });
});
