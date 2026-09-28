import type { OrderEditRequest } from "@/lib/order/dal/order-edit-request.dal";

type EditResult =
  | { success: true; edit: OrderEditRequest }
  | {
      success: false;
      reason:
        | "NOT_FOUND"
        | "NOT_ORDER"
        | "EDIT_EXISTS"
        | "EDIT_NOT_FOUND"
        | "EDIT_NOT_REQUESTED"
        | "CONFLICT"
        | "INVALID_ACTION"
        | "ITEM_EDIT_UNSUPPORTED";
    };

export type CustomerOrderEditsRequestDependencies = {
  findOwnedOrder(input: {
    orderId: string;
    customerId: string;
    email: string;
    salesChannelId: string | null;
  }): Promise<unknown | null>;
  getOrderEdit(orderId: string): Promise<OrderEditRequest | null>;
  acceptEdit(input: {
    orderId: string;
    editId: string;
    customerId: string;
    actorId: string;
    email: string;
    salesChannelId: string | null;
  }): Promise<EditResult>;
  declineEdit(input: {
    orderId: string;
    editId: string;
    customerId: string;
    actorId: string;
    email: string;
    salesChannelId: string | null;
  }): Promise<EditResult>;
};

const privateJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "access-control-allow-headers":
        "content-type, x-publishable-api-key, x-storefront-host",
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "access-control-allow-origin": "*",
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      vary: "x-publishable-api-key, x-storefront-host",
      "x-content-type-options": "nosniff",
    },
  });

const failureResponse = (reason: string) => {
  const status =
    reason === "NOT_FOUND" || reason === "EDIT_NOT_FOUND"
      ? 404
      : reason === "NOT_ORDER" || reason === "INVALID_ACTION"
        ? 422
        : reason === "ITEM_EDIT_UNSUPPORTED"
          ? 422
          : 409;
  const message =
    {
      NOT_FOUND: "Order not found",
      NOT_ORDER: "This order cannot be edited",
      EDIT_EXISTS: "An order edit is already waiting for a response",
      EDIT_NOT_FOUND: "No active order edit exists",
      EDIT_NOT_REQUESTED: "This order edit is no longer awaiting a response",
      CONFLICT: "The order changed while the edit was being processed",
      INVALID_ACTION: "The order edit contains invalid properties",
      ITEM_EDIT_UNSUPPORTED:
        "This order has payment, promotion, fulfillment, or shipping activity that must be reconciled before its items can change",
    }[reason] ?? "Order edit request failed";
  return privateJson({ error: reason, message }, status);
};

const customerEditToApi = (edit: OrderEditRequest) => ({
  id: edit.id,
  order_id: edit.orderId,
  version: edit.version,
  status: edit.status,
  requested_at: edit.requestedAt,
  updated_at: edit.updatedAt,
  actions: edit.actions.map((action) => {
    const details =
      action.details &&
      typeof action.details === "object" &&
      !Array.isArray(action.details)
        ? action.details
        : {};
    const safeDetails = {
      ...(typeof details.email === "string" ? { email: details.email } : {}),
      ...(typeof details.noNotification === "boolean"
        ? { no_notification: details.noNotification }
        : {}),
      ...(typeof details.title === "string" &&
      typeof details.previousQuantity === "number"
        ? {
            title: details.title,
            previous_quantity: details.previousQuantity,
            ...(typeof details.quantity === "number"
              ? { quantity: details.quantity }
              : {}),
            ...(typeof details.previousOrderTotal === "number"
              ? { previous_order_total: details.previousOrderTotal }
              : {}),
            ...(typeof details.proposedOrderTotal === "number"
              ? { proposed_order_total: details.proposedOrderTotal }
              : {}),
            ...(action.action === "ITEM_REMOVE" ? { removed: true } : {}),
          }
        : {}),
    };
    return {
      id: action.id,
      action: action.action,
      ordering: action.ordering,
      details: safeDetails,
      applied: action.applied,
    };
  }),
});

/** Store API for customers to inspect, accept, or decline an order edit. */
export async function handleCustomerOrderEditsRequest(
  method: string,
  path: string,
  input: {
    customer: { id: string; userId: string; email: string };
    salesChannelId: string | null;
  },
  dependencies: CustomerOrderEditsRequestDependencies,
): Promise<Response | null> {
  const readMatch = /^customers\/me\/orders\/([^/]+)\/edits$/.exec(path);
  const actionMatch =
    /^customers\/me\/orders\/([^/]+)\/edits\/([^/]+)\/(confirm|decline)$/.exec(
      path,
    );
  if (!readMatch && !actionMatch) return null;
  const orderId = readMatch?.[1] ?? actionMatch?.[1];
  if (!orderId) return privateJson({ error: "NOT_FOUND" }, 404);

  const ownedOrder = await dependencies.findOwnedOrder({
    orderId,
    customerId: input.customer.id,
    email: input.customer.email,
    salesChannelId: input.salesChannelId,
  });
  if (!ownedOrder) return privateJson({ error: "NOT_FOUND" }, 404);

  if (readMatch) {
    if (method !== "GET")
      return privateJson(
        { error: "METHOD_NOT_ALLOWED", message: "Use GET" },
        405,
      );
    const edit = await dependencies.getOrderEdit(orderId);
    return privateJson({ order_edit: edit ? customerEditToApi(edit) : null });
  }

  if (method !== "POST")
    return privateJson(
      { error: "METHOD_NOT_ALLOWED", message: "Use POST" },
      405,
    );
  const editId = actionMatch?.[2];
  const action = actionMatch?.[3];
  if (!editId || (action !== "confirm" && action !== "decline"))
    return privateJson({ error: "NOT_FOUND" }, 404);

  const owner = {
    orderId,
    editId,
    customerId: input.customer.id,
    actorId: input.customer.userId,
    email: input.customer.email,
    salesChannelId: input.salesChannelId,
  };
  const result =
    action === "confirm"
      ? await dependencies.acceptEdit(owner)
      : await dependencies.declineEdit(owner);
  return result.success
    ? privateJson({ order_edit: customerEditToApi(result.edit) })
    : failureResponse(result.reason);
}
