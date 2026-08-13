import type { TaxRateDTO } from "./dto/tax.dto";
import { describe, expect, it } from "vitest";
import { resolveTaxRates } from "./resolve-tax-rates";

const rate = (
  id: string,
  taxRegionId: string,
  options: Partial<TaxRateDTO> = {},
): TaxRateDTO => ({
  id,
  taxRegionId,
  rate: 5,
  code: id,
  name: id,
  isDefault: true,
  isCombinable: false,
  metadata: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
  rules: [],
  ...options,
});

describe("resolveTaxRates", () => {
  it("prioritizes a province product override over defaults", () => {
    const rates = [
      rate("country", "country"),
      rate("province", "province"),
      rate("override", "province", {
        isDefault: false,
        rules: [
          {
            id: "rule",
            taxRateId: "override",
            reference: "product",
            referenceId: "product-1",
            label: "Product",
          },
        ],
      }),
    ];
    expect(
      resolveTaxRates({
        rates,
        item: { productId: "product-1" },
        countryRegionId: "country",
        provinceRegionId: "province",
      }).map((item) => item.id),
    ).toEqual(["override"]);
  });

  it("combines a province override with its matching country rate", () => {
    const rates = [
      rate("country", "country"),
      rate("override", "province", {
        isDefault: false,
        isCombinable: true,
        rules: [
          {
            id: "rule",
            taxRateId: "override",
            reference: "shipping_option",
            referenceId: "shipping-1",
            label: "Express",
          },
        ],
      }),
    ];
    expect(
      resolveTaxRates({
        rates,
        item: { shippingOptionId: "shipping-1" },
        countryRegionId: "country",
        provinceRegionId: "province",
      }).map((item) => item.id),
    ).toEqual(["override", "country"]);
  });
});
