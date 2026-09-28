import type {
  OrderClaimDTO,
  OrderExchangeDTO,
} from "@/lib/order/dto/order.dto";
import type { AdminApiAccess } from "./orders";
import { z } from "zod";

type ClaimFailureReason =
  | "NOT_FOUND"
  | "ORDER_CANCELED"
  | "INVALID_QUANTITY"
  | "INVALID_REASON"
  | "INVALID_LOCATION"
  | "INVALID_VARIANT"
  | "NO_PRICE"
  | "INVENTORY_UNAVAILABLE"
  | "RETURN_CLOSED"
  | "EXCHANGE_CLOSED"
  | "CONFLICT"
  | "ORDER_EMAIL_REQUIRED";

type ExchangeFailureReason = ClaimFailureReason | "EXCHANGE_CLOSED";

type ClaimWriteResult =
  | {
      success: true;
      claimId: string;
      displayId: number;
      returnId?: string;
      refundAmount?: number;
      notificationSent?: boolean;
    }
  | { success: false; reason: ClaimFailureReason };

type ExchangeWriteResult =
  | {
      success: true;
      returnId: string;
      exchangeId?: string;
      displayId?: number;
      notificationSent?: boolean;
    }
  | { success: false; reason: ExchangeFailureReason };

export type AdminOrderChangesApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  hasNotificationEmail(orderId: string): Promise<boolean>;
  notifyClaim(input: {
    orderId: string;
    claimId: string;
    type: "refund" | "replace";
  }): Promise<boolean>;
  notifyExchange(input: {
    orderId: string;
    returnId: string;
  }): Promise<boolean>;
  listClaims(orderId: string): Promise<OrderClaimDTO[]>;
  listExchanges(orderId: string): Promise<OrderExchangeDTO[]>;
  createRefundClaim(input: {
    orderId: string;
    locationId?: string;
    returnItems: boolean;
    sendNotification: boolean;
    items: Array<{
      itemId: string;
      quantity: number;
      reason: "missing_item" | "wrong_item" | "production_failure" | "other";
      note?: string;
    }>;
    createdBy: string;
  }): Promise<ClaimWriteResult>;
  createReplacementClaim(input: {
    orderId: string;
    locationId: string;
    sendNotification: boolean;
    returnShipping?: { name: string; amount: number };
    outboundShipping?: { name: string; amount: number };
    items: Array<{
      itemId: string;
      quantity: number;
      reason: "production_failure" | "other";
      note?: string;
    }>;
    outboundItems: Array<{
      variantId: string;
      quantity: number;
      note?: string;
    }>;
    createdBy: string;
  }): Promise<ClaimWriteResult>;
  createExchange(input: {
    orderId: string;
    locationId: string;
    allowBackorder: boolean;
    carryOverPromotions: boolean;
    sendNotification: boolean;
    returnShipping?: { name: string; amount: number };
    outboundShipping?: { name: string; amount: number };
    items: Array<{
      itemId: string;
      variantId: string;
      quantity: number;
      note?: string;
    }>;
    createdBy: string;
  }): Promise<ExchangeWriteResult>;
  cancelExchange(input: {
    orderId: string;
    exchangeId: string;
    canceledBy: string;
  }): Promise<
    | { success: true; returnId: string }
    | { success: false; reason: ExchangeFailureReason }
  >;
};

const shippingSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    amount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

const claimItemSchema = z
  .object({
    item_id: z.uuid(),
    quantity: z.number().int().min(1).max(100_000),
    reason: z
      .enum(["missing_item", "wrong_item", "production_failure", "other"])
      .default("other"),
    note: z.string().trim().max(1_000).optional(),
  })
  .strict();

const additionalItemSchema = z
  .object({
    variant_id: z.uuid(),
    quantity: z.number().int().min(1).max(100_000),
    note: z.string().trim().max(1_000).optional(),
  })
  .strict();

