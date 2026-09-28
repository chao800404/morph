import { describe, expect, it, vi } from "vitest";
import type { OrderReturnDTO } from "@/lib/order/dto/order.dto";
import {
  handleAdminReturnsRequest,
  type AdminReturnsApiDependencies,
} from "./returns";

const orderId = "6fa459ea-ee8a-3ca4-894e-db77e160355e";
const returnId = "a20a3e44-0f4e-4ad0-8bd8-b78f0c5c9469";
const returnItemId = "b6cfd2d3-10d2-4eca-a27b-f6e217b0bc8c";
const itemId = "23b0ce93-fffb-4f2b-8ab2-3e87c14935f1";
const locationId = "c51fd8d1-5eb7-41b4-84f8-a7d1e6ed0998";
const actorId = "4c5b7a2e-5684-4e61-b7f1-2af5e44e623f";

const orderReturn: OrderReturnDTO = {
  id: returnId,
  orderId,
  displayId: 12,
  claimId: null,
  exchangeId: null,
  status: "requested",
  locationId: null,
  requestedAt: "2026-09-27T00:00:00.000Z",
  receivedAt: null,
  canceledAt: null,
  items: [
    {
      id: returnItemId,
      itemId,
      reasonId: null,
      title: "Test product",
      sku: "TEST-1",
      quantity: 2,
      receivedQuantity: 0,
      damagedQuantity: 0,
      reason: null,
      note: null,
    },
  ],
};

const dependencies = (
  overrides: Partial<AdminReturnsApiDependencies> = {},
): AdminReturnsApiDependencies => ({
  authorize: vi.fn(async () => ({ allowed: true as const, userId: actorId })),
  listReturns: vi.fn(async () => ({ returns: [orderReturn], total: 1 })),
  findReturn: vi.fn(async () => orderReturn),
  createReturn: vi.fn(async () => ({
    success: true as const,
    returnId,
    displayId: 12,
  })),
  receiveReturn: vi.fn(async () => ({ success: true as const, returnId })),
  cancelReturn: vi.fn(async () => ({ success: true as const, returnId })),
  ...overrides,
});

const json = (response: Response) => response.json() as Promise<unknown>;

describe("Medusa-shaped Admin returns API", () => {
  it("lists returns with exact offset pagination and snake_case DTOs", async () => {
    const deps = dependencies();
    const response = await handleAdminReturnsRequest(
      new Request(
        "https://morph.test/api/admin/returns?order_id=" +
          orderId +
          "&status=requested&offset=5&limit=10",
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.listReturns).toHaveBeenCalledWith({
      orderId,
      status: "requested",
      offset: 5,
      limit: 10,
      page: 1,
    });
    expect(await json(response)).toMatchObject({
      returns: [
        {
          id: returnId,
          order_id: orderId,
          display_id: 12,
          status: "requested",
          items: [
            {
              id: returnItemId,
              item_id: itemId,
              received_quantity: 0,
              damaged_quantity: 0,
            },
          ],
        },
      ],
      count: 1,
      offset: 5,
      limit: 10,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("creates a return from the order route using the verified actor", async () => {
    const deps = dependencies();
    const response = await handleAdminReturnsRequest(
      new Request(`https://morph.test/api/admin/orders/${orderId}/returns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [{ id: itemId, quantity: 1, note: "Box was damaged" }],
        }),
      }),
      deps,
    );

    expect(response.status).toBe(201);
    expect(deps.createReturn).toHaveBeenCalledWith({
      orderId,
      createdBy: actorId,
      items: [{ itemId, quantity: 1, note: "Box was damaged" }],
    });
    expect(await json(response)).toMatchObject({
      return: { id: returnId, order_id: orderId },
    });
  });

  it("receives returned quantities and preserves the DAL inventory guard", async () => {
    const deps = dependencies();
    const response = await handleAdminReturnsRequest(
      new Request(`https://morph.test/api/admin/returns/${returnId}/receive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          location_id: locationId,
          items: [{ id: returnItemId, quantity: 2, damaged_quantity: 1 }],
        }),
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.receiveReturn).toHaveBeenCalledWith({
      returnId,
      locationId,
      items: [{ returnItemId, quantity: 2, damagedQuantity: 1 }],
    });
    expect(await json(response)).toMatchObject({ return: { id: returnId } });
  });

  it("does not cancel a return when the order-version guard reports a conflict", async () => {
    const deps = dependencies({
      cancelReturn: vi.fn(async () => ({
        success: false as const,
        reason: "CONFLICT" as const,
      })),
    });
    const response = await handleAdminReturnsRequest(
      new Request(`https://morph.test/api/admin/returns/${returnId}/cancel`, {
        method: "POST",
      }),
      deps,
    );

    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({ error: "CONFLICT" });
    expect(deps.cancelReturn).toHaveBeenCalledWith({
      returnId,
      canceledBy: actorId,
    });
    expect(deps.findReturn).not.toHaveBeenCalled();
  });

  it("requires an authenticated commerce actor before accepting writes", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => ({
        allowed: false as const,
        status: 403 as const,
        error: "FORBIDDEN" as const,
        message: "Commerce access required",
      })),
    });
    const response = await handleAdminReturnsRequest(
      new Request(`https://morph.test/api/admin/orders/${orderId}/returns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ id: itemId, quantity: 1 }] }),
      }),
      deps,
    );

    expect(response.status).toBe(403);
    expect(deps.createReturn).not.toHaveBeenCalled();
  });
});
