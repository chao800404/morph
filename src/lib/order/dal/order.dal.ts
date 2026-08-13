import { getDb } from "@/db";
import type { Metadata } from "@/db/json";
import {
  orderAddresses,
  orderItems,
  orderLineItems,
  orders,
  orderSummaries,
} from "@/db/schema";
import { fulfillmentItems, fulfillments } from "@/db/fulfillment.schema";
import { orderFulfillments, orderPaymentCollections } from "@/db/link.schema";
import { paymentCollections } from "@/db/payment.schema";
import { containsPattern } from "@/lib/db/like-pattern";
import type { OrderDetailDTO } from "@/lib/order/dto/order.dto";
import { isOrderDisplayIdConflict } from "@/lib/order/database-error";
import {
  toOrderDetailDTO,
  toOrderFulfillmentDTOs,
  toOrderItemDTO,
  toOrderListDTO,
} from "@/lib/order/mapper/order.mapper";
import type { FulfillmentRow } from "@/lib/order/mapper/order.mapper";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  like,
  max,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

export const orderDal = {
  async listPage(options: {
    query?: string;
    sortBy: "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }) {
    const db = await getDb();
    const conditions: SQL[] = [isNull(orders.deletedAt)];
    if (options.query) {
      const pattern = containsPattern(options.query);
      conditions.push(
        or(
          like(orders.email, pattern),
          like(orders.customDisplayId, pattern),
        ) as SQL,
      );
    }
    const where = and(...conditions);
    const sortColumn =
      options.sortBy === "updatedAt" ? orders.updatedAt : orders.createdAt;
    const orderBy =
      options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    const [totals, rows] = await Promise.all([
      db.select({ value: count() }).from(orders).where(where),
      db
        .select({ order: orders, summary: orderSummaries.totals })
        .from(orders)
        .leftJoin(
          orderSummaries,
          and(
            eq(orderSummaries.orderId, orders.id),
            eq(orderSummaries.version, orders.version),
            isNull(orderSummaries.deletedAt),
          ),
        )
        .where(where)
        .orderBy(orderBy)
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);
    const data = rows.map(toOrderListDTO);
    return { orders: data, total: Number(totals[0]?.value ?? 0) };
  },

  async findById(id: string): Promise<OrderDetailDTO | null> {
    const db = await getDb();
    const rows = await db
      .select({ order: orders, summary: orderSummaries.totals })
      .from(orders)
      .leftJoin(
        orderSummaries,
        and(
          eq(orderSummaries.orderId, orders.id),
          eq(orderSummaries.version, orders.version),
          isNull(orderSummaries.deletedAt),
        ),
      )
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const [addresses, paymentRows, unfulfilledRows] = await Promise.all([
      db
        .select()
        .from(orderAddresses)
        .where(
          and(
            inArray(
              orderAddresses.id,
              [row.order.shippingAddressId, row.order.billingAddressId].filter(
                (value): value is string => Boolean(value),
              ),
            ),
            isNull(orderAddresses.deletedAt),
          ),
        ),
      db
        .select({ collection: paymentCollections })
        .from(orderPaymentCollections)
        .innerJoin(
          paymentCollections,
          eq(
            paymentCollections.id,
            orderPaymentCollections.paymentCollectionId,
          ),
        )
        .where(eq(orderPaymentCollections.orderId, id))
        .limit(1),
      db
        .select({ id: orderItems.id })
        .from(orderItems)
        .where(
          and(
            eq(orderItems.orderId, id),
            eq(orderItems.version, row.order.version),
            isNull(orderItems.deletedAt),
            sql`${orderItems.fulfilledQuantity} < ${orderItems.quantity}`,
          ),
        )
        .limit(1),
    ]);
    return toOrderDetailDTO({
      row,
      addresses,
      payment: paymentRows[0]?.collection ?? null,
      hasUnfulfilledItems: unfulfilledRows.length > 0,
    });
  },

  async listItemsPage(options: {
    orderId: string;
    page: number;
    limit: number;
  }) {
    const db = await getDb();
    const [order] = await db
      .select({ version: orders.version })
      .from(orders)
      .where(and(eq(orders.id, options.orderId), isNull(orders.deletedAt)))
      .limit(1);
    if (!order) return { items: [], total: 0 };
    const condition = and(
      eq(orderItems.orderId, options.orderId),
      eq(orderItems.version, order.version),
      isNull(orderItems.deletedAt),
      isNull(orderLineItems.deletedAt),
    );
    const [totals, rows] = await Promise.all([
      db
        .select({ value: count() })
        .from(orderItems)
        .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
        .where(condition),
      db
        .select({ item: orderLineItems, state: orderItems })
        .from(orderItems)
        .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
        .where(condition)
        .orderBy(asc(orderItems.createdAt), asc(orderItems.id))
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);
    return {
      items: rows.map(toOrderItemDTO),
      total: Number(totals[0]?.value ?? 0),
    };
  },

  async listFulfillableItems(orderId: string, limit: number) {
    const db = await getDb();
    const [order] = await db
      .select({ version: orders.version })
      .from(orders)
      .where(and(eq(orders.id, orderId), isNull(orders.deletedAt)))
      .limit(1);
    if (!order) return [];
    const rows = await db
      .select({ item: orderLineItems, state: orderItems })
      .from(orderItems)
      .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
      .where(
        and(
          eq(orderItems.orderId, orderId),
          eq(orderItems.version, order.version),
          isNull(orderItems.deletedAt),
          isNull(orderLineItems.deletedAt),
          sql`${orderItems.fulfilledQuantity} < ${orderItems.quantity}`,
        ),
      )
      .orderBy(asc(orderItems.createdAt), asc(orderItems.id))
      .limit(limit + 1);
    return rows.map(toOrderItemDTO);
  },

  async listFulfillmentsPage(options: {
    orderId: string;
    page: number;
    limit: number;
  }) {
    const db = await getDb();
    const condition = and(
      eq(orderFulfillments.orderId, options.orderId),
      isNull(fulfillments.deletedAt),
    );
    const [totals, fulfillmentRows] = await Promise.all([
      db
        .select({ value: count() })
        .from(orderFulfillments)
        .innerJoin(
          fulfillments,
          eq(fulfillments.id, orderFulfillments.fulfillmentId),
        )
        .where(condition),
      db
        .select({ fulfillment: fulfillments })
        .from(orderFulfillments)
        .innerJoin(
          fulfillments,
          eq(fulfillments.id, orderFulfillments.fulfillmentId),
        )
        .where(condition)
        .orderBy(desc(fulfillments.createdAt), asc(fulfillments.id))
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);
    const fulfillmentIds = fulfillmentRows.map((row) => row.fulfillment.id);
    const itemRows =
      fulfillmentIds.length === 0
        ? []
        : await db
            .select()
            .from(fulfillmentItems)
            .where(
              and(
                inArray(fulfillmentItems.fulfillmentId, fulfillmentIds),
                isNull(fulfillmentItems.deletedAt),
              ),
            )
            .orderBy(asc(fulfillmentItems.createdAt));
    const hydratedRows: FulfillmentRow[] = [];
    for (const { fulfillment } of fulfillmentRows) {
      const items = itemRows.filter(
        (item) => item.fulfillmentId === fulfillment.id,
      );
      if (items.length === 0) {
        hydratedRows.push({ fulfillment, item: null });
      } else {
        hydratedRows.push(...items.map((item) => ({ fulfillment, item })));
      }
    }
    return {
      fulfillments: toOrderFulfillmentDTOs(hydratedRows),
      total: Number(totals[0]?.value ?? 0),
    };
  },

  async create(
    data: {
      id: string;
      email?: string;
      currencyCode: string;
      status: "draft" | "pending";
      noNotification: boolean;
      itemTitle?: string;
      itemSku?: string;
      quantity: number;
      unitPrice: number;
    },
    displayIdRetry = 0,
  ): Promise<{ id: string; displayId: number }> {
    const db = await getDb();
    const nextRows = await db
      .select({ value: max(orders.displayId) })
      .from(orders);
    const displayId = Number(nextRows[0]?.value ?? 0) + 1;
    const now = new Date().toISOString();
    const lineItemId = crypto.randomUUID();
    try {
      if (data.itemTitle) {
        await db.batch([
          db.insert(orders).values({
            id: data.id,
            displayId,
            status: data.status,
            email: data.email || null,
            currencyCode: data.currencyCode,
            isDraftOrder: data.status === "draft",
            noNotification: data.noNotification,
            createdAt: now,
            updatedAt: now,
          }),
          db.insert(orderSummaries).values({
            id: crypto.randomUUID(),
            orderId: data.id,
            version: 1,
            totals: { total: Math.round(data.unitPrice * data.quantity) },
            createdAt: now,
            updatedAt: now,
          }),
          db.insert(orderLineItems).values({
            id: lineItemId,
            title: data.itemTitle,
            variantSku: data.itemSku || null,
            unitPrice: Math.round(data.unitPrice),
            isCustomPrice: true,
            createdAt: now,
            updatedAt: now,
          }),
          db.insert(orderItems).values({
            id: crypto.randomUUID(),
            orderId: data.id,
            itemId: lineItemId,
            version: 1,
            quantity: data.quantity,
            unitPrice: Math.round(data.unitPrice),
            createdAt: now,
            updatedAt: now,
          }),
        ]);
      } else {
        await db.batch([
          db.insert(orders).values({
            id: data.id,
            displayId,
            status: data.status,
            email: data.email || null,
            currencyCode: data.currencyCode,
            isDraftOrder: data.status === "draft",
            noNotification: data.noNotification,
            createdAt: now,
            updatedAt: now,
          }),
          db.insert(orderSummaries).values({
            id: crypto.randomUUID(),
            orderId: data.id,
            version: 1,
            totals: { total: 0 },
            createdAt: now,
            updatedAt: now,
          }),
        ]);
      }
    } catch (error) {
      if (displayIdRetry < 3 && isOrderDisplayIdConflict(error)) {
        return this.create(data, displayIdRetry + 1);
      }
      throw error;
    }
    return { id: data.id, displayId };
  },

  async update(
    id: string,
    data: {
      email?: string;
      status: OrderDetailDTO["status"];
      noNotification: boolean;
    },
  ) {
    const db = await getDb();
    await db
      .update(orders)
      .set({
        email: data.email || null,
        status: data.status,
        isDraftOrder: data.status === "draft",
        noNotification: data.noNotification,
        canceledAt:
          data.status === "canceled" ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)));
  },

  async updateMetadata(id: string, metadata: Metadata) {
    const db = await getDb();
    await db
      .update(orders)
      .set({ metadata, updatedAt: new Date().toISOString() })
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)));
  },
};
