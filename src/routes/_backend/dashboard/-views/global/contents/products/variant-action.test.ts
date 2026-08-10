import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The mocks are typed, not `vi.fn()` bare: an untyped mock infers an empty
 * tuple for its arguments, so `mock.calls[0][0]` is a type error and the
 * assertions below would have to reach for `any` — which rules.md forbids.
 */
type VariantCall = { data: Record<string, unknown> };
const serverResult = { success: true, message: "Saved" };

const updateVariant = vi.fn(async (_options: VariantCall) => serverResult);
const createVariant = vi.fn(async (_options: VariantCall) => serverResult);

vi.mock("@/server/product/variants.serverFn", () => ({
  updateVariant,
  createVariant,
  deleteVariants: vi.fn(),
  getVariantDetail: vi.fn(),
}));
vi.mock("@/server/product/update-product.serverFn", () => ({
  updateProduct: vi.fn(),
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
  updateVariantMetadataAction,
  updateVariantPricingAction,
} = await import("./product-actions");

const editForm = (fields: Record<string, string>) => {
  const data = new FormData();
  data.set("id", "var_1");
  data.set("title", "Small");
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const sentToUpdate = () => updateVariant.mock.calls.at(-1)?.[0].data;

describe("updateVariantAction", () => {
  beforeEach(() => {
    updateVariant.mockClear();
    createVariant.mockClear();
  });

  it("sends the variant's own shipping attributes", async () => {
    // These columns and the DAL write existed from the start; only the form did
    // not render them, so every variant kept the product's defaults forever.
    await updateVariantAction({
      data: editForm({
        barcode: "4710001234567",
        weight: "250",
        length: "120",
        width: "80",
        height: "40",
      }),
    });

    expect(sentToUpdate()).toMatchObject({
      barcode: "4710001234567",
      weight: 250,
      length: 120,
      width: 80,
      height: 40,
    });
  });

  it("keeps the decimals a measurement can have", async () => {
    // The columns are `real`. Rounding 12.5 mm to 13 would quietly change what
    // is shipped, and a carrier's rate table takes the fraction.
    await updateVariantAction({ data: editForm({ height: "12.5" }) });

    expect(sentToUpdate()?.height).toBe(12.5);
  });

  it("clears a measurement the author emptied", async () => {
    // Null, not undefined: the form renders every one of these fields, so a
    // blank box is "no value", and treating it as "unchanged" would make a
    // variant override impossible to remove once set.
    await updateVariantAction({ data: editForm({ weight: "" }) });

    expect(sentToUpdate()?.weight).toBeNull();
  });

  it("clears a barcode the author emptied", async () => {
    // The unique index is partial on `IS NOT NULL`, so an emptied barcode has
    // to reach the column as null — an empty string would collide with every
    // other variant that also has none.
    await updateVariantAction({ data: editForm({ barcode: "" }) });

    expect(sentToUpdate()?.barcode).toBeNull();
  });

  it("rejects a negative measurement rather than storing it", async () => {
    await updateVariantAction({ data: editForm({ width: "-5" }) });

    expect(sentToUpdate()?.width).toBeNull();
  });

  it("does not overwrite metadata from the general editor", async () => {
    await updateVariantAction({
      data: editForm({ metadata: JSON.stringify({ erp_id: "00124" }) }),
    });

    expect(sentToUpdate()).not.toHaveProperty("metadata");
  });

  it("does not overwrite prices from the general editor", async () => {
    await updateVariantAction({
      data: editForm({ "price-usd": "10" }),
    });

    expect(sentToUpdate()).not.toHaveProperty("prices");
  });

  it("round-trips metadata through its independent editor", async () => {
    await updateVariantMetadataAction({
      data: editForm({ metadata: JSON.stringify({ erp_id: "00124" }) }),
    });

    expect(sentToUpdate()).toEqual({
      id: "var_1",
      metadata: { erp_id: "00124" },
    });
  });

  it("updates all submitted currencies through the pricing grid action", async () => {
    await updateVariantPricingAction({
      data: editForm({
        "price-usd": "12.50",
        "price-decimals-usd": "2",
        "price-jpy": "1800",
        "price-decimals-jpy": "0",
      }),
    });

    expect(sentToUpdate()).toEqual({
      id: "var_1",
      prices: [
        { currencyCode: "usd", amount: 1250 },
        { currencyCode: "jpy", amount: 1800 },
      ],
    });
  });
});

describe("createVariantAction", () => {
  beforeEach(() => createVariant.mockClear());

  it("carries the shipping attributes through creation too", async () => {
    // The update path had these before the create path did; a variant created
    // with a weight used to lose it silently.
    const data = new FormData();
    data.set("productId", "prod_1");
    data.set("title", "Large");
    data.set("barcode", "4710009999999");
    data.set("weight", "500");

    await createVariantAction({ data });

    expect(createVariant.mock.calls.at(-1)?.[0].data).toMatchObject({
      barcode: "4710009999999",
      weight: 500,
    });
  });
});