const createClaimBodySchema = z
  .object({
    type: z.enum(["refund", "replace"]),
    claim_items: z.array(claimItemSchema).max(50).default([]),
    additional_items: z.array(additionalItemSchema).max(25).default([]),
    return_location_id: z.uuid().optional(),
    return_items: z.boolean().default(true),
    return_shipping: shippingSchema.optional(),
    outbound_shipping: shippingSchema.optional(),
    no_notification: z.boolean().default(false),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.type === "refund" && input.claim_items.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["claim_items"],
        message: "Refund claims require at least one claimed item",
      });
    }
    if (input.type === "refund" && input.return_shipping) {
      context.addIssue({
        code: "custom",
        path: ["return_shipping"],
        message:
          "Refund claims do not currently support a separate return shipping charge",
      });
    }
    if (
      input.type === "refund" &&
      (input.additional_items.length > 0 || input.outbound_shipping)
    ) {
      context.addIssue({
        code: "custom",
        path: [
          input.additional_items.length > 0
            ? "additional_items"
            : "outbound_shipping",
        ],
        message: "Refund claims cannot include replacement items or shipping",
      });
    }
    if (input.type === "replace" && input.additional_items.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["additional_items"],
        message: "Replacement claims require at least one additional item",
      });
    }
    if (input.type === "replace" && !input.return_location_id) {
      context.addIssue({
        code: "custom",
        path: ["return_location_id"],
        message: "A stock location is required for replacement claims",
      });
    }
    if (
      input.type === "replace" &&
      input.claim_items.some(
        (item) =>
          item.reason === "missing_item" || item.reason === "wrong_item",
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["claim_items"],
        message:
          "Replacement claims support production_failure or other reasons",
      });
    }
    if (
      input.type === "replace" &&
      input.return_shipping &&
      input.claim_items.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["return_shipping"],
        message: "Return shipping requires at least one inbound item",
      });
    }
    if (
      input.type === "refund" &&
      input.return_items &&
      input.claim_items.length > 0 &&
      !input.return_location_id
    ) {
      context.addIssue({
        code: "custom",
        path: ["return_location_id"],
        message: "A stock location is required when items are returned",
      });
    }
    if (
      input.type === "refund" &&
      input.return_shipping &&
      (!input.return_items || input.claim_items.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["return_shipping"],
        message: "Return shipping requires returned items",
      });
    }
    const itemIds = input.claim_items.map((item) => item.item_id);
    if (new Set(itemIds).size !== itemIds.length) {
      context.addIssue({
        code: "custom",
        path: ["claim_items"],
        message: "An order item can only appear once in a claim",
      });
    }
  });

const exchangeItemSchema = z
  .object({
    item_id: z.uuid(),
    variant_id: z.uuid(),
    quantity: z.number().int().min(1).max(100_000),
    note: z.string().trim().max(1_000).optional(),
  })
  .strict();

const createExchangeBodySchema = z
  .object({
    location_id: z.uuid(),
    items: z.array(exchangeItemSchema).min(1).max(25),
    allow_backorder: z.boolean().default(false),
    carry_over_promotions: z.boolean().default(false),
    return_shipping: shippingSchema.optional(),
    outbound_shipping: shippingSchema.optional(),
    no_notification: z.boolean().default(false),
  })
  .strict()
  .refine(
    (input) =>
      new Set(input.items.map((item) => item.item_id)).size ===
      input.items.length,
    { path: ["items"], message: "An order item can only appear once" },
  );

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

const claimToApi = (claim: OrderClaimDTO) => ({
  id: claim.id,
  display_id: claim.displayId,
  return_id: claim.returnId,
  type: claim.type,
  refund_amount: claim.refundAmount,
  order_version: claim.orderVersion,
  created_at: claim.createdAt,
  canceled_at: claim.canceledAt,
  return_shipping: claim.returnShipping,
  outbound_shipping: claim.outboundShipping,
  items: claim.items.map((item) => ({
    id: item.id,
    item_id: item.itemId,
    title: item.title,
    sku: item.sku,
    quantity: item.quantity,
    reason: item.reason,
    note: item.note,
    is_additional_item: item.isAdditionalItem,
  })),
});

const exchangeToApi = (exchange: OrderExchangeDTO) => ({
  id: exchange.id,
  display_id: exchange.displayId,
  return_id: exchange.returnId,
  difference_due: exchange.differenceDue,
  allow_backorder: exchange.allowBackorder,
  created_at: exchange.createdAt,
  canceled_at: exchange.canceledAt,
  return_status: exchange.returnStatus,
  location_name: exchange.locationName,
  return_shipping: exchange.returnShipping,
  outbound_shipping: exchange.outboundShipping,
  inbound_items: exchange.inboundItems.map((item) => ({
    id: item.id,
    item_id: item.itemId,
    title: item.title,
    sku: item.sku,
    quantity: item.quantity,
    received_quantity: item.receivedQuantity,
  })),
  items: exchange.items.map((item) => ({
    id: item.id,
    item_id: item.itemId,
    title: item.title,
    sku: item.sku,
    quantity: item.quantity,
    unit_price: item.unitPrice,
  })),
});

