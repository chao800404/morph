import type { SalesChannelDTO } from "@/lib/sales-channel/dto/sales-channel.dto";
import { describe, expect, it, vi } from "vitest";
import {
  handleAdminSalesChannelsRequest,
  type AdminSalesChannelsApiDependencies,
} from "./sales-channels";

const channelId = "23afdb65-4d5e-49d9-a61e-125eb6b9a836";
const productId = "86811451-df01-42e0-a35f-2383817c7bf6";

const channel: SalesChannelDTO & { productCount: number } = {
  id: channelId,
  name: "Online Store",
  type: "storefront",
  description: "Main storefront",
  isDisabled: false,
  metadata: { source: "test" },
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-02T00:00:00.000Z"),
  productCount: 4,
};

const dependencies = (
  overrides: Partial<AdminSalesChannelsApiDependencies> = {},
): AdminSalesChannelsApiDependencies => ({
  authorize: vi.fn(async () => ({
    allowed: true as const,
    userId: "admin-1",
    role: "admin",
  })),
  listSalesChannels: vi.fn(async () => ({ channels: [channel], total: 1 })),
  findSalesChannel: vi.fn(async () => channel),
  countProducts: vi.fn(async () => new Map([[channelId, 4]])),
  getDefaultSalesChannelId: vi.fn(async () => channelId),
  createSalesChannel: vi.fn(async () => ({
    success: true as const,
    message: "created",
    data: { id: channelId },
  })),
  updateSalesChannel: vi.fn(async () => ({
    success: true as const,
    message: "updated",
    data: { id: channelId },
  })),
  deleteSalesChannels: vi.fn(async () => ({
    success: true as const,
    message: "deleted",
    data: { count: 1 },
  })),
  addProducts: vi.fn(async () => ({
    success: true as const,
    message: "added",
    data: { id: channelId, count: 1 },
  })),
  removeProducts: vi.fn(async () => ({
    success: true as const,
    message: "removed",
    data: { id: channelId, count: 1 },
  })),
  ...overrides,
});

describe("Admin sales channels API", () => {
  it("lists with Medusa field names and exact offset pagination", async () => {
    const deps = dependencies();
    const response = await handleAdminSalesChannelsRequest(
      new Request(
        "https://shop.test/api/admin/sales-channels?q=Online&type=storefront&is_disabled=false&offset=3&limit=5&order=name",
      ),
      "sales-channels",
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sales_channels: [
        {
          id: channelId,
          name: "Online Store",
          is_disabled: false,
          is_default: true,
          product_count: 4,
          metadata: { source: "test" },
        },
      ],
      count: 1,
      offset: 3,
      limit: 5,
    });
    expect(deps.listSalesChannels).toHaveBeenCalledWith({
      query: "Online",
      type: "storefront",
      isDisabled: false,
      offset: 3,
      limit: 5,
      page: 1,
      sortBy: "name",
      sortOrder: "asc",
    });
  });

  it("creates with snake-case fields and returns the created sales channel", async () => {
    const deps = dependencies();
    const response = await handleAdminSalesChannelsRequest(
      new Request("https://shop.test/api/admin/sales-channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Online Store",
          type: "storefront",
          is_disabled: false,
          metadata: { source: "api" },
        }),
      }),
      "sales-channels",
      deps,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      sales_channel: { id: channelId, is_disabled: false },
    });
    expect(deps.createSalesChannel).toHaveBeenCalledWith({
      name: "Online Store",
      type: "storefront",
      description: undefined,
      isDisabled: false,
      metadata: { source: "api" },
    });
  });

  it("updates only supplied fields and rejects unknown input", async () => {
    const deps = dependencies();
    const response = await handleAdminSalesChannelsRequest(
      new Request(`https://shop.test/api/admin/sales-channels/${channelId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_disabled: true }),
      }),
      `sales-channels/${channelId}`,
      deps,
    );
    expect(response.status).toBe(200);
    expect(deps.updateSalesChannel).toHaveBeenCalledWith({
      id: channelId,
      isDisabled: true,
    });

    const invalid = await handleAdminSalesChannelsRequest(
      new Request("https://shop.test/api/admin/sales-channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Online", ignored: true }),
      }),
      "sales-channels",
      deps,
    );
    expect(invalid.status).toBe(400);
  });

  it("preserves the default-channel deletion guard", async () => {
    const deps = dependencies({
      deleteSalesChannels: vi.fn(async () => ({
        success: false as const,
        message: "The default sales channel cannot be deleted",
        data: null,
        error: "DEFAULT_CHANNEL",
      })),
    });
    const response = await handleAdminSalesChannelsRequest(
      new Request(`https://shop.test/api/admin/sales-channels/${channelId}`, {
        method: "DELETE",
      }),
      `sales-channels/${channelId}`,
      deps,
    );

    expect(response.status).toBe(409);
    expect(deps.deleteSalesChannels).toHaveBeenCalledWith({ ids: [channelId] });
  });

  it("adds and removes products through the batch route", async () => {
    const deps = dependencies();
    const add = await handleAdminSalesChannelsRequest(
      new Request(
        `https://shop.test/api/admin/sales-channels/${channelId}/products/batch`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ product_ids: [{ id: productId }] }),
        },
      ),
      `sales-channels/${channelId}/products/batch`,
      deps,
    );
    expect(add.status).toBe(200);
    expect(deps.addProducts).toHaveBeenCalledWith({
      salesChannelId: channelId,
      productIds: [productId],
    });

    const remove = await handleAdminSalesChannelsRequest(
      new Request(
        `https://shop.test/api/admin/sales-channels/${channelId}/products/batch`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ product_ids: [{ id: productId }] }),
        },
      ),
      `sales-channels/${channelId}/products/batch`,
      deps,
    );
    expect(remove.status).toBe(200);
    expect(deps.removeProducts).toHaveBeenCalledWith({
      salesChannelId: channelId,
      productIds: [productId],
    });
  });

  it("requires an admin before any write", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => ({
        allowed: true as const,
        userId: "user-1",
        role: "user",
      })),
    });
    const response = await handleAdminSalesChannelsRequest(
      new Request("https://shop.test/api/admin/sales-channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Online" }),
      }),
      "sales-channels",
      deps,
    );

    expect(response.status).toBe(403);
    expect(deps.createSalesChannel).not.toHaveBeenCalled();
  });
});
