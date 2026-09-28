import { getDb } from "@/db";
import {
  orderAddresses,
  orderItems,
  orderLineItems,
  orders,
  orderSummaries,
} from "@/db/order.schema";
import { likeContains } from "@/lib/db/like-query";
import { totalFromOrderSnapshot } from "@/lib/order/mapper/order.mapper";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  or,
  type SQL,
} from "drizzle-orm";
import type { OrderExportItemDTO } from "./order-export.dto";

export interface OrderExportPageInput {
  query?: string;
  sortBy: "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
  offset: number;
}

export const orderExportDal = {
  async listPage(options: OrderExportPageInput): Promise<{
    items: OrderExportItemDTO[];
    total: number;
  }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(orders.deletedAt)];
    if (options.query) {
      conditions.push(
        or(
          likeContains(orders.email, options.query),
          likeContains(orders.customDisplayId, options.query),
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
        .orderBy(orderBy, asc(orders.id))
        .limit(options.limit)
        .offset(options.offset),
    ]);
    if (!rows.length) return { items: [], total: Number(totals[0]?.value ?? 0) };

    const orderIds = rows.map(({ order }) => order.id);
    const addressIds = rows.flatMap(({ order }) =>
      [order.shippingAddressId, order.billingAddressId].filter(
        (id): id is string => Boolean(id),
      ),
    );
    const [addresses, itemRows] = await Promise.all([
      addressIds.length
        ? db
            .select()
            .from(orderAddresses)
            .where(
              and(inArray(orderAddresses.id, addressIds), isNull(orderAddresses.deletedAt)),
            )
        : Promise.resolve([]),
      db
        .select({ orderId: orderItems.orderId, lineItem: orderLineItems, state: orderItems })
        .from(orderItems)
        .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
        .innerJoin(
          orders,
          and(
            eq(orders.id, orderItems.orderId),
            eq(orders.version, orderItems.version),
            isNull(orders.deletedAt),
          ),
        )
        .where(
          and(
            inArray(orderItems.orderId, orderIds),
            isNull(orderItems.deletedAt),
            isNull(orderLineItems.deletedAt),
          ),
        )
        .orderBy(asc(orderItems.createdAt), asc(orderItems.id)),
    ]);
    const addressById = new Map(addresses.map((address) => [address.id, address]));
    const itemsByOrderId = new Map<
      string,
      OrderExportItemDTO["items"]
    >();
    for (const { orderId, lineItem, state } of itemRows) {
      const items = itemsByOrderId.get(orderId) ?? [];
      items.push({ lineItem, state });
      itemsByOrderId.set(orderId, items);
    }

    return {
      items: rows.map(({ order, summary }) => ({
        order,
        total: totalFromOrderSnapshot(summary),
        summary,
        shippingAddress: order.shippingAddressId
          ? (addressById.get(order.shippingAddressId) ?? null)
          : null,
        billingAddress: order.billingAddressId
          ? (addressById.get(order.billingAddressId) ?? null)
          : null,
        items: itemsByOrderId.get(order.id) ?? [],
      })),
      total: Number(totals[0]?.value ?? 0),
    };
  },
};
