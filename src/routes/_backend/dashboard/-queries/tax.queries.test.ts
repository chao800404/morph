import { describe, expect, it, vi } from "vitest";
import {
  normalizeTaxProvinceListParams,
  normalizeTaxRateListParams,
  normalizeTaxRegionListParams,
} from "./tax.queries";

vi.mock("@/server/tax/tax-regions.serverFn", () => ({
  getTaxRate: vi.fn(),
  getTaxRegion: vi.fn(),
  listTaxRegionOptions: vi.fn(),
  listTaxProvinces: vi.fn(),
  listTaxRegions: vi.fn(),
  listTaxRates: vi.fn(),
  listTaxRuleTargets: vi.fn(),
}));
describe("normalizeTaxRegionListParams", () => {
  it("normalizes route search into the shared list key", () => {
    expect(
      normalizeTaxRegionListParams({
        q: "tw",
        sortBy: "name",
        sortOrder: "asc",
        page: 2,
        limit: 10,
      }),
    ).toEqual({
      query: "tw",
      sortBy: "name",
      sortOrder: "asc",
      page: 2,
      limit: 10,
    });
  });
});

describe("normalizeTaxRateListParams", () => {
  it("keeps override table state independent from the province table", () => {
    const id = crypto.randomUUID();
    expect(
      normalizeTaxRateListParams(id, "override", {
        q: "state",
        page: 4,
        sortBy: "code",
        taxRateQ: "food",
        taxRatePage: 2,
        taxRateSortBy: "name",
        taxRateSortOrder: "asc",
      }),
    ).toEqual({
      taxRegionId: id,
      kind: "override",
      query: "food",
      sortBy: "name",
      sortOrder: "asc",
      page: 2,
      limit: 10,
    });
  });
});

describe("normalizeTaxProvinceListParams", () => {
  it("normalizes URL-backed state for the sub-region card", () => {
    expect(
      normalizeTaxProvinceListParams(crypto.randomUUID(), {
        q: "ca",
        taxRegionHasRates: "yes",
        sortBy: "updatedAt",
        sortOrder: "desc",
        page: 3,
        limit: 5,
      }),
    ).toMatchObject({
      query: "ca",
      hasRates: "yes",
      sortBy: "updatedAt",
      sortOrder: "desc",
      page: 3,
      limit: 5,
    });
  });
});
