import { describe, expect, it, vi } from "vitest";
import type {
  OrderDetailDTO,
  OrderItemDTO,
  OrderListDTO,
} from "@/lib/order/dto/order.dto";
import {
  handleAdminDraftOrdersRequest,
  type AdminDraftOrdersApiDependencies,
} from "./draft-orders";

const orderId = "6fa459ea-ee8a-3ca4-894e-db77e160355e";
const variantId = "a20a3e44-0f4e-4ad0-8bd8-b78f0c5c9469";
const editId = "30bd4d5f-d832-493f-94fb-f4bd68a3df6d";
const timestamp = "2026-09-28T00:00:00.000Z";

const listDraft: OrderListDTO = {
  id: orderId,
  displayId: 44,
  status: "draft",
  email: "buyer@example.com",
  currencyCode: "twd",
  isDraftOrder: true,
  total: 1200,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const draft: OrderDetailDTO = {
  ...listDraft,
  version: 1,
  noNotification: false,
  metadata: {},
  customerId: null,
  regionId: null,
  salesChannelId: null,
  hasUnfulfilledItems: true,
  shippingAddress: null,
  billingAddress: null,
  creditLines: [],
  payment: null,
};

const item: OrderItemDTO = {
  id: variantId,
  variantId,
  title: "Everyday Tote",
  thumbnail: null,
  sku: "TOTE-01",
  isCustomPrice: false,
  quantity: 2,
  fulfilledQuantity: 0,
  unitPrice: 600,
};

const pendingEdit = {
  id: editId,
  orderId,
  version: 2,
  status: "pending",
  createdBy: "admin-1",
  requestedBy: null,
  requestedAt: null,
  updatedAt: timestamp,
  actions: [],
};

const dependencies = (
  overrides: Partial<AdminDraftOrdersApiDependencies> = {},
): AdminDraftOrdersApiDependencies => ({
  authorize: vi.fn(async () => ({ allowed: true as const })),
  listDraftOrders: vi.fn(async () => ({ orders: [listDraft], total: 1 })),
  findOrder: vi.fn(async () => draft),
  resolveRegionCurrencyCode: vi.fn(async () => "twd"),
  listItems: vi.fn(async () => [item]),
  listShippingMethods: vi.fn(async () => []),
  getDraftOrderEdit: vi.fn(async () => null),
  createDraftOrder: vi.fn(async () => ({
    success: true as const,
    message: "Draft created",
    data: { id: orderId, displayId: 44 },
  })),
  updateDraftOrder: vi.fn(async () => ({ success: true as const })),
  updateDraftOrderEditFields: vi.fn(async () => ({
    success: false as const,
    reason: "EDIT_NOT_FOUND" as const,
  })),
  deleteDraftOrder: vi.fn(async () => ({ success: true as const })),
  convertDraftOrder: vi.fn(async () => ({ success: true as const })),
  beginDraftOrderEdit: vi.fn(async () => ({
    success: false as const,
    reason: "EDIT_EXISTS" as const,
  })),
  addDraftOrderEditItems: vi.fn(async () => ({
    success: false as const,
    reason: "EDIT_NOT_FOUND" as const,
  })),
  updateDraftOrderEditItem: vi.fn(async () => ({
    success: false as const,
    reason: "EDIT_NOT_FOUND" as const,
  })),
  updateDraftOrderEditAction: vi.fn(async () => ({
    success: false as const,
    reason: "EDIT_NOT_FOUND" as const,
  })),
  removeDraftOrderEditItem: vi.fn(async () => ({
    success: false as const,
    reason: "EDIT_NOT_FOUND" as const,
  })),
  removeDraftOrderEditAction: vi.fn(async () => ({
    success: false as const,
    reason: "EDIT_NOT_FOUND" as const,
  })),
  addDraftOrderEditPromotions: vi.fn(async () => ({
    success: false as const,
    reason: "EDIT_NOT_FOUND" as const,
  })),
  removeDraftOrderEditPromotions: vi.fn(async () => ({
    success: false as const,
    reason: "EDIT_NOT_FOUND" as const,
  })),
  addDraftOrderEditShippingMethod: vi.fn(async () => ({
    success: false as const,
    reason: "EDIT_NOT_FOUND" as const,
  })),
  updateDraftOrderEditShippingMethod: vi.fn(async () => ({
    success: false as const,
    reason: "EDIT_NOT_FOUND" as const,
  })),
  updateDraftOrderEditShippingAction: vi.fn(async () => ({
    success: false as const,
    reason: "EDIT_NOT_FOUND" as const,
  })),
  removeDraftOrderEditShippingMethod: vi.fn(async () => ({
    success: false as const,
    reason: "EDIT_NOT_FOUND" as const,
  })),
  removeDraftOrderEditShippingAction: vi.fn(async () => ({
    success: false as const,
    reason: "EDIT_NOT_FOUND" as const,
  })),
  requestDraftOrderEdit: vi.fn(async () => ({
    success: false as const,
    reason: "EDIT_NOT_FOUND" as const,
  })),
  cancelDraftOrderEdit: vi.fn(async () => ({
    success: false as const,
    reason: "EDIT_NOT_FOUND" as const,
  })),
  confirmDraftOrderEdit: vi.fn(async () => ({
    success: false as const,
    reason: "EDIT_NOT_FOUND" as const,
  })),
  ...overrides,
});

const json = (response: Response) => response.json() as Promise<unknown>;

describe("Medusa-shaped Admin draft orders API", () => {
  it("lists only draft orders with offset pagination and snake_case fields", async () => {
    const deps = dependencies();
    const response = await handleAdminDraftOrdersRequest(
      new Request(
        "https://morph.test/api/admin/draft-orders?q=buyer&offset=20&limit=10&order=updated_at",
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.listDraftOrders).toHaveBeenCalledWith({
      query: "buyer",
      offset: 20,
      limit: 10,
      page: 3,
      sortBy: "updatedAt",
      sortOrder: "asc",
    });
    expect(await json(response)).toEqual({
      draft_orders: [
        {
          id: orderId,
          display_id: 44,
          status: "draft",
          email: "buyer@example.com",
          currency_code: "twd",
          is_draft_order: true,
          total: 1200,
          created_at: timestamp,
          updated_at: timestamp,
        },
      ],
      count: 1,
      offset: 20,
      limit: 10,
    });
  });

  it("creates a draft using the shared order service and returns its item snapshots", async () => {
    const deps = dependencies();
    const response = await handleAdminDraftOrdersRequest(
      new Request("https://morph.test/api/admin/draft-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "buyer@example.com",
          region_id: "4c5b7a2e-5684-4e61-b7f1-2af5e44e623f",
          shipping_address: { country_code: "TW", city: "Taipei" },
          items: [{ variant_id: variantId, quantity: 2 }],
        }),
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.createDraftOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "buyer@example.com",
        currencyCode: "twd",
        regionId: "4c5b7a2e-5684-4e61-b7f1-2af5e44e623f",
        shippingAddress: expect.objectContaining({
          countryCode: "tw",
          city: "Taipei",
        }),
        items: [
          {
            type: "variant",
            variantId,
            quantity: 2,
            customPrice: false,
          },
        ],
      }),
    );
    expect(await json(response)).toMatchObject({
      draft_order: {
        id: orderId,
        is_draft_order: true,
        items: [
          {
            variant_id: variantId,
            quantity: 2,
            unit_price: 600,
          },
        ],
      },
    });
  });

  it("rejects non-draft updates and returns the latest order after a successful update", async () => {
    const deps = dependencies();
    const response = await handleAdminDraftOrdersRequest(
      new Request(`https://morph.test/api/admin/draft-orders/${orderId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ no_notification: true }),
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.updateDraftOrder).toHaveBeenCalledWith({
      id: orderId,
      expectedUpdatedAt: timestamp,
      noNotification: true,
    });

    const nonDraft = dependencies({
      findOrder: vi.fn(async () => ({ ...draft, isDraftOrder: false })),
    });
    const rejected = await handleAdminDraftOrdersRequest(
      new Request(`https://morph.test/api/admin/draft-orders/${orderId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ no_notification: true }),
      }),
      nonDraft,
    );
    expect(rejected.status).toBe(404);
    expect(nonDraft.updateDraftOrder).not.toHaveBeenCalled();
  });

  it("converts a draft and returns the resulting order", async () => {
    const convertedOrder = {
      ...draft,
      isDraftOrder: false,
      status: "pending" as const,
    };
    const deps = dependencies({
      findOrder: vi.fn(async () => convertedOrder),
    });
    const response = await handleAdminDraftOrdersRequest(
      new Request(
        `https://morph.test/api/admin/draft-orders/${orderId}/convert-to-order`,
        { method: "POST" },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.convertDraftOrder).toHaveBeenCalledWith(orderId);
    expect(await json(response)).toMatchObject({
      order: { id: orderId, status: "pending", is_draft_order: false },
    });
  });

  it("deletes an active draft and returns the Medusa deletion shape", async () => {
    const deps = dependencies();
    const response = await handleAdminDraftOrdersRequest(
      new Request(`https://morph.test/api/admin/draft-orders/${orderId}`, {
        method: "DELETE",
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.deleteDraftOrder).toHaveBeenCalledWith(orderId, timestamp);
    expect(await json(response)).toEqual({
      id: orderId,
      object: "draft_order",
      deleted: true,
    });
  });

  it("refuses to delete a draft with payment or fulfillment activity", async () => {
    const deps = dependencies({
      deleteDraftOrder: vi.fn(async () => ({
        success: false as const,
        reason: "HAS_ACTIVITY" as const,
      })),
    });
    const response = await handleAdminDraftOrdersRequest(
      new Request(`https://morph.test/api/admin/draft-orders/${orderId}`, {
        method: "DELETE",
      }),
      deps,
    );

    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({ error: "HAS_ACTIVITY" });
  });

  it("begins a version-bound edit and returns its preview actions", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => ({
        allowed: true as const,
        userId: "admin-1",
      })),
      getDraftOrderEdit: vi.fn(async () => pendingEdit),
      beginDraftOrderEdit: vi.fn(async () => ({
        success: true as const,
        edit: pendingEdit,
      })),
    });
    const response = await handleAdminDraftOrdersRequest(
      new Request(`https://morph.test/api/admin/draft-orders/${orderId}/edit`, {
        method: "POST",
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.beginDraftOrderEdit).toHaveBeenCalledWith({
      orderId,
      expectedVersion: 1,
      actorId: "admin-1",
    });
    expect(await json(response)).toMatchObject({
      draft_order_preview: {
        order_change: { id: editId, status: "pending", actions: [] },
      },
    });
  });

  it("stages email, notification, and address changes on an edit", async () => {
    const deps = dependencies({
      updateDraftOrderEditFields: vi.fn(async () => ({
        success: true as const,
      })),
    });
    const response = await handleAdminDraftOrdersRequest(
      new Request(`https://morph.test/api/admin/draft-orders/${orderId}/edit`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "new@example.com",
          no_notification: true,
          shipping_address: {
            first_name: "Sam",
            country_code: "TW",
          },
        }),
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.updateDraftOrderEditFields).toHaveBeenCalledWith({
      orderId,
      email: "new@example.com",
      noNotification: true,
      shippingAddress: {
        firstName: "Sam",
        lastName: null,
        company: null,
        address1: null,
        address2: null,
        city: null,
        province: null,
        postalCode: null,
        countryCode: "tw",
        phone: null,
      },
    });
  });

  it("stages added items using Medusa snake_case request fields", async () => {
    const deps = dependencies({
      getDraftOrderEdit: vi.fn(async () => pendingEdit),
      addDraftOrderEditItems: vi.fn(async () => ({ success: true as const })),
    });
    const response = await handleAdminDraftOrdersRequest(
      new Request(
        `https://morph.test/api/admin/draft-orders/${orderId}/edit/items`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            items: [{ variant_id: variantId, quantity: 3 }],
          }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.addDraftOrderEditItems).toHaveBeenCalledWith(orderId, [
      { variantId, quantity: 3 },
    ]);
    expect(await json(response)).toMatchObject({
      draft_order_preview: { id: orderId },
    });
  });

  it("stages and removes promotion codes on an edit", async () => {
    const deps = dependencies({
      addDraftOrderEditPromotions: vi.fn(async () => ({
        success: true as const,
      })),
      removeDraftOrderEditPromotions: vi.fn(async () => ({
        success: true as const,
      })),
    });
    const post = await handleAdminDraftOrdersRequest(
      new Request(
        `https://morph.test/api/admin/draft-orders/${orderId}/edit/promotions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ promo_codes: ["  SAVE10  ", "FREESHIP"] }),
        },
      ),
      deps,
    );
    const remove = await handleAdminDraftOrdersRequest(
      new Request(
        `https://morph.test/api/admin/draft-orders/${orderId}/edit/promotions`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ promo_codes: ["SAVE10"] }),
        },
      ),
      deps,
    );

    expect(post.status).toBe(200);
    expect(remove.status).toBe(200);
    expect(deps.addDraftOrderEditPromotions).toHaveBeenCalledWith(orderId, [
      "SAVE10",
      "FREESHIP",
    ]);
    expect(deps.removeDraftOrderEditPromotions).toHaveBeenCalledWith(orderId, [
      "SAVE10",
    ]);
  });

  it("stages shipping methods and routes changes to current or pending methods", async () => {
    const deps = dependencies({
      addDraftOrderEditShippingMethod: vi.fn(async () => ({
        success: true as const,
      })),
      updateDraftOrderEditShippingMethod: vi.fn(async () => ({
        success: true as const,
      })),
      updateDraftOrderEditShippingAction: vi.fn(async () => ({
        success: true as const,
      })),
      removeDraftOrderEditShippingMethod: vi.fn(async () => ({
        success: true as const,
      })),
      removeDraftOrderEditShippingAction: vi.fn(async () => ({
        success: true as const,
      })),
    });
    const add = await handleAdminDraftOrdersRequest(
      new Request(
        `https://morph.test/api/admin/draft-orders/${orderId}/edit/shipping-methods`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            shipping_option_id: variantId,
            custom_amount: 180,
            description: "Evening delivery",
            internal_note: "Call on arrival",
          }),
        },
      ),
      deps,
    );
    const update = await handleAdminDraftOrdersRequest(
      new Request(
        `https://morph.test/api/admin/draft-orders/${orderId}/edit/shipping-methods/method/${variantId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ custom_amount: 220 }),
        },
      ),
      deps,
    );
    const remove = await handleAdminDraftOrdersRequest(
      new Request(
        `https://morph.test/api/admin/draft-orders/${orderId}/edit/shipping-methods/method/${variantId}`,
        { method: "DELETE" },
      ),
      deps,
    );
    const updatePending = await handleAdminDraftOrdersRequest(
      new Request(
        `https://morph.test/api/admin/draft-orders/${orderId}/edit/shipping-methods/${editId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description: "Pickup point" }),
        },
      ),
      deps,
    );
    const removePending = await handleAdminDraftOrdersRequest(
      new Request(
        `https://morph.test/api/admin/draft-orders/${orderId}/edit/shipping-methods/${editId}`,
        { method: "DELETE" },
      ),
      deps,
    );

    expect([
      add.status,
      update.status,
      remove.status,
      updatePending.status,
      removePending.status,
    ]).toEqual([200, 200, 200, 200, 200]);
    expect(deps.addDraftOrderEditShippingMethod).toHaveBeenCalledWith({
      orderId,
      shippingOptionId: variantId,
      customAmount: 180,
      description: "Evening delivery",
      internalNote: "Call on arrival",
    });
    expect(deps.updateDraftOrderEditShippingMethod).toHaveBeenCalledWith({
      orderId,
      methodId: variantId,
      customAmount: 220,
    });
    expect(deps.removeDraftOrderEditShippingMethod).toHaveBeenCalledWith({
      orderId,
      methodId: variantId,
    });
    expect(deps.updateDraftOrderEditShippingAction).toHaveBeenCalledWith({
      orderId,
      actionId: editId,
      description: "Pickup point",
    });
    expect(deps.removeDraftOrderEditShippingAction).toHaveBeenCalledWith({
      orderId,
      actionId: editId,
    });
  });

  it("confirms a staged edit with the verified administrator actor", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => ({
        allowed: true as const,
        userId: "admin-1",
      })),
      confirmDraftOrderEdit: vi.fn(async () => ({ success: true as const })),
    });
    const response = await handleAdminDraftOrdersRequest(
      new Request(
        `https://morph.test/api/admin/draft-orders/${orderId}/edit/confirm`,
        { method: "POST" },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({});
    expect(deps.confirmDraftOrderEdit).toHaveBeenCalledWith({
      orderId,
      actorId: "admin-1",
    });
  });

  it("requires admin access before touching draft order data", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => ({
        allowed: false as const,
        status: 403 as const,
        error: "FORBIDDEN" as const,
        message: "Commerce access required",
      })),
    });
    const response = await handleAdminDraftOrdersRequest(
      new Request("https://morph.test/api/admin/draft-orders"),
      deps,
    );

    expect(response.status).toBe(403);
    expect(deps.listDraftOrders).not.toHaveBeenCalled();
  });
});
