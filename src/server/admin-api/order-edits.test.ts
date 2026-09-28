import { describe, expect, it, vi } from "vitest";
import type { OrderEditRequest } from "@/lib/order/dal/order-edit-request.dal";
import type { AdminOrderEditsDependencies } from "./order-edits";
import { handleAdminOrderEditsRequest } from "./order-edits";

const orderId = "6fa459ea-ee8a-3ca4-894e-db77e160355e";
const editId = "a20a3e44-0f4e-4ad0-8bd8-b78f0c5c9469";
const actorId = "b6cfd2d3-10d2-4eca-a27b-f6e217b0bc8c";
const edit: OrderEditRequest = {
  id: editId,
  orderId,
  version: 2,
  status: "requested",
  createdBy: actorId,
  requestedBy: actorId,
  requestedAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
  actions: [
    {
      id: "d6b12412-4117-4e27-a194-1893a08db98b",
      action: "ORDER_UPDATE",
      ordering: 0,
      reference: "order",
      referenceId: orderId,
      details: { email: "updated@example.com", noNotification: false },
      applied: false,
    },
  ],
};

const dependencies = (
  overrides: Partial<AdminOrderEditsDependencies> = {},
): AdminOrderEditsDependencies => ({
  authorize: vi.fn(async () => ({ allowed: true as const, userId: actorId })),
  get: vi.fn(async () => edit),
  request: vi.fn(async () => ({ success: true as const, edit })),
  cancel: vi.fn(async () => ({ success: true as const })),
  confirm: vi.fn(async () => ({
    success: true as const,
    edit: { ...edit, status: "confirmed" },
  })),
  ...overrides,
});

describe("Admin order edit API", () => {
  it("creates a customer-reviewed order change with the verified actor", async () => {
    const deps = dependencies();
    const response = await handleAdminOrderEditsRequest(
      new Request(`https://morph.test/api/admin/orders/${orderId}/edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "updated@example.com" }),
      }),
      deps,
    );

    expect(response?.status).toBe(201);
    expect(deps.request).toHaveBeenCalledWith({
      orderId,
      actorId,
      email: "updated@example.com",
    });
    expect(await response?.json()).toMatchObject({
      order_edit: { id: editId, order_id: orderId, status: "requested" },
    });
  });

  it("rejects malformed payloads before making a change", async () => {
    const deps = dependencies();
    const response = await handleAdminOrderEditsRequest(
      new Request(`https://morph.test/api/admin/orders/${orderId}/edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "bad", unexpected: true }),
      }),
      deps,
    );

    expect(response?.status).toBe(400);
    expect(deps.request).not.toHaveBeenCalled();
  });

  it("stages quantity reductions and item removals as separate edit actions", async () => {
    const deps = dependencies();
    const itemId = "eb2e92a4-7e3a-4f38-8e94-6a7a9e51110e";
    const removedItemId = "e831a115-a55d-441f-8794-8d03240423f5";
    const response = await handleAdminOrderEditsRequest(
      new Request(`https://morph.test/api/admin/orders/${orderId}/edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [
            { item_id: itemId, action: "ITEM_UPDATE", quantity: 1 },
            { item_id: removedItemId, action: "ITEM_REMOVE" },
          ],
        }),
      }),
      deps,
    );

    expect(response?.status).toBe(201);
    expect(deps.request).toHaveBeenCalledWith({
      orderId,
      actorId,
      itemChanges: [
        { itemId, action: "ITEM_UPDATE", quantity: 1 },
        { itemId: removedItemId, action: "ITEM_REMOVE" },
      ],
    });
  });

  it("rejects duplicate line changes before creating an edit", async () => {
    const deps = dependencies();
    const itemId = "eb2e92a4-7e3a-4f38-8e94-6a7a9e51110e";
    const response = await handleAdminOrderEditsRequest(
      new Request(`https://morph.test/api/admin/orders/${orderId}/edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [
            { item_id: itemId, action: "ITEM_REMOVE" },
            { item_id: itemId, action: "ITEM_UPDATE", quantity: 1 },
          ],
        }),
      }),
      deps,
    );

    expect(response?.status).toBe(400);
    expect(deps.request).not.toHaveBeenCalled();
  });

  it("force-confirms and cancels only the active requested edit", async () => {
    const confirmDependencies = dependencies();
    const confirmed = await handleAdminOrderEditsRequest(
      new Request(
        `https://morph.test/api/admin/orders/${orderId}/edit/confirm`,
        { method: "POST" },
      ),
      confirmDependencies,
    );
    expect(confirmed?.status).toBe(200);
    expect(confirmDependencies.confirm).toHaveBeenCalledWith({
      orderId,
      editId,
      actorId,
    });
    expect(await confirmed?.json()).toMatchObject({
      order_edit: { status: "confirmed" },
    });

    const cancelDependencies = dependencies();
    const canceled = await handleAdminOrderEditsRequest(
      new Request(`https://morph.test/api/admin/orders/${orderId}/edit`, {
        method: "DELETE",
      }),
      cancelDependencies,
    );
    expect(canceled?.status).toBe(200);
    expect(cancelDependencies.cancel).toHaveBeenCalledWith({
      orderId,
      editId,
      actorId,
    });
  });
});
