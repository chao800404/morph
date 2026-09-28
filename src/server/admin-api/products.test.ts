import type {
  ProductDetailDTO,
  ProductListItemDTO,
} from "@/lib/product/dto/product.dto";
import type { ProductVariantDTO } from "@/lib/product/dto/product-variant.dto";
import { describe, expect, it, vi } from "vitest";
import {
  handleAdminProductsRequest,
  type AdminProductsApiDependencies,
} from "./products";

const productId = "c5a01d8c-93e0-4b1d-b4d1-44ed7e74e94e";
const collectionId = "b2652fd0-e3fb-4a6e-87b1-f3dd6f979c29";
const categoryId = "626773d2-8f20-42a9-9da8-80fc46dadd80";
const channelId = "2a314c31-7684-4b53-93a1-c85d459a2d02";
const date = new Date("2026-09-27T02:00:00.000Z");

const product: ProductListItemDTO = {
  id: productId,
  title: "Morph Shirt",
  handle: "morph-shirt",
  subtitle: null,
  description: "A test product",
  status: "published",
  collectionId,
  typeId: null,
  discountable: true,
  thumbnailAssetId: null,
  weight: 200,
  length: null,
  width: null,
  height: null,
  originCountry: "TW",
  hsCode: null,
  midCode: null,
  material: "cotton",
  metadata: { color: "blue" },
  createdBy: "admin-1",
  updatedBy: "admin-1",
  createdAt: date,
  updatedAt: date,
  thumbnailUrl: "https://assets.test/shirt.png",
  collectionTitle: "Clothing",
  typeValue: null,
  salesChannels: [{ id: channelId, name: "Online" }],
  variantCount: 1,
};

const detail: ProductDetailDTO = {
  ...product,
  shippingProfileId: "shipping-profile-1",
  shippingProfileName: "Default",
  options: [
    {
      id: "option-1",
      title: "Size",
      isExclusive: true,
      rank: 0,
      metadata: null,
      values: [
        {
          id: "b97b8c46-f9b6-4071-9fb6-a2bec78e5594",
          optionId: "option-1",
          value: "M",
          rank: 0,
          metadata: null,
        },
      ],
      createdBy: "admin-1",
      updatedBy: "admin-1",
      createdAt: date,
      updatedAt: date,
    },
  ],
  assetIds: ["asset-1"],
  tagIds: ["tag-1"],
  categoryIds: [categoryId],
  assets: [
    { id: "asset-1", name: "Shirt", url: "https://assets.test/shirt.png" },
  ],
  tags: [{ id: "tag-1", value: "summer" }],
  categories: [{ id: categoryId, name: "Tops" }],
  salesChannels: [
    {
      id: channelId,
      name: "Online",
      type: "storefront",
      description: null,
      isDisabled: false,
      metadata: {},
      createdAt: date,
      updatedAt: date,
    },
  ],
  salesChannelIds: [channelId],
};

const variant: ProductVariantDTO = {
  id: "f4699221-a57c-4cbd-abcc-149909208570",
  productId,
  title: "M",
  sku: "SHIRT-M",
  barcode: null,
  rank: 0,
  manageInventory: true,
  allowBackorder: false,
  inventoryQuantity: 4,
  inventoryKit: [],
  weight: null,
  length: null,
  width: null,
  height: null,
  thumbnailAssetId: null,
  assets: [],
  optionValueIds: ["b97b8c46-f9b6-4071-9fb6-a2bec78e5594"],
  prices: [
    {
      id: "price-1",
      variantId: "f4699221-a57c-4cbd-abcc-149909208570",
      currencyCode: "twd",
      amount: 1200,
    },
  ],
  metadata: {},
  createdBy: "admin-1",
  updatedBy: "admin-1",
  createdAt: date,
  updatedAt: date,
};

