import { describe, expect, it } from "vitest";
import {
  calculateDraftOrderSummary,
  calculateDraftOrderTotal,
  draftOrderConversionFailure,
  resolveDraftShippingOptions,
} from "./draft-order";

const validDraft = {
  isDraftOrder: true,
  status: "draft",
  canceledAt: null,
  hasLineItems: true,
};

describe("draftOrderConversionFailure", () => {
  it("allows a non-canceled draft with at least one line item", () => {
    expect(draftOrderConversionFailure(validDraft)).toBeNull();
  });

  it.each([
    [{ ...validDraft, isDraftOrder: false }, "NOT_DRAFT"],
    [{ ...validDraft, status: "pending" }, "INVALID_STATUS"],
    [{ ...validDraft, canceledAt: "2026-09-27T00:00:00.000Z" }, "CANCELED"],
    [{ ...validDraft, hasLineItems: false }, "EMPTY"],
  ] as const)("rejects an invalid conversion state: %s", (input, failure) => {
    expect(draftOrderConversionFailure(input)).toBe(failure);
  });
});

describe("calculateDraftOrderTotal", () => {
  it("sums quantities and unit prices in minor currency units", () => {
    expect(
      calculateDraftOrderTotal([
        { quantity: 2, unitPrice: 1_250 },
        { quantity: 3, unitPrice: 80 },
      ]),
    ).toBe(2_740);
  });

  it.each([
    { items: [{ quantity: 0, unitPrice: 100 }] },
    { items: [{ quantity: 1.5, unitPrice: 100 }] },
    { items: [{ quantity: 1, unitPrice: -1 }] },
    { items: [{ quantity: Number.MAX_SAFE_INTEGER, unitPrice: 2 }] },
    {
      items: [
        { quantity: 1, unitPrice: Number.MAX_SAFE_INTEGER },
        { quantity: 1, unitPrice: 1 },
      ],
    },
  ])("rejects invalid or overflowing totals: $items", ({ items }) => {
    expect(calculateDraftOrderTotal(items)).toBeNull();
  });
});

describe("resolveDraftShippingOptions", () => {
  const availableOptions = [
    { id: "ship-a", name: "A delivery", amount: 500, shippingProfileId: "a" },
    { id: "ship-a2", name: "A express", amount: 900, shippingProfileId: "a" },
    { id: "ship-b", name: "B delivery", amount: 700, shippingProfileId: "b" },
  ];

  it("requires one currently available option for each shipping profile", () => {
    expect(
      resolveDraftShippingOptions({
        selectedOptionIds: ["ship-a"],
        availableOptions,
        requiredShippingProfiles: [{ id: "a" }, { id: "b" }],
      }),
    ).toBeNull();

    expect(
      resolveDraftShippingOptions({
        selectedOptionIds: ["ship-a2", "ship-b"],
        availableOptions,
        requiredShippingProfiles: [{ id: "a" }, { id: "b" }],
      }),
    ).toEqual([availableOptions[1], availableOptions[2]]);
  });

  it("rejects duplicate profiles, duplicate ids, and unavailable options", () => {
    for (const selectedOptionIds of [
      ["ship-a", "ship-a2"],
      ["ship-a", "ship-a"],
      ["missing"],
    ]) {
      expect(
        resolveDraftShippingOptions({
          selectedOptionIds,
          availableOptions,
          requiredShippingProfiles: [{ id: "a" }],
        }),
      ).toBeNull();
    }
  });

  it("applies a custom amount only to its selected option and records the override", () => {
    expect(
      resolveDraftShippingOptions({
        selectedOptionIds: ["ship-a", "ship-b"],
        availableOptions,
        requiredShippingProfiles: [{ id: "a" }, { id: "b" }],
        customAmounts: [{ shippingOptionId: "ship-a", amount: 0 }],
      }),
    ).toEqual([
      { ...availableOptions[0], amount: 0, isCustomAmount: true },
      availableOptions[2],
    ]);
  });

  it("rejects duplicate, unselected, negative, and fractional custom amounts", () => {
    const base = {
      selectedOptionIds: ["ship-a"],
      availableOptions,
      requiredShippingProfiles: [{ id: "a" }],
    };
    for (const customAmounts of [
      [
        { shippingOptionId: "ship-a", amount: 100 },
        { shippingOptionId: "ship-a", amount: 200 },
      ],
      [{ shippingOptionId: "ship-b", amount: 100 }],
      [{ shippingOptionId: "ship-a", amount: -1 }],
      [{ shippingOptionId: "ship-a", amount: 10.5 }],
    ]) {
      expect(
        resolveDraftShippingOptions({ ...base, customAmounts }),
      ).toBeNull();
    }
  });
});

