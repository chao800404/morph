import type { TaxRateDTO, TaxRegionDTO } from "../dto/tax.dto";
import { describe, expect, it } from "vitest";
import { systemTaxProvider } from "./system-tax-provider";

const region = (
  id: string,
  parentId: string | null,
  provinceCode: string | null,
): TaxRegionDTO => ({
  id,
  countryCode: "us",
  countryName: "United States",
  provinceCode,
  parentId,
  providerId: parentId ? null : "tp_system",
  metadata: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const rate = (
  id: string,
  taxRegionId: string,
  value: number | null,
  options: Partial<TaxRateDTO> = {},
): TaxRateDTO => ({
  id,
  taxRegionId,
  rate: value,
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

const country = region("country", null, null);
const province = region("province", "country", "CA");

describe("systemTaxProvider", () => {
  it("creates item and shipping tax lines from the most specific rates", async () => {
    const lines = await systemTaxProvider.getTaxLines({
      context: {
        address: { countryCode: "us", provinceCode: "CA" },
        currencyCode: "usd",
      },
      region: {
        countryRegion: country,
        provinceRegion: province,
        rates: [
          rate("country-rate", country.id, 5),
          rate("ca", province.id, 7.25),
        ],
      },
      itemLines: [{ id: "item", unitAmount: 1000, quantity: 2 }],
      shippingLines: [
        { id: "shipping", amount: 500, shippingOptionId: "express" },
      ],
    });

    expect(lines).toEqual([
      expect.objectContaining({
        lineItemId: "item",
        rate: 7.25,
        providerId: "tp_system",
        taxRateId: "ca",
      }),
      expect.objectContaining({
        shippingLineId: "shipping",
        rate: 7.25,
        providerId: "tp_system",
        taxRateId: "ca",
      }),
    ]);
  });

  it("returns both child and parent rates when the child is combinable", async () => {
    const lines = await systemTaxProvider.getTaxLines({
      context: {
        address: { countryCode: "us", provinceCode: "CA" },
        currencyCode: "usd",
      },
      region: {
        countryRegion: country,
        provinceRegion: province,
        rates: [
          rate("country-rate", country.id, 2),
          rate("local", province.id, 3, { isCombinable: true }),
        ],
      },
      itemLines: [{ id: "item", unitAmount: 1000, quantity: 1 }],
      shippingLines: [],
    });

    expect(lines.map((line) => line.taxRateId)).toEqual([
      "local",
      "country-rate",
    ]);
  });

  it("does not emit an unusable system tax line for a null rate", async () => {
    const lines = await systemTaxProvider.getTaxLines({
      context: {
        address: { countryCode: "us" },
        currencyCode: "usd",
      },
      region: {
        countryRegion: country,
        provinceRegion: null,
        rates: [rate("automatic", country.id, null)],
      },
      itemLines: [{ id: "item", unitAmount: 1000, quantity: 1 }],
      shippingLines: [],
    });

    expect(lines).toEqual([]);
  });
});
