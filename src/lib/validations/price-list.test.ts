import { describe, expect, it } from "vitest";
import {
  batchPriceCreateInputSchema,
  batchPriceUpdateInputSchema,
  createPriceListInputSchema,
  savePriceListPriceInputSchema,
} from "./price-list";

const input = {
  priceListId: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
  variantId: "6ba7b811-9dad-41d1-80b4-00c04fd430c8",
  currencyCode: "TWD",
  amount: 1_000,
};

describe("savePriceListPriceInputSchema", () => {
  it("accepts regular prices and open-ended quantity tiers", () => {
    expect(savePriceListPriceInputSchema.safeParse(input).success).toBe(true);
    expect(
      savePriceListPriceInputSchema.safeParse({ ...input, minQuantity: "10" }),
    ).toMatchObject({
      success: true,
      data: { currencyCode: "twd", minQuantity: 10 },
    });
  });

  it("accepts a bounded quantity tier", () => {
    expect(
      savePriceListPriceInputSchema.safeParse({
        ...input,
        minQuantity: "10",
        maxQuantity: "19",
      }),
    ).toMatchObject({
      success: true,
      data: { minQuantity: 10, maxQuantity: 19 },
    });
  });

  it.each([
    { maxQuantity: "10" },
    { minQuantity: "10", maxQuantity: "9" },
    { minQuantity: "0" },
    { minQuantity: "1.5" },
  ])("rejects invalid quantity range %o", (range) => {
    expect(
      savePriceListPriceInputSchema.safeParse({ ...input, ...range }).success,
    ).toBe(false);
  });
});

describe("price list batch input schemas", () => {
  it("requires a lower quantity for a new bounded tier", () => {
    expect(
      batchPriceCreateInputSchema.safeParse({
        variantId: input.variantId,
        currencyCode: "twd",
        amount: 900,
        maxQuantity: 10,
      }).success,
    ).toBe(false);
  });

  it("allows partial quantity updates to use the existing other bound", () => {
    expect(
      batchPriceUpdateInputSchema.safeParse({
        id: "6ba7b812-9dad-41d1-80b4-00c04fd430c8",
        maxQuantity: 10,
      }),
    ).toMatchObject({ success: true, data: { maxQuantity: 10 } });
  });
});

describe("price list targeting schemas", () => {
  it("accepts customer group and region targets", () => {
    expect(
      createPriceListInputSchema.safeParse({
        title: "Taiwan wholesale",
        customerGroupIds: ["6ba7b812-9dad-41d1-80b4-00c04fd430c8"],
        regionIds: ["6ba7b813-9dad-41d1-80b4-00c04fd430c8"],
      }),
    ).toMatchObject({
      success: true,
      data: {
        customerGroupIds: ["6ba7b812-9dad-41d1-80b4-00c04fd430c8"],
        regionIds: ["6ba7b813-9dad-41d1-80b4-00c04fd430c8"],
      },
    });
  });

  it("rejects duplicate region targets", () => {
    const regionId = "6ba7b813-9dad-41d1-80b4-00c04fd430c8";
    expect(
      createPriceListInputSchema.safeParse({
        title: "Taiwan wholesale",
        regionIds: [regionId, regionId],
      }).success,
    ).toBe(false);
  });
});
