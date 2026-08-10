import { beforeEach, describe, expect, it, vi } from "vitest";

type VariantInput = {
  data: {
    optionValueIds: string[];
    prices: Array<{ currencyCode: string; amount: number }>;
    manageInventory: boolean;
    allowBackorder: boolean;
  };
};

const createVariant = vi.fn(async (_input: VariantInput) => ({
  success: true,
  message: "Created",
}));

const updateVariant = vi.fn(async (_input: VariantInput) => ({
  success: true,
  message: "Saved",
}));

const sentTo = (call: number) => createVariant.mock.calls[call][0].data;

vi.mock("@/server/product/variants.serverFn", () => ({
  createVariant,
  updateVariant,
  deleteVariants: vi.fn(),
  getVariantDetail: vi.fn(),
}));
const updateProduct = vi.fn(
  async (_input: {
    data: {
      height?: number | null;
      weight?: number | null;
      hsCode?: string | null;
      originCountry?: string | null;
    };
  }) => ({ success: true, message: "Saved" }),
);

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
vi.mock("@/server/product/options.serverFn", () => ({
  createProductOption: vi.fn(),
  deleteProductOptions: vi.fn(),
  updateProductOption: vi.fn(),
}));
vi.mock("@/server/sales-channel/sales-channels.serverFn", () => ({
  setProductSalesChannels: vi.fn(),
}));

const {
  createVariantAction,
  updateVariantAction,
  updateProductAttributesAction,
} = await import("./product-actions");

const form = (entries: Array<[string, string]>) => {
  const data = new FormData();
  data.set("productId", "prod_1");
  data.set("title", "13cm");
  for (const [key, value] of entries) data.append(key, value);
  return data;
};

describe("createVariantAction", () => {
  beforeEach(() => createVariant.mockClear());

  it("collects one option value per axis from the selects", () => {
    // Each axis renders `option-<optionId>`; the ids are what the server
    // matches against the product's own options.
    void createVariantAction({
      data: form([
        ["option-opt-size", "val-13"],
        ["option-opt-color", "val-black"],
      ]),
    });

    expect(sentTo(0).optionValueIds).toEqual(["val-13", "val-black"]);
  });

  it("drops blank and zero prices instead of storing a free variant", () => {
    void createVariantAction({
      data: form([
        ["price-usd", "12.50"],
        ["price-eur", ""],
        ["price-gbp", "0"],
      ]),
    });

    expect(sentTo(0).prices).toEqual([{ currencyCode: "usd", amount: 1250 }]);
  });

  it("reads the switches, where unchecked submits nothing at all", () => {
    void createVariantAction({
      data: form([["manageInventory", "on"]]),
    });

    expect(sentTo(0).manageInventory).toBe(true);
    expect(sentTo(0).allowBackorder).toBe(false);
  });

  it("refuses without a product", () => {
    const data = new FormData();
    data.set("title", "13cm");

    return createVariantAction({ data }).then((result) => {
      expect(result.success).toBe(false);
      expect(createVariant).not.toHaveBeenCalled();
    });
  });
});

describe("updateVariantAction option values", () => {
  beforeEach(() => updateVariant.mockClear());

  it("carries the chosen cell so a variant can move axes", () => {
    // Adding an option axis leaves older variants with no value on it; this is
    // the payload that fills the gap.
    const data = new FormData();
    data.set("id", "var_1");
    data.set("title", "13cm");
    data.append("option-opt-size", "val-13");
    data.append("option-opt-color", "val-black");

    void updateVariantAction({ data });

    expect(updateVariant.mock.calls[0][0].data.optionValueIds).toEqual([
      "val-13",
      "val-black",
    ]);
  });

  it("sends an empty list when no axis was answered", () => {
    // The server treats a present-but-empty list as "no axes", which its
    // one-value-per-axis check rejects — better than silently leaving the
    // variant where it was.
    const data = new FormData();
    data.set("id", "var_1");
    data.set("title", "13cm");

    void updateVariantAction({ data });

    expect(updateVariant.mock.calls[0][0].data.optionValueIds).toEqual([]);
  });
});

describe("updateProductAttributesAction", () => {
  beforeEach(() => updateProduct.mockClear());

  it("keeps the decimals a measurement can have", () => {
    // The columns are `real`. Rounding 12.5 mm to 13 would quietly change what
    // is shipped, and a carrier's rate table takes the fraction.
    const data = new FormData();
    data.set("id", "prod_1");
    data.set("height", "12.5");
    data.set("weight", "900");

    void updateProductAttributesAction({ data });

    const sent = updateProduct.mock.calls[0][0].data;
    expect(sent.height).toBe(12.5);
    expect(sent.weight).toBe(900);
  });

  it("clears a field the author emptied instead of leaving it", () => {
    // Every attribute is always rendered, so a blank box means "no value".
    // Sending `undefined` would leave the old number in place.
    const data = new FormData();
    data.set("id", "prod_1");
    data.set("height", "");
    data.set("hsCode", "");

    void updateProductAttributesAction({ data });

    const sent = updateProduct.mock.calls[0][0].data;
    expect(sent.height).toBeNull();
    expect(sent.hsCode).toBeNull();
  });

  it("normalises the country code", () => {
    const data = new FormData();
    data.set("id", "prod_1");
    data.set("originCountry", "tw");

    void updateProductAttributesAction({ data });

    expect(updateProduct.mock.calls[0][0].data.originCountry).toBe("TW");
  });
});
