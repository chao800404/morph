import type { AssetActionResult } from "@/lib/asset/action-result";
import {
  cancelOrder,
  cancelOrderFulfillment,
  captureOrderPayment,
  createOrderFulfillment,
  markOrderFulfillmentDelivered,
  markOrderFulfillmentShipped,
  refundOrderPayment,
} from "@/server/marketing/order-workflow.serverFn";
import { convertDraftOrder } from "@/server/marketing/orders.serverFn";
import {
  cancelOrderReturn,
  createOrderReturn,
  receiveOrderReturn,
} from "@/server/marketing/order-return.serverFn";
import {
  createOrderRefundClaim,
  createOrderReplacementClaim,
} from "@/server/marketing/order-claim.serverFn";
import {
  cancelOrderExchange,
  createOrderExchange,
} from "@/server/marketing/order-exchange.serverFn";
import { findCurrency, toMinorUnits } from "@/lib/currency/catalog";

const text = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const result = (value: {
  success: boolean;
  message: string;
  errors?: Partial<Record<string, string[]>>;
}): AssetActionResult => ({
  success: value.success,
  message: value.message,
  errors: value.errors
    ? Object.fromEntries(
        Object.entries(value.errors).filter(
          (entry): entry is [string, string[]] => Boolean(entry[1]),
        ),
      )
    : undefined,
});

export const captureOrderPaymentAction = async ({ data }: { data: FormData }) =>
  result(
    await captureOrderPayment({
      data: {
        orderId: text(data, "orderId") ?? "",
        amount: text(data, "amount") ? Number(text(data, "amount")) : undefined,
      },
    }),
  );

export const cancelOrderAction = async ({ data }: { data: FormData }) =>
  result(await cancelOrder({ data: { orderId: text(data, "orderId") ?? "" } }));

export const convertDraftOrderAction = async ({ data }: { data: FormData }) =>
  result(
    await convertDraftOrder({ data: { id: text(data, "orderId") ?? "" } }),
  );

const orderEditRequestAction = async (
  data: FormData,
  action: "confirm" | "cancel",
) => {
  const orderId = text(data, "orderId") ?? "";
  const response = await fetch(
    `/api/admin/orders/${encodeURIComponent(orderId)}/edit${
      action === "confirm" ? "/confirm" : ""
    }`,
    { method: action === "confirm" ? "POST" : "DELETE" },
  );
  const value: unknown = await response.json().catch(() => null);
  const message =
    value &&
    typeof value === "object" &&
    "message" in value &&
    typeof value.message === "string"
      ? value.message
      : action === "confirm"
        ? "The order edit could not be confirmed"
        : "The order edit could not be canceled";
  return {
    success: response.ok,
    message: response.ok
      ? action === "confirm"
        ? "Order edit confirmed"
        : "Order edit canceled"
      : message,
  } satisfies AssetActionResult;
};

export const confirmOrderEditAction = ({ data }: { data: FormData }) =>
  orderEditRequestAction(data, "confirm");

export const cancelOrderEditAction = ({ data }: { data: FormData }) =>
  orderEditRequestAction(data, "cancel");

export const refundOrderPaymentAction = async (
  _state: unknown,
  data: FormData,
) =>
  result(
    await refundOrderPayment({
      data: {
        orderId: text(data, "orderId") ?? "",
        amount: Number(text(data, "amount") ?? 0),
        note: text(data, "note"),
      },
    }),
  );

export const createOrderFulfillmentAction = async (
  _state: unknown,
  data: FormData,
) => {
  const itemIds = data
    .getAll("itemId")
    .filter((value): value is string => typeof value === "string");
  return result(
    await createOrderFulfillment({
      data: {
        orderId: text(data, "orderId") ?? "",
        locationId: text(data, "locationId") ?? "",
        items: itemIds.flatMap((itemId) => {
          const quantity = Number(text(data, `quantity:${itemId}`) ?? 0);
          return quantity > 0 ? [{ itemId, quantity }] : [];
        }),
      },
    }),
  );
};

export const shipOrderFulfillmentAction = async ({
  data,
}: {
  data: FormData;
}) =>
  result(
    await markOrderFulfillmentShipped({
      data: { fulfillmentId: text(data, "fulfillmentId") ?? "" },
    }),
  );

export const deliverOrderFulfillmentAction = async ({
  data,
}: {
  data: FormData;
}) =>
  result(
    await markOrderFulfillmentDelivered({
      data: { fulfillmentId: text(data, "fulfillmentId") ?? "" },
    }),
  );

