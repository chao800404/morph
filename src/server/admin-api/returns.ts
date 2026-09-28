import type { OrderReturnDTO } from "@/lib/order/dto/order.dto";
import { z } from "zod";
import type { AdminApiAccess } from "./orders";

type AdminReturnResult =
  | { success: true; returnId: string; displayId?: number }
  | {
      success: false;
      reason:
        | "NOT_FOUND"
        | "ORDER_CANCELED"
        | "INVALID_QUANTITY"
        | "INVALID_REASON"
        | "INVALID_LOCATION"
        | "RETURN_CLOSED"
        | "CONFLICT"
        | "INVALID_VARIANT"
        | "NO_PRICE"
        | "INVENTORY_UNAVAILABLE"
        | "EXCHANGE_CLOSED";
    };

export type AdminReturnsApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listReturns(input: {
    orderId?: string;
    status?: OrderReturnDTO["status"];
    offset: number;
    limit: number;
    page: number;
  }): Promise<{ returns: OrderReturnDTO[]; total: number }>;
  findReturn(id: string): Promise<OrderReturnDTO | null>;
  createReturn(input: {
    orderId: string;
    items: Array<{
      itemId: string;
      quantity: number;
      reasonId?: string;
      note?: string;
    }>;
    createdBy: string | null;
  }): Promise<AdminReturnResult>;
  receiveReturn(input: {
    returnId: string;
    locationId: string;
    items: Array<{
      returnItemId: string;
      quantity: number;
      damagedQuantity: number;
    }>;
  }): Promise<AdminReturnResult>;
  cancelReturn(input: {
    returnId: string;
    canceledBy: string;
  }): Promise<AdminReturnResult>;
};

const listReturnsQuerySchema = z
  .object({
    order_id: z.uuid().optional(),
    status: z
      .enum(["open", "requested", "received", "partially_received", "canceled"])
      .optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .transform(({ order_id, status, offset, limit }) => ({
    ...(order_id ? { orderId: order_id } : {}),
    ...(status ? { status } : {}),
    offset,
    limit,
    page: Math.floor(offset / limit) + 1,
  }));

const createReturnBodySchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.uuid(),
            quantity: z.number().int().min(1).max(100_000),
            reason_id: z.uuid().optional(),
            note: z.string().trim().max(1_000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
      ),
  })
  .strict();