describe("calculateDraftOrderSummary", () => {
  const taxLine = (lineItemId: string, rate: number) => ({
    lineItemId,
    rate,
    name: "VAT",
    code: "vat",
    providerId: "system",
  });

  it("calculates exclusive item and shipping taxes", () => {
    expect(
      calculateDraftOrderSummary({
        items: [
          { id: "item", quantity: 1, unitPrice: 10_000, isTaxInclusive: false },
        ],
        shippingMethods: [
          { id: "shipping", amount: 1_000, isTaxInclusive: false },
        ],
        taxLines: [
          taxLine("item", 10),
          {
            shippingLineId: "shipping",
            rate: 10,
            name: "VAT",
            code: "vat",
            providerId: "system",
          },
        ],
      }),
    ).toMatchObject({
      itemSubtotal: 10_000,
      shippingSubtotal: 1_000,
      subtotal: 11_000,
      taxTotal: 1_100,
      total: 12_100,
      itemsTotal: 10_000,
      shippingTotal: 1_000,
    });
  });

  it("removes inclusive taxes from the payable total", () => {
    expect(
      calculateDraftOrderSummary({
        items: [
          { id: "item", quantity: 1, unitPrice: 11_000, isTaxInclusive: true },
        ],
        shippingMethods: [
          { id: "shipping", amount: 1_100, isTaxInclusive: true },
        ],
        taxLines: [
          taxLine("item", 10),
          {
            shippingLineId: "shipping",
            rate: 10,
            name: "VAT",
            code: "vat",
            providerId: "system",
          },
        ],
      }),
    ).toMatchObject({
      subtotal: 12_100,
      taxTotal: 1_100,
      total: 12_100,
    });
  });

  it("applies item and shipping promotion adjustments before calculating tax", () => {
    expect(
      calculateDraftOrderSummary({
        items: [
          { id: "item", quantity: 1, unitPrice: 10_000, isTaxInclusive: false },
        ],
        shippingMethods: [
          { id: "shipping", amount: 1_000, isTaxInclusive: false },
        ],
        itemAdjustments: [{ itemId: "item", amount: 1_000 }],
        shippingAdjustments: [
          { shippingMethodId: "shipping", amount: 200 },
        ],
        taxLines: [
          taxLine("item", 10),
          {
            shippingLineId: "shipping",
            rate: 10,
            name: "VAT",
            code: "vat",
            providerId: "system",
          },
        ],
      }),
    ).toMatchObject({
      discountTotal: 1_200,
      taxTotal: 980,
      total: 10_780,
    });
  });

  it("supports tax-free items without shipping and rejects invalid tax references", () => {
    expect(
      calculateDraftOrderSummary({
        items: [
          { id: "item", quantity: 2, unitPrice: 500, isTaxInclusive: false },
        ],
        shippingMethods: [],
        taxLines: [],
      }),
    ).toMatchObject({ itemsTotal: 1_000, shippingTotal: 0, total: 1_000 });
    expect(
      calculateDraftOrderSummary({
        items: [
          { id: "item", quantity: 1, unitPrice: 500, isTaxInclusive: false },
        ],
        shippingMethods: [],
        taxLines: [taxLine("missing-item", 10)],
      }),
    ).toBeNull();
  });
});
