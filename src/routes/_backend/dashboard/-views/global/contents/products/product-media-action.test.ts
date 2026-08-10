import { beforeEach, describe, expect, it, vi } from "vitest";

const updateProduct = vi.fn(async () => ({ success: true, message: "Saved" }));

vi.mock("@/server/product/update-product.serverFn", () => ({
  updateProduct,
  deleteProducts: vi.fn(),
}));
vi.mock("@/server/product/collections.serverFn", () => ({
  createCollection: vi.fn(),
  deleteCollections: vi.fn(),
  updateCollection: vi.fn(),
}));
vi.mock("@/server/product/categories.serverFn", () => ({
  createProductCategory: vi.fn(),
  deleteProductCategories: vi.fn(),
  updateProductCategory: vi.fn(),
}));
vi.mock("@/server/product/variants.serverFn", () => ({
  updateVariant: vi.fn(),
  deleteVariants: vi.fn(),
  getVariantDetail: vi.fn(),
}));
vi.mock("@/server/product/options.serverFn", () => ({
  createProductOption: vi.fn(),
  deleteProductOptions: vi.fn(),
  updateProductOption: vi.fn(),
}));
vi.mock("@/server/sales-channel/sales-channels.serverFn", () => ({
  setProductSalesChannels: vi.fn(),
}));

const { updateProductMediaAction } = await import("./product-actions");

const formWith = (assets: string) => {
  const data = new FormData();
  data.set("id", "prod_1");
  data.set("assets", assets);
  return data;
};

describe("updateProductMediaAction", () => {
  beforeEach(() => updateProduct.mockClear());

  it("submits the ids in the order the author arranged them", async () => {
    // Order is the payload: the server writes it as `rank` and derives the
    // thumbnail from the first entry, so a set would lose the thumbnail.
    await updateProductMediaAction({
      data: formWith(
        JSON.stringify([
          { id: "a1", name: "front", url: "/a1.png" },
          { id: "a2", name: "back", url: "/a2.png" },
        ]),
      ),
    });

    expect(updateProduct).toHaveBeenCalledWith({
      data: { id: "prod_1", assetIds: ["a1", "a2"] },
    });
  });

  it("clears the gallery when every image is removed", async () => {
    // Empty must reach the server as an empty list, not as "leave alone" —
    // otherwise removing the last image silently does nothing.
    await updateProductMediaAction({ data: formWith("[]") });

    expect(updateProduct).toHaveBeenCalledWith({
      data: { id: "prod_1", assetIds: [] },
    });
  });

  it("refuses to save when the value is not readable", async () => {
    const result = await updateProductMediaAction({
      data: formWith("not json"),
    });

    expect(result.success).toBe(false);
    expect(updateProduct).not.toHaveBeenCalled();
  });
});