const receiveReturnBodySchema = z
  .object({
    location_id: z.uuid(),
    items: z
      .array(
        z
          .object({
            id: z.uuid(),
            quantity: z.number().int().min(1).max(100_000),
            damaged_quantity: z.number().int().min(0).max(100_000).default(0),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
      )
      .refine((items) =>
        items.every((item) => item.damaged_quantity <= item.quantity),
      ),
  })
  .strict();

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

const returnToApi = (orderReturn: OrderReturnDTO) => ({
  id: orderReturn.id,
  order_id: orderReturn.orderId,
  display_id: orderReturn.displayId,
  claim_id: orderReturn.claimId,
  exchange_id: orderReturn.exchangeId,
  status: orderReturn.status,
  location_id: orderReturn.locationId,
  requested_at: orderReturn.requestedAt,
  received_at: orderReturn.receivedAt,
  canceled_at: orderReturn.canceledAt,
  items: orderReturn.items.map((item) => ({
    id: item.id,
    item_id: item.itemId,
    reason_id: item.reasonId,
    reason: item.reason,
    note: item.note,
    title: item.title,
    sku: item.sku,
    quantity: item.quantity,
    received_quantity: item.receivedQuantity,
    damaged_quantity: item.damagedQuantity,
  })),
});

const failureResponse = (reason: string) => {
  const errors: Record<string, { message: string; status: number }> = {
    NOT_FOUND: { message: "Order or return not found", status: 404 },
    ORDER_CANCELED: {
      message: "Canceled and draft orders cannot have returns",
      status: 409,
    },
    INVALID_QUANTITY: {
      message: "Return quantities exceed the eligible quantity",
      status: 409,
    },
    INVALID_REASON: { message: "Select an active return reason", status: 400 },
    INVALID_LOCATION: {
      message: "Select an active stock location",
      status: 400,
    },
    RETURN_CLOSED: {
      message: "This return can no longer be changed",
      status: 409,
    },
    CONFLICT: {
      message: "The order changed during this operation. Refresh and try again",
      status: 409,
    },
    INVALID_VARIANT: {
      message: "Select an active product variant",
      status: 400,
    },
    NO_PRICE: { message: "The replacement item has no price", status: 409 },
    INVENTORY_UNAVAILABLE: {
      message: "Replacement inventory is unavailable",
      status: 409,
    },
    EXCHANGE_CLOSED: {
      message: "This exchange can no longer be changed",
      status: 409,
    },
  };
  const error = errors[reason] ?? {
    message: "Return operation failed",
    status: 409,
  };
  return routeError(reason, error.message, error.status);
};

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

/** Medusa-shaped return endpoints backed by Morph's version-guarded return workflow. */
export async function handleAdminReturnsRequest(
  request: Request,
  dependencies: AdminReturnsApiDependencies,
): Promise<Response> {
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

  if (path === "returns") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    const parsed = listReturnsQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid return list query",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    try {
      const result = await dependencies.listReturns(parsed.data);
      return privateJson({
        returns: result.returns.map(returnToApi),
        count: result.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    } catch {
      return routeError("INTERNAL_ERROR", "Returns could not be loaded", 500);
    }
  }

  const returnActionMatch = /^returns\/([^/]+)\/(receive|cancel)$/.exec(path);
  if (returnActionMatch) {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const [, returnId, action] = returnActionMatch;
    const parsedId = z.uuid().safeParse(returnId ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid return ID", 400);

    try {
      let result: AdminReturnResult;
      if (action === "cancel") {
        if (!access.userId)
          return routeError("FORBIDDEN", "A verified actor is required", 403);
        result = await dependencies.cancelReturn({
          returnId: parsedId.data,
          canceledBy: access.userId,
        });
      } else {
        const parsedBody = receiveReturnBodySchema.safeParse(
          await readJson(request),
        );
        if (!parsedBody.success)
          return privateJson(
            {
              error: "INVALID_REQUEST",
              message: "Invalid return receipt payload",
              details: parsedBody.error.flatten().fieldErrors,
            },
            400,
          );
        result = await dependencies.receiveReturn({
          returnId: parsedId.data,
          locationId: parsedBody.data.location_id,
          items: parsedBody.data.items.map((item) => ({
            returnItemId: item.id,
            quantity: item.quantity,
            damagedQuantity: item.damaged_quantity,
          })),
        });
      }
      if (!result.success) return failureResponse(result.reason);
      const updated = await dependencies.findReturn(parsedId.data);
      return updated
        ? privateJson({ return: returnToApi(updated) })
        : routeError("NOT_FOUND", "Return not found", 404);
    } catch {
      return routeError("INTERNAL_ERROR", "Return operation failed", 500);
    }
  }

  const orderReturnMatch = /^orders\/([^/]+)\/returns$/.exec(path);
  if (orderReturnMatch) {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const parsedOrderId = z.uuid().safeParse(orderReturnMatch[1] ?? "");
    if (!parsedOrderId.success)
      return routeError("INVALID_REQUEST", "Invalid order ID", 400);
    const parsedBody = createReturnBodySchema.safeParse(
      await readJson(request),
    );
    if (!parsedBody.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid return payload",
          details: parsedBody.error.flatten().fieldErrors,
        },
        400,
      );
    if (!access.userId)
      return routeError("FORBIDDEN", "A verified actor is required", 403);
    try {
      const result = await dependencies.createReturn({
        orderId: parsedOrderId.data,
        createdBy: access.userId,
        items: parsedBody.data.items.map((item) => ({
          itemId: item.id,
          quantity: item.quantity,
          ...(item.reason_id ? { reasonId: item.reason_id } : {}),
          ...(item.note !== undefined ? { note: item.note } : {}),
        })),
      });
      if (!result.success) return failureResponse(result.reason);
      const created = await dependencies.findReturn(result.returnId);
      return created
        ? privateJson({ return: returnToApi(created) }, 201)
        : routeError("NOT_FOUND", "Created return could not be loaded", 404);
    } catch {
      return routeError("INTERNAL_ERROR", "Return could not be created", 500);
    }
  }

  const returnMatch = /^returns\/([^/]+)$/.exec(path);
  if (returnMatch) {
    if (request.method !== "GET") return methodNotAllowed("GET, POST");
    const parsedId = z.uuid().safeParse(returnMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid return ID", 400);
    try {
      const orderReturn = await dependencies.findReturn(parsedId.data);
      return orderReturn
        ? privateJson({ return: returnToApi(orderReturn) })
        : routeError("NOT_FOUND", "Return not found", 404);
    } catch {
      return routeError("INTERNAL_ERROR", "Return could not be loaded", 500);
    }
  }

  return routeError("NOT_FOUND", "Admin API route not found", 404);
}
