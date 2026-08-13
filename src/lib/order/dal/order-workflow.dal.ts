import { getDb } from "@/db";
import { fulfillmentItems, fulfillments } from "@/db/fulfillment.schema";
import { inventoryLevels, reservationItems } from "@/db/inventory.schema";
import {
  orderFulfillments,
  orderPaymentCollections,
  productVariantInventoryItems,
} from "@/db/link.schema";
import { orderItems, orderLineItems, orders } from "@/db/order.schema";
import { paymentCollections } from "@/db/payment.schema";
import { orderPaymentDal } from "@/lib/payment/dal/order-payment.dal";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { fulfillmentProviderRegistry } from "@/lib/fulfillment/providers/fulfillment-provider-registry.server";

type CancelOrderResult =
  | { success: true }
  | {
      success: false;
      reason: "NOT_FOUND" | "ALREADY_SHIPPED" | "PAYMENT_CAPTURED";
    };

export const orderWorkflowDal = {
  async cancel(orderId: string): Promise<CancelOrderResult> {
    const db = await getDb();
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), isNull(orders.deletedAt)))
      .limit(1);
    if (!order) return { success: false, reason: "NOT_FOUND" };
    if (order.canceledAt) return { success: true };
    const fulfillmentRows = await db
      .select({ fulfillment: fulfillments })
      .from(orderFulfillments)
      .innerJoin(
        fulfillments,
        and(
          eq(fulfillments.id, orderFulfillments.fulfillmentId),
          isNull(fulfillments.deletedAt),
        ),
      )
      .where(eq(orderFulfillments.orderId, orderId));
    if (fulfillmentRows.some((row) => row.fulfillment.shippedAt))
      return { success: false, reason: "ALREADY_SHIPPED" };
    const [payment] = await db
      .select({ collection: paymentCollections })
      .from(orderPaymentCollections)
      .innerJoin(
        paymentCollections,
        eq(paymentCollections.id, orderPaymentCollections.paymentCollectionId),
      )
      .where(eq(orderPaymentCollections.orderId, orderId))
      .limit(1);
    const captured = payment?.collection.capturedAmount ?? 0;
    const refunded = payment?.collection.refundedAmount ?? 0;
    if (captured > refunded)
      return { success: false, reason: "PAYMENT_CAPTURED" };
    if (payment && captured === 0) {
      const canceled = await orderPaymentDal.cancelAuthorization(orderId);
      if (!canceled.success && canceled.reason !== "NOT_FOUND")
        return { success: false, reason: "PAYMENT_CAPTURED" };
    }
    const states = await db
      .select({ state: orderItems, item: orderLineItems })
      .from(orderItems)
      .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
      .where(
        and(
          eq(orderItems.orderId, orderId),
          eq(orderItems.version, order.version),
          isNull(orderItems.deletedAt),
        ),
      );
    const lineIds = states.map((row) => row.item.id);
    const reservations = lineIds.length
      ? await db
          .select()
          .from(reservationItems)
          .where(
            and(
              inArray(reservationItems.lineItemId, lineIds),
              isNull(reservationItems.deletedAt),
            ),
          )
      : [];
    const now = new Date().toISOString();
    const statements: BatchItem<"sqlite">[] = [];
    for (const reservation of reservations) {
      statements.push(
        db
          .update(inventoryLevels)
          .set({
            reservedQuantity: sql`max(0, ${inventoryLevels.reservedQuantity} - ${reservation.quantity})`,
            updatedAt: now,
          })
          .where(
            and(
              eq(inventoryLevels.inventoryItemId, reservation.inventoryItemId),
              eq(inventoryLevels.locationId, reservation.locationId),
            ),
          ),
        db
          .update(reservationItems)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(reservationItems.id, reservation.id)),
      );
    }
    for (const row of fulfillmentRows) {
      const provider = fulfillmentProviderRegistry.get(
        row.fulfillment.providerId,
      );
      if (provider)
        await provider.cancel({
          orderId,
          fulfillmentId: row.fulfillment.id,
          data: row.fulfillment.data ?? {},
        });
      const items = await db
        .select()
        .from(fulfillmentItems)
        .where(
          and(
            eq(fulfillmentItems.fulfillmentId, row.fulfillment.id),
            isNull(fulfillmentItems.deletedAt),
          ),
        );
      for (const fulfillmentItem of items) {
        if (!fulfillmentItem.lineItemId) continue;
        const state = states.find(
          (candidate) => candidate.item.id === fulfillmentItem.lineItemId,
        );
        if (!state) continue;
        statements.push(
          db
            .update(orderItems)
            .set({
              fulfilledQuantity: sql`max(0, ${orderItems.fulfilledQuantity} - ${fulfillmentItem.quantity})`,
              updatedAt: now,
            })
            .where(eq(orderItems.id, state.state.id)),
        );
        if (!state.item.variantId) continue;
        const links = await db
          .select()
          .from(productVariantInventoryItems)
          .where(
            eq(productVariantInventoryItems.variantId, state.item.variantId),
          );
        for (const link of links)
          statements.push(
            db
              .update(inventoryLevels)
              .set({
                stockedQuantity: sql`${inventoryLevels.stockedQuantity} + ${fulfillmentItem.quantity * link.requiredQuantity}`,
                updatedAt: now,
              })
              .where(
                and(
                  eq(inventoryLevels.inventoryItemId, link.inventoryItemId),
                  eq(inventoryLevels.locationId, row.fulfillment.locationId),
                ),
              ),
          );
      }
      statements.push(
        db
          .update(fulfillments)
          .set({ canceledAt: now, updatedAt: now })
          .where(eq(fulfillments.id, row.fulfillment.id)),
      );
    }
    statements.push(
      db
        .update(orders)
        .set({ status: "canceled", canceledAt: now, updatedAt: now })
        .where(eq(orders.id, orderId)),
    );
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    return { success: true };
  },
};
