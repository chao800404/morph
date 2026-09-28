import type {
  OrderEditItemChangeInput,
  OrderEditRequest,
} from "@/lib/order/dal/order-edit-request.dal";
import type { AdminApiAccess } from "@/server/admin-api/orders";
import { z } from "zod";

type MutationResult =
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

export type AdminOrderEditsDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  get(orderId: string): Promise<OrderEditRequest | null>;
  request(input: {
    orderId: string;
    actorId: string;
    email?: string;
    noNotification?: boolean;
    itemChanges?: OrderEditItemChangeInput[];
  }): Promise<MutationResult>;
  cancel(input: {
    orderId: string;
    editId: string;
    actorId: string;
  }): Promise<{ success: true } | { success: false; reason: string }>;
  confirm(input: {
    orderId: string;
    editId: string;
    actorId: string;
  }): Promise<MutationResult>;
};

const privateJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });

const routeError = (error: string, message: string, status: number) =>
  privateJson({ error, message }, status);

const methodNotAllowed = (allow: string) =>
  new Response(
    JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: `Use ${allow}` }),
    {
      status: 405,
      headers: {
        allow,
        "cache-control": "private, no-store",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    },
  );

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const requestBodySchema = z
  .object({
    email: z.email().or(z.literal("")).optional(),
    no_notification: z.boolean().optional(),
    items: z
      .array(
        z.discriminatedUnion("action", [
          z
            .object({
              item_id: z.uuid(),
              action: z.literal("ITEM_UPDATE"),
              quantity: z.number().int().min(1).max(100_000),
            })
            .strict(),
          z
            .object({
              item_id: z.uuid(),
              action: z.literal("ITEM_REMOVE"),
            })
            .strict(),
        ]),
      )
      .max(40)
      .optional(),
  })
  .strict()
  .refine(
    (input) =>
      new Set((input.items ?? []).map((item) => item.item_id)).size ===
      (input.items ?? []).length,
    { path: ["items"], message: "Each order item may only be changed once" },
  )
  .refine(
    (input) =>
      input.email !== undefined ||
      input.no_notification !== undefined ||
      Boolean(input.items?.length),
  );

const actionToApi = (action: OrderEditRequest["actions"][number]) => ({
  id: action.id,
  action: action.action,
  ordering: action.ordering,
  reference: action.reference,
  reference_id: action.referenceId,
  details: action.details,
  applied: action.applied,
});

const editToApi = (edit: OrderEditRequest) => ({
  id: edit.id,
  order_id: edit.orderId,
  version: edit.version,
  status: edit.status,
  created_by: edit.createdBy,
  requested_by: edit.requestedBy,
  requested_at: edit.requestedAt,
  updated_at: edit.updatedAt,
  actions: edit.actions.map(actionToApi),
});

const failureResponse = (reason: string) => {
  const status =
    reason === "NOT_FOUND" || reason === "EDIT_NOT_FOUND"
      ? 404
      : reason === "NOT_ORDER" ||
          reason === "INVALID_ACTION" ||
          reason === "ITEM_EDIT_UNSUPPORTED"
        ? 422
        : reason === "CONFLICT" || reason === "EDIT_EXISTS"
          ? 409
          : 409;
  const message =
    {
      NOT_FOUND: "Order not found",
      NOT_ORDER: "Only active orders can have edit requests",
      EDIT_EXISTS: "An order edit is already waiting for a response",
      EDIT_NOT_FOUND: "No active order edit exists",
      EDIT_NOT_REQUESTED: "This order edit is no longer awaiting a response",
      CONFLICT: "The order changed while this edit was being confirmed",
      INVALID_ACTION: "The order edit contains invalid properties",
      ITEM_EDIT_UNSUPPORTED:
        "This order has payment, promotion, fulfillment, or shipping activity that must be reconciled before its items can change",
    }[reason] ?? "Order edit request failed";
  return routeError(reason, message, status);
};

/** Admin endpoints for customer-reviewed changes to non-draft order properties. */
export async function handleAdminOrderEditsRequest(
  request: Request,
  dependencies: AdminOrderEditsDependencies,
): Promise<Response | null> {
  let access: AdminApiAccess;
  try {
    access = await dependencies.authorize(request);
  } catch {
    access = {
      allowed: false,
      status: 401,
      error: "UNAUTHORIZED",
      message: "A signed-in commerce user is required",
    };
  }
  if (!access.allowed)
    return routeError(access.error, access.message, access.status);

  const path = new URL(request.url).pathname
    .replace(/^\/api\/admin\/?/, "")
    .replace(/\/$/, "");
  const match = /^orders\/([^/]+)\/edit(?:\/(confirm))?$/.exec(path);
  if (!match) return null;
  const orderId = z.uuid().safeParse(match[1] ?? "");
  if (!orderId.success)
    return routeError("INVALID_REQUEST", "Invalid order ID", 400);
  const confirmPath = match[2] === "confirm";
  const actorId = access.allowed ? access.userId : undefined;

  if (confirmPath) {
    if (request.method !== "POST") return methodNotAllowed("POST");
    if (!actorId)
      return routeError("FORBIDDEN", "A verified actor is required", 403);
    const edit = await dependencies.get(orderId.data);
    if (!edit) return failureResponse("EDIT_NOT_FOUND");
    const result = await dependencies.confirm({
      orderId: orderId.data,
      editId: edit.id,
      actorId,
    });
    return result.success
      ? privateJson({ order_edit: editToApi(result.edit) })
      : failureResponse(result.reason);
  }

  if (request.method === "GET") {
    const edit = await dependencies.get(orderId.data);
    return edit
      ? privateJson({ order_edit: editToApi(edit) })
      : privateJson({ order_edit: null });
  }
  if (request.method === "POST") {
    if (!actorId)
      return routeError("FORBIDDEN", "A verified actor is required", 403);
    const parsed = requestBodySchema.safeParse(await readJson(request));
    if (!parsed.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid order edit request",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    const result = await dependencies.request({
      orderId: orderId.data,
      actorId,
      ...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}),
      ...(parsed.data.no_notification !== undefined
        ? { noNotification: parsed.data.no_notification }
        : {}),
      ...(parsed.data.items?.length
        ? {
            itemChanges: parsed.data.items.map((item) =>
              item.action === "ITEM_UPDATE"
                ? {
                    itemId: item.item_id,
                    action: item.action,
                    quantity: item.quantity,
                  }
                : { itemId: item.item_id, action: item.action },
            ),
          }
        : {}),
    });
    return result.success
      ? privateJson({ order_edit: editToApi(result.edit) }, 201)
      : failureResponse(result.reason);
  }
  if (request.method === "DELETE") {
    if (!actorId)
      return routeError("FORBIDDEN", "A verified actor is required", 403);
    const edit = await dependencies.get(orderId.data);
    if (!edit) return failureResponse("EDIT_NOT_FOUND");
    const result = await dependencies.cancel({
      orderId: orderId.data,
      editId: edit.id,
      actorId,
    });
    return result.success
      ? privateJson({ id: edit.id, object: "order_edit", canceled: true })
      : failureResponse(result.reason);
  }
  return methodNotAllowed("GET, POST, DELETE");
}
