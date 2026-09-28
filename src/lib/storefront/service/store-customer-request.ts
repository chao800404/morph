import { createAuth } from "@/auth";
import { env } from "cloudflare:workers";
import { customerAddressDal } from "@/lib/customer/dal/customer-address.dal";
import { orderReturnDal } from "@/lib/order/dal/order-return.dal";
import { orderDal } from "@/lib/order/dal/order.dal";
import { orderEditRequestDal } from "@/lib/order/dal/order-edit-request.dal";
import { orderEditService } from "@/lib/order/service/order-edit.service";
import { orderTransferDal } from "@/lib/order/dal/order-transfer.dal";
import { handleCustomerOrderAdjustmentsRequest } from "./customer-order-adjustments-request";
import { handleCustomerOrderEditsRequest } from "./customer-order-edits-request";
import { sendOrderTransferRequestedEmail } from "@/lib/email";
import { getDb } from "@/db";
import { returnReasons } from "@/db/order.schema";
import { asc, isNull } from "drizzle-orm";
import { storeCustomerDal } from "@/lib/storefront/dal/store-customer.dal";
import { storeContextDal } from "@/lib/storefront/dal/store-context.dal";
import { buildOrderTransferConfirmationUrl } from "@/lib/storefront/order-transfer-confirmation-url";
import {
  createStoreCustomerAddressInputSchema,
  createCustomerOrderReturnInputSchema,
  createStoreReturnInputSchema,
  storeCustomerOrderPageSchema,
  storeCustomerProfileInputSchema,
  storeOrderTransferRequestSchema,
  storeOrderTransferTokenSchema,
  updateStoreCustomerAddressInputSchema,
} from "@/lib/validations/store-customer";
import type { StoreContextDTO } from "../dto/store-context.dto";

export interface VerifiedStoreCustomer {
  id: string;
  email: string;
  userId: string;
}

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
    },
  });

const unauthorized = () =>
  privateJson(
    {
      error: "UNAUTHORIZED",
      message: "A verified customer account is required",
    },
    401,
  );

const notFound = () =>
  privateJson(
    { error: "NOT_FOUND", message: "Store customer resource not found" },
    404,
  );

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const parsePage = (url: URL) =>
  storeCustomerOrderPageSchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });

const cleanText = (value: string | null | undefined) =>
  value == null ? value : value.trim() || null;

const addressFields = (input: {
  addressName?: string | null;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
  company?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  countryCode?: string | null;
  province?: string | null;
  postalCode?: string | null;
  phone?: string | null;
}) => ({
  addressName: cleanText(input.addressName) ?? null,
  isDefaultShipping: input.isDefaultShipping,
  isDefaultBilling: input.isDefaultBilling,
  company: cleanText(input.company) ?? null,
  firstName: cleanText(input.firstName) ?? null,
  lastName: cleanText(input.lastName) ?? null,
  address1: cleanText(input.address1) ?? null,
  address2: cleanText(input.address2) ?? null,
  city: cleanText(input.city) ?? null,
  countryCode: cleanText(input.countryCode)?.toLowerCase() ?? null,
  province: cleanText(input.province) ?? null,
  postalCode: cleanText(input.postalCode) ?? null,
  phone: cleanText(input.phone) ?? null,
});

/**
 * The storefront API's customer identity is the Better Auth user from this
 * request's verified cookie session. No customer ID is accepted from input.
 */
export async function resolveVerifiedStoreCustomer(
  request: Request,
): Promise<VerifiedStoreCustomer | null> {
  const session = await createAuth(env, request.url).api.getSession({
    headers: request.headers,
  });
  const user = session?.user;
  if (
    !user ||
    user.isAnonymous === true ||
    user.emailVerified !== true ||
    !user.email.trim()
  ) {
    return null;
  }

  const email = user.email.trim().toLowerCase();
  const customer = await storeCustomerDal.findOrCreateAccount({
    email,
    name: user.name,
    phone: user.phoneNumber?.trim() || null,
  });
  return { id: customer.id, email, userId: user.id };
}

const returnError = (reason: string) => {
  const status =
    reason === "NOT_FOUND" ? 404 : reason === "INVALID_REASON" ? 422 : 409;
  const message =
    {
      ORDER_CANCELED: "Canceled and draft orders cannot have returns",
      INVALID_QUANTITY: "Return quantities exceed the eligible quantity",
      INVALID_REASON: "Select an active return reason",
      CONFLICT:
        "The order changed during this operation. Refresh and try again",
    }[reason] ?? "Return request could not be created";
  return privateJson({ error: reason, message }, status);
};

