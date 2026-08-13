import { describe, expect, it } from "vitest";

import { matchesGeoZone, matchesShippingRules } from "./match-shipping";

describe("shipping matchers", () => {
  it("matches a province and postal wildcard", () => {
    expect(
      matchesGeoZone(
        {
          type: "zip",
          countryCode: "us",
          provinceCode: "CA",
          city: "Los Angeles",
          postalExpression: "900*",
        },
        {
          countryCode: "US",
          provinceCode: "ca",
          city: "los angeles",
          postalCode: "90012",
        },
      ),
    ).toBe(true);
  });

  it("rejects an address outside the geo zone", () => {
    expect(
      matchesGeoZone(
        { type: "province", countryCode: "us", provinceCode: "CA" },
        { countryCode: "us", provinceCode: "NY" },
      ),
    ).toBe(false);
  });

  it("evaluates numeric and membership option rules", () => {
    expect(
      matchesShippingRules(
        [
          { attribute: "total", operator: "gte", value: 10_000 },
          {
            attribute: "currency_code",
            operator: "in",
            value: ["usd", "cad"],
          },
        ],
        { total: 12_000, currency_code: "usd" },
      ),
    ).toBe(true);
  });
});
