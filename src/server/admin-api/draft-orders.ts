import type {
  OrderDetailDTO,
  OrderItemDTO,
  OrderListDTO,
} from "@/lib/order/dto/order.dto";
import type {
  CreateDraftOrderInput,
  CreateDraftOrderResult,
} from "@/lib/order/service/draft-order-write.service";
import type {
  DraftOrderEdit,
  DraftOrderEditItemInput,
} from "@/lib/order/dal/draft-order-edit.dal";
import type { JsonValue } from "@/db/json";
import { metadataInputSchema } from "@/lib/validations/product";
import type { AdminApiAccess } from "@/server/admin-api/orders";
import { orderDetailToApi, orderListToApi } from "@/server/admin-api/orders";
import { z } from "zod";

type DraftOrderListInput = {
  query?: string;
  sortBy: "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
  offset: number;
};

type AdminDraftOrderCreateInput = Omit<
  CreateDraftOrderInput,
  "currencyCode"
> & {
  currencyCode?: string;
};

type DraftShippingMethod = {
  id: string;
  shippingOptionId: string | null;
  shippingProfileId: string | null;
  name: string;
  description: JsonValue | null;
  amount: number;
  isCustomAmount: boolean;
};

type DraftEditFailureReason =
  | "NOT_FOUND"
  | "NOT_DRAFT"
  | "VERSION_CONFLICT"
  | "EDIT_EXISTS"
  | "EDIT_NOT_FOUND"
  | "EDIT_NOT_PENDING"
  | "ITEM_NOT_FOUND"
  | "SHIPPING_METHOD_NOT_FOUND"
  | "ACTION_NOT_FOUND"
  | "EMPTY_EDIT"
  | "INVALID_ACTION"
  | "EMPTY_ORDER"
  | "TOO_MANY_ITEMS"
  | "UPDATE_FAILED"
  | "CREATE_FAILED"
  | "CUSTOMER_NOT_FOUND"
  | "REGION_NOT_FOUND"
  | "REGION_CURRENCY_MISMATCH"
  | "SALES_CHANNEL_NOT_FOUND"
  | "SALES_CHANNEL_DISABLED"
  | "VARIANT_UNAVAILABLE"
  | "NO_PRICE"
  | "INVALID_TOTAL"
  | "HAS_ADJUSTMENTS"
  | "SHIPPING_OPTION_UNAVAILABLE"
  | "EDIT_CONFLICT";

type DraftEditMutationResult =
  | { success: true; editId?: string; updatedAt?: string }
  | { success: false; reason: DraftEditFailureReason; message?: string };

