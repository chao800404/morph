import { notificationDal } from "@/lib/notification/dal/notification.dal";
import { retryFailedOrderPlacedNotification } from "@/lib/order/service/order-notification.service";
import { failure, ok, paginationOf, parseInput } from "@/lib/db/server-result";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

const listOrderNotificationsInputSchema = z.object({
  orderId: z.uuid(),
  page: z.number().int().min(1).max(100_000),
  limit: z.number().int().min(1).max(100),
});

export const listOrderNotifications = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(listOrderNotificationsInputSchema, data),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const result = await notificationDal.listForOrder(input.data);
      return ok("Order notifications fetched", {
        notifications: result.notifications,
        pagination: paginationOf(
          result.total,
          input.data.page,
          input.data.limit,
        ),
      });
    } catch (error) {
      return failure(
        "List order notifications error",
        error,
        "LIST_FAILED",
        "Failed to fetch order notifications",
      );
    }
  });

const retryOrderNotificationInputSchema = z.object({
  orderId: z.uuid(),
  notificationId: z.uuid(),
});

export const retryOrderNotification = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(retryOrderNotificationInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const retried = await retryFailedOrderPlacedNotification(input.data);
      if (!retried.success) {
        const messages = {
          NOT_RETRYABLE:
            "This failed order confirmation cannot be retried. Refresh the order and try again.",
          DELIVERY_FAILED:
            "The email provider could not send this confirmation. A new failed attempt is available to retry.",
          RETRY_FAILED:
            "The confirmation retry could not be completed. Refresh the order and try again.",
        } as const;
        return failure(
          "Retry order notification error",
          new Error(messages[retried.reason]),
          retried.reason,
          messages[retried.reason],
        );
      }
      return ok("Order confirmation email retry sent", {
        orderId: input.data.orderId,
        notificationId: input.data.notificationId,
      });
    } catch (error) {
      return failure(
        "Retry order notification error",
        error,
        "RETRY_FAILED",
        "Failed to retry the order confirmation email",
      );
    }
  });