const dependencies = (
  overrides: Partial<AdminProductsApiDependencies> = {},
): AdminProductsApiDependencies => ({
  authorize: vi.fn(async () => ({
    allowed: true as const,
    userId: "admin-1",
    role: "admin",
  })),
  maxAssets: 20,
  listProducts: vi.fn(async () => ({ products: [product], total: 23 })),
  findProduct: vi.fn(async () => detail),
  createProduct: vi.fn(async () => ({
    success: true as const,
    message: "Product created",
    data: { id: productId, handle: "morph-shirt", variantCount: 1 },
  })),
  updateProduct: vi.fn(async () => ({
    success: true as const,
    message: "Product updated",
    data: { id: productId },
  })),
  deleteProducts: vi.fn(async () => ({
    success: true as const,
    message: "Product deleted",
    data: { deleted: 1 },
  })),
  createVariant: vi.fn(async () => ({
    success: true as const,
    message: "Variant created",
    data: { id: variant.id },
  })),
  updateVariant: vi.fn(async () => ({
    success: true as const,
    message: "Variant updated",
    data: { id: variant.id },
  })),
  updateInventoryKits: vi.fn(async () => ({
    success: true as const,
    message: "Inventory kits updated",
    data: { id: variant.id, updated: 1 },
  })),
  deleteVariants: vi.fn(async () => ({
    success: true as const,
    message: "Variant deleted",
    data: { deleted: 1, restoredProductIds: [] },
  })),
  findVariant: vi.fn(async () => variant),
  listVariants: vi.fn(async () => ({ variants: [variant], total: 1 })),
  ...overrides,
});