export const cancelOrderFulfillmentAction = async ({
  data,
}: {
  data: FormData;
}) =>
  result(
    await cancelOrderFulfillment({
      data: { fulfillmentId: text(data, "fulfillmentId") ?? "" },
    }),
  );

export const createOrderReturnAction = async (
  _state: unknown,
  data: FormData,
) => {
  const itemIds = data
    .getAll("itemId")
    .filter((value): value is string => typeof value === "string");
  return result(
    await createOrderReturn({
      data: {
        orderId: text(data, "orderId") ?? "",
        items: itemIds.flatMap((itemId) => {
          const quantity = Number(text(data, `quantity:${itemId}`) ?? 0);
          if (quantity <= 0) return [];
          return [
            {
              itemId,
              quantity,
              reasonId: text(data, `reason:${itemId}`),
              note: text(data, `note:${itemId}`),
            },
          ];
        }),
      },
    }),
  );
};

export const createOrderReplacementClaimAction = async (
  _state: unknown,
  data: FormData,
) => {
  const currencyCode = text(data, "currencyCode") ?? "usd";
  const currency = findCurrency(currencyCode);
  if (!currency)
    return {
      success: false as const,
      message: "The order currency is unavailable.",
    };
  const shippingCharge = (prefix: "returnShipping" | "outboundShipping") => {
    const name = text(data, `${prefix}Name`);
    const amount = text(data, `${prefix}Amount`);
    if (!name && !amount) return { success: true as const, value: undefined };
    if (!name || !amount)
      return {
        success: false as const,
        message:
          "Enter both a shipping method name and fee, or leave both blank.",
      };
    return {
      success: true as const,
      value: { name, amount: toMinorUnits(amount, currency) },
    };
  };
  const returnShipping = shippingCharge("returnShipping");
  if (!returnShipping.success) return returnShipping;
  const outboundShipping = shippingCharge("outboundShipping");
  if (!outboundShipping.success) return outboundShipping;
  const itemIds = data
    .getAll("itemId")
    .filter((value): value is string => typeof value === "string");
  const inboundItems = itemIds.flatMap((itemId) => {
    const quantity = Number(text(data, `quantity:${itemId}`) ?? 0);
    const reason = text(data, `reason:${itemId}`);
    if (
      quantity <= 0 ||
      (reason !== "production_failure" && reason !== "other")
    )
      return [];
    return [
      {
        itemId,
        quantity,
        reason,
        note: text(data, `note:${itemId}`),
      },
    ];
  });
  if (
    itemIds.some(
      (itemId) =>
        Number(text(data, `quantity:${itemId}`) ?? 0) > 0 &&
        !["production_failure", "other"].includes(
          text(data, `reason:${itemId}`) ?? "",
        ),
    )
  )
    return {
      success: false as const,
      message: "Choose a claim reason for every inbound item.",
    };

  const outboundKeys = data
    .getAll("outboundKey")
    .filter((value): value is string => typeof value === "string");
  const outboundItems = outboundKeys.flatMap((key) => {
    const quantity = Number(text(data, `outboundQuantity:${key}`) ?? 0);
    const variantId = text(data, `outboundVariant:${key}`);
    if (quantity <= 0 || !variantId) return [];
    return [{ variantId, quantity, note: text(data, `outboundNote:${key}`) }];
  });
  if (
    outboundKeys.some(
      (key) =>
        Number(text(data, `outboundQuantity:${key}`) ?? 0) > 0 &&
        !text(data, `outboundVariant:${key}`),
    )
  )
    return {
      success: false as const,
      message: "Choose a variant for every outbound item with a quantity.",
    };
  if (returnShipping.value && inboundItems.length === 0)
    return {
      success: false as const,
      message: "Add at least one inbound item to charge return shipping.",
    };
  if (!outboundItems.length)
    return {
      success: false as const,
      message: "Add at least one outbound replacement item.",
    };
  return result(
    await createOrderReplacementClaim({
      data: {
        orderId: text(data, "orderId") ?? "",
        locationId: text(data, "locationId") ?? "",
        sendNotification: data.get("sendNotification") === "on",
        returnShipping: returnShipping.value,
        outboundShipping: outboundShipping.value,
        items: inboundItems,
        outboundItems,
      },
    }),
  );
};