export type AdminDraftOrdersApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listDraftOrders(input: DraftOrderListInput): Promise<{
    orders: OrderListDTO[];
    total: number;
  }>;
  findOrder(id: string): Promise<OrderDetailDTO | null>;
  resolveRegionCurrencyCode(regionId: string): Promise<string | null>;
  listItems(orderId: string): Promise<OrderItemDTO[]>;
  listShippingMethods(orderId: string): Promise<DraftShippingMethod[]>;
  getDraftOrderEdit(orderId: string): Promise<DraftOrderEdit | null>;
  createDraftOrder(
    input: CreateDraftOrderInput,
  ): Promise<CreateDraftOrderResult>;
  updateDraftOrder(input: {
    id: string;
    expectedUpdatedAt: string;
    email?: string;
    noNotification?: boolean;
  }): Promise<
    | { success: true }
    | { success: false; reason: "NOT_FOUND" | "NOT_DRAFT" | "CONFLICT" }
  >;
  updateDraftOrderEditFields(input: {
    orderId: string;
    email?: string;
    noNotification?: boolean;
    shippingAddress?: JsonValue;
    billingAddress?: JsonValue;
  }): Promise<DraftEditMutationResult>;
  deleteDraftOrder(
    id: string,
    expectedUpdatedAt: string,
  ): Promise<
    | { success: true }
    | {
        success: false;
        reason: "NOT_FOUND" | "NOT_DRAFT" | "CONFLICT" | "HAS_ACTIVITY";
      }
  >;
  convertDraftOrder(id: string): Promise<
    | { success: true }
    | {
        success: false;
        reason:
          | "NOT_FOUND"
          | "NOT_DRAFT"
          | "INVALID_STATUS"
          | "CANCELED"
          | "EMPTY"
          | "PROMOTION_EXHAUSTED"
          | "CONFLICT";
      }
  >;
  beginDraftOrderEdit(input: {
    orderId: string;
    expectedVersion: number;
    actorId?: string;
  }): Promise<
    | { success: true; edit: DraftOrderEdit }
    | { success: false; reason: DraftEditFailureReason }
  >;
  addDraftOrderEditItems(
    orderId: string,
    items: DraftOrderEditItemInput[],
  ): Promise<DraftEditMutationResult>;
  updateDraftOrderEditItem(input: {
    orderId: string;
    itemId: string;
    quantity: number;
    unitPrice?: number;
    compareAtUnitPrice?: number;
    internalNote?: string;
  }): Promise<DraftEditMutationResult>;
  updateDraftOrderEditAction(input: {
    orderId: string;
    actionId: string;
    quantity: number;
    unitPrice?: number;
    compareAtUnitPrice?: number;
    internalNote?: string;
  }): Promise<DraftEditMutationResult>;
  removeDraftOrderEditItem(input: {
    orderId: string;
    itemId: string;
  }): Promise<DraftEditMutationResult>;
  removeDraftOrderEditAction(input: {
    orderId: string;
    actionId: string;
  }): Promise<DraftEditMutationResult>;
  addDraftOrderEditPromotions(
    orderId: string,
    codes: string[],
  ): Promise<DraftEditMutationResult>;
  removeDraftOrderEditPromotions(
    orderId: string,
    codes: string[],
  ): Promise<DraftEditMutationResult>;
  addDraftOrderEditShippingMethod(input: {
    orderId: string;
    shippingOptionId: string;
    customAmount?: number;
    description?: string;
    internalNote?: string;
  }): Promise<DraftEditMutationResult>;
  updateDraftOrderEditShippingMethod(input: {
    orderId: string;
    methodId: string;
    customAmount?: number;
    description?: string;
    internalNote?: string;
  }): Promise<DraftEditMutationResult>;
  updateDraftOrderEditShippingAction(input: {
    orderId: string;
    actionId: string;
    customAmount?: number;
    description?: string;
    internalNote?: string;
  }): Promise<DraftEditMutationResult>;
  removeDraftOrderEditShippingMethod(input: {
    orderId: string;
    methodId: string;
  }): Promise<DraftEditMutationResult>;
  removeDraftOrderEditShippingAction(input: {
    orderId: string;
    actionId: string;
  }): Promise<DraftEditMutationResult>;
  requestDraftOrderEdit(input: {
    orderId: string;
    actorId?: string;
  }): Promise<DraftEditMutationResult>;
  cancelDraftOrderEdit(input: {
    orderId: string;
    actorId?: string;
  }): Promise<DraftEditMutationResult>;
  confirmDraftOrderEdit(input: {
    orderId: string;
    actorId?: string;
  }): Promise<DraftEditMutationResult>;
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });

const routeError = (error: string, message: string, status: number) =>
  jsonResponse({ error, message }, status);

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

const listQuerySchema = z
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
    page: Math.floor(input.offset / input.limit) + 1,
    sortBy: input.order.includes("updated_at")
      ? ("updatedAt" as const)
      : ("createdAt" as const),
    sortOrder: input.order.startsWith("-")
      ? ("desc" as const)
      : ("asc" as const),
  }));

const addressSchema = z
  .object({
    first_name: z.string().trim().max(100).optional(),
    last_name: z.string().trim().max(100).optional(),
    company: z.string().trim().max(200).optional(),
    address_1: z.string().trim().max(300).optional(),
    address_2: z.string().trim().max(300).optional(),
    city: z.string().trim().max(150).optional(),
    province: z.string().trim().max(150).optional(),
    postal_code: z.string().trim().max(40).optional(),
    country_code: z.string().trim().max(2).optional(),
    phone: z.string().trim().max(50).optional(),
  })
  .strict();

const addressToInput = (
  address: z.infer<typeof addressSchema> | null | undefined,
) =>
  address
    ? {
        firstName: address.first_name || null,
        lastName: address.last_name || null,
        company: address.company || null,
        address1: address.address_1 || null,
        address2: address.address_2 || null,
        city: address.city || null,
        province: address.province || null,
        postalCode: address.postal_code || null,
        countryCode: address.country_code?.toLowerCase() || null,
        phone: address.phone || null,
      }
    : null;

