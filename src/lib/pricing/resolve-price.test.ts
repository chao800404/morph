import { describe, expect, it } from "vitest";

import type { PriceCandidate } from "./resolve-price";
import { resolvePrice } from "./resolve-price";

const candidate = (
  overrides: Partial<PriceCandidate> = {},
): PriceCandidate => ({
  id: "price-base",
  amount: 900,
  currencyCode: "usd",
  minQuantity: null,
  maxQuantity: null,
  priceList: null,
  rules: [],
  ...overrides,
});

describe("resolvePrice", () => {
  it("falls back to the legacy base amount", () => {
    expect(
      resolvePrice({
        baseAmount: 1_000,
        candidates: [],
        context: { currencyCode: "usd", quantity: 1 },
      }),
    ).toMatchObject({ amount: 1_000, originalAmount: 1_000, priceId: null });
  });

  it("uses a normalized base price as the original amount for a sale", () => {
    const result = resolvePrice({
      baseAmount: 1_000,
      candidates: [
        candidate({ id: "normalized-base", amount: 950 }),
        candidate({
          id: "sale",
          amount: 700,
          priceList: {
            id: "summer-sale",
            status: "active",
            type: "sale",
            startsAt: null,
            endsAt: null,
            rules: [],
          },
        }),
      ],
      context: { currencyCode: "usd", quantity: 1 },
    });

    expect(result).toMatchObject({
      amount: 700,
      originalAmount: 950,
      priceId: "sale",
    });
  });

  it("resolves a normalized base price without a legacy fallback", () => {
    const result = resolvePrice({
      baseAmount: null,
      candidates: [candidate({ amount: 950 })],
      context: { currencyCode: "usd", quantity: 1 },
    });

    expect(result).toMatchObject({ amount: 950, originalAmount: 950 });
  });

  it("selects a matching quantity and region price", () => {
    const result = resolvePrice({
      baseAmount: 1_000,
      candidates: [
        candidate({ id: "general", amount: 950 }),
        candidate({
          id: "regional-volume",
          amount: 800,
          minQuantity: 10,
          rules: [
            {
              attribute: "regionId",
              value: "region-us",
              operator: "eq",
              priority: 10,
            },
          ],
        }),
      ],
      context: {
        currencyCode: "usd",
        quantity: 10,
        regionId: "region-us",
      },
    });
    expect(result).toMatchObject({ amount: 800, priceId: "regional-volume" });
  });

  it("applies the matching bounded quantity tier", () => {
    const result = resolvePrice({
      baseAmount: 1_000,
      candidates: [
        candidate({
          id: "ten-to-nineteen",
          amount: 800,
          minQuantity: 10,
          maxQuantity: 19,
        }),
        candidate({ id: "twenty-plus", amount: 700, minQuantity: 20 }),
      ],
      context: { currencyCode: "usd", quantity: 20 },
    });
    expect(result).toMatchObject({ amount: 700, priceId: "twenty-plus" });
  });

  it("ignores draft, expired, and unmatched targeted lists", () => {
    const now = new Date("2026-08-13T00:00:00.000Z");
    const result = resolvePrice({
      baseAmount: 1_000,
      now,
      candidates: [
        candidate({
          id: "expired",
          amount: 100,
          priceList: {
            id: "old-sale",
            status: "active",
            type: "sale",
            startsAt: null,
            endsAt: "2026-08-12T23:59:59.000Z",
            rules: [],
          },
        }),
        candidate({
          id: "wrong-group",
          amount: 200,
          priceList: {
            id: "vip",
            status: "active",
            type: "override",
            startsAt: null,
            endsAt: null,
            rules: [{ attribute: "customerGroupId", values: ["vip"] }],
          },
        }),
      ],
      context: {
        currencyCode: "usd",
        quantity: 1,
        customerGroupId: "retail",
      },
    });
    expect(result?.amount).toBe(1_000);
  });

  it("applies price-list rules only in a matching region", () => {
    const targeted = candidate({
      id: "taiwan-sale",
      amount: 700,
      priceList: {
        id: "taiwan-prices",
        status: "active",
        type: "sale",
        startsAt: null,
        endsAt: null,
        rules: [{ attribute: "regionId", values: ["region-tw"] }],
      },
    });
    const inTargetRegion = resolvePrice({
      baseAmount: 1_000,
      candidates: [targeted],
      context: {
        currencyCode: "usd",
        quantity: 1,
        regionId: "region-tw",
      },
    });
    const outsideTargetRegion = resolvePrice({
      baseAmount: 1_000,
      candidates: [targeted],
      context: {
        currencyCode: "usd",
        quantity: 1,
        regionId: "region-jp",
      },
    });

    expect(inTargetRegion?.amount).toBe(700);
    expect(outsideTargetRegion?.amount).toBe(1_000);
  });
});
