import { retryOrderPlacedEmail, sendOrderPlacedEmail } from "@/lib/email";
import { notificationDal } from "@/lib/notification/dal/notification.dal";
import { orderDal } from "@/lib/order/dal/order.dal";
import { giftCardDal } from "@/lib/gift-card/dal/gift-card.dal";

export type RetryOrderPlacedNotificationResult =
  | { success: true }
  | {
      success: false;
      reason: "NOT_RETRYABLE" | "DELIVERY_FAILED" | "RETRY_FAILED";
    };

/**
 * Deliver the customer confirmation after an order has been committed.
 * Notification failure never rolls back or hides the completed commerce write.
 */
export async function notifyOrderPlaced(input: {
  orderId: string;
}): Promise<boolean> {
  try {
    const order = await orderDal.findById(input.orderId);
    if (
      !order ||
      order.isDraftOrder ||
      order.status === "canceled" ||
      order.noNotification ||
      !order.email
    ) {
      return false;
    }

    const items: Awaited<ReturnType<typeof orderDal.listItemsPage>>["items"] =
      [];
    let page = 1;
    let total = 0;
    do {
      const result = await orderDal.listItemsPage({
        orderId: input.orderId,
        page,
        limit: 100,
        version: order.version,
      });
      total = result.total;
      if (total > 500) return false;
      items.push(...result.items);
      // A stale or incomplete page must not keep a post-commit notification
      // retrying forever. Leave delivery for a later reconciliation instead.
      if (result.items.length === 0 && items.length < total) return false;
      page += 1;
    } while (items.length < total);

    const issuedGiftCards = items.some((item) => item.isGiftcard)
      ? await giftCardDal.listForOrder(input.orderId)
      : [];
    const delivery = await sendOrderPlacedEmail({
      email: order.email,
      orderId: order.id,
      customerId: order.customerId,
      currencyCode: order.currencyCode,
      orderDisplayId: order.displayId,
      items: items.map((item) => ({
        title: item.title,
        sku: item.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
      total: order.total,
      ...(issuedGiftCards.length ? { giftCards: issuedGiftCards } : {}),
    });
    return delivery.success;
  } catch {
    return false;
  }
}

/** Retry a failed order confirmation without rebuilding or changing its snapshot. */
export async function retryFailedOrderPlacedNotification(input: {
  orderId: string;
  notificationId: string;
}): Promise<RetryOrderPlacedNotificationResult> {
  try {
    const [order, notification] = await Promise.all([
      orderDal.findById(input.orderId),
      notificationDal.findRetryableOrderPlaced(input),
    ]);
    if (
      !order ||
      order.isDraftOrder ||
      order.status === "canceled" ||
      order.noNotification ||
      !notification
    ) {
      return { success: false, reason: "NOT_RETRYABLE" };
    }

    const delivery = await retryOrderPlacedEmail({
      email: notification.to,
      orderId: order.id,
      customerId: notification.receiverId,
      notificationId: notification.id,
      data: notification.data,
    });
    return delivery.success
      ? { success: true }
      : { success: false, reason: "DELIVERY_FAILED" };
  } catch {
    return { success: false, reason: "RETRY_FAILED" };
  }
}

/** Convert a draft order and send the same idempotent order.placed notice. */
export async function convertDraftOrderAndNotifyCustomer(orderId: string) {
  const result = await orderDal.convertDraftToOrder(orderId);
  if (result.success) await notifyOrderPlaced({ orderId });
  return result;
}
