import { describe, expect, it, vi } from "vitest";
import type { OrderEditRequest } from "@/lib/order/dal/order-edit-request.dal";
import { handleCustomerOrderEditsRequest } from "./customer-order-edits-request";

const orderId = "6fa459ea-ee8a-3ca4-894e-db77e160355e";
const editId = "a20a3e44-0f4e-4ad0-8bd8-b78f0c5c9469";
const customer = {
  id: "b6cfd2d3-10d2-4eca-a27b-f6e217b0bc8c",
  userId: "23b0ce93-fffb-4f2b-8ab2-3e87c14935f1",
  email: "buyer@example.test",
};
const edit: OrderEditRequest = {
  id: editId,
  orderId,
  version: 2,
  status: "requested",
  createdBy: "admin-private-id",
  requestedBy: "admin-private-id",
  requestedAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
  actions: [
    {
      id: "d6b12412-4117-4e27-a194-1893a08db98b",
      action: "ORDER_UPDATE",
      ordering: 0,
      reference: "order",
      referenceId: orderId,
      details: { email: "updated@example.test", noNotification: true },
      applied: false,
    },
  ],
};

const dependencies = () => ({
  findOwnedOrder: vi.fn(async (): Promise<{ id: string } | null> => ({
    id: orderId,
  })),
  getOrderEdit: vi.fn(async () => edit),
  acceptEdit: vi.fn(async () => ({
    success: true as const,
    edit: { ...edit, status: "confirmed" },
  })),
  declineEdit: vi.fn(async () => ({
    success: true as const,
    edit: { ...edit, status: "declined" },
  })),
});

describe("customer order edit API", () => {
  it("checks ownership and returns only customer-safe edit details", async () => {
    const deps = dependencies();
    const response = await handleCustomerOrderEditsRequest(
      "GET",
      `customers/me/orders/${orderId}/edits`,
      { customer, salesChannelId: "channel-1" },
      deps,
    );

    expect(deps.findOwnedOrder).toHaveBeenCalledWith({
      orderId,
      customerId: customer.id,
      email: customer.email,
      salesChannelId: "channel-1",
    });
    expect(response?.status).toBe(200);
    const payload = await response?.json();
    expect(payload).toEqual({
      order_edit: {
        id: editId,
        order_id: orderId,
        version: 2,
        status: "requested",
        requested_at: edit.requestedAt,
        updated_at: edit.updatedAt,
        actions: [
          {
            id: edit.actions[0]?.id,
            action: "ORDER_UPDATE",
            ordering: 0,
            details: {
              email: "updated@example.test",
              no_notification: true,
            },
            applied: false,
          },
        ],
      },
    });
    expect(JSON.stringify(payload)).not.toContain("admin-private-id");
  });

  it("shows item changes without exposing internal line references", async () => {
    const itemEdit: OrderEditRequest = {
      ...edit,
      actions: [
        {
          id: "0b19ea67-a22d-4ee8-9eb3-5bccffef6a1e",
          action: "ITEM_UPDATE",
          ordering: 0,
          reference: "item",
          referenceId: "eb2e92a4-7e3a-4f38-8e94-6a7a9e51110e",
          details: {
            title: "Canvas Tote",
            previousQuantity: 3,
            quantity: 1,
            previousOrderTotal: 3500,
            proposedOrderTotal: 1200,
          },
          applied: false,
        },
        {
          id: "9ea393b2-4579-4152-a7c2-5f9a25f63428",
          action: "ITEM_REMOVE",
          ordering: 1,
          reference: "item",
          referenceId: "e831a115-a55d-441f-8794-8d03240423f5",
          details: { title: "Wool Cap", previousQuantity: 1 },
          applied: false,
        },
      ],
    };
    const deps = dependencies();
    deps.getOrderEdit.mockResolvedValue(itemEdit);
    const response = await handleCustomerOrderEditsRequest(
      "GET",
      `customers/me/orders/${orderId}/edits`,
      { customer, salesChannelId: "channel-1" },
      deps,
    );

    const payload = await response?.json();
    expect(payload).toMatchObject({
      order_edit: {
        actions: [
          {
            action: "ITEM_UPDATE",
            details: {
              title: "Canvas Tote",
              previous_quantity: 3,
              quantity: 1,
              previous_order_total: 3500,
              proposed_order_total: 1200,
            },
          },
          {
            action: "ITEM_REMOVE",
            details: {
              title: "Wool Cap",
              previous_quantity: 1,
              removed: true,
            },
          },
        ],
      },
    });
    expect(JSON.stringify(payload)).not.toContain("reference_id");
  });

  it("passes verified customer identity to the ownership-guarded accept action", async () => {
    const deps = dependencies();
    const response = await handleCustomerOrderEditsRequest(
      "POST",
      `customers/me/orders/${orderId}/edits/${editId}/confirm`,
      { customer, salesChannelId: "channel-1" },
      deps,
    );

    expect(deps.acceptEdit).toHaveBeenCalledWith({
      orderId,
      editId,
      customerId: customer.id,
      actorId: customer.userId,
      email: customer.email,
      salesChannelId: "channel-1",
    });
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      order_edit: { status: "confirmed" },
    });
  });

  it("hides edits for unowned orders and does not call mutation dependencies", async () => {
    const deps = dependencies();
    deps.findOwnedOrder.mockResolvedValue(null);
    const response = await handleCustomerOrderEditsRequest(
      "POST",
      `customers/me/orders/${orderId}/edits/${editId}/decline`,
      { customer, salesChannelId: "channel-1" },
      deps,
    );

    expect(response?.status).toBe(404);
    expect(deps.declineEdit).not.toHaveBeenCalled();
  });
});