describe("Admin products API", () => {
  it("lists products with Medusa offset pagination, filters, and snake-case fields", async () => {
    const deps = dependencies();
    const response = await handleAdminProductsRequest(
      new Request(
        `https://shop.test/api/admin/products?offset=7&limit=5&order=title&status=published&collection_id=${collectionId}&category_id=${categoryId}&sales_channel_id=${channelId}`,
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      products: [
        {
          id: productId,
          title: "Morph Shirt",
          thumbnail: "https://assets.test/shirt.png",
          collection_id: collectionId,
          variant_count: 1,
          created_at: date.toISOString(),
          sales_channels: [{ id: channelId, name: "Online" }],
        },
      ],
      count: 23,
      offset: 7,
      limit: 5,
    });
    expect(deps.listProducts).toHaveBeenCalledWith({
      query: undefined,
      status: "published",
      collectionId,
      categoryId,
      salesChannelId: channelId,
      offset: 7,
      limit: 5,
      sortBy: "title",
      sortOrder: "asc",
      page: 2,
    });
  });

  it("rejects invalid product filters before accessing the DAL", async () => {
    const deps = dependencies();
    const response = await handleAdminProductsRequest(
      new Request(
        "https://shop.test/api/admin/products?status=active&limit=101",
      ),
      deps,
    );

    expect(response.status).toBe(400);
    expect(deps.listProducts).not.toHaveBeenCalled();
  });

  it("retrieves product associations and variants", async () => {
    const deps = dependencies();
    const response = await handleAdminProductsRequest(
      new Request(`https://shop.test/api/admin/products/${productId}`),
      deps,
    );
    const body = (await response.json()) as {
      product: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(body.product).toMatchObject({
      id: productId,
      created_by: "admin-1",
      shipping_profile: { id: "shipping-profile-1", name: "Default" },
      options: [{ title: "Size", values: [{ value: "M" }] }],
      images: [{ id: "asset-1", url: "https://assets.test/shirt.png" }],
      categories: [{ id: categoryId, name: "Tops" }],
      variants: [
        {
          id: "f4699221-a57c-4cbd-abcc-149909208570",
          sku: "SHIRT-M",
          prices: [{ currency_code: "twd", amount: 1200 }],
        },
      ],
      variants_count: 1,
    });
    expect(deps.listVariants).toHaveBeenCalledWith({
      productId,
      sortBy: "createdAt",
      sortOrder: "asc",
      page: 1,
      limit: 200,
    });
  });

  it("lists product variants with exact Medusa-style offset pagination", async () => {
    const deps = dependencies();
    const response = await handleAdminProductsRequest(
      new Request(
        `https://shop.test/api/admin/products/${productId}/variants?q=shirt&offset=3&limit=5&order=-updated_at`,
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      variants: [
        {
          id: variant.id,
          product_id: productId,
          options: [{ id: "b97b8c46-f9b6-4071-9fb6-a2bec78e5594", value: "M" }],
          prices: [{ currency_code: "twd", amount: 1200 }],
        },
      ],
      count: 1,
      offset: 3,
      limit: 5,
    });
    expect(deps.listVariants).toHaveBeenCalledWith({
      productId,
      query: "shirt",
      offset: 3,
      limit: 5,
      page: 1,
      sortBy: "updatedAt",
      sortOrder: "desc",
    });
  });

  it("creates a product variant from Medusa option names and price fields", async () => {
    const deps = dependencies();
    const response = await handleAdminProductsRequest(
      new Request(
        `https://shop.test/api/admin/products/${productId}/variants`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "M",
            sku: "SHIRT-M-NEW",
            options: { Size: "M" },
            manage_inventory: false,
            prices: [{ currency_code: "twd", amount: 1300 }],
          }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(201);
    expect(deps.createVariant).toHaveBeenCalledWith(
      expect.objectContaining({
        productId,
        title: "M",
        sku: "SHIRT-M-NEW",
        optionValueIds: ["b97b8c46-f9b6-4071-9fb6-a2bec78e5594"],
        manageInventory: false,
        prices: [{ currencyCode: "twd", amount: 1300 }],
      }),
      "admin-1",
    );
  });

  it("rejects variant mutations when the variant belongs to another product", async () => {
    const deps = dependencies({
      findVariant: vi.fn(async () => ({ ...variant, productId: collectionId })),
    });
    const response = await handleAdminProductsRequest(
      new Request(
        `https://shop.test/api/admin/products/${productId}/variants/${variant.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Changed" }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(404);
    expect(deps.updateVariant).not.toHaveBeenCalled();
  });

  it("updates and deletes a product variant through the shared write service", async () => {
    const deps = dependencies();
    const updated = await handleAdminProductsRequest(
      new Request(
        `https://shop.test/api/admin/products/${productId}/variants/${variant.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "Updated M",
            options: { Size: "M" },
            prices: [{ currency_code: "twd", amount: 1400 }],
          }),
        },
      ),
      deps,
    );
    const deleted = await handleAdminProductsRequest(
      new Request(
        `https://shop.test/api/admin/products/${productId}/variants/${variant.id}`,
        { method: "DELETE" },
      ),
      deps,
    );

    expect(updated.status).toBe(200);
    expect(deps.updateVariant).toHaveBeenCalledWith(
      expect.objectContaining({
        id: variant.id,
        title: "Updated M",
        optionValueIds: ["b97b8c46-f9b6-4071-9fb6-a2bec78e5594"],
        prices: [{ currencyCode: "twd", amount: 1400 }],
      }),
      "admin-1",
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      id: variant.id,
      object: "product_variant",
      deleted: true,
    });
    expect(deps.deleteVariants).toHaveBeenCalledWith(
      { ids: [variant.id] },
      "admin-1",
    );
  });

  it("batches variant inventory item changes through one kit replacement", async () => {
    const itemA = "2bc25e0e-6c0d-47e1-af8f-0a4eead279a1";
    const itemB = "2bc25e0e-6c0d-47e1-af8f-0a4eead279a2";
    const itemC = "2bc25e0e-6c0d-47e1-af8f-0a4eead279a3";
    const kitVariant = {
      ...variant,
      inventoryKit: [
        {
          inventoryItemId: itemA,
          title: "Frame",
          sku: "FRAME",
          unitOfMeasure: "kg",
          requiredQuantity: 1,
        },
        {
          inventoryItemId: itemB,
          title: "Wheel",
          sku: "WHEEL",
          unitOfMeasure: "kg",
          requiredQuantity: 2,
        },
      ],
    };
    const deps = dependencies({
      findVariant: vi.fn(async () => kitVariant),
    });
    const response = await handleAdminProductsRequest(
      new Request(
        `https://shop.test/api/admin/products/${productId}/variants/inventory-items/batch`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            create: [
              {
                variant_id: variant.id,
                inventory_item_id: itemC,
                required_quantity: 1,
              },
            ],
            update: [
              {
                variant_id: variant.id,
                inventory_item_id: itemA,
                required_quantity: 3,
              },
            ],
            delete: [{ variant_id: variant.id, inventory_item_id: itemB }],
          }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.updateInventoryKits).toHaveBeenCalledWith(
      [
        {
          productId,
          variantId: variant.id,
          expectedUpdatedAt: date.toISOString(),
          items: [
            { inventoryItemId: itemA, requiredQuantity: 3 },
            { inventoryItemId: itemC, requiredQuantity: 1 },
          ],
        },
      ],
      "admin-1",
    );
    expect(await response.json()).toMatchObject({
      created: [
        {
          variant_id: variant.id,
          inventory_item_id: itemC,
          required_quantity: 1,
        },
      ],
      updated: [
        {
          variant_id: variant.id,
          inventory_item_id: itemA,
          required_quantity: 3,
        },
      ],
      deleted: [{ variant_id: variant.id, inventory_item_id: itemB }],
    });
  });

  it("supports Medusa-style single inventory-item association routes", async () => {
    const itemId = "2bc25e0e-6c0d-47e1-af8f-0a4eead279a1";
    const updatedVariant = {
      ...variant,
      inventoryKit: [
        {
          inventoryItemId: itemId,
          title: "Frame",
          sku: "FRAME",
          unitOfMeasure: "kg",
          requiredQuantity: 0.375,
        },
      ],
    };
    const deps = dependencies({
      findVariant: vi
        .fn()
        .mockResolvedValueOnce(variant)
        .mockResolvedValueOnce(updatedVariant),
    });
    const response = await handleAdminProductsRequest(
      new Request(
        `https://shop.test/api/admin/products/${productId}/variants/${variant.id}/inventory-items`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            inventory_item_id: itemId,
            required_quantity: 0.375,
          }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.updateInventoryKits).toHaveBeenCalledWith(
      [
        {
          productId,
          variantId: variant.id,
          expectedUpdatedAt: date.toISOString(),
          items: [{ inventoryItemId: itemId, requiredQuantity: 0.375 }],
        },
      ],
      "admin-1",
    );
    expect(await response.json()).toMatchObject({
      variant: {
        inventory_items: [
          {
            inventory_item_id: itemId,
            required_quantity: 0.375,
            inventory: {
              id: itemId,
              title: "Frame",
              sku: "FRAME",
              unit_of_measure: "kg",
            },
          },
        ],
      },
    });
  });

  it("rejects malformed IDs and returns 404 for missing products", async () => {
    const deps = dependencies({ findProduct: vi.fn(async () => null) });
    const invalid = await handleAdminProductsRequest(
      new Request("https://shop.test/api/admin/products/nope"),
      deps,
    );
    const missing = await handleAdminProductsRequest(
      new Request(`https://shop.test/api/admin/products/${productId}`),
      deps,
    );

    expect(invalid.status).toBe(400);
    expect(missing.status).toBe(404);
    expect(deps.listVariants).not.toHaveBeenCalled();
  });

  it("creates products with Medusa-style snake-case inputs and returns the product", async () => {
    const deps = dependencies();
    const response = await handleAdminProductsRequest(
      new Request("https://shop.test/api/admin/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "New Shirt",
          collection_id: collectionId,
          sales_channel_ids: [channelId],
          options: [{ title: "Size", values: ["M"] }],
          prices: [{ currency_code: "twd", amount: 1200 }],
        }),
      }),
      deps,
    );

    expect(response.status).toBe(201);
    expect(deps.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New Shirt",
        collectionId,
        salesChannelIds: [channelId],
        prices: [{ currencyCode: "twd", amount: 1200 }],
      }),
      "admin-1",
    );
    expect(deps.findProduct).toHaveBeenCalledWith(productId);
  });

  it("updates and archives a product through the shared write service", async () => {
    const deps = dependencies();
    const updateResponse = await handleAdminProductsRequest(
      new Request(`https://shop.test/api/admin/products/${productId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Updated Shirt",
          shipping_profile_id: "646aa7ce-8afb-4252-a6f0-c98456b5791c",
        }),
      }),
      deps,
    );
    const archiveResponse = await handleAdminProductsRequest(
      new Request(`https://shop.test/api/admin/products/${productId}/archive`, {
        method: "POST",
      }),
      deps,
    );

    expect(updateResponse.status).toBe(200);
    expect(deps.updateProduct).toHaveBeenNthCalledWith(
      1,
      {
        id: productId,
        title: "Updated Shirt",
        shippingProfileId: "646aa7ce-8afb-4252-a6f0-c98456b5791c",
      },
      "admin-1",
    );
    expect(archiveResponse.status).toBe(200);
    expect(deps.updateProduct).toHaveBeenNthCalledWith(
      2,
      { id: productId, status: "archived" },
      "admin-1",
    );
  });

  it("soft-deletes products and rejects product writes from non-admin roles", async () => {
    const deps = dependencies();
    const deleted = await handleAdminProductsRequest(
      new Request(`https://shop.test/api/admin/products/${productId}`, {
        method: "DELETE",
      }),
      deps,
    );
    const restrictedDeps = dependencies({
      authorize: vi.fn(async () => ({
        allowed: true as const,
        userId: "user-1",
        role: "user",
      })),
    });
    const restricted = await handleAdminProductsRequest(
      new Request("https://shop.test/api/admin/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Blocked" }),
      }),
      restrictedDeps,
    );

    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      id: productId,
      object: "product",
      deleted: true,
    });
    expect(deps.deleteProducts).toHaveBeenCalledWith(
      { ids: [productId] },
      "admin-1",
    );
    expect(restricted.status).toBe(403);
    expect(restrictedDeps.createProduct).not.toHaveBeenCalled();
  });
});
