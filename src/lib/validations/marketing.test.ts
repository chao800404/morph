import { describe, expect, it } from "vitest";
import {
  createOrderInputSchema,
  updateDraftOrderItemsInputSchema,
} from "./marketing";

const validDraft = {
  currencyCode: "TWD",
  shippingAddress: null,
  billingAddress: null,
  noNotification: false,
  items: [
    {
      type: "variant",
      variantId: "00000000-0000-4000-8000-000000000001",
      quantity: 2,
      customPrice: false,
    },
    {
      type: "variant",
      variantId: "00000000-0000-4000-8000-000000000002",
      quantity: 1,
      customPrice: true,
      unitPrice: 350,
    },
    {
      type: "custom",
      title: "Gift wrapping",
      sku: "GIFT-WRAP",
      quantity: 1,
      unitPrice: 50,
    },
  ],
};

describe("createOrderInputSchema", () => {
  it("accepts catalog variants, authorized custom prices, and custom items", () => {
    const result = createOrderInputSchema.safeParse(validDraft);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.currencyCode).toBe("twd");
  });

  it("requires an amount when a catalog variant uses a custom price", () => {
    const result = createOrderInputSchema.safeParse({
      ...validDraft,
      items: [
        {
          type: "variant",
          variantId: "00000000-0000-4000-8000-000000000001",
          quantity: 1,
          customPrice: true,
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("requires at least one item and caps an atomic D1 batch at 40 lines", () => {
    expect(
      createOrderInputSchema.safeParse({ ...validDraft, items: [] }).success,
    ).toBe(false);
    expect(
      createOrderInputSchema.safeParse({
        ...validDraft,
        items: Array.from({ length: 41 }, (_, index) => ({
          type: "custom",
          title: `Item ${index + 1}`,
          quantity: 1,
          unitPrice: 0,
        })),
      }).success,
    ).toBe(false);
  });
});

describe("updateDraftOrderItemsInputSchema", () => {
  it("requires an expected order version and non-empty replacement items", () => {
    const valid = {
      id: "00000000-0000-4000-8000-000000000010",
      expectedVersion: 2,
      shippingAddress: null,
      billingAddress: null,
      shippingOptionIds: [],
      items: validDraft.items,
    };
    expect(updateDraftOrderItemsInputSchema.safeParse(valid).success).toBe(
      true,
    );
    expect(
      updateDraftOrderItemsInputSchema.safeParse({ ...valid, items: [] })
        .success,
    ).toBe(false);
    expect(
      updateDraftOrderItemsInputSchema.safeParse({
        id: valid.id,
        shippingAddress: null,
        billingAddress: null,
        items: valid.items,
      }).success,
    ).toBe(false);
  });

  it("requires unique shipping choices so a profile cannot be charged twice", () => {
    const id = "00000000-0000-4000-8000-000000000020";
    expect(
      updateDraftOrderItemsInputSchema.safeParse({
        id: "00000000-0000-4000-8000-000000000010",
        expectedVersion: 2,
        shippingAddress: null,
        billingAddress: null,
        shippingOptionIds: [id, id],
        items: validDraft.items,
      }).success,
    ).toBe(false);
  });

  it("accepts a non-negative custom amount for a selected shipping option", () => {
    const shippingOptionId = "00000000-0000-4000-8000-000000000020";
    expect(
      updateDraftOrderItemsInputSchema.safeParse({
        id: "00000000-0000-4000-8000-000000000010",
        expectedVersion: 2,
        shippingAddress: null,
        billingAddress: null,
        shippingOptionIds: [shippingOptionId],
        shippingCustomAmounts: [{ shippingOptionId, amount: 0 }],
        items: validDraft.items,
      }).success,
    ).toBe(true);
    expect(
      updateDraftOrderItemsInputSchema.safeParse({
        id: "00000000-0000-4000-8000-000000000010",
        expectedVersion: 2,
        shippingAddress: null,
        billingAddress: null,
        shippingOptionIds: [],
        shippingCustomAmounts: [{ shippingOptionId, amount: 500 }],
        items: validDraft.items,
      }).success,
    ).toBe(false);
  });

  it("normalizes promotion codes and rejects duplicate selections", () => {
    const valid = {
      id: "00000000-0000-4000-8000-000000000010",
      expectedVersion: 2,
      shippingAddress: null,
      billingAddress: null,
      items: validDraft.items,
    };
    const normalized = updateDraftOrderItemsInputSchema.safeParse({
      ...valid,
      promotionCodes: ["  spring10  "],
    });
    expect(normalized.success).toBe(true);
    if (normalized.success) expect(normalized.data.promotionCodes).toEqual(["SPRING10"]);
    expect(
      updateDraftOrderItemsInputSchema.safeParse({
        ...valid,
        promotionCodes: ["SPRING10", "spring10"],
      }).success,
    ).toBe(false);
  });
});
