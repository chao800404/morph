import { getDb } from "@/db";
import {
  fulfillmentAddresses,
  fulfillmentItems,
  fulfillments,
  shippingOptions,
} from "@/db/fulfillment.schema";
import { inventoryLevels, reservationItems } from "@/db/inventory.schema";
import {
  orderFulfillments,
  productVariantInventoryItems,
} from "@/db/link.schema";
import {
  orderAddresses,
  orderItems,
  orderLineItems,
  orders,
  orderShippingMethods,
  orderShippings,
} from "@/db/order.schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { fulfillmentProviderRegistry } from "../providers/fulfillment-provider-registry.server";

type FulfillmentResult =
  | { success: true; fulfillmentId: string }
  | {
      success: false;
      reason:
        | "NOT_FOUND"
        | "ORDER_CANCELED"
        | "INVALID_QUANTITY"
        | "NO_RESERVATION"
        | "PROVIDER_UNAVAILABLE"
        | "ALREADY_SHIPPED";
    };

export const orderFulfillmentDal = {
  async create(input: {
    orderId: string;
    locationId: string;
    items: Array<{ itemId: string; quantity: number }>;
    createdBy?: string;
  }): Promise<FulfillmentResult> {
    const db = await getDb();
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), isNull(orders.deletedAt)))
      .limit(1);
    if (!order) return { success: false, reason: "NOT_FOUND" };
    if (order.canceledAt) return { success: false, reason: "ORDER_CANCELED" };
    const states = await db
      .select({ state: orderItems, item: orderLineItems })
      .from(orderItems)
      .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
      .where(
        and(
          eq(orderItems.orderId, input.orderId),
          eq(orderItems.version, order.version),
          isNull(orderItems.deletedAt),
          isNull(orderLineItems.deletedAt),
        ),
      );
    const requested = input.items.map((request) => ({
      ...request,
      row: states.find((row) => row.item.id === request.itemId),
    }));
    if (
      !requested.length ||
      requested.some(
        ({ quantity, row }) =>
          !row ||
          !Number.isInteger(quantity) ||
          quantity <= 0 ||
          quantity > row.state.quantity - row.state.fulfilledQuantity,
      )
    )
      return { success: false, reason: "INVALID_QUANTITY" };
    const variantIds = requested.flatMap(({ row }) =>
      row?.item.variantId ? [row.item.variantId] : [],
    );
    const inventoryLinks = variantIds.length
      ? await db
          .select()
          .from(productVariantInventoryItems)
          .where(inArray(productVariantInventoryItems.variantId, variantIds))
      : [];
    const reservations = await db
      .select()
      .from(reservationItems)
      .where(
        and(
          inArray(
            reservationItems.lineItemId,
            requested.map((item) => item.itemId),
          ),
          eq(reservationItems.locationId, input.locationId),
          isNull(reservationItems.deletedAt),
        ),
      );
    for (const request of requested) {
      const links = inventoryLinks.filter(
        (link) => link.variantId === request.row?.item.variantId,
      );
      for (const link of links) {
        const reserved = reservations
          .filter(
            (reservation) =>
              reservation.lineItemId === request.itemId &&
              reservation.inventoryItemId === link.inventoryItemId,
          )
          .reduce((sum, reservation) => sum + reservation.quantity, 0);
        if (reserved < request.quantity * link.requiredQuantity)
          return { success: false, reason: "NO_RESERVATION" };
      }
    }
    const [shipping] = await db
      .select({ method: orderShippingMethods, option: shippingOptions })
      .from(orderShippings)
      .innerJoin(
        orderShippingMethods,
        eq(orderShippingMethods.id, orderShippings.shippingMethodId),
      )
      .leftJoin(
        shippingOptions,
        eq(shippingOptions.id, orderShippingMethods.shippingOptionId),
      )
      .where(
        and(
          eq(orderShippings.orderId, input.orderId),
          eq(orderShippings.version, order.version),
          isNull(orderShippings.deletedAt),
        ),
      )
      .limit(1);
    const provider = fulfillmentProviderRegistry.get(
      shipping?.option?.providerId ?? null,
    );
    if (!provider) return { success: false, reason: "PROVIDER_UNAVAILABLE" };
    const [deliveryAddress] = order.shippingAddressId
      ? await db
          .select()
          .from(orderAddresses)
          .where(eq(orderAddresses.id, order.shippingAddressId))
          .limit(1)
      : [];
    const fulfillmentId = crypto.randomUUID();
    const data = await provider.create({
      orderId: input.orderId,
      fulfillmentId,
      data: shipping?.method.data ?? {},
    });
    const now = new Date().toISOString();
    const deliveryAddressId = deliveryAddress ? crypto.randomUUID() : null;
    const statements: BatchItem<"sqlite">[] = [];
    if (deliveryAddress && deliveryAddressId) {
      const {
        id: _id,
        customerId: _customerId,
        deletedAt: _deletedAt,
        ...address
      } = deliveryAddress;
      statements.push(
        db.insert(fulfillmentAddresses).values({
          ...address,
          id: deliveryAddressId,
          updatedAt: now,
        }),
      );
    }
    statements.push(
      db.insert(fulfillments).values({
        id: fulfillmentId,
        locationId: input.locationId,
        providerId: shipping?.option?.providerId ?? null,
        shippingOptionId: shipping?.method.shippingOptionId ?? null,
        deliveryAddressId,
        packedAt: now,
        createdBy: input.createdBy ?? null,
        requiresShipping: requested.some(
          (request) => request.row?.item.requiresShipping,
        ),
        data,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(orderFulfillments).values({
        orderId: input.orderId,
        fulfillmentId,
        createdAt: now,
        updatedAt: now,
      }),
    );
    for (const request of requested) {
      const row = request.row!;
      statements.push(
        db.insert(fulfillmentItems).values({
          id: crypto.randomUUID(),
          fulfillmentId,
          title: row.item.title,
          sku: row.item.variantSku ?? "",
          barcode: row.item.variantBarcode ?? "",
          quantity: request.quantity,
          lineItemId: row.item.id,
          inventoryItemId: null,
          createdAt: now,
          updatedAt: now,
        }),
        db
          .update(orderItems)
          .set({
            fulfilledQuantity: sql`${orderItems.fulfilledQuantity} + ${request.quantity}`,
            updatedAt: now,
          })
          .where(eq(orderItems.id, row.state.id)),
      );
      const links = inventoryLinks.filter(
        (link) => link.variantId === row.item.variantId,
      );
      for (const link of links) {
        let remaining = request.quantity * link.requiredQuantity;
        for (const reservation of reservations.filter(
          (item) =>
            item.lineItemId === row.item.id &&
            item.inventoryItemId === link.inventoryItemId,
        )) {
          if (!remaining) break;
          const consumed = Math.min(remaining, reservation.quantity);
          remaining -= consumed;
          statements.push(
            db
              .update(inventoryLevels)
              .set({
                stockedQuantity: sql`max(0, ${inventoryLevels.stockedQuantity} - ${consumed})`,
                reservedQuantity: sql`max(0, ${inventoryLevels.reservedQuantity} - ${consumed})`,
                updatedAt: now,
              })
              .where(
                and(
                  eq(
                    inventoryLevels.inventoryItemId,
                    reservation.inventoryItemId,
                  ),
                  eq(inventoryLevels.locationId, reservation.locationId),
                ),
              ),
            consumed === reservation.quantity
              ? db
                  .update(reservationItems)
                  .set({ deletedAt: now, updatedAt: now })
                  .where(eq(reservationItems.id, reservation.id))
              : db
                  .update(reservationItems)
                  .set({
                    quantity: reservation.quantity - consumed,
                    updatedAt: now,
                  })
                  .where(eq(reservationItems.id, reservation.id)),
          );
        }
      }
    }
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    return { success: true, fulfillmentId };
  },

  async markShipped(
    fulfillmentId: string,
    actorId?: string,
  ): Promise<FulfillmentResult> {
    return this.transition(fulfillmentId, "shipped", actorId);
  },

  async markDelivered(fulfillmentId: string): Promise<FulfillmentResult> {
    return this.transition(fulfillmentId, "delivered");
  },

  async cancel(fulfillmentId: string): Promise<FulfillmentResult> {
    const db = await getDb();
    const [row] = await db
      .select({ fulfillment: fulfillments, orderId: orderFulfillments.orderId })
      .from(fulfillments)
      .innerJoin(
        orderFulfillments,
        eq(orderFulfillments.fulfillmentId, fulfillments.id),
      )
      .where(
        and(eq(fulfillments.id, fulfillmentId), isNull(fulfillments.deletedAt)),
      )
      .limit(1);
    if (!row) return { success: false, reason: "NOT_FOUND" };
    if (row.fulfillment.canceledAt) return { success: true, fulfillmentId };
    if (row.fulfillment.shippedAt)
      return { success: false, reason: "ALREADY_SHIPPED" };
    const provider = fulfillmentProviderRegistry.get(
      row.fulfillment.providerId,
    );
    if (provider)
      await provider.cancel({
        orderId: row.orderId,
        fulfillmentId,
        data: row.fulfillment.data ?? {},
      });
    const items = await db
      .select({ fulfillmentItem: fulfillmentItems, item: orderLineItems })
      .from(fulfillmentItems)
      .leftJoin(
        orderLineItems,
        eq(orderLineItems.id, fulfillmentItems.lineItemId),
      )
      .where(
        and(
          eq(fulfillmentItems.fulfillmentId, fulfillmentId),
          isNull(fulfillmentItems.deletedAt),
        ),
      );
    const now = new Date().toISOString();
    const statements: BatchItem<"sqlite">[] = [
      db
        .update(fulfillments)
        .set({ canceledAt: now, updatedAt: now })
        .where(eq(fulfillments.id, fulfillmentId)),
    ];
    for (const rowItem of items) {
      if (!rowItem.fulfillmentItem.lineItemId) continue;
      statements.push(
        db
          .update(orderItems)
          .set({
            fulfilledQuantity: sql`max(0, ${orderItems.fulfilledQuantity} - ${rowItem.fulfillmentItem.quantity})`,
            updatedAt: now,
          })
          .where(
            and(
              eq(orderItems.orderId, row.orderId),
              eq(orderItems.itemId, rowItem.fulfillmentItem.lineItemId),
            ),
          ),
      );
      if (!rowItem.item?.variantId) continue;
      const links = await db
        .select()
        .from(productVariantInventoryItems)
        .where(
          eq(productVariantInventoryItems.variantId, rowItem.item.variantId),
        );
      for (const link of links)
        statements.push(
          db
            .update(inventoryLevels)
            .set({
              stockedQuantity: sql`${inventoryLevels.stockedQuantity} + ${rowItem.fulfillmentItem.quantity * link.requiredQuantity}`,
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
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    return { success: true, fulfillmentId };
  },

  async transition(
    fulfillmentId: string,
    transition: "shipped" | "delivered",
    actorId?: string,
  ): Promise<FulfillmentResult> {
    const db = await getDb();
    const [fulfillment] = await db
      .select()
      .from(fulfillments)
      .where(
        and(eq(fulfillments.id, fulfillmentId), isNull(fulfillments.deletedAt)),
      )
      .limit(1);
    if (!fulfillment) return { success: false, reason: "NOT_FOUND" };
    if (fulfillment.canceledAt)
      return { success: false, reason: "ORDER_CANCELED" };
    if (transition === "shipped" && fulfillment.shippedAt)
      return { success: true, fulfillmentId };
    if (transition === "delivered" && fulfillment.deliveredAt)
      return { success: true, fulfillmentId };
    if (transition === "delivered" && !fulfillment.shippedAt)
      return { success: false, reason: "INVALID_QUANTITY" };
    const items = await db
      .select()
      .from(fulfillmentItems)
      .where(
        and(
          eq(fulfillmentItems.fulfillmentId, fulfillmentId),
          isNull(fulfillmentItems.deletedAt),
        ),
      );
    const now = new Date().toISOString();
    const statements: BatchItem<"sqlite">[] = [
      db
        .update(fulfillments)
        .set(
          transition === "shipped"
            ? {
                shippedAt: now,
                markedShippedBy: actorId ?? null,
                updatedAt: now,
              }
            : { deliveredAt: now, updatedAt: now },
        )
        .where(eq(fulfillments.id, fulfillmentId)),
    ];
    for (const item of items)
      if (item.lineItemId)
        statements.push(
          db
            .update(orderItems)
            .set(
              transition === "shipped"
                ? {
                    shippedQuantity: sql`${orderItems.shippedQuantity} + ${item.quantity}`,
                    updatedAt: now,
                  }
                : {
                    deliveredQuantity: sql`${orderItems.deliveredQuantity} + ${item.quantity}`,
                    updatedAt: now,
                  },
            )
            .where(eq(orderItems.itemId, item.lineItemId)),
        );
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    if (transition === "delivered") {
      const [orderLink] = await db
        .select({ orderId: orderFulfillments.orderId })
        .from(orderFulfillments)
        .where(eq(orderFulfillments.fulfillmentId, fulfillmentId))
        .limit(1);
      if (orderLink) {
        const states = await db
          .select()
          .from(orderItems)
          .where(
            and(
              eq(orderItems.orderId, orderLink.orderId),
              isNull(orderItems.deletedAt),
            ),
          );
        if (
          states.length &&
          states.every((state) => state.deliveredQuantity >= state.quantity)
        )
          await db
            .update(orders)
            .set({ status: "completed", updatedAt: now })
            .where(eq(orders.id, orderLink.orderId));
      }
    }
    return { success: true, fulfillmentId };
  },
};
