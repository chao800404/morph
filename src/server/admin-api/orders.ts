import type {
  OrderFulfillmentDTO,
  OrderDetailDTO,
  OrderListDTO,
} from "@/lib/order/dto/order.dto";
import { z } from "zod";

export type AdminApiAccess =
  | { allowed: true; userId?: string; role?: string }
  | {
      allowed: false;
      status: 401 | 403;
      error: "UNAUTHORIZED" | "FORBIDDEN";
      message: string;
    };

export type AdminOrdersApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listOrders(input: {
    query?: string;
    sortBy: "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    offset: number;
  }): Promise<{ orders: OrderListDTO[]; total: number }>;
  findOrder(id: string): Promise<OrderDetailDTO | null>;
  cancelOrder(
    id: string,
    actorId?: string,
  ): Promise<
    | { success: true }
    | {
        success: false;
        reason:
          | "NOT_FOUND"
          | "ALREADY_SHIPPED"
          | "PAYMENT_CAPTURED"
          | "STORE_CREDIT_UNAVAILABLE";
      }
  >;
  listOrderFulfillments(input: {
    orderId: string;
    page: number;
    limit: number;
    offset: number;
  }): Promise<{ fulfillments: OrderFulfillmentDTO[]; total: number }>;
  findOrderFulfillment(input: {
    orderId: string;
    fulfillmentId: string;
  }): Promise<OrderFulfillmentDTO | null>;
  createFulfillment(
    input: {
      orderId: string;
      locationId: string;
      items: Array<{ itemId: string; quantity: number }>;
    },
    createdBy?: string,
  ): Promise<AdminFulfillmentResult>;
  cancelFulfillment(input: {
    orderId: string;
    fulfillmentId: string;
  }): Promise<AdminFulfillmentResult>;
  markFulfillmentShipped(input: {
    orderId: string;
    fulfillmentId: string;
    actorId?: string;
    labels: Array<{
      trackingNumber: string;
      trackingUrl: string;
      labelUrl: string;
    }>;
  }): Promise<AdminFulfillmentResult>;
  markFulfillmentDelivered(input: {
    orderId: string;
    fulfillmentId: string;
  }): Promise<AdminFulfillmentResult>;
};

type AdminFulfillmentResult =
  | { success: true; fulfillmentId: string }
  | {
      success: false;
      reason:
        | "NOT_FOUND"
        | "ORDER_CANCELED"
        | "INVALID_QUANTITY"
        | "NO_RESERVATION"
        | "PROVIDER_UNAVAILABLE"
        | "ALREADY_SHIPPED";
    };

const listOrdersQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z
      .enum(["created_at", "-created_at", "updated_at", "-updated_at"])
      .default("-created_at"),
  })
  .strict()
  .transform((input) => ({
    query: input.q || undefined,
    offset: input.offset,
    limit: input.limit,
    sortBy: input.order.includes("updated_at")
      ? ("updatedAt" as const)
      : ("createdAt" as const),
    sortOrder: input.order.startsWith("-")
      ? ("desc" as const)
      : ("asc" as const),
  }));