const failures: Record<string, { message: string; status: number }> = {
  NOT_FOUND: { message: "Order or record not found", status: 404 },
  ORDER_CANCELED: {
    message: "Canceled and draft orders cannot have claims or exchanges",
    status: 409,
  },
  INVALID_QUANTITY: {
    message: "Claim or exchange quantities exceed the eligible quantity",
    status: 409,
  },
  INVALID_REASON: { message: "Select a supported claim reason", status: 400 },
  INVALID_LOCATION: { message: "Select an active stock location", status: 400 },
  INVALID_VARIANT: { message: "Select an active product variant", status: 400 },
  NO_PRICE: { message: "The replacement item has no price", status: 409 },
  INVENTORY_UNAVAILABLE: {
    message: "Replacement inventory is unavailable",
    status: 409,
  },
  CONFLICT: {
    message: "The order changed during this operation. Refresh and try again",
    status: 409,
  },
  ORDER_EMAIL_REQUIRED: {
    message: "Add a customer email address before enabling notifications",
    status: 409,
  },
  EXCHANGE_CLOSED: {
    message: "This exchange can no longer be canceled",
    status: 409,
  },
};

const failureResponse = (reason: string) => {
  const error = failures[reason] ?? {
    message: "Order claim or exchange operation failed",
    status: 409,
  };
  return routeError(reason, error.message, error.status);
};

