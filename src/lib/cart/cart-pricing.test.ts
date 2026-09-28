import { describe, expect, it } from "vitest";

import type { CartDTO } from "./dto/cart.dto";
import { hasCartPricingChanged } from "./cart-pricing";

const cart = (overrides: Partial<CartDTO> = {}): CartDTO => ({
  id: "cart_1",
  regionId: "region_1",
  salesChannelId: "channel_1",
  currencyCode: "twd",
  locale: "zh-TW",
  email: "buyer@example.com",
  shippingAddress: null,
  billingAddress: null,
  completedAt: null,
  items: [
    {
      id: "item_1",
      variantId: "variant_1",
      productId: "product_1",
      title: "Product",
      variantTitle: "Default",
      productHandle: "product",
      thumbnail: null,
      quantity: 1,
      unitPrice: 1_000,
      subtotal: 1_000,
      discountTotal: 0,
      taxTotal: 0,
      total: 1_000,
    },
  ],
  shippingMethods: [],
  promotions: [],
  itemSubtotal: 1_000,
  itemDiscountTotal: 0,
  itemTaxTotal: 0,
  shippingSubtotal: 0,
  shippingDiscountTotal: 0,
  shippingTaxTotal: 0,
  creditTotal: 0,
  subtotal: 1_000,
  discountTotal: 0,
  taxTotal: 0,
  totalBeforeCredits: 1_000,
  total: 1_000,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("cart pricing comparison", () => {
  it("ignores timestamps and other non-monetary cart changes", () => {
    expect(
      hasCartPricingChanged(
        cart(),
        cart({
          updatedAt: "2026-01-02T00:00:00.000Z",
          email: "new@example.com",
        }),
      ),
    ).toBe(false);
  });

  it("detects a price-list change even when the order total stays the same", () => {
    const original = cart();
    const updatedItem = {
      ...original.items[0],
      unitPrice: 900,
      subtotal: 900,
      total: 900,
    };
    expect(
      hasCartPricingChanged(
        original,
        cart({
          items: [updatedItem],
          shippingMethods: [
            {
              id: "shipping_1",
              shippingOptionId: "option_1",
              name: "Standard",
              amount: 100,
              discountTotal: 0,
              taxTotal: 0,
              total: 100,
            },
          ],
          itemSubtotal: 900,
          shippingSubtotal: 100,
          subtotal: 1_000,
          total: 1_000,
        }),
      ),
    ).toBe(true);
  });

  it("detects changed discounts and applied promotions", () => {
    const original = cart();
    const updatedItem = {
      ...original.items[0],
      discountTotal: 100,
      total: 900,
    };
    expect(
      hasCartPricingChanged(
        original,
        cart({
          items: [updatedItem],
          promotions: [{ id: "promo_1", code: "SAVE", isAutomatic: true }],
          itemDiscountTotal: 100,
          discountTotal: 100,
          total: 900,
        }),
      ),
    ).toBe(true);
  });

  it("detects changed item tax and selected shipping amounts", () => {
    const original = cart();
    expect(
      hasCartPricingChanged(
        original,
        cart({
          items: [
            {
              ...original.items[0],
              taxTotal: 50,
              total: 1_050,
            },
          ],
          shippingMethods: [
            {
              id: "shipping_1",
              shippingOptionId: "option_1",
              name: "Standard",
              amount: 120,
              discountTotal: 0,
              taxTotal: 0,
              total: 120,
            },
          ],
          itemTaxTotal: 50,
          shippingSubtotal: 120,
          subtotal: 1_120,
          taxTotal: 50,
          total: 1_170,
        }),
      ),
    ).toBe(true);
  });
});
