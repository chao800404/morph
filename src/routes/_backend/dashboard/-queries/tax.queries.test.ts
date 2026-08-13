import { describe, expect, it, vi } from "vitest";
import { normalizeTaxRegionListParams } from "./tax.queries";

vi.mock("@/server/tax/tax-regions.serverFn", () => ({
  getTaxRate: vi.fn(),
  getTaxRegion: vi.fn(),
  listTaxRegionOptions: vi.fn(),
  listTaxRegions: vi.fn(),
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
