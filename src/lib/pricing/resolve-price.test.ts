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
});
