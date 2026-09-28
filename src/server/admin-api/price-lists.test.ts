import type {
  PriceListDTO,
  PriceListPriceDTO,
} from "@/lib/pricing/dto/price-list.dto";
import { describe, expect, it, vi } from "vitest";
import {
  handleAdminPriceListsRequest,
  type AdminPriceListsApiDependencies,
} from "./price-lists";

const priceListId = "c31f09f6-8d9b-4f3e-94d8-047bb63376e2";
const customerGroupId = "ab09cb0e-89bb-4b48-83d0-e634ad6a6bda";
const regionId = "e3f98d22-bd04-4eca-a95b-2d3bcce46121";
const productId = "8e839c64-06a7-460a-b123-8a4f223aca94";
const variantId = "90295e45-3128-44be-bf6b-5939e3189f41";
const priceId = "774e6b8a-8f0e-4a78-bda2-3b5810dc6450";

const priceList: PriceListDTO = {
  id: priceListId,
  title: "VIP sale",
  description: "VIP customers",
  status: "active",
  type: "sale",
  startsAt: "2026-09-01T00:00:00.000Z",
  endsAt: null,
  customerGroupIds: [customerGroupId],
  regionIds: [regionId],
  metadata: { source: "test" },
  priceCount: 1,
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const price: PriceListPriceDTO = {
  id: priceId,
  productId,
  variantId,
  productTitle: "Shirt",
  variantTitle: "Medium",
  sku: "SHIRT-M",
  currencyCode: "twd",
  amount: 900,
  minQuantity: 3,
  maxQuantity: 10,
  createdAt: "2026-09-01T00:00:00.000Z",
};

const dependencies = (
  overrides: Partial<AdminPriceListsApiDependencies> = {},
): AdminPriceListsApiDependencies => ({
  authorize: vi.fn(async () => ({
    allowed: true as const,
    userId: "admin-1",
    role: "admin",
  })),
  listPriceLists: vi.fn(async () => ({ priceLists: [priceList], total: 1 })),
  findPriceList: vi.fn(async () => priceList),
  listPriceListPrices: vi.fn(async () => ({ prices: [price], total: 1 })),
  createPriceList: vi.fn(async () => ({
    success: true as const,
    message: "Price list created",
    data: { id: priceListId },
  })),
  updatePriceList: vi.fn(async () => ({
    success: true as const,
    message: "Price list updated",
    data: { id: priceListId },
  })),
  archivePriceList: vi.fn(async () => ({
    success: true as const,
    message: "Price list archived",
    data: { id: priceListId },
  })),
  batchPriceListPrices: vi.fn(async () => ({
    success: true as const,
    message: "Prices updated",
    data: {
      created: [price],
      updated: [price],
      deleted: {
        ids: [priceId],
        object: "price" as const,
        deleted: true as const,
      },
    },
  })),
  ...overrides,
});

describe("Admin price lists API", () => {
  it("lists price lists with exact offset pagination and Medusa field names", async () => {
    const deps = dependencies();
    const response = await handleAdminPriceListsRequest(
      new Request(
        "https://shop.test/api/admin/price-lists?q=VIP&offset=3&limit=5&order=title&status=active",
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      price_lists: [
        {
          id: priceListId,
          title: "VIP sale",
          rules: {
            customer_group_id: [customerGroupId],
            region_id: [regionId],
          },
          starts_at: priceList.startsAt,
          price_count: 1,
        },
      ],
      count: 1,
      offset: 3,
      limit: 5,
    });
    expect(deps.listPriceLists).toHaveBeenCalledWith({
      query: "VIP",
      status: "active",
      type: undefined,
      offset: 3,
      limit: 5,
      page: 1,
      sortBy: "title",
      sortOrder: "asc",
    });
  });

  it("reads price list prices using exact offset and snake-case fields", async () => {
    const deps = dependencies();
    const response = await handleAdminPriceListsRequest(
      new Request(
        `https://shop.test/api/admin/price-lists/${priceListId}/prices?q=shirt&offset=3&limit=2&order=-amount`,
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      prices: [
        {
          id: priceId,
          variant_id: variantId,
          product_id: productId,
          currency_code: "twd",
          amount: 900,
          min_quantity: 3,
          max_quantity: 10,
        },
      ],
      count: 1,
      offset: 3,
      limit: 2,
    });
    expect(deps.listPriceListPrices).toHaveBeenCalledWith({
      priceListId,
      query: "shirt",
      offset: 3,
      limit: 2,
      page: 2,
      sortBy: "amount",
      sortOrder: "desc",
    });
  });

  it("creates a price list from Medusa-style date, customer-group, and region rules", async () => {
    const deps = dependencies();
    const response = await handleAdminPriceListsRequest(
      new Request("https://shop.test/api/admin/price-lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "VIP sale",
          status: "active",
          type: "sale",
          starts_at: "2026-09-01T00:00:00.000Z",
          rules: {
            customer_group_id: [customerGroupId],
            region_id: [regionId],
          },
        }),
      }),
      deps,
    );

    expect(response.status).toBe(201);
    expect(deps.createPriceList).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "VIP sale",
        status: "active",
        type: "sale",
        startsAt: "2026-09-01T00:00:00.000Z",
        customerGroupIds: [customerGroupId],
        regionIds: [regionId],
      }),
    );
  });

  it("updates only supplied fields and lets an empty rules object clear all rules", async () => {
    const deps = dependencies();
    const response = await handleAdminPriceListsRequest(
      new Request(`https://shop.test/api/admin/price-lists/${priceListId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Renamed", rules: {} }),
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.updatePriceList).toHaveBeenCalledWith({
      id: priceListId,
      title: "Renamed",
      customerGroupIds: [],
      regionIds: [],
    });
  });

  it("rejects unsupported price list rules rather than silently ignoring them", async () => {
    const response = await handleAdminPriceListsRequest(
      new Request("https://shop.test/api/admin/price-lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "VIP sale",
          rules: { customer_tag: ["vip"] },
        }),
      }),
      dependencies(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "INVALID_REQUEST",
      message: "This store supports customer group and region price list rules",
    });
  });

  it("batches price creates, updates, and deletes with Medusa field names", async () => {
    const deps = dependencies();
    const response = await handleAdminPriceListsRequest(
      new Request(
        `https://shop.test/api/admin/price-lists/${priceListId}/prices/batch`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            create: [
              {
                variant_id: variantId,
                currency_code: "TWD",
                amount: 850,
                min_quantity: 4,
              },
            ],
            update: [{ id: priceId, amount: 875, max_quantity: null }],
            delete: ["809e08b0-9fed-45b2-9320-9f92ac39c92a"],
          }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.batchPriceListPrices).toHaveBeenCalledWith(priceListId, {
      create: [
        {
          variantId,
          currencyCode: "twd",
          amount: 850,
          minQuantity: 4,
        },
      ],
      update: [{ id: priceId, amount: 875, maxQuantity: null }],
      delete: ["809e08b0-9fed-45b2-9320-9f92ac39c92a"],
    });
    expect(await response.json()).toMatchObject({
      created: [{ id: priceId, variant_id: variantId, currency_code: "twd" }],
      updated: [{ id: priceId, amount: 900 }],
      deleted: { ids: [priceId], object: "price", deleted: true },
    });
  });

  it("rejects unsupported price rules instead of silently dropping them", async () => {
    const deps = dependencies();
    const response = await handleAdminPriceListsRequest(
      new Request(
        `https://shop.test/api/admin/price-lists/${priceListId}/prices/batch`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            create: [
              {
                variant_id: variantId,
                currency_code: "twd",
                amount: 850,
                rules: { region_id: "region-1" },
              },
            ],
          }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(400);
    expect(deps.batchPriceListPrices).not.toHaveBeenCalled();
  });

  it("archives price lists and blocks writes for non-admin roles", async () => {
    const deps = dependencies();
    const deleted = await handleAdminPriceListsRequest(
      new Request(`https://shop.test/api/admin/price-lists/${priceListId}`, {
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
    const restricted = await handleAdminPriceListsRequest(
      new Request("https://shop.test/api/admin/price-lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Blocked" }),
      }),
      restrictedDeps,
    );

    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      id: priceListId,
      object: "price_list",
      deleted: true,
    });
    expect(deps.archivePriceList).toHaveBeenCalledWith(priceListId);
    expect(restricted.status).toBe(403);
    expect(restrictedDeps.createPriceList).not.toHaveBeenCalled();
  });
});