/** Admin endpoints for order claims and exchanges, backed by Morph's guarded order workflows. */
export async function handleAdminOrderClaimsExchangesRequest(
  request: Request,
  dependencies: AdminOrderChangesApiDependencies,
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

  const actionMatch =
    /^orders\/([^/]+)\/(claims|exchanges)(?:\/([^/]+)(?:\/(cancel))?)?$/.exec(
      path,
    );
  if (!actionMatch) return routeError("NOT_FOUND", "Route not found", 404);
  const [, orderId, resource, recordId, action] = actionMatch;
  const parsedOrderId = z.uuid().safeParse(orderId ?? "");
  if (!parsedOrderId.success)
    return routeError("INVALID_REQUEST", "Invalid order ID", 400);
  if (recordId) {
    const parsedRecordId = z.uuid().safeParse(recordId);
    if (!parsedRecordId.success)
      return routeError("INVALID_REQUEST", `Invalid ${resource} ID`, 400);
  }

  const isClaims = resource === "claims";
  if (isClaims && action)
    return routeError("NOT_FOUND", "Claims cannot be canceled", 404);

  if (request.method === "GET") {
    if (action) return methodNotAllowed("POST");
    try {
      if (isClaims) {
        const claims = await dependencies.listClaims(parsedOrderId.data);
        const selected = recordId
          ? claims.filter((claim) => claim.id === recordId)
          : claims;
        if (selected.length === 0 && recordId)
          return routeError("NOT_FOUND", "Claim not found", 404);
        return recordId
          ? privateJson({ claim: claimToApi(selected[0]!) })
          : privateJson({
              claims: selected.map(claimToApi),
              count: selected.length,
            });
      }
      const exchanges = await dependencies.listExchanges(parsedOrderId.data);
      const selected = recordId
        ? exchanges.filter((exchange) => exchange.id === recordId)
        : exchanges;
      if (selected.length === 0 && recordId)
        return routeError("NOT_FOUND", "Exchange not found", 404);
      return recordId
        ? privateJson({ exchange: exchangeToApi(selected[0]!) })
        : privateJson({
            exchanges: selected.map(exchangeToApi),
            count: selected.length,
          });
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Order changes could not be loaded",
        500,
      );
    }
  }

  if (request.method !== "POST") return methodNotAllowed("GET, POST");
  if (!access.userId)
    return routeError("FORBIDDEN", "A verified actor is required", 403);

  if (isClaims && !recordId) {
    const parsedBody = createClaimBodySchema.safeParse(await readJson(request));
    if (!parsedBody.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid claim payload",
          details: parsedBody.error.flatten().fieldErrors,
        },
        400,
      );
    const body = parsedBody.data;
    try {
      if (
        !body.no_notification &&
        !(await dependencies.hasNotificationEmail(parsedOrderId.data))
      )
        return failureResponse("ORDER_EMAIL_REQUIRED");
      const result =
        body.type === "refund"
          ? await dependencies.createRefundClaim({
              orderId: parsedOrderId.data,
              ...(body.return_location_id
                ? { locationId: body.return_location_id }
                : {}),
              returnItems: body.return_items,
              sendNotification: !body.no_notification,
              items: body.claim_items.map((item) => ({
                itemId: item.item_id,
                quantity: item.quantity,
                reason: item.reason,
                ...(item.note !== undefined ? { note: item.note } : {}),
              })),
              createdBy: access.userId,
            })
          : await dependencies.createReplacementClaim({
              orderId: parsedOrderId.data,
              locationId: body.return_location_id ?? "",
              sendNotification: !body.no_notification,
              ...(body.return_shipping
                ? { returnShipping: body.return_shipping }
                : {}),
              ...(body.outbound_shipping
                ? { outboundShipping: body.outbound_shipping }
                : {}),
              items: body.claim_items.map((item) => ({
                itemId: item.item_id,
                quantity: item.quantity,
                reason:
                  item.reason === "production_failure"
                    ? "production_failure"
                    : "other",
                ...(item.note !== undefined ? { note: item.note } : {}),
              })),
              outboundItems: body.additional_items.map((item) => ({
                variantId: item.variant_id,
                quantity: item.quantity,
                ...(item.note !== undefined ? { note: item.note } : {}),
              })),
              createdBy: access.userId,
            });
      if (!result.success) return failureResponse(result.reason);
      let notificationSent: boolean | undefined;
      if (!body.no_notification) {
        try {
          notificationSent = await dependencies.notifyClaim({
            orderId: parsedOrderId.data,
            claimId: result.claimId,
            type: body.type,
          });
        } catch {
          notificationSent = false;
        }
      }
      let claim: OrderClaimDTO | undefined;
      try {
        claim = (await dependencies.listClaims(parsedOrderId.data)).find(
          (candidate) => candidate.id === result.claimId,
        );
      } catch {
        // The claim is already committed. Return its stable identifiers so a
        // transient read failure cannot make clients retry a successful write.
      }
      return privateJson(
        {
          claim: claim
            ? claimToApi(claim)
            : {
                id: result.claimId,
                display_id: result.displayId,
                return_id: result.returnId ?? null,
                type: body.type,
                refund_amount: result.refundAmount ?? null,
              },
          ...(notificationSent !== undefined
            ? { notification_sent: notificationSent }
            : {}),
        },
        201,
      );
    } catch {
      return routeError("INTERNAL_ERROR", "Claim operation failed", 500);
    }
  }

  if (!isClaims && !recordId) {
    const parsedBody = createExchangeBodySchema.safeParse(
      await readJson(request),
    );
    if (!parsedBody.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid exchange payload",
          details: parsedBody.error.flatten().fieldErrors,
        },
        400,
      );
    const body = parsedBody.data;
    try {
      if (
        !body.no_notification &&
        !(await dependencies.hasNotificationEmail(parsedOrderId.data))
      )
        return failureResponse("ORDER_EMAIL_REQUIRED");
      const result = await dependencies.createExchange({
        orderId: parsedOrderId.data,
        locationId: body.location_id,
        allowBackorder: body.allow_backorder,
        carryOverPromotions: body.carry_over_promotions,
        sendNotification: !body.no_notification,
        ...(body.return_shipping
          ? { returnShipping: body.return_shipping }
          : {}),
        ...(body.outbound_shipping
          ? { outboundShipping: body.outbound_shipping }
          : {}),
        items: body.items.map((item) => ({
          itemId: item.item_id,
          variantId: item.variant_id,
          quantity: item.quantity,
          ...(item.note !== undefined ? { note: item.note } : {}),
        })),
        createdBy: access.userId,
      });
      if (!result.success) return failureResponse(result.reason);
      let notificationSent: boolean | undefined;
      if (!body.no_notification) {
        try {
          notificationSent = await dependencies.notifyExchange({
            orderId: parsedOrderId.data,
            returnId: result.returnId,
          });
        } catch {
          notificationSent = false;
        }
      }
      let exchange: OrderExchangeDTO | undefined;
      try {
        exchange = (await dependencies.listExchanges(parsedOrderId.data)).find(
          (candidate) => candidate.returnId === result.returnId,
        );
      } catch {
        // The exchange is already committed. Keep the successful write
        // response successful even if its expanded relation cannot be read.
      }
      return privateJson(
        {
          exchange: exchange
            ? exchangeToApi(exchange)
            : {
                id: result.exchangeId,
                display_id: result.displayId ?? null,
                return_id: result.returnId,
              },
          ...(notificationSent !== undefined
            ? { notification_sent: notificationSent }
            : {}),
        },
        201,
      );
    } catch {
      return routeError("INTERNAL_ERROR", "Exchange operation failed", 500);
    }
  }

  if (!isClaims && recordId && action === "cancel") {
    try {
      const result = await dependencies.cancelExchange({
        orderId: parsedOrderId.data,
        exchangeId: recordId,
        canceledBy: access.userId,
      });
      if (!result.success) return failureResponse(result.reason);
      const exchanges = await dependencies.listExchanges(parsedOrderId.data);
      const exchange = exchanges.find((candidate) => candidate.id === recordId);
      return exchange
        ? privateJson({ exchange: exchangeToApi(exchange) })
        : routeError("NOT_FOUND", "Exchange not found", 404);
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Exchange could not be canceled",
        500,
      );
    }
  }

  return methodNotAllowed("GET, POST");
}
