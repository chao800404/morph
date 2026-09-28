import { orderReturnDal } from "@/lib/order/dal/order-return.dal";
import { orderDal } from "@/lib/order/dal/order.dal";
import { notifyOrderClaimCreated } from "@/lib/order/service/order-change-notification.service";
import { failure, ok, parseInput } from "@/lib/db/server-result";
import {
  createOrderRefundClaimInputSchema,
  createOrderReplacementClaimInputSchema,
  getMarketingRecordInputSchema,
} from "@/lib/validations/marketing";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

const failureFor = (reason: string) => {
  const messages: Record<string, string> = {
    NOT_FOUND: "Order not found",
    ORDER_CANCELED: "Canceled and draft orders cannot have claims",
    INVALID_QUANTITY: "Claim quantities exceed the delivered quantity",
    INVALID_LOCATION: "Select an active stock location",
    INVALID_REASON:
      "Choose a supported reason for this returned-item replacement claim",
    INVALID_VARIANT: "The claimed item no longer has an active product variant",
    INVENTORY_UNAVAILABLE:
      "Replacement inventory is unavailable at this location",
    CONFLICT: "The order changed during this operation. Refresh and try again",
    ORDER_EMAIL_REQUIRED:
      "Add a customer email address before enabling notifications",
  };
  return {
    success: false as const,
    message: messages[reason] ?? "Order claim operation failed",
    data: null,
    error: reason,
  };
};

export const listOrderClaims = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(getMarketingRecordInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const claims = await orderReturnDal.listClaims(input.data.id);
      return ok("Order claims fetched", { claims });
    } catch (error) {
      return failure(
        "List order claims error",
        error,
        "LIST_FAILED",
        "Failed to fetch order claims",
      );
    }
  });

export const createOrderReplacementClaim = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(createOrderReplacementClaimInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    try {
      const order = input.data.sendNotification
        ? await orderDal.findById(input.data.orderId)
        : null;
      if (input.data.sendNotification && !order?.email)
        return failureFor("ORDER_EMAIL_REQUIRED");
      const result = await orderReturnDal.createReplacementClaim({
        ...input.data,
        createdBy: context.user.id,
      });
      if (!result.success) return failureFor(result.reason);
      if (!input.data.sendNotification)
        return ok(`Replacement claim #${result.displayId} confirmed`, result);

      const notificationSent = await notifyOrderClaimCreated({
        orderId: input.data.orderId,
        claimId: result.claimId,
        type: "replace",
      }).catch(() => false);
      return notificationSent
        ? ok(
            `Replacement claim #${result.displayId} confirmed and the customer was notified.`,
            { ...result, notificationSent: true },
          )
        : ok(
            `Replacement claim #${result.displayId} confirmed, but the customer notification could not be sent.`,
            { ...result, notificationSent: false },
          );
    } catch (error) {
      return failure(
        "Create replacement claim error",
        error,
        "CREATE_FAILED",
        "Failed to create replacement claim",
      );
    }
  });

export const createOrderRefundClaim = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(createOrderRefundClaimInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    try {
      const order = input.data.sendNotification
        ? await orderDal.findById(input.data.orderId)
        : null;
      if (input.data.sendNotification && !order?.email)
        return failureFor("ORDER_EMAIL_REQUIRED");
      const result = await orderReturnDal.createRefundClaim({
        ...input.data,
        createdBy: context.user.id,
      });
      if (!result.success) return failureFor(result.reason);
      if (!input.data.sendNotification)
        return ok(
          `Refund claim #${result.displayId} recorded. No payment refund has been processed.`,
          result,
        );

      const notificationSent = await notifyOrderClaimCreated({
        orderId: input.data.orderId,
        claimId: result.claimId,
        type: "refund",
      }).catch(() => false);
      return notificationSent
        ? ok(
            `Refund claim #${result.displayId} recorded and the customer was notified. No payment refund has been processed.`,
            { ...result, notificationSent: true },
          )
        : ok(
            `Refund claim #${result.displayId} recorded, but the customer notification could not be sent. No payment refund has been processed.`,
            { ...result, notificationSent: false },
          );
    } catch (error) {
      return failure(
        "Create order refund claim error",
        error,
        "CREATE_FAILED",
        "Failed to create refund claim",
      );
    }
  });
