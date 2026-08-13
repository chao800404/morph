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
