import { orderFulfillmentDal } from "@/lib/fulfillment/dal/order-fulfillment.dal";
import { orderWorkflowDal } from "@/lib/order/dal/order-workflow.dal";
import { orderPaymentDal } from "@/lib/payment/dal/order-payment.dal";
import { failure, ok, parseInput } from "@/lib/db/server-result";
import {
  captureOrderPaymentInputSchema,
  createOrderFulfillmentInputSchema,
  fulfillmentTransitionInputSchema,
  orderOperationInputSchema,
  refundOrderPaymentInputSchema,
} from "@/lib/validations/marketing";
import { createServerFn } from "@tanstack/react-start";

import { commerceAdminMiddleware } from "../middleware/auth.middleware";

export const captureOrderPayment = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(captureOrderPaymentInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await orderPaymentDal.capture(data.orderId, data.amount);
      return result.success
        ? ok("Payment captured", result)
        : {
            success: false as const,
            message: "Payment capture failed",
            data: null,
            error: result.reason,
          };
    } catch (error) {
      return failure(
        "Capture payment error",
        error,
        "CAPTURE_FAILED",
        "Failed to capture payment",
      );
    }
  });

export const refundOrderPayment = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(refundOrderPaymentInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await orderPaymentDal.refund(data.orderId, data.amount, {
        reasonId: data.reasonId,
        note: data.note,
        createdBy: context.user.id,
      });
      return result.success
        ? ok("Payment refunded", result)
        : {
            success: false as const,
            message: "Payment refund failed",
            data: null,
            error: result.reason,
          };
    } catch (error) {
      return failure(
        "Refund payment error",
        error,
        "REFUND_FAILED",
        "Failed to refund payment",
      );
    }
  });

export const createOrderFulfillment = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createOrderFulfillmentInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await orderFulfillmentDal.create({
        ...data,
        createdBy: context.user.id,
      });
      return result.success
        ? ok("Fulfillment created", result)
        : {
            success: false as const,
            message: "Fulfillment could not be created",
            data: null,
            error: result.reason,
          };
    } catch (error) {
      return failure(
        "Create fulfillment error",
        error,
        "FULFILLMENT_FAILED",
        "Failed to create fulfillment",
      );
    }
  });

export const markOrderFulfillmentShipped = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(fulfillmentTransitionInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await orderFulfillmentDal.markShipped(
        data.fulfillmentId,
        context.user.id,
      );
      return result.success
        ? ok("Fulfillment marked shipped", result)
        : {
            success: false as const,
            message: "Fulfillment transition failed",
            data: null,
            error: result.reason,
          };
    } catch (error) {
      return failure(
        "Ship fulfillment error",
        error,
        "SHIP_FAILED",
        "Failed to mark fulfillment shipped",
      );
    }
  });

export const markOrderFulfillmentDelivered = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(fulfillmentTransitionInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await orderFulfillmentDal.markDelivered(
        data.fulfillmentId,
      );
      return result.success
        ? ok("Fulfillment marked delivered", result)
        : {
            success: false as const,
            message: "Fulfillment transition failed",
            data: null,
            error: result.reason,
          };
    } catch (error) {
      return failure(
        "Deliver fulfillment error",
        error,
        "DELIVER_FAILED",
        "Failed to mark fulfillment delivered",
      );
    }
  });

export const cancelOrderFulfillment = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(fulfillmentTransitionInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await orderFulfillmentDal.cancel(data.fulfillmentId);
      return result.success
        ? ok("Fulfillment canceled", result)
        : {
            success: false as const,
            message: "Fulfillment could not be canceled",
            data: null,
            error: result.reason,
          };
    } catch (error) {
      return failure(
        "Cancel fulfillment error",
        error,
        "FULFILLMENT_CANCEL_FAILED",
        "Failed to cancel fulfillment",
      );
    }
  });

export const cancelOrder = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(orderOperationInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await orderWorkflowDal.cancel(data.orderId);
      return result.success
        ? ok("Order canceled", { orderId: data.orderId })
        : {
            success: false as const,
            message: "Order could not be canceled",
            data: null,
            error: result.reason,
          };
    } catch (error) {
      return failure(
        "Cancel order error",
        error,
        "CANCEL_FAILED",
        "Failed to cancel order",
      );
    }
  });