const editOrderFieldsBodySchema = z
  .object({
    email: z.email().or(z.literal("")).optional(),
    no_notification: z.boolean().optional(),
    shipping_address: addressSchema.nullable().optional(),
    billing_address: addressSchema.nullable().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0);

const draftItemSchema = z.union([
  z
    .object({
      variant_id: z.uuid(),
      quantity: z.number().int().min(1).max(100_000),
      unit_price: z.number().int().min(0).max(2_147_483_647).optional(),
      compare_at_unit_price: z
        .number()
        .int()
        .min(0)
        .max(2_147_483_647)
        .optional(),
    })
    .strict(),
  z
    .object({
      title: z.string().trim().min(1).max(200),
      sku: z.string().trim().max(100).optional(),
      quantity: z.number().int().min(1).max(100_000),
      unit_price: z.number().int().min(0).max(2_147_483_647),
      compare_at_unit_price: z
        .number()
        .int()
        .min(0)
        .max(2_147_483_647)
        .optional(),
    })
    .strict(),
]);

const createBodySchema = z
  .object({
    email: z.email().or(z.literal("")).optional(),
    customer_id: z.uuid().optional(),
    region_id: z.uuid().optional(),
    sales_channel_id: z.uuid().optional(),
    currency_code: z.string().trim().length(3).optional(),
    no_notification: z.boolean().optional(),
    metadata: metadataInputSchema.optional(),
    shipping_address: addressSchema.nullable().optional(),
    billing_address: addressSchema.nullable().optional(),
    items: z.array(draftItemSchema).min(1).max(40),
  })
  .strict()
  .transform((input): AdminDraftOrderCreateInput => ({
    email: input.email ?? "",
    ...(input.customer_id ? { customerId: input.customer_id } : {}),
    ...(input.region_id ? { regionId: input.region_id } : {}),
    ...(input.sales_channel_id
      ? { salesChannelId: input.sales_channel_id }
      : {}),
    ...(input.currency_code
      ? { currencyCode: input.currency_code.toLowerCase() }
      : {}),
    noNotification: input.no_notification ?? false,
    ...(input.metadata ? { metadata: input.metadata } : {}),
    shippingAddress: addressToInput(input.shipping_address),
    billingAddress: addressToInput(input.billing_address),
    items: input.items.map((item) =>
      "variant_id" in item
        ? {
            type: "variant" as const,
            variantId: item.variant_id,
            quantity: item.quantity,
            customPrice: item.unit_price !== undefined,
            ...(item.unit_price !== undefined
              ? { unitPrice: item.unit_price }
              : {}),
            ...(item.compare_at_unit_price !== undefined
              ? { compareAtUnitPrice: item.compare_at_unit_price }
              : {}),
          }
        : {
            type: "custom" as const,
            title: item.title,
            ...(item.sku ? { sku: item.sku } : {}),
            quantity: item.quantity,
            unitPrice: item.unit_price,
            ...(item.compare_at_unit_price !== undefined
              ? { compareAtUnitPrice: item.compare_at_unit_price }
              : {}),
          },
    ),
  }));

const updateBodySchema = z
  .object({
    email: z.email().or(z.literal("")).optional(),
    no_notification: z.boolean().optional(),
  })
  .strict()
  .refine(
    (input) => input.email !== undefined || input.no_notification !== undefined,
  );

const editItemSchema = z.union([
  z
    .object({
      variant_id: z.uuid(),
      quantity: z.number().int().min(1).max(100_000),
      unit_price: z.number().int().min(0).max(2_147_483_647).optional(),
      compare_at_unit_price: z
        .number()
        .int()
        .min(0)
        .max(2_147_483_647)
        .optional(),
    })
    .strict()
    .transform((item): DraftOrderEditItemInput => ({
      variantId: item.variant_id,
      quantity: item.quantity,
      ...(item.unit_price !== undefined ? { unitPrice: item.unit_price } : {}),
      ...(item.compare_at_unit_price !== undefined
        ? { compareAtUnitPrice: item.compare_at_unit_price }
        : {}),
    })),
  z
    .object({
      title: z.string().trim().min(1).max(200),
      sku: z.string().trim().max(100).optional(),
      quantity: z.number().int().min(1).max(100_000),
      unit_price: z.number().int().min(0).max(2_147_483_647),
      compare_at_unit_price: z
        .number()
        .int()
        .min(0)
        .max(2_147_483_647)
        .optional(),
    })
    .strict()
    .transform((item): DraftOrderEditItemInput => ({
      title: item.title,
      ...(item.sku ? { sku: item.sku } : {}),
      quantity: item.quantity,
      unitPrice: item.unit_price,
      ...(item.compare_at_unit_price !== undefined
        ? { compareAtUnitPrice: item.compare_at_unit_price }
        : {}),
    })),
]);

const addEditItemsBodySchema = z
  .object({ items: z.array(editItemSchema).min(1).max(40) })
  .strict();

const updateEditItemBodySchema = z
  .object({
    quantity: z.number().int().min(1).max(100_000),
    unit_price: z.number().int().min(0).max(2_147_483_647).optional(),
    compare_at_unit_price: z
      .number()
      .int()
      .min(0)
      .max(2_147_483_647)
      .optional(),
    internal_note: z.string().trim().max(1000).optional(),
  })
  .strict();

const editPromotionsBodySchema = z
  .object({
    promo_codes: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  })
  .strict();

const shippingAmountSchema = z.number().int().min(0).max(2_147_483_647);

const addEditShippingMethodBodySchema = z
  .object({
    shipping_option_id: z.uuid(),
    custom_amount: shippingAmountSchema.optional(),
    description: z.string().trim().max(5000).optional(),
    internal_note: z.string().trim().max(1000).optional(),
  })
  .strict();

const updateEditShippingMethodBodySchema = z
  .object({
    custom_amount: shippingAmountSchema.optional(),
    description: z.string().trim().max(5000).optional(),
    internal_note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.custom_amount !== undefined ||
      input.description !== undefined ||
      input.internal_note !== undefined,
  );

const itemToApi = (item: OrderItemDTO) => ({
  id: item.id,
  variant_id: item.variantId,
  title: item.title,
  thumbnail: item.thumbnail,
  sku: item.sku,
  is_custom_price: item.isCustomPrice,
  quantity: item.quantity,
  fulfilled_quantity: item.fulfilledQuantity,
  unit_price: item.unitPrice,
});

const draftOrderToApi = async (
  order: OrderDetailDTO,
  listItems: AdminDraftOrdersApiDependencies["listItems"],
  listShippingMethods: AdminDraftOrdersApiDependencies["listShippingMethods"],
  getDraftOrderEdit: AdminDraftOrdersApiDependencies["getDraftOrderEdit"],
) => {
  const [items, shippingMethods, edit] = await Promise.all([
    listItems(order.id),
    listShippingMethods(order.id),
    getDraftOrderEdit(order.id),
  ]);
  return {
    ...orderDetailToApi(order),
    items: items.map((item) => ({
      ...itemToApi(item),
      ...(edit
        ? {
            actions: edit.actions
              .filter((action) => action.referenceId === item.id)
              .map(editActionToApi),
          }
        : {}),
    })),
    shipping_methods: shippingMethods.map((method) => ({
      id: method.id,
      name: method.name,
      description: method.description,
      amount: method.amount,
      shipping_option_id: method.shippingOptionId,
      shipping_profile_id: method.shippingProfileId,
      is_custom_amount: method.isCustomAmount,
    })),
    payment_collections: [],
    ...(edit
      ? {
          order_change: {
            id: edit.id,
            version: edit.version,
            status: edit.status,
            updated_at: edit.updatedAt,
            actions: edit.actions.map(editActionToApi),
          },
        }
      : {}),
  };
};

const editActionToApi = (action: DraftOrderEdit["actions"][number]) => ({
  id: action.id,
  action: action.action,
  ordering: action.ordering,
  reference: action.reference,
  reference_id: action.referenceId,
  details: action.details,
  internal_note: action.internalNote,
  applied: action.applied,
});

const draftEditFailure = (reason: DraftEditFailureReason, message?: string) => {
  const status =
    reason === "NOT_FOUND" ||
    reason === "ITEM_NOT_FOUND" ||
    reason === "SHIPPING_METHOD_NOT_FOUND" ||
    reason === "ACTION_NOT_FOUND" ||
    reason === "EDIT_NOT_FOUND"
      ? 404
      : reason === "INVALID_ACTION" ||
          reason === "EMPTY_EDIT" ||
          reason === "EMPTY_ORDER" ||
          reason === "TOO_MANY_ITEMS" ||
          reason === "CUSTOMER_NOT_FOUND" ||
          reason === "REGION_NOT_FOUND" ||
          reason === "SALES_CHANNEL_NOT_FOUND" ||
          reason === "VARIANT_UNAVAILABLE" ||
          reason === "NO_PRICE" ||
          reason === "INVALID_TOTAL" ||
          reason === "SHIPPING_OPTION_UNAVAILABLE"
        ? 422
        : reason === "UPDATE_FAILED" || reason === "CREATE_FAILED"
          ? 500
          : 409;
  const messageByReason: Partial<Record<DraftEditFailureReason, string>> = {
    NOT_FOUND: "Draft order not found",
    NOT_DRAFT: "Only an active draft order can be edited",
    VERSION_CONFLICT: "The draft changed while this edit was being saved",
    EDIT_EXISTS: "An edit is already active for this draft order",
    EDIT_NOT_FOUND: "No active edit exists for this draft order",
    EDIT_NOT_PENDING: "This edit is no longer open for changes",
    ITEM_NOT_FOUND: "The item is not part of the current draft order",
    SHIPPING_METHOD_NOT_FOUND:
      "The shipping method is not part of the current draft order",
    ACTION_NOT_FOUND: "The edit action could not be found",
    EMPTY_EDIT: "Add at least one change before continuing",
    INVALID_ACTION: "The edit contains an invalid item action",
    EMPTY_ORDER: "A draft order must contain at least one item",
    TOO_MANY_ITEMS: "A draft order cannot contain more than 40 items",
    CUSTOMER_NOT_FOUND: "The customer on this order is no longer available",
    REGION_NOT_FOUND: "The region on this order is no longer available",
    REGION_CURRENCY_MISMATCH: "The order currency does not match its region",
    SALES_CHANNEL_NOT_FOUND: "The sales channel on this order is unavailable",
    SALES_CHANNEL_DISABLED: "The sales channel on this order is disabled",
    VARIANT_UNAVAILABLE: "A selected product variant is unavailable",
    NO_PRICE: "A selected product variant has no price in the order currency",
    INVALID_TOTAL: "The draft order total is too large",
    HAS_ADJUSTMENTS:
      "This draft contains adjustments that must be recalculated first",
    SHIPPING_OPTION_UNAVAILABLE:
      "A selected shipping option is no longer available",
    UPDATE_FAILED: "The draft order edit could not be applied",
    CREATE_FAILED: "The draft order edit could not be applied",
  };
  return routeError(
    reason,
    message ?? messageByReason[reason] ?? "Draft order edit failed",
    status,
  );
};

const creationFailureStatus = (code?: string) =>
  code === "CREATE_FAILED"
    ? 500
    : code === "REGION_CURRENCY_MISMATCH"
      ? 409
      : 400;

/** Admin draft-order REST surface backed by Morph's order DAL and draft service. */
export async function handleAdminDraftOrdersRequest(
  request: Request,
  dependencies: AdminDraftOrdersApiDependencies,
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

  if (path === "draft-orders") {
    if (request.method === "GET") {
      const parsed = listQuerySchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams.entries()),
      );
      if (!parsed.success)
        return jsonResponse(
          {
            error: "INVALID_REQUEST",
            message: "Invalid draft order list query",
            details: parsed.error.flatten().fieldErrors,
          },
          400,
        );
      try {
        const result = await dependencies.listDraftOrders(parsed.data);
        return jsonResponse({
          draft_orders: result.orders.map(orderListToApi),
          count: result.total,
          offset: parsed.data.offset,
          limit: parsed.data.limit,
        });
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Draft orders could not be loaded",
          500,
        );
      }
    }
    if (request.method !== "POST") return methodNotAllowed("GET, POST");
    const parsed = createBodySchema.safeParse(await readJson(request));
    if (!parsed.success)
      return jsonResponse(
        {
          error: "INVALID_REQUEST",
          message: "Invalid draft order payload",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    try {
      const currencyCode =
        parsed.data.currencyCode ??
        (parsed.data.regionId
          ? await dependencies.resolveRegionCurrencyCode(parsed.data.regionId)
          : null);
      if (!currencyCode)
        return routeError(
          "REGION_REQUIRED",
          "A region or currency_code is required to create a draft order",
          400,
        );
      const created = await dependencies.createDraftOrder({
        ...parsed.data,
        currencyCode,
      });
      if (!created.success)
        return routeError(
          created.error ?? "INVALID_DRAFT_ORDER",
          created.message,
          creationFailureStatus(created.error),
        );
      const order = await dependencies.findOrder(created.data.id);
      if (!order || !order.isDraftOrder)
        return routeError(
          "INTERNAL_ERROR",
          "Draft order could not be loaded after creation",
          500,
        );
      return jsonResponse({
        draft_order: await draftOrderToApi(
          order,
          dependencies.listItems,
          dependencies.listShippingMethods,
          dependencies.getDraftOrderEdit,
        ),
      });
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Draft order could not be created",
        500,
      );
    }
  }

  const editMatch = /^draft-orders\/([^/]+)\/edit(?:\/(.*))?$/.exec(path);
  if (editMatch) {
    const parsedId = z.uuid().safeParse(editMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid draft order ID", 400);
    const orderId = parsedId.data;
    const editPath = editMatch[2] ?? "";
    const actorId = access.allowed ? access.userId : undefined;
    const previewResponse = async () => {
      const order = await dependencies.findOrder(orderId);
      if (!order?.isDraftOrder || order.status !== "draft")
        return routeError("NOT_FOUND", "Draft order not found", 404);
      return jsonResponse({
        draft_order_preview: await draftOrderToApi(
          order,
          dependencies.listItems,
          dependencies.listShippingMethods,
          dependencies.getDraftOrderEdit,
        ),
      });
    };
    const mutationResponse = async (result: DraftEditMutationResult) =>
      result.success
        ? previewResponse()
        : draftEditFailure(result.reason, result.message);

    try {
      if (editPath === "") {
        if (request.method === "POST") {
          const current = await dependencies.findOrder(orderId);
          if (!current?.isDraftOrder || current.status !== "draft")
            return routeError("NOT_FOUND", "Draft order not found", 404);
          const result = await dependencies.beginDraftOrderEdit({
            orderId,
            expectedVersion: current.version,
            actorId,
          });
          if (!result.success) return draftEditFailure(result.reason);
          return previewResponse();
        }
        if (request.method === "PATCH") {
          const parsed = editOrderFieldsBodySchema.safeParse(
            await readJson(request),
          );
          if (!parsed.success)
            return jsonResponse(
              {
                error: "INVALID_REQUEST",
                message: "Invalid draft order edit fields",
                details: parsed.error.flatten().fieldErrors,
              },
              400,
            );
          return mutationResponse(
            await dependencies.updateDraftOrderEditFields({
              orderId,
              ...(parsed.data.email !== undefined
                ? { email: parsed.data.email }
                : {}),
              ...(parsed.data.no_notification !== undefined
                ? { noNotification: parsed.data.no_notification }
                : {}),
              ...(Object.hasOwn(parsed.data, "shipping_address")
                ? {
                    shippingAddress: addressToInput(
                      parsed.data.shipping_address,
                    ) as JsonValue,
                  }
                : {}),
              ...(Object.hasOwn(parsed.data, "billing_address")
                ? {
                    billingAddress: addressToInput(
                      parsed.data.billing_address,
                    ) as JsonValue,
                  }
                : {}),
            }),
          );
        }
        if (request.method === "DELETE") {
          const result = await dependencies.cancelDraftOrderEdit({
            orderId,
            actorId,
          });
          if (!result.success)
            return draftEditFailure(result.reason, result.message);
          return jsonResponse({
            id: orderId,
            object: "draft_order_edit",
            deleted: true,
          });
        }
        return methodNotAllowed("POST, PATCH, DELETE");
      }

      if (editPath === "request" || editPath === "confirm") {
        if (request.method !== "POST") return methodNotAllowed("POST");
        const result =
          editPath === "request"
            ? await dependencies.requestDraftOrderEdit({ orderId, actorId })
            : await dependencies.confirmDraftOrderEdit({ orderId, actorId });
        if (!result.success)
          return draftEditFailure(result.reason, result.message);
        return editPath === "confirm" ? jsonResponse({}) : previewResponse();
      }

      if (editPath === "promotions") {
        if (request.method !== "POST" && request.method !== "DELETE")
          return methodNotAllowed("POST, DELETE");
        const parsed = editPromotionsBodySchema.safeParse(
          await readJson(request),
        );
        if (!parsed.success)
          return jsonResponse(
            {
              error: "INVALID_REQUEST",
              message: "Invalid draft order edit promotions",
              details: parsed.error.flatten().fieldErrors,
            },
            400,
          );
        const result =
          request.method === "POST"
            ? await dependencies.addDraftOrderEditPromotions(
                orderId,
                parsed.data.promo_codes,
              )
            : await dependencies.removeDraftOrderEditPromotions(
                orderId,
                parsed.data.promo_codes,
              );
        return mutationResponse(result);
      }

      if (editPath === "shipping-methods") {
        if (request.method !== "POST") return methodNotAllowed("POST");
        const parsed = addEditShippingMethodBodySchema.safeParse(
          await readJson(request),
        );
        if (!parsed.success)
          return jsonResponse(
            {
              error: "INVALID_REQUEST",
              message: "Invalid draft order edit shipping method",
              details: parsed.error.flatten().fieldErrors,
            },
            400,
          );
        return mutationResponse(
          await dependencies.addDraftOrderEditShippingMethod({
            orderId,
            shippingOptionId: parsed.data.shipping_option_id,
            ...(parsed.data.custom_amount !== undefined
              ? { customAmount: parsed.data.custom_amount }
              : {}),
            ...(parsed.data.description !== undefined
              ? { description: parsed.data.description }
              : {}),
            ...(parsed.data.internal_note !== undefined
              ? { internalNote: parsed.data.internal_note }
              : {}),
          }),
        );
      }

      const existingShippingMethodMatch =
        /^shipping-methods\/method\/([^/]+)$/.exec(editPath);
      if (existingShippingMethodMatch) {
        const methodId = z
          .uuid()
          .safeParse(existingShippingMethodMatch[1] ?? "");
        if (!methodId.success)
          return routeError(
            "INVALID_REQUEST",
            "Invalid shipping method ID",
            400,
          );
        if (request.method === "DELETE")
          return mutationResponse(
            await dependencies.removeDraftOrderEditShippingMethod({
              orderId,
              methodId: methodId.data,
            }),
          );
        if (request.method !== "POST") return methodNotAllowed("POST, DELETE");
        const parsed = updateEditShippingMethodBodySchema.safeParse(
          await readJson(request),
        );
        if (!parsed.success)
          return jsonResponse(
            {
              error: "INVALID_REQUEST",
              message: "Invalid draft order edit shipping method",
              details: parsed.error.flatten().fieldErrors,
            },
            400,
          );
        return mutationResponse(
          await dependencies.updateDraftOrderEditShippingMethod({
            orderId,
            methodId: methodId.data,
            ...(parsed.data.custom_amount !== undefined
              ? { customAmount: parsed.data.custom_amount }
              : {}),
            ...(parsed.data.description !== undefined
              ? { description: parsed.data.description }
              : {}),
            ...(parsed.data.internal_note !== undefined
              ? { internalNote: parsed.data.internal_note }
              : {}),
          }),
        );
      }

      const shippingActionMatch = /^shipping-methods\/([^/]+)$/.exec(editPath);
      if (shippingActionMatch) {
        const actionId = z.uuid().safeParse(shippingActionMatch[1] ?? "");
        if (!actionId.success)
          return routeError(
            "INVALID_REQUEST",
            "Invalid shipping action ID",
            400,
          );
        if (request.method === "DELETE")
          return mutationResponse(
            await dependencies.removeDraftOrderEditShippingAction({
              orderId,
              actionId: actionId.data,
            }),
          );
        if (request.method !== "POST") return methodNotAllowed("POST, DELETE");
        const parsed = updateEditShippingMethodBodySchema.safeParse(
          await readJson(request),
        );
        if (!parsed.success)
          return jsonResponse(
            {
              error: "INVALID_REQUEST",
              message: "Invalid draft order edit shipping action",
              details: parsed.error.flatten().fieldErrors,
            },
            400,
          );
        return mutationResponse(
          await dependencies.updateDraftOrderEditShippingAction({
            orderId,
            actionId: actionId.data,
            ...(parsed.data.custom_amount !== undefined
              ? { customAmount: parsed.data.custom_amount }
              : {}),
            ...(parsed.data.description !== undefined
              ? { description: parsed.data.description }
              : {}),
            ...(parsed.data.internal_note !== undefined
              ? { internalNote: parsed.data.internal_note }
              : {}),
          }),
        );
      }

      if (editPath === "items") {
        if (request.method !== "POST") return methodNotAllowed("POST");
        const parsed = addEditItemsBodySchema.safeParse(
          await readJson(request),
        );
        if (!parsed.success)
          return jsonResponse(
            {
              error: "INVALID_REQUEST",
              message: "Invalid draft order edit items",
              details: parsed.error.flatten().fieldErrors,
            },
            400,
          );
        return mutationResponse(
          await dependencies.addDraftOrderEditItems(orderId, parsed.data.items),
        );
      }

      const existingItemMatch = /^items\/item\/([^/]+)$/.exec(editPath);
      if (existingItemMatch) {
        const itemId = z.uuid().safeParse(existingItemMatch[1] ?? "");
        if (!itemId.success)
          return routeError("INVALID_REQUEST", "Invalid order item ID", 400);
        if (request.method === "DELETE")
          return mutationResponse(
            await dependencies.removeDraftOrderEditItem({
              orderId,
              itemId: itemId.data,
            }),
          );
        if (request.method !== "POST") return methodNotAllowed("POST, DELETE");
        const parsed = updateEditItemBodySchema.safeParse(
          await readJson(request),
        );
        if (!parsed.success)
          return jsonResponse(
            {
              error: "INVALID_REQUEST",
              message: "Invalid draft order edit item",
              details: parsed.error.flatten().fieldErrors,
            },
            400,
          );
        return mutationResponse(
          await dependencies.updateDraftOrderEditItem({
            orderId,
            itemId: itemId.data,
            quantity: parsed.data.quantity,
            ...(parsed.data.unit_price !== undefined
              ? { unitPrice: parsed.data.unit_price }
              : {}),
            ...(parsed.data.compare_at_unit_price !== undefined
              ? { compareAtUnitPrice: parsed.data.compare_at_unit_price }
              : {}),
            ...(parsed.data.internal_note !== undefined
              ? { internalNote: parsed.data.internal_note }
              : {}),
          }),
        );
      }

      const actionMatch = /^items\/([^/]+)$/.exec(editPath);
      if (actionMatch) {
        const actionId = z.uuid().safeParse(actionMatch[1] ?? "");
        if (!actionId.success)
          return routeError("INVALID_REQUEST", "Invalid edit action ID", 400);
        if (request.method === "DELETE")
          return mutationResponse(
            await dependencies.removeDraftOrderEditAction({
              orderId,
              actionId: actionId.data,
            }),
          );
        if (request.method !== "POST") return methodNotAllowed("POST, DELETE");
        const parsed = updateEditItemBodySchema.safeParse(
          await readJson(request),
        );
        if (!parsed.success)
          return jsonResponse(
            {
              error: "INVALID_REQUEST",
              message: "Invalid draft order edit action",
              details: parsed.error.flatten().fieldErrors,
            },
            400,
          );
        return mutationResponse(
          await dependencies.updateDraftOrderEditAction({
            orderId,
            actionId: actionId.data,
            quantity: parsed.data.quantity,
            ...(parsed.data.unit_price !== undefined
              ? { unitPrice: parsed.data.unit_price }
              : {}),
            ...(parsed.data.compare_at_unit_price !== undefined
              ? { compareAtUnitPrice: parsed.data.compare_at_unit_price }
              : {}),
            ...(parsed.data.internal_note !== undefined
              ? { internalNote: parsed.data.internal_note }
              : {}),
          }),
        );
      }

      return routeError("NOT_FOUND", "Draft order edit route not found", 404);
    } catch {
      return routeError("INTERNAL_ERROR", "Draft order edit failed", 500);
    }
  }

  const convertMatch = /^draft-orders\/([^/]+)\/convert-to-order$/.exec(path);
  if (convertMatch) {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const parsedId = z.uuid().safeParse(convertMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid draft order ID", 400);
    try {
      const converted = await dependencies.convertDraftOrder(parsedId.data);
      if (!converted.success) {
        const messages = {
          NOT_FOUND: ["NOT_FOUND", "Draft order not found", 404],
          NOT_DRAFT: ["NOT_DRAFT", "This order is no longer a draft", 409],
          INVALID_STATUS: [
            "INVALID_STATUS",
            "Only an active draft can be converted",
            409,
          ],
          CANCELED: [
            "CANCELED",
            "A canceled draft order cannot be converted",
            409,
          ],
          EMPTY: [
            "EMPTY",
            "Add at least one item before converting this draft",
            409,
          ],
          PROMOTION_EXHAUSTED: [
            "PROMOTION_EXHAUSTED",
            "A promotion limit has been reached",
            409,
          ],
          CONFLICT: [
            "CONFLICT",
            "The draft changed while it was being converted",
            409,
          ],
        } as const;
        const [code, message, status] = messages[converted.reason];
        return routeError(code, message, status);
      }
      const order = await dependencies.findOrder(parsedId.data);
      return order && !order.isDraftOrder
        ? jsonResponse({ order: orderDetailToApi(order) })
        : routeError(
            "INTERNAL_ERROR",
            "Converted order could not be loaded",
            500,
          );
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Draft order could not be converted",
        500,
      );
    }
  }

  const orderMatch = /^draft-orders\/([^/]+)$/.exec(path);
  if (orderMatch) {
    const parsedId = z.uuid().safeParse(orderMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid draft order ID", 400);
    if (request.method === "GET") {
      try {
        const order = await dependencies.findOrder(parsedId.data);
        return order?.isDraftOrder
          ? jsonResponse({
              draft_order: await draftOrderToApi(
                order,
                dependencies.listItems,
                dependencies.listShippingMethods,
                dependencies.getDraftOrderEdit,
              ),
            })
          : routeError("NOT_FOUND", "Draft order not found", 404);
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Draft order could not be loaded",
          500,
        );
      }
    }
    if (request.method === "DELETE") {
      try {
        const current = await dependencies.findOrder(parsedId.data);
        if (!current?.isDraftOrder || current.status !== "draft")
          return routeError("NOT_FOUND", "Active draft order not found", 404);
        const result = await dependencies.deleteDraftOrder(
          parsedId.data,
          current.updatedAt,
        );
        if (!result.success) {
          if (result.reason === "NOT_FOUND")
            return routeError("NOT_FOUND", "Draft order not found", 404);
          if (result.reason === "NOT_DRAFT")
            return routeError(
              "NOT_DRAFT",
              "Only an active draft can be deleted",
              409,
            );
          if (result.reason === "HAS_ACTIVITY")
            return routeError(
              "HAS_ACTIVITY",
              "A draft with payment or fulfillment activity cannot be deleted",
              409,
            );
          return routeError(
            "CONFLICT",
            "The draft changed while it was being deleted",
            409,
          );
        }
        return jsonResponse({
          id: parsedId.data,
          object: "draft_order",
          deleted: true,
        });
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Draft order could not be deleted",
          500,
        );
      }
    }
    if (request.method !== "POST") return methodNotAllowed("GET, POST, DELETE");
    const parsed = updateBodySchema.safeParse(await readJson(request));
    if (!parsed.success)
      return jsonResponse(
        {
          error: "INVALID_REQUEST",
          message: "Invalid draft order update payload",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    try {
      const current = await dependencies.findOrder(parsedId.data);
      if (!current?.isDraftOrder || current.status !== "draft")
        return routeError("NOT_FOUND", "Active draft order not found", 404);
      const result = await dependencies.updateDraftOrder({
        id: parsedId.data,
        expectedUpdatedAt: current.updatedAt,
        ...(parsed.data.email !== undefined
          ? { email: parsed.data.email }
          : {}),
        ...(parsed.data.no_notification !== undefined
          ? { noNotification: parsed.data.no_notification }
          : {}),
      });
      if (!result.success) {
        if (result.reason === "NOT_FOUND")
          return routeError("NOT_FOUND", "Draft order not found", 404);
        if (result.reason === "NOT_DRAFT")
          return routeError(
            "NOT_DRAFT",
            "Only an active draft can be updated",
            409,
          );
        return routeError(
          "CONFLICT",
          "The draft changed while it was being updated",
          409,
        );
      }
      const order = await dependencies.findOrder(parsedId.data);
      return order?.isDraftOrder
        ? jsonResponse({
            draft_order: await draftOrderToApi(
              order,
              dependencies.listItems,
              dependencies.listShippingMethods,
              dependencies.getDraftOrderEdit,
            ),
          })
        : routeError("NOT_FOUND", "Draft order not found", 404);
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Draft order could not be updated",
        500,
      );
    }
  }

  return routeError("NOT_FOUND", "Admin API route not found", 404);
}