const createFulfillmentBodySchema = z
  .object({
    location_id: z.uuid(),
    items: z
      .array(
        z
          .object({
            id: z.uuid(),
            quantity: z.number().int().min(1).max(100_000),
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

const createShipmentBodySchema = z
  .object({
    labels: z
      .array(
        z
          .object({
            tracking_number: z.string().trim().min(1).max(200),
            tracking_url: z.url().optional(),
            label_url: z.url().optional(),
          })
          .strict(),
      )
      .max(10)
      .default([]),
  })
  .strict();

const fulfillmentListQuerySchema = z
  .object({
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .transform(({ offset, limit }) => ({
    offset,
    limit,
    page: Math.floor(offset / limit) + 1,
  }));

const privateJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });

const orderAddressToApi = (address: OrderDetailDTO["shippingAddress"]) =>
  address
    ? {
        first_name: address.firstName,
        last_name: address.lastName,
        company: address.company,
        address_1: address.address1,
        address_2: address.address2,
        city: address.city,
        province: address.province,
        postal_code: address.postalCode,
        country_code: address.countryCode,
        phone: address.phone,
      }
    : null;

export const orderListToApi = (order: OrderListDTO) => ({
  id: order.id,
  display_id: order.displayId,
  status: order.status,
  email: order.email,
  currency_code: order.currencyCode,
  is_draft_order: order.isDraftOrder,
  total: order.total,
  created_at: order.createdAt,
  updated_at: order.updatedAt,
});

export const orderDetailToApi = (order: OrderDetailDTO) => ({
  ...orderListToApi(order),
  version: order.version,
  no_notification: order.noNotification,
  metadata: order.metadata,
  customer_id: order.customerId,
  region_id: order.regionId,
  sales_channel_id: order.salesChannelId,
  has_unfulfilled_items: order.hasUnfulfilledItems,
  shipping_address: orderAddressToApi(order.shippingAddress),
  billing_address: orderAddressToApi(order.billingAddress),
  credit_lines: order.creditLines.map((line) => ({
    id: line.id,
    reference: line.reference,
    reference_id: line.referenceId,
    amount: line.amount,
    metadata: line.metadata,
    created_at: line.createdAt,
    updated_at: line.updatedAt,
  })),
  payment: order.payment
    ? {
        authorized_amount: order.payment.authorizedAmount,
        captured_amount: order.payment.capturedAmount,
        refunded_amount: order.payment.refundedAmount,
        status: order.payment.status,
      }
    : null,
});

const fulfillmentToApi = (fulfillment: OrderFulfillmentDTO) => ({
  id: fulfillment.id,
  location_id: fulfillment.locationId,
  shipped_at: fulfillment.shippedAt,
  delivered_at: fulfillment.deliveredAt,
  canceled_at: fulfillment.canceledAt,
  labels: fulfillment.labels.map((label) => ({
    id: label.id,
    tracking_number: label.trackingNumber,
    tracking_url: label.trackingUrl,
    label_url: label.labelUrl,
  })),
  items: fulfillment.items.map((item) => ({
    id: item.id,
    line_item_id: item.lineItemId,
    title: item.title,
    quantity: item.quantity,
  })),
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

const fulfillmentError = (reason: string, creating = false) => {
  const errors: Record<string, { message: string; status: number }> = {
    NOT_FOUND: { message: "Order or fulfillment not found", status: 404 },
    ORDER_CANCELED: {
      message: "Canceled orders cannot be fulfilled",
      status: 409,
    },
    INVALID_QUANTITY: {
      message: creating
        ? "Invalid fulfillment items or quantities"
        : "The fulfillment transition is invalid",
      status: creating ? 400 : 409,
    },
    NO_RESERVATION: {
      message: "The requested inventory is not reserved at this location",
      status: 409,
    },
    PROVIDER_UNAVAILABLE: {
      message: "The configured fulfillment provider is unavailable",
      status: 503,
    },
    ALREADY_SHIPPED: {
      message: "A shipped fulfillment cannot be canceled",
      status: 409,
    },
  };
  const error = errors[reason] ?? {
    message: "Fulfillment operation failed",
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

/** Medusa-shaped Admin order REST surface backed by Morph order workflows. */
export async function handleAdminOrdersRequest(
  request: Request,
  dependencies: AdminOrdersApiDependencies,
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
  if (path === "orders") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    const url = new URL(request.url);
    const parsed = listOrdersQuerySchema.safeParse(
      Object.fromEntries(url.searchParams.entries()),
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid order list query",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    try {
      const result = await dependencies.listOrders({
        ...parsed.data,
        page: 1,
      });
      return privateJson({
        orders: result.orders.map(orderListToApi),
        count: result.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    } catch {
      return routeError("INTERNAL_ERROR", "Orders could not be loaded", 500);
    }
  }

  const cancelOrderMatch = /^orders\/([^/]+)\/cancel$/.exec(path);
  if (cancelOrderMatch) {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const parsedId = z.uuid().safeParse(cancelOrderMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid order ID", 400);
    try {
      const result = await dependencies.cancelOrder(
        parsedId.data,
        access.userId,
      );
      if (!result.success) {
        if (result.reason === "NOT_FOUND")
          return routeError("NOT_FOUND", "Order not found", 404);
        if (result.reason === "PAYMENT_CAPTURED")
          return routeError(
            result.reason,
            "A captured payment must be refunded before this order can be canceled",
            409,
          );
        if (result.reason === "STORE_CREDIT_UNAVAILABLE")
          return routeError(
            result.reason,
            "Store credit could not be restored, so the order was not canceled",
            409,
          );
        return routeError(
          result.reason,
          "A shipped order cannot be canceled",
          409,
        );
      }
      const order = await dependencies.findOrder(parsedId.data);
      return order
        ? privateJson({ order: orderDetailToApi(order) })
        : routeError("NOT_FOUND", "Order not found", 404);
    } catch {
      return routeError("INTERNAL_ERROR", "Order could not be canceled", 500);
    }
  }

  const orderFulfillmentsMatch = /^orders\/([^/]+)\/fulfillments$/.exec(path);
  if (orderFulfillmentsMatch) {
    const parsedId = z.uuid().safeParse(orderFulfillmentsMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid order ID", 400);
    if (request.method === "GET") {
      const parsedQuery = fulfillmentListQuerySchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams.entries()),
      );
      if (!parsedQuery.success)
        return privateJson(
          {
            error: "INVALID_REQUEST",
            message: "Invalid fulfillment list query",
            details: parsedQuery.error.flatten().fieldErrors,
          },
          400,
        );
      try {
        const result = await dependencies.listOrderFulfillments({
          orderId: parsedId.data,
          ...parsedQuery.data,
        });
        return privateJson({
          fulfillments: result.fulfillments.map(fulfillmentToApi),
          count: result.total,
          offset: parsedQuery.data.offset,
          limit: parsedQuery.data.limit,
        });
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Fulfillments could not be loaded",
          500,
        );
      }
    }
    if (request.method !== "POST") return methodNotAllowed("GET, POST");
    const parsedBody = createFulfillmentBodySchema.safeParse(
      await readJson(request),
    );
    if (!parsedBody.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid fulfillment payload",
          details: parsedBody.error.flatten().fieldErrors,
        },
        400,
      );
    try {
      const result = await dependencies.createFulfillment(
        {
          orderId: parsedId.data,
          locationId: parsedBody.data.location_id,
          items: parsedBody.data.items.map((item) => ({
            itemId: item.id,
            quantity: item.quantity,
          })),
        },
        access.userId,
      );
      if (!result.success) return fulfillmentError(result.reason, true);
      const [fulfillment, order] = await Promise.all([
        dependencies.findOrderFulfillment({
          orderId: parsedId.data,
          fulfillmentId: result.fulfillmentId,
        }),
        dependencies.findOrder(parsedId.data),
      ]);
      return privateJson({
        fulfillment: fulfillment
          ? fulfillmentToApi(fulfillment)
          : { id: result.fulfillmentId },
        ...(order ? { order: orderDetailToApi(order) } : {}),
      });
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Fulfillment could not be created",
        500,
      );
    }
  }

  const fulfillmentActionMatch =
    /^orders\/([^/]+)\/fulfillments\/([^/]+)\/(cancel|shipments|mark-as-delivered)$/.exec(
      path,
    );
  if (fulfillmentActionMatch) {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const [, orderId, fulfillmentId, action] = fulfillmentActionMatch;
    const parsedOrderId = z.uuid().safeParse(orderId ?? "");
    const parsedFulfillmentId = z.uuid().safeParse(fulfillmentId ?? "");
    if (!parsedOrderId.success || !parsedFulfillmentId.success)
      return routeError(
        "INVALID_REQUEST",
        "Invalid order or fulfillment ID",
        400,
      );

    try {
      let result: AdminFulfillmentResult;
      if (action === "cancel") {
        result = await dependencies.cancelFulfillment({
          orderId: parsedOrderId.data,
          fulfillmentId: parsedFulfillmentId.data,
        });
      } else if (action === "mark-as-delivered") {
        result = await dependencies.markFulfillmentDelivered({
          orderId: parsedOrderId.data,
          fulfillmentId: parsedFulfillmentId.data,
        });
      } else {
        const parsedBody = createShipmentBodySchema.safeParse(
          (await readJson(request)) ?? {},
        );
        if (!parsedBody.success)
          return privateJson(
            {
              error: "INVALID_REQUEST",
              message: "Invalid shipment payload",
              details: parsedBody.error.flatten().fieldErrors,
            },
            400,
          );
        result = await dependencies.markFulfillmentShipped({
          orderId: parsedOrderId.data,
          fulfillmentId: parsedFulfillmentId.data,
          actorId: access.userId,
          labels: parsedBody.data.labels.map((label) => ({
            trackingNumber: label.tracking_number,
            trackingUrl: label.tracking_url ?? "",
            labelUrl: label.label_url ?? "",
          })),
        });
      }
      if (!result.success) return fulfillmentError(result.reason);
      const [fulfillment, order] = await Promise.all([
        dependencies.findOrderFulfillment({
          orderId: parsedOrderId.data,
          fulfillmentId: parsedFulfillmentId.data,
        }),
        dependencies.findOrder(parsedOrderId.data),
      ]);
      return privateJson({
        ...(fulfillment ? { fulfillment: fulfillmentToApi(fulfillment) } : {}),
        ...(order ? { order: orderDetailToApi(order) } : {}),
      });
    } catch {
      return routeError("INTERNAL_ERROR", "Fulfillment operation failed", 500);
    }
  }

  const orderMatch = /^orders\/([^/]+)$/.exec(path);
  if (orderMatch) {
    const parsedId = z.uuid().safeParse(orderMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid order ID", 400);
    if (request.method === "GET") {
      try {
        const order = await dependencies.findOrder(parsedId.data);
        return order
          ? privateJson({ order: orderDetailToApi(order) })
          : routeError("NOT_FOUND", "Order not found", 404);
      } catch {
        return routeError("INTERNAL_ERROR", "Order could not be loaded", 500);
      }
    }
    if (request.method === "POST")
      return routeError(
        "ORDER_EDIT_REQUIRED",
        "Use the order edit request endpoint so the customer can review the change",
        409,
      );
    if (request.method !== "GET") return methodNotAllowed("GET");
  }

  return routeError("NOT_FOUND", "Admin API route not found", 404);
}