export const createOrderRefundClaimAction = async (
  _state: unknown,
  data: FormData,
) => {
  const itemIds = data
    .getAll("itemId")
    .filter((value): value is string => typeof value === "string");
  return result(
    await createOrderRefundClaim({
      data: {
        orderId: text(data, "orderId") ?? "",
        locationId: text(data, "locationId") || undefined,
        returnItems: data.get("returnItems") === "on",
        sendNotification: data.get("sendNotification") === "on",
        items: itemIds.flatMap((itemId) => {
          const quantity = Number(text(data, `quantity:${itemId}`) ?? 0);
          const reason = text(data, `reason:${itemId}`);
          if (
            quantity <= 0 ||
            (reason !== "missing_item" &&
              reason !== "wrong_item" &&
              reason !== "production_failure" &&
              reason !== "other")
          )
            return [];
          return [
            {
              itemId,
              quantity,
              reason,
              note: text(data, `note:${itemId}`),
            },
          ];
        }),
      },
    }),
  );
};

export const createOrderExchangeAction = async (
  _state: unknown,
  data: FormData,
) => {
  const currencyCode = text(data, "currencyCode") ?? "usd";
  const currency = findCurrency(currencyCode);
  if (!currency)
    return {
      success: false as const,
      message: "The order currency is unavailable.",
    };
  const shippingCharge = (prefix: "returnShipping" | "outboundShipping") => {
    const name = text(data, `${prefix}Name`);
    const amount = text(data, `${prefix}Amount`);
    if (!name && !amount) return { success: true as const, value: undefined };
    if (!name || !amount)
      return {
        success: false as const,
        message:
          "Enter both a shipping method name and fee, or leave both blank.",
      };
    return {
      success: true as const,
      value: { name, amount: toMinorUnits(amount, currency) },
    };
  };
  const returnShipping = shippingCharge("returnShipping");
  if (!returnShipping.success) return returnShipping;
  const outboundShipping = shippingCharge("outboundShipping");
  if (!outboundShipping.success) return outboundShipping;
  const itemIds = data
    .getAll("itemId")
    .filter((value): value is string => typeof value === "string");
  const items = itemIds.flatMap((itemId) => {
    const quantity = Number(text(data, `quantity:${itemId}`) ?? 0);
    const variantId = text(data, `variant:${itemId}`);
    if (quantity <= 0 || !variantId) return [];
    return [
      {
        itemId,
        variantId,
        quantity,
        note: text(data, `note:${itemId}`),
      },
    ];
  });
  if (
    itemIds.some(
      (itemId) =>
        Number(text(data, `quantity:${itemId}`) ?? 0) > 0 &&
        !text(data, `variant:${itemId}`),
    )
  )
    return {
      success: false as const,
      message: "Choose a replacement variant for every item with a quantity.",
    };
  return result(
    await createOrderExchange({
      data: {
        orderId: text(data, "orderId") ?? "",
        locationId: text(data, "locationId") ?? "",
        allowBackorder: data.get("allowBackorder") === "on",
        carryOverPromotions: data.get("carryOverPromotions") === "on",
        sendNotification: data.get("sendNotification") === "on",
        returnShipping: returnShipping.value,
        outboundShipping: outboundShipping.value,
        items,
      },
    }),
  );
};

export const cancelOrderExchangeAction = async ({ data }: { data: FormData }) =>
  result(
    await cancelOrderExchange({
      data: { exchangeId: text(data, "exchangeId") ?? "" },
    }),
  );

export const receiveOrderReturnAction = async (
  _state: unknown,
  data: FormData,
) => {
  const returnItemIds = data
    .getAll("returnItemId")
    .filter((value): value is string => typeof value === "string");
  return result(
    await receiveOrderReturn({
      data: {
        returnId: text(data, "returnId") ?? "",
        locationId: text(data, "locationId") ?? "",
        items: returnItemIds.flatMap((returnItemId) => {
          const quantity = Number(text(data, `quantity:${returnItemId}`) ?? 0);
          if (quantity <= 0) return [];
          return [
            {
              returnItemId,
              quantity,
              damagedQuantity: Number(
                text(data, `damaged:${returnItemId}`) ?? 0,
              ),
            },
          ];
        }),
      },
    }),
  );
};

export const cancelOrderReturnAction = async ({ data }: { data: FormData }) =>
  result(
    await cancelOrderReturn({
      data: { returnId: text(data, "returnId") ?? "" },
    }),
  );
