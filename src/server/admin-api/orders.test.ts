import { describe, expect, it, vi } from "vitest";
import type { OrderDetailDTO, OrderListDTO } from "@/lib/order/dto/order.dto";
import {
  handleAdminOrdersRequest,
  type AdminOrdersApiDependencies,
} from "./orders";

const orderId = "6fa459ea-ee8a-3ca4-894e-db77e160355e";
const fulfillmentId = "a20a3e44-0f4e-4ad0-8bd8-b78f0c5c9469";
const locationId = "b6cfd2d3-10d2-4eca-a27b-f6e217b0bc8c";
const itemId = "23b0ce93-fffb-4f2b-8ab2-3e87c14935f1";
const listOrder: OrderListDTO = {
  id: orderId,
  displayId: 42,
  status: "completed",
  email: "customer@example.com",
  currencyCode: "twd",
  isDraftOrder: false,
  total: 1250,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const fulfillment = {
  id: fulfillmentId,
  locationId,
  labels: [],
  shippedAt: null,
  deliveredAt: null,
  canceledAt: null,
  items: [{ id: itemId, lineItemId: itemId, title: "Test item", quantity: 1 }],
};

const dependencies = (
  overrides: Partial<AdminOrdersApiDependencies> = {},
): AdminOrdersApiDependencies => ({
  authorize: vi.fn(async () => ({ allowed: true as const })),
  listOrders: vi.fn(async () => ({ orders: [listOrder], total: 1 })),
  findOrder: vi.fn(
    async () =>
      ({
        ...listOrder,
        version: 2,
        noNotification: false,
        metadata: {},
        customerId: "4c5b7a2e-5684-4e61-b7f1-2af5e44e623f",
        regionId: null,
        salesChannelId: "cc90d0f8-c0de-45cb-9531-04d21ef3a1d3",
        hasUnfulfilledItems: false,
        shippingAddress: {
          firstName: "Lin",
          lastName: "Test",
          company: null,
          address1: "1 Main Street",
          address2: null,
          city: "Taipei",
          province: null,
          postalCode: "100",
          countryCode: "tw",
          phone: null,
        },
        billingAddress: null,
        creditLines: [],
        payment: {
          authorizedAmount: 1250,
          capturedAmount: 1250,
          refundedAmount: 0,
          status: "captured",
        },
      }) satisfies OrderDetailDTO,
  ),
  cancelOrder: vi.fn(async () => ({ success: true as const })),
  listOrderFulfillments: vi.fn(async () => ({
    fulfillments: [fulfillment],
    total: 1,
  })),
  findOrderFulfillment: vi.fn(async () => fulfillment),
  createFulfillment: vi.fn(async () => ({
    success: true as const,
    fulfillmentId,
  })),
  cancelFulfillment: vi.fn(async () => ({
    success: true as const,
    fulfillmentId,
  })),
  markFulfillmentShipped: vi.fn(async () => ({
    success: true as const,
    fulfillmentId,
  })),
  markFulfillmentDelivered: vi.fn(async () => ({
    success: true as const,
    fulfillmentId,
  })),
  ...overrides,
});

const json = (response: Response) => response.json() as Promise<unknown>;

describe("Medusa-shaped Admin orders API", () => {
  it("lists orders with offset pagination, search, and snake_case fields", async () => {
    const deps = dependencies();
    const response = await handleAdminOrdersRequest(
      new Request(
        "https://morph.test/api/admin/orders?q=customer&offset=20&limit=10&order=updated_at",
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.listOrders).toHaveBeenCalledWith({
      query: "customer",
      offset: 20,
      limit: 10,
      sortBy: "updatedAt",
      sortOrder: "asc",
      page: 1,
    });
    expect(await json(response)).toEqual({
      orders: [
        {
          id: orderId,
          display_id: 42,
          status: "completed",
          email: "customer@example.com",
          currency_code: "twd",
          is_draft_order: false,
          total: 1250,
          created_at: "2026-09-27T00:00:00.000Z",
          updated_at: "2026-09-27T00:00:00.000Z",
        },
      ],
      count: 1,
      offset: 20,
      limit: 10,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects invalid query values before reading orders", async () => {
    const deps = dependencies();
    const response = await handleAdminOrdersRequest(
      new Request("https://morph.test/api/admin/orders?limit=1000"),
      deps,
    );

    expect(response.status).toBe(400);
    expect(deps.listOrders).not.toHaveBeenCalled();
  });

  it("requires a commerce session and rejects users without commerce access", async () => {
    const unauthorized = dependencies({
      authorize: vi.fn(async () => ({
        allowed: false as const,
        status: 401 as const,
        error: "UNAUTHORIZED" as const,
        message: "Sign in required",
      })),
    });
    const forbidden = dependencies({
      authorize: vi.fn(async () => ({
        allowed: false as const,
        status: 403 as const,
        error: "FORBIDDEN" as const,
        message: "Commerce access required",
      })),
    });

    const unauthorizedResponse = await handleAdminOrdersRequest(
      new Request("https://morph.test/api/admin/orders"),
      unauthorized,
    );
    const forbiddenResponse = await handleAdminOrdersRequest(
      new Request("https://morph.test/api/admin/orders"),
      forbidden,
    );

    expect(unauthorizedResponse.status).toBe(401);
    expect(forbiddenResponse.status).toBe(403);
    expect(unauthorized.listOrders).not.toHaveBeenCalled();
    expect(forbidden.listOrders).not.toHaveBeenCalled();
  });

  it("returns order detail in the Admin API field shape", async () => {
    const deps = dependencies();
    const response = await handleAdminOrdersRequest(
      new Request(`https://morph.test/api/admin/orders/${orderId}`),
      deps,
    );
    const payload = await json(response);

    expect(response.status).toBe(200);
    expect(deps.findOrder).toHaveBeenCalledWith(orderId);
    if (!payload || typeof payload !== "object" || !("order" in payload)) {
      throw new Error("Expected an order object in the API response");
    }
    expect(payload.order).toMatchObject({
      display_id: 42,
      currency_code: "twd",
      is_draft_order: false,
      customer_id: "4c5b7a2e-5684-4e61-b7f1-2af5e44e623f",
      sales_channel_id: "cc90d0f8-c0de-45cb-9531-04d21ef3a1d3",
      shipping_address: {
        first_name: "Lin",
        address_1: "1 Main Street",
        postal_code: "100",
        country_code: "tw",
      },
      payment: {
        authorized_amount: 1250,
        captured_amount: 1250,
        refunded_amount: 0,
        status: "captured",
      },
    });
  });

  it("returns not found for unknown orders and routes", async () => {
    const deps = dependencies({ findOrder: vi.fn(async () => null) });
    const missingOrder = await handleAdminOrdersRequest(
      new Request(`https://morph.test/api/admin/orders/${orderId}`),
      deps,
    );
    const missingRoute = await handleAdminOrdersRequest(
      new Request("https://morph.test/api/admin/products"),
      deps,
    );

    expect(missingOrder.status).toBe(404);
    expect(missingRoute.status).toBe(404);
  });

  it("requires customer-reviewed order edits for order changes", async () => {
    const deps = dependencies();
    const response = await handleAdminOrdersRequest(
      new Request(`https://morph.test/api/admin/orders/${orderId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "updated@example.com" }),
      }),
      deps,
    );

    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({
      error: "ORDER_EDIT_REQUIRED",
    });
  });

  it("maps canceled-order business guards to conflicts", async () => {
    const deps = dependencies({
      cancelOrder: vi.fn(async () => ({
        success: false as const,
        reason: "PAYMENT_CAPTURED" as const,
      })),
    });
    const response = await handleAdminOrdersRequest(
      new Request(`https://morph.test/api/admin/orders/${orderId}/cancel`, {
        method: "POST",
      }),
      deps,
    );

    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({ error: "PAYMENT_CAPTURED" });
    expect(deps.findOrder).not.toHaveBeenCalled();
  });

  it("lists and creates order fulfillments using snake_case REST fields", async () => {
    const deps = dependencies();
    const listResponse = await handleAdminOrdersRequest(
      new Request(
        `https://morph.test/api/admin/orders/${orderId}/fulfillments?offset=5&limit=10`,
      ),
      deps,
    );
    const createResponse = await handleAdminOrdersRequest(
      new Request(
        `https://morph.test/api/admin/orders/${orderId}/fulfillments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            location_id: locationId,
            items: [{ id: itemId, quantity: 1 }],
          }),
        },
      ),
      deps,
    );

    expect(listResponse.status).toBe(200);
    expect(await json(listResponse)).toMatchObject({
      fulfillments: [{ id: fulfillmentId, location_id: locationId }],
      count: 1,
      limit: 10,
    });
    expect(deps.listOrderFulfillments).toHaveBeenCalledWith({
      orderId,
      offset: 5,
      limit: 10,
      page: 1,
    });
    expect(createResponse.status).toBe(200);
    expect(deps.createFulfillment).toHaveBeenCalledWith(
      { orderId, locationId, items: [{ itemId, quantity: 1 }] },
      undefined,
    );
    expect(await json(createResponse)).toMatchObject({
      fulfillment: { id: fulfillmentId, location_id: locationId },
    });
  });

  it("scopes fulfillment actions to the path order and persists shipment labels", async () => {
    const deps = dependencies();
    const response = await handleAdminOrdersRequest(
      new Request(
        `https://morph.test/api/admin/orders/${orderId}/fulfillments/${fulfillmentId}/shipments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            labels: [
              {
                tracking_number: "TW123456",
                tracking_url: "https://carrier.test/track/TW123456",
              },
            ],
          }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.markFulfillmentShipped).toHaveBeenCalledWith({
      orderId,
      fulfillmentId,
      actorId: undefined,
      labels: [
        {
          trackingNumber: "TW123456",
          trackingUrl: "https://carrier.test/track/TW123456",
          labelUrl: "",
        },
      ],
    });
  });

  it("does not accept mutations on this read-only slice", async () => {
    const deps = dependencies();
    const response = await handleAdminOrdersRequest(
      new Request("https://morph.test/api/admin/orders", { method: "POST" }),
      deps,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(deps.listOrders).not.toHaveBeenCalled();
  });
});
