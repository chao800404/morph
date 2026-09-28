import { getDb } from "@/db";
import {
  fulfillmentAddresses,
  fulfillmentItems,
  fulfillmentLabels,
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
import { firstOrNull } from "@/lib/db/single-row";
import { getConfig } from "@/server/get-config";

import { fulfillmentProviderRegistry } from "../providers/fulfillment-provider-registry.server";
import { batchGuard } from "@/lib/db/batch-guard";

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
    getConfig();
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
    const providerResult = await provider.create({
      orderId: input.orderId,
      fulfillmentId,
      locationId: input.locationId,
      shippingOptionId: shipping?.method.shippingOptionId ?? null,
      currencyCode: order.currencyCode,
      address: deliveryAddress
        ? {
            firstName: deliveryAddress.firstName,
            lastName: deliveryAddress.lastName,
            company: deliveryAddress.company,
            address1: deliveryAddress.address1,
            address2: deliveryAddress.address2,
            city: deliveryAddress.city,
            province: deliveryAddress.province,
            postalCode: deliveryAddress.postalCode,
            countryCode: deliveryAddress.countryCode,
            phone: deliveryAddress.phone,
          }
        : null,
      items: requested.map(({ itemId, quantity, row }) => ({
        lineItemId: itemId,
        title: row!.item.title,
        sku: row!.item.variantSku ?? "",
        barcode: row!.item.variantBarcode ?? "",
        quantity,
      })),
      data: shipping?.method.data ?? {},
    });
    const now = new Date().toISOString();
    const deliveryAddressId = deliveryAddress ? crypto.randomUUID() : null;
    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        sql`EXISTS (
          SELECT 1 FROM orders
          WHERE id = ${input.orderId}
            AND version = ${order.version}
            AND canceled_at IS NULL
        )`,
      ),
    ];
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
        data: providerResult.data,
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
    for (const label of providerResult.labels) {
      statements.push(
        db.insert(fulfillmentLabels).values({
          id: crypto.randomUUID(),
          fulfillmentId,
          trackingNumber: label.trackingNumber,
          trackingUrl: label.trackingUrl,
          labelUrl: label.labelUrl,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
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
    try {
      await db.batch(
        statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
    } catch (error) {
      try {
        await provider.cancel({
          orderId: input.orderId,
          fulfillmentId,
          data: providerResult.data,
        });
      } catch (compensationError) {
        throw new AggregateError(
          [error, compensationError],
          "Fulfillment persistence failed and the provider could not be compensated",
        );
      }
      throw error;
    }
    return { success: true, fulfillmentId };
  },

  async markShipped(
    fulfillmentId: string,
    actorId?: string,
    expectedOrderId?: string,
    labels: Array<{
      trackingNumber: string;
      trackingUrl: string;
      labelUrl: string;
    }> = [],
  ): Promise<FulfillmentResult> {
    return this.transition(
      fulfillmentId,
      "shipped",
      actorId,
      expectedOrderId,
      labels,
    );
  },

  async markDelivered(
    fulfillmentId: string,
    expectedOrderId?: string,
  ): Promise<FulfillmentResult> {
    return this.transition(
      fulfillmentId,
      "delivered",
      undefined,
      expectedOrderId,
    );
  },

  async cancel(
    fulfillmentId: string,
    expectedOrderId?: string,
  ): Promise<FulfillmentResult> {
    getConfig();
    const db = await getDb();
    const row = firstOrNull(
      await db
        .select({
          fulfillment: fulfillments,
          orderId: orderFulfillments.orderId,
        })
        .from(fulfillments)
        .innerJoin(
          orderFulfillments,
          eq(orderFulfillments.fulfillmentId, fulfillments.id),
        )
        .where(
          and(
            eq(fulfillments.id, fulfillmentId),
            isNull(fulfillments.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!row) return { success: false, reason: "NOT_FOUND" };
    if (expectedOrderId && row.orderId !== expectedOrderId)
      return { success: false, reason: "NOT_FOUND" };
    const currentOrder = firstOrNull(
      await db
        .select({ version: orders.version })
        .from(orders)
        .where(and(eq(orders.id, row.orderId), isNull(orders.deletedAt)))
        .limit(1),
    );
    if (!currentOrder) return { success: false, reason: "NOT_FOUND" };
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
      batchGuard(
        db,
        sql`EXISTS (
          SELECT 1 FROM orders
          WHERE id = ${row.orderId}
            AND version = ${currentOrder.version}
            AND canceled_at IS NULL
        )`,
      ),
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
              eq(orderItems.version, currentOrder.version),
              isNull(orderItems.deletedAt),
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
    expectedOrderId?: string,
    labels: Array<{
      trackingNumber: string;
      trackingUrl: string;
      labelUrl: string;
    }> = [],
  ): Promise<FulfillmentResult> {
    const db = await getDb();
    const fulfillment = firstOrNull(
      await db
        .select()
        .from(fulfillments)
        .where(
          and(
            eq(fulfillments.id, fulfillmentId),
            isNull(fulfillments.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!fulfillment) return { success: false, reason: "NOT_FOUND" };
    if (fulfillment.canceledAt)
      return { success: false, reason: "ORDER_CANCELED" };
    if (transition === "shipped" && fulfillment.shippedAt)
      return { success: true, fulfillmentId };
    if (transition === "delivered" && fulfillment.deliveredAt)
      return { success: true, fulfillmentId };
    if (transition === "delivered" && !fulfillment.shippedAt)
      return { success: false, reason: "INVALID_QUANTITY" };
    const orderLink = firstOrNull(
      await db
        .select({ orderId: orderFulfillments.orderId })
        .from(orderFulfillments)
        .where(eq(orderFulfillments.fulfillmentId, fulfillmentId))
        .limit(1),
    );
    if (!orderLink) return { success: false, reason: "NOT_FOUND" };
    if (expectedOrderId && orderLink.orderId !== expectedOrderId)
      return { success: false, reason: "NOT_FOUND" };
    const currentOrder = firstOrNull(
      await db
        .select({ version: orders.version })
        .from(orders)
        .where(and(eq(orders.id, orderLink.orderId), isNull(orders.deletedAt)))
        .limit(1),
    );
    if (!currentOrder) return { success: false, reason: "NOT_FOUND" };
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
      batchGuard(
        db,
        sql`EXISTS (
          SELECT 1 FROM orders
          WHERE id = ${orderLink.orderId}
            AND version = ${currentOrder.version}
            AND canceled_at IS NULL
        )`,
      ),
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
    if (transition === "shipped")
      for (const label of labels)
        statements.push(
          db.insert(fulfillmentLabels).values({
            id: crypto.randomUUID(),
            fulfillmentId,
            trackingNumber: label.trackingNumber,
            trackingUrl: label.trackingUrl,
            labelUrl: label.labelUrl,
            createdAt: now,
            updatedAt: now,
          }),
        );
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
            .where(
              and(
                eq(orderItems.orderId, orderLink.orderId),
                eq(orderItems.version, currentOrder.version),
                eq(orderItems.itemId, item.lineItemId),
                isNull(orderItems.deletedAt),
              ),
            ),
        );
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    if (transition === "delivered") {
      const states = await db
        .select()
        .from(orderItems)
        .where(
          and(
            eq(orderItems.orderId, orderLink.orderId),
            eq(orderItems.version, currentOrder.version),
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
          .where(
            and(
              eq(orders.id, orderLink.orderId),
              eq(orders.version, currentOrder.version),
            ),
          );
    }
    return { success: true, fulfillmentId };
  },
};
