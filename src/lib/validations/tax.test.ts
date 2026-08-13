import { describe, expect, it } from "vitest";
import {
  createTaxProvinceInputSchema,
  createTaxRateInputSchema,
  createTaxRegionInputSchema,
  listTaxProvincesInputSchema,
} from "./tax";

describe("tax validation", () => {
  it("normalizes country and province codes", () => {
    expect(
      createTaxRegionInputSchema.parse({ countryCode: "TW" }).countryCode,
    ).toBe("tw");
    expect(
      createTaxProvinceInputSchema.parse({
        parentId: crypto.randomUUID(),
        provinceCode: " txg ",
      }).provinceCode,
    ).toBe("TXG");
  });
  it("accepts fractional percentage rates and rejects rates over 100", () => {
    const input = {
      taxRegionId: crypto.randomUUID(),
      name: "Local tax",
      code: "LOCAL",
      rate: "8.25" as unknown as number,
      isDefault: false,
      isCombinable: true,
      rules: [
        { reference: "product" as const, referenceId: crypto.randomUUID() },
      ],
    };
    expect(createTaxRateInputSchema.parse(input).rate).toBe(8.25);
    expect(
      createTaxRateInputSchema.safeParse({ ...input, rate: 100.01 }).success,
    ).toBe(false);
  });
  it("requires override targets and keeps default rates global", () => {
    const base = {
      taxRegionId: crypto.randomUUID(),
      name: "Standard",
      code: "STD",
      rate: 5,
      isCombinable: false,
    };
    expect(
      createTaxRateInputSchema.safeParse({
        ...base,
        isDefault: false,
        rules: [],
      }).success,
    ).toBe(false);
    expect(
      createTaxRateInputSchema.safeParse({
        ...base,
        isDefault: true,
        rules: [{ reference: "product", referenceId: crypto.randomUUID() }],
      }).success,
    ).toBe(false);
  });
  it("validates paginated sub-region filters", () => {
    const parsed = listTaxProvincesInputSchema.parse({
      parentId: crypto.randomUUID(),
      hasRates: "yes",
    });
    expect(parsed).toMatchObject({
      hasRates: "yes",
      sortBy: "code",
      sortOrder: "desc",
      page: 1,
      limit: 10,
    });
    expect(
      listTaxProvincesInputSchema.safeParse({
        parentId: crypto.randomUUID(),
        hasRates: "unknown",
      }).success,
    ).toBe(false);
  });
});