/** Store return reasons and guest return requests follow the Medusa Store API. */
export async function handleStoreReturnRequest(
  method: "GET" | "POST",
  path: string,
  request: Request,
): Promise<Response | null> {
  if (method === "GET" && path === "return-reasons") {
    const db = await getDb();
    const rows = await db
      .select({
        id: returnReasons.id,
        value: returnReasons.value,
        label: returnReasons.label,
        description: returnReasons.description,
        parentReturnReasonId: returnReasons.parentReturnReasonId,
      })
      .from(returnReasons)
      .where(isNull(returnReasons.deletedAt))
      .orderBy(asc(returnReasons.label));
    return privateJson({ returnReasons: rows });
  }

  if (method !== "POST" || path !== "returns") return null;
  const parsed = createStoreReturnInputSchema.safeParse(
    await readJson(request),
  );
  if (!parsed.success) {
    return privateJson(
      {
        error: "INVALID_REQUEST",
        message: "Invalid return request",
        details: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }

  // The random order ID is the guest return credential, as in Medusa's Store API.
  const result = await orderReturnDal.create({
    ...parsed.data,
    createdBy: null,
  });
  if (!result.success) return returnError(result.reason);
  const returnRecord = await orderReturnDal.findById(result.returnId);
  return returnRecord
    ? privateJson({ return: returnRecord }, 201)
    : privateJson(
        {
          error: "RETURN_UNAVAILABLE",
          message: "The return request was created",
        },
        201,
      );
}

/** Customer Store API endpoints for transferring guest orders to an account. */
export async function handleStoreOrderTransferRequest(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  request: Request,
  context: Pick<StoreContextDTO, "salesChannelId" | "storefrontId">,
): Promise<Response | null> {
  const match =
    /^orders\/([^/]+)\/transfer\/(request|accept|decline|cancel)$/.exec(path);
  if (!match) return null;
  if (method !== "POST") {
    return privateJson(
      { error: "METHOD_NOT_ALLOWED", message: "Use POST for order transfers" },
      405,
    );
  }

  const orderId = match[1];
  const action = match[2];
  if (!orderId || !action) return notFound();
  const now = new Date().toISOString();

  if (action === "request") {
    let customer: VerifiedStoreCustomer | null;
    try {
      customer = await resolveVerifiedStoreCustomer(request);
    } catch {
      return privateJson(
        {
          error: "CUSTOMER_LOOKUP_FAILED",
          message: "Customer account could not be loaded",
        },
        500,
      );
    }
    if (!customer) return unauthorized();
    const parsed = storeOrderTransferRequestSchema.safeParse(
      (await readJson(request)) ?? {},
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid order transfer request",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const result = await orderTransferDal.request({
      orderId,
      customerId: customer.id,
      userId: customer.userId,
      email: customer.email,
      description: parsed.data.description?.trim() || null,
      updateOrderEmail: parsed.data.updateOrderEmail,
      salesChannelId: context.salesChannelId,
      now,
    });
    if (!result.success) {
      return result.reason === "NOT_FOUND"
        ? notFound()
        : privateJson(
            {
              error: "ORDER_TRANSFER_PENDING",
              message: "A transfer request is already pending for this order",
            },
            409,
          );
    }

    let confirmationUrl: string | null = null;
    if (context.storefrontId) {
      try {
        confirmationUrl = buildOrderTransferConfirmationUrl(
          await storeContextDal.findPrimaryActiveHostname(context.storefrontId),
          orderId,
          result.token,
        );
      } catch {
        // The confirmation code and order reference still work without a
        // generated link; a domain lookup failure must not strand the request.
      }
    }

    const sent = await sendOrderTransferRequestedEmail({
      email: result.orderEmail,
      transferId: result.transferId,
      customerId: customer.id,
      orderDisplayId: result.orderDisplayId,
      orderId,
      targetEmail: result.targetEmail,
      description: result.description,
      token: result.token,
      confirmationUrl,
    });
    if (!sent.success) {
      await orderTransferDal.cancel({
        orderId,
        customerId: customer.id,
        salesChannelId: context.salesChannelId,
        now: new Date().toISOString(),
      });
      return privateJson(
        {
          error: "EMAIL_UNAVAILABLE",
          message: "Order transfer confirmation could not be sent",
        },
        503,
      );
    }

    const order = await orderDal.findById(orderId);
    return privateJson(
      {
        ...(order ? { order } : {}),
        orderTransfer: { id: result.transferId, orderId, status: "pending" },
      },
      201,
    );
  }

  if (action === "cancel") {
    let customer: VerifiedStoreCustomer | null;
    try {
      customer = await resolveVerifiedStoreCustomer(request);
    } catch {
      return privateJson(
        {
          error: "CUSTOMER_LOOKUP_FAILED",
          message: "Customer account could not be loaded",
        },
        500,
      );
    }
    if (!customer) return unauthorized();
    const canceled = await orderTransferDal.cancel({
      orderId,
      customerId: customer.id,
      salesChannelId: context.salesChannelId,
      now,
    });
    if (!canceled) {
      return privateJson(
        {
          error: "ORDER_TRANSFER_UNAVAILABLE",
          message: "Pending transfer not found",
        },
        404,
      );
    }
    const order = await orderDal.findById(orderId);
    return privateJson({
      ...(order ? { order } : {}),
      orderTransfer: { orderId, status: "canceled" },
    });
  }

  const parsed = storeOrderTransferTokenSchema.safeParse(
    await readJson(request),
  );
  if (!parsed.success) {
    return privateJson(
      {
        error: "INVALID_REQUEST",
        message: "A valid order transfer token is required",
        details: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }

  const accepted =
    action === "accept"
      ? await orderTransferDal.accept({
          orderId,
          salesChannelId: context.salesChannelId,
          token: parsed.data.token,
          now,
        })
      : await orderTransferDal.decline({
          orderId,
          salesChannelId: context.salesChannelId,
          token: parsed.data.token,
          now,
        });
  if (!accepted) {
    return privateJson(
      {
        error: "ORDER_TRANSFER_UNAVAILABLE",
        message: "The transfer is invalid, expired, or no longer available",
      },
      409,
    );
  }
  const order = await orderDal.findById(orderId);
  return privateJson({
    ...(order ? { order } : {}),
    orderTransfer: {
      orderId,
      status: action === "accept" ? "accepted" : "declined",
    },
  });
}

export async function handleStoreCustomerRequest(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  request: Request,
  context: Pick<StoreContextDTO, "salesChannelId">,
): Promise<Response | null> {
  if (path !== "customers/me" && !path.startsWith("customers/me/")) return null;

  let customer: VerifiedStoreCustomer | null;
  try {
    customer = await resolveVerifiedStoreCustomer(request);
  } catch {
    return privateJson(
      {
        error: "CUSTOMER_LOOKUP_FAILED",
        message: "Customer account could not be loaded",
      },
      500,
    );
  }
  if (!customer) return unauthorized();

  const orderAdjustmentResponse = await handleCustomerOrderAdjustmentsRequest(
    method,
    path,
    { customer, salesChannelId: context.salesChannelId },
    {
      findOwnedOrder: ({ orderId, customerId, email, salesChannelId }) =>
        salesChannelId === null
          ? Promise.resolve(null)
          : storeCustomerDal.findOrder({
              id: orderId,
              customerId,
              email,
              salesChannelId,
            }),
      listClaims: (orderId) => orderReturnDal.listClaims(orderId),
      listExchanges: (orderId) => orderReturnDal.listExchanges(orderId),
    },
  );
  if (orderAdjustmentResponse) return orderAdjustmentResponse;

  const orderEditResponse = await handleCustomerOrderEditsRequest(
    method,
    path,
    { customer, salesChannelId: context.salesChannelId },
    {
      findOwnedOrder: ({ orderId, customerId, email, salesChannelId }) =>
        salesChannelId === null
          ? Promise.resolve(null)
          : storeCustomerDal.findOrder({
              id: orderId,
              customerId,
              email,
              salesChannelId,
            }),
      getOrderEdit: (orderId) => orderEditRequestDal.get(orderId),
      acceptEdit: (input) =>
        orderEditService.confirm({
          orderId: input.orderId,
          editId: input.editId,
          actorId: input.actorId,
          ownership: {
            customerId: input.customerId,
            email: input.email,
            salesChannelId: input.salesChannelId,
          },
        }),
      declineEdit: (input) => orderEditRequestDal.declineCustomer(input),
    },
  );
  if (orderEditResponse) return orderEditResponse;

  if (method === "GET" && path === "customers/me") {
    const profile = await storeCustomerDal.getProfile(customer.id);
    return profile ? privateJson({ customer: profile }) : notFound();
  }

  if (method === "PATCH" && path === "customers/me") {
    const parsed = storeCustomerProfileInputSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid customer profile",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const fields: Parameters<typeof storeCustomerDal.updateProfile>[1] = {};
    for (const key of [
      "firstName",
      "lastName",
      "companyName",
      "phone",
    ] as const) {
      const value = parsed.data[key];
      if (value !== undefined) fields[key] = cleanText(value);
    }
    await storeCustomerDal.updateProfile(customer.id, fields);
    const profile = await storeCustomerDal.getProfile(customer.id);
    return profile ? privateJson({ customer: profile }) : notFound();
  }

  if (method === "GET" && path === "customers/me/addresses") {
    const parsed = parsePage(new URL(request.url));
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid address pagination",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const addresses = await storeCustomerDal.listAddresses(customer.id);
    return privateJson({
      addresses: addresses.slice(
        parsed.data.offset,
        parsed.data.offset + parsed.data.limit,
      ),
      count: addresses.length,
      offset: parsed.data.offset,
      limit: parsed.data.limit,
    });
  }

  if (method === "POST" && path === "customers/me/addresses") {
    const parsed = createStoreCustomerAddressInputSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid customer address",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    try {
      const id = crypto.randomUUID();
      const created = await customerAddressDal.create({
        id,
        customerId: customer.id,
        fields: addressFields(parsed.data),
        now: new Date().toISOString(),
      });
      if (!created) return notFound();
      const address = (await storeCustomerDal.listAddresses(customer.id)).find(
        (candidate) => candidate.id === id,
      );
      return privateJson({ address }, 201);
    } catch {
      return privateJson(
        {
          error: "INVALID_STATE",
          message: "The default address could not be saved",
        },
        409,
      );
    }
  }

  const addressPath = /^customers\/me\/addresses\/([^/]+)$/.exec(path);
  if (addressPath && method === "GET") {
    const address = (await storeCustomerDal.listAddresses(customer.id)).find(
      (candidate) => candidate.id === addressPath[1],
    );
    return address ? privateJson({ address }) : notFound();
  }
  if (addressPath && method === "PATCH") {
    const parsed = updateStoreCustomerAddressInputSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid customer address",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const addressId = addressPath[1];
    const addresses = await storeCustomerDal.listAddresses(customer.id);
    const existing = addresses.find((address) => address.id === addressId);
    if (!existing) return notFound();
    const merged = {
      ...existing,
      ...parsed.data,
      isDefaultShipping:
        parsed.data.isDefaultShipping ?? existing.isDefaultShipping,
      isDefaultBilling:
        parsed.data.isDefaultBilling ?? existing.isDefaultBilling,
    };
    try {
      const updated = await customerAddressDal.update({
        id: addressId,
        customerId: customer.id,
        fields: addressFields(merged),
        now: new Date().toISOString(),
      });
      if (!updated) return notFound();
      const address = (await storeCustomerDal.listAddresses(customer.id)).find(
        (candidate) => candidate.id === addressId,
      );
      return privateJson({ address });
    } catch {
      return privateJson(
        {
          error: "INVALID_STATE",
          message: "The default address could not be saved",
        },
        409,
      );
    }
  }

  if (addressPath && method === "DELETE") {
    const deleted = await customerAddressDal.softDelete({
      id: addressPath[1],
      customerId: customer.id,
      now: new Date().toISOString(),
    });
    return deleted
      ? privateJson({ id: addressPath[1], deleted: true })
      : notFound();
  }

  if (method === "GET" && path === "customers/me/orders") {
    const parsed = parsePage(new URL(request.url));
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid order pagination",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const page = await storeCustomerDal.listOrders({
      customerId: customer.id,
      email: customer.email,
      salesChannelId: context.salesChannelId,
      ...parsed.data,
    });
    return privateJson(page);
  }

  const orderReturnsPath = /^customers\/me\/orders\/([^/]+)\/returns$/.exec(
    path,
  );
  const orderReturnCancelPath =
    /^customers\/me\/orders\/([^/]+)\/returns\/([^/]+)$/.exec(path);
  const returnableItemsPath =
    /^customers\/me\/orders\/([^/]+)\/returnable-items$/.exec(path);
  if (method === "DELETE" && orderReturnCancelPath) {
    const [, orderId, returnId] = orderReturnCancelPath;
    if (!orderId || !returnId) return notFound();
    const ownedOrder = await storeCustomerDal.findOrder({
      id: orderId,
      customerId: customer.id,
      email: customer.email,
      salesChannelId: context.salesChannelId,
    });
    if (!ownedOrder) return notFound();
    const result = await orderReturnDal.cancel({
      returnId,
      canceledBy: customer.userId,
      ownership: {
        orderId,
        customerId: customer.id,
        email: customer.email,
        salesChannelId: context.salesChannelId,
      },
    });
    if (!result.success) return returnError(result.reason);
    const returnRecord = await orderReturnDal.findById(returnId);
    return returnRecord ? privateJson({ return: returnRecord }) : notFound();
  }
  if (
    (method === "GET" && (orderReturnsPath || returnableItemsPath)) ||
    (method === "POST" && orderReturnsPath)
  ) {
    const orderId = (orderReturnsPath ?? returnableItemsPath)?.[1];
    if (!orderId) return notFound();
    const ownedOrder = await storeCustomerDal.findOrder({
      id: orderId,
      customerId: customer.id,
      email: customer.email,
      salesChannelId: context.salesChannelId,
    });
    if (!ownedOrder) return notFound();

    if (method === "GET" && returnableItemsPath) {
      const result = await orderReturnDal.listReturnableItems(orderId);
      return result ? privateJson(result) : notFound();
    }
    if (method === "GET" && orderReturnsPath) {
      const parsed = parsePage(new URL(request.url));
      if (!parsed.success) {
        return privateJson(
          {
            error: "INVALID_REQUEST",
            message: "Invalid return pagination",
            details: parsed.error.flatten().fieldErrors,
          },
          400,
        );
      }
      const result = await orderReturnDal.listPage({
        orderId,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
      return privateJson({
        returns: result.returns,
        count: result.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    }

    const parsed = createCustomerOrderReturnInputSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid return request",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const result = await orderReturnDal.create({
      orderId,
      items: parsed.data.items,
      createdBy: customer.userId,
      ownership: {
        customerId: customer.id,
        email: customer.email,
        salesChannelId: context.salesChannelId,
      },
    });
    if (!result.success) return returnError(result.reason);
    const returnRecord = await orderReturnDal.findById(result.returnId);
    return returnRecord
      ? privateJson({ return: returnRecord }, 201)
      : privateJson(
          {
            error: "RETURN_UNAVAILABLE",
            message: "The return request was created",
          },
          201,
        );
  }

  const orderPath = /^customers\/me\/orders\/([^/]+)$/.exec(path);
  if (method === "GET" && orderPath) {
    const orderId = orderPath[1];
    const ownedOrder = await storeCustomerDal.findOrder({
      id: orderId,
      customerId: customer.id,
      email: customer.email,
      salesChannelId: context.salesChannelId,
    });
    if (!ownedOrder) return notFound();
    const parsed = parsePage(new URL(request.url));
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid order item pagination",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const items = await storeCustomerDal.listOrderItems({
      orderId,
      ...parsed.data,
    });
    const detail = await orderDal.findById(orderId);
    if (
      !detail ||
      detail.isDraftOrder ||
      detail.salesChannelId !== context.salesChannelId ||
      (detail.customerId !== customer.id &&
        detail.email?.trim().toLowerCase() !== customer.email)
    ) {
      return notFound();
    }
    return privateJson({
      order: {
        ...ownedOrder,
        shippingAddress: detail.shippingAddress,
        billingAddress: detail.billingAddress,
        hasUnfulfilledItems: detail.hasUnfulfilledItems,
        payment: detail.payment,
        creditLines: detail.creditLines.map(({ amount, reference }) => ({
          amount,
          reference,
        })),
      },
      items: items.items,
      count: items.count,
      offset: parsed.data.offset,
      limit: parsed.data.limit,
    });
  }

  return notFound();
}
