import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findDetail: vi.fn(),
  findVariant: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  createVariant: vi.fn(),
  updateVariant: vi.fn(),
}));

vi.mock("@/lib/product/dal/product.dal", () => ({
  productDal: { findDetail: mocks.findDetail },
}));
vi.mock("@/lib/product/dal/product-variant.dal", () => ({
  productVariantDal: { findById: mocks.findVariant },
}));
vi.mock("@/lib/product/service/product-write.service", () => ({
  productWriteService: {
    create: mocks.createProduct,
    update: mocks.updateProduct,
  },
}));
vi.mock("@/lib/product/service/product-variant-write.service", () => ({
  productVariantWriteService: {
    create: mocks.createVariant,
    update: mocks.updateVariant,
  },
}));

import { createProductImportGroupApplier } from "./product-import-apply";
import type { ProductImportGroup } from "./product-import.csv";

const productId = "c31f09f6-8d9b-4f3e-94d8-047bb63376e2";
const variantId = "a53209f6-8d9b-4f3e-94d8-047bb63376e2";

const group = (overrides: Partial<ProductImportGroup> = {}): ProductImportGroup => ({
  key: "new:mug",
  rows: [
    {
      row: 2,
      product: {
        title: "Mug",
        tagValues: ["ceramic"],
        categoryIds: [productId],
      },
      variant: {
        title: "Blue",
        sku: "MUG-BLUE",
        barcode: "12345678",
        optionValues: [{ name: "Color", value: "Blue" }],
        prices: [{ currencyCode: "twd", amount: 32000 }],
        metadata: { batch: "blue" },
      },
    },
    {
      row: 3,
      product: {
        title: "Mug",
        tagValues: ["ceramic"],
        categoryIds: [productId],
      },
      variant: {
        title: "Red",
        sku: "MUG-RED",
        optionValues: [{ name: "Color", value: "Red" }],
        prices: [{ currencyCode: "twd", amount: 33000 }],
      },
    },
  ],
  ...overrides,
});

describe("product CSV group applier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createProduct.mockResolvedValue({ success: true, message: "created", data: {} });
    mocks.updateProduct.mockResolvedValue({ success: true, message: "updated", data: {} });
  });

  it("creates a product with options and an explicit variant list", async () => {
    const applyGroup = createProductImportGroupApplier(10);
    const result = await applyGroup(group(), "admin-1");

    expect(result).toEqual({ success: true, action: "created" });
    expect(mocks.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Mug",
        categoryIds: [productId],
        tagValues: ["ceramic"],
        options: [{ title: "Color", values: ["Blue", "Red"] }],
        variants: [
          expect.objectContaining({
            title: "Blue",
            barcode: "12345678",
            optionValues: ["Blue"],
            prices: [{ currencyCode: "twd", amount: 32000 }],
            metadata: { batch: "blue" },
          }),
          expect.objectContaining({
            title: "Red",
            optionValues: ["Red"],
            prices: [{ currencyCode: "twd", amount: 33000 }],
          }),
        ],
      }),
      "admin-1",
    );
  });

  it("does not update a variant owned by a different product", async () => {
    mocks.findDetail.mockResolvedValue({
      id: productId,
      options: [],
    });
    mocks.findVariant.mockResolvedValue({ id: variantId, productId: "another-product" });
    const existingGroup = group({
      key: productId,
      productId,
      rows: [
        {
          row: 2,
          product: { title: "Mug" },
          variant: { sku: "MUG-BLUE" },
          productId,
          variantId,
        },
      ],
    });

    const result = await createProductImportGroupApplier(10)(existingGroup, "admin-1");

    expect(result).toMatchObject({ success: false });
    expect(mocks.updateVariant).not.toHaveBeenCalled();
  });

  it("passes variant metadata through when updating an existing variant", async () => {
    mocks.findDetail.mockResolvedValue({
      id: productId,
      options: [],
    });
    mocks.findVariant.mockResolvedValue({ id: variantId, productId });
    mocks.updateVariant.mockResolvedValue({ success: true, message: "updated", data: {} });
    const existingGroup = group({
      key: productId,
      productId,
      rows: [
        {
          row: 2,
          product: {},
          variant: { metadata: { season: "winter" } },
          productId,
          variantId,
        },
      ],
    });

    const result = await createProductImportGroupApplier(10)(existingGroup, "admin-1");

    expect(result).toEqual({ success: true, action: "updated" });
    expect(mocks.updateVariant).toHaveBeenCalledWith(
      expect.objectContaining({ id: variantId, metadata: { season: "winter" } }),
      "admin-1",
    );
  });
});
