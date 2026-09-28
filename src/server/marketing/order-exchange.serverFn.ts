import { productVariantDal } from "@/lib/product/dal/product-variant.dal";
import { orderReturnDal } from "@/lib/order/dal/order-return.dal";
import { orderDal } from "@/lib/order/dal/order.dal";
import { pricingDal } from "@/lib/pricing/dal/pricing.dal";
import { notifyOrderExchangeCreated } from "@/lib/order/service/order-change-notification.service";
import { failure, ok, parseInput } from "@/lib/db/server-result";
import {
  createOrderExchangeInputSchema,
  getMarketingRecordInputSchema,
  orderExchangeOperationInputSchema,
  searchOrderExchangeVariantsInputSchema,
} from "@/lib/validations/marketing";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

const failureFor = (reason: string) => {
  const messages: Record<string, string> = {
    NOT_FOUND: "Order or exchange not found",
    ORDER_CANCELED: "Canceled and draft orders cannot have exchanges",
    INVALID_QUANTITY: "Exchange quantities exceed the delivered quantity",
    INVALID_LOCATION: "Select an active stock location",
    INVALID_VARIANT: "Select an active, stocked product variant",
    NO_PRICE: "The replacement variant has no price in the order currency",
    INVENTORY_UNAVAILABLE:
      "Replacement inventory is unavailable at this location",
    ORDER_EMAIL_REQUIRED:
      "Add a customer email address before enabling notifications",
    EXCHANGE_CLOSED: "This exchange can no longer be canceled",
    CONFLICT: "The order changed during this operation. Refresh and try again",
  };
  return {
    success: false as const,
    message: messages[reason] ?? "Order exchange operation failed",
    data: null,
    error: reason,
  };
};

export const listOrderExchanges = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(getMarketingRecordInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const exchanges = await orderReturnDal.listExchanges(input.data.id);
      return ok("Order exchanges fetched", { exchanges });
    } catch (error) {
      return failure(
        "List order exchanges error",
        error,
        "LIST_FAILED",
        "Failed to fetch order exchanges",
      );
    }
  });

export const searchOrderExchangeVariants = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(searchOrderExchangeVariantsInputSchema, data),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const order = await orderDal.findById(input.data.orderId);
      if (!order || !order.salesChannelId) return failureFor("NOT_FOUND");
      const result = await productVariantDal.searchPage({
        query: input.data.query,
        limit: input.data.limit,
        publishedSalesChannelId: order.salesChannelId,
      });
      const variants = await Promise.all(
        result.variants.map(async (variant) => {
          const price = await pricingDal.resolveVariantPrice(variant.id, {
            currencyCode: order.currencyCode,
            quantity: 1,
            ...(order.regionId ? { regionId: order.regionId } : {}),
            salesChannelId: order.salesChannelId!,
            ...(order.customerId ? { customerId: order.customerId } : {}),
          });
          return price ? { ...variant, unitPrice: price.amount } : null;
        }),
      );
      return ok("Exchange variants fetched", {
        variants: variants.filter((variant) => variant !== null),
        total: result.total,
      });
    } catch (error) {
      return failure(
        "Search order exchange variants error",
        error,
        "SEARCH_FAILED",
        "Failed to search replacement variants",
      );
    }
  });

export const createOrderExchange = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(createOrderExchangeInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    try {
      if (input.data.sendNotification) {
        const order = await orderDal.findById(input.data.orderId);
        if (!order) return failureFor("NOT_FOUND");
        if (!order.email) return failureFor("ORDER_EMAIL_REQUIRED");
      }
      const result = await orderReturnDal.createExchange({
        ...input.data,
        createdBy: context.user.id,
      });
      if (!result.success) return failureFor(result.reason);
      if (!input.data.sendNotification)
        return ok(`Exchange #${result.displayId} confirmed`, result);

      const notificationSent = await notifyOrderExchangeCreated({
        orderId: input.data.orderId,
        returnId: result.returnId,
      }).catch(() => false);
      return notificationSent
        ? ok(
            `Exchange #${result.displayId} confirmed and the customer was notified.`,
            { ...result, notificationSent: true },
          )
        : ok(
            `Exchange #${result.displayId} confirmed, but the customer notification could not be sent.`,
            { ...result, notificationSent: false },
          );
    } catch (error) {
      return failure(
        "Create order exchange error",
        error,
        "CREATE_FAILED",
        "Failed to create order exchange",
      );
    }
  });

export const cancelOrderExchange = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(orderExchangeOperationInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    try {
      const result = await orderReturnDal.cancelExchange({
        ...input.data,
        canceledBy: context.user.id,
      });
      return result.success
        ? ok("Order exchange canceled", result)
        : failureFor(result.reason);
    } catch (error) {
      return failure(
        "Cancel order exchange error",
        error,
        "CANCEL_FAILED",
        "Failed to cancel order exchange",
      );
    }
  });
