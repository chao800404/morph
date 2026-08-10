import { describe, expect, it, vi } from "vitest";
import {
  normalizeProductListParams,
  normalizeProductOptionListParams,
} from "./product.queries";

vi.mock("@/server/product/collections.serverFn", () => ({
  getCollection: vi.fn(),
  listCollections: vi.fn(),
}));

vi.mock("@/server/product/list-products.serverFn", () => ({
  getProduct: vi.fn(),
  listProducts: vi.fn(),
}));

vi.mock("@/server/product/options.serverFn", () => ({
  getProductOption: vi.fn(),
  listProductOptions: vi.fn(),
}));

vi.mock("@/server/product/categories.serverFn", () => ({
  getProductCategory: vi.fn(),
  listProductCategories: vi.fn(),
}));

vi.mock("@/server/product/taxonomy.serverFn", () => ({
  listProductTaxonomy: vi.fn(),
}));

vi.mock("@/server/product/variants.serverFn", () => ({
  getVariantDetail: vi.fn(),
}));

describe("normalizeProductOptionListParams", () => {
  it("keeps the option date filter in the server-side list params", () => {
    expect(
      normalizeProductOptionListParams({
        optionCreatedWithin: "30d",
        page: 3,
      }),
    ).toMatchObject({
      createdWithin: "30d",
      page: 3,
    });
  });
});

describe("normalizeProductListParams", () => {
  it("keeps product filters in the server-side list params", () => {
    expect(
      normalizeProductListParams({
        productStatus: "published",
        productCreatedWithin: "7d",
        productUpdatedWithin: "24h",
        page: 2,
      }),
    ).toMatchObject({
      status: "published",
      createdWithin: "7d",
      updatedWithin: "24h",
      page: 2,
    });
  });
});
