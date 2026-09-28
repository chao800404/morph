import { getDb } from "@/db";
import {
  inventoryLevels,
  reservationItems,
  inventoryItems,
  productVariantInventoryItems,
  productVariants,
  orderChangeActions,
  orderChanges,
  orderClaims,
  orderClaimItems,
  orderCreditLines,
  orderItems,
  orderExchanges,
  orderExchangeItems,
  orderLineItems,
  orderLineItemAdjustments,
  orderLineItemTaxLines,
  orderAddresses,
  orderShippings,
  orderShippingMethods,
  orderShippingMethodTaxLines,
  orderSummaries,
  orderTransactions,
  orders,
  returnItems,
  returnReasons,
  returns,
} from "@/db/schema";
import { stockLocations } from "@/db/stock-location.schema";
import { products } from "@/db/product.schema";
import { productSalesChannels } from "@/db/link.schema";
import { regions } from "@/db/region.schema";
import { promotionApplicationMethods, promotions } from "@/db/promotion.schema";
import { firstOrNull } from "@/lib/db/single-row";
import type {
  OrderExchangeDTO,
  OrderReturnDTO,
} from "@/lib/order/dto/order.dto";
import { pricingDal } from "@/lib/pricing/dal/pricing.dal";
import { calculateAmountLine } from "@/lib/cart/cart-totals";
import { calculateOrderClaimRefundAmount } from "@/lib/order/order-claim-refund";
import { availableRefundClaimQuantity } from "@/lib/order/order-claim-availability";
import { calculateTaxLines } from "@/lib/tax/calculate-tax-lines.server";
import { loadPromotionRules } from "@/lib/promotion/dal/promotion-rules.dal";
import { evaluateExchangePromotionCarryOver } from "@/lib/promotion/exchange-promotion";
import { and, asc, count, eq, inArray, isNull, max, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { batchGuard } from "@/lib/db/batch-guard";

/**
 * Guard both the root version and every item snapshot copied by this write.
 * Fulfillment transitions currently update item lifecycle counters without
 * changing the order version, so checking the item values closes that race too.
 * The condition goes through `batchGuard`.
 */
const versionGuard = (input: {
  orderId: string;
  version: number;
  states: Array<typeof orderItems.$inferSelect>;
  ownership?: {
    customerId: string;
    email: string;
    salesChannelId?: string;
  };
}) => {
  const snapshot = JSON.stringify(
    input.states.map((state) => ({
      id: state.id,
      quantity: state.quantity,
      fulfilledQuantity: state.fulfilledQuantity,
      deliveredQuantity: state.deliveredQuantity,
      shippedQuantity: state.shippedQuantity,
      returnRequestedQuantity: state.returnRequestedQuantity,
      returnReceivedQuantity: state.returnReceivedQuantity,
      returnDismissedQuantity: state.returnDismissedQuantity,
      writtenOffQuantity: state.writtenOffQuantity,
    })),
  );
  return sql`
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = ${input.orderId}
        AND o.version = ${input.version}
        AND o.deleted_at IS NULL
        AND o.canceled_at IS NULL
        AND (
          ${
            input.ownership
              ? sql`o.customer_id = ${input.ownership.customerId} OR lower(o.email) = ${input.ownership.email}`
              : sql`1 = 1`
          }
        )
        AND (
          ${
            input.ownership?.salesChannelId
              ? sql`o.sales_channel_id = ${input.ownership.salesChannelId}`
              : sql`1 = 1`
          }
        )
        AND (
          SELECT COUNT(*) FROM order_items oi
          WHERE oi.order_id = o.id
            AND oi.version = o.version
            AND oi.deleted_at IS NULL
        ) = json_array_length(${snapshot})
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(${snapshot}) expected
          LEFT JOIN order_items oi
            ON oi.id = json_extract(expected.value, '$.id')
           AND oi.order_id = o.id
           AND oi.version = o.version
           AND oi.deleted_at IS NULL
          WHERE oi.id IS NULL
             OR oi.quantity != json_extract(expected.value, '$.quantity')
             OR oi.fulfilled_quantity != json_extract(expected.value, '$.fulfilledQuantity')
             OR oi.delivered_quantity != json_extract(expected.value, '$.deliveredQuantity')
             OR oi.shipped_quantity != json_extract(expected.value, '$.shippedQuantity')
             OR oi.return_requested_quantity != json_extract(expected.value, '$.returnRequestedQuantity')
             OR oi.return_received_quantity != json_extract(expected.value, '$.returnReceivedQuantity')
             OR oi.return_dismissed_quantity != json_extract(expected.value, '$.returnDismissedQuantity')
             OR oi.written_off_quantity != json_extract(expected.value, '$.writtenOffQuantity')
        )
      )
  `;
};

const snapshotRows = async (input: {
  db: Awaited<ReturnType<typeof getDb>>;
  orderId: string;
  fromVersion: number;
  toVersion: number;
  now: string;
  states: Array<typeof orderItems.$inferSelect>;
  stateChanges?: Map<
    string,
    { requested: number; received: number; dismissed: number }
  >;
  excludeItemIds?: Set<string>;
}): Promise<BatchItem<"sqlite">[]> => {
  const { db, orderId, fromVersion, toVersion, now } = input;
  const [shippingRows, summaryRows, transactionRows, creditRows] =
    await Promise.all([
      db
        .select()
        .from(orderShippings)
        .where(
          and(
            eq(orderShippings.orderId, orderId),
            eq(orderShippings.version, fromVersion),
            isNull(orderShippings.returnId),
            isNull(orderShippings.exchangeId),
            isNull(orderShippings.claimId),
            isNull(orderShippings.deletedAt),
          ),
        ),
      db
        .select()
        .from(orderSummaries)
        .where(
          and(
            eq(orderSummaries.orderId, orderId),
            eq(orderSummaries.version, fromVersion),
            isNull(orderSummaries.deletedAt),
          ),
        ),
      db
        .select()
        .from(orderTransactions)
        .where(
          and(
            eq(orderTransactions.orderId, orderId),
            eq(orderTransactions.version, fromVersion),
            isNull(orderTransactions.deletedAt),
          ),
        ),
      db
        .select()
        .from(orderCreditLines)
        .where(
          and(
            eq(orderCreditLines.orderId, orderId),
            eq(orderCreditLines.version, fromVersion),
            isNull(orderCreditLines.deletedAt),
          ),
        ),
    ]);

  const statements: BatchItem<"sqlite">[] = [];
  for (const state of input.states) {
    if (input.excludeItemIds?.has(state.itemId)) continue;
    const change = input.stateChanges?.get(state.itemId);
    const { id: _id, deletedAt: _deletedAt, ...snapshot } = state;
    statements.push(
      db.insert(orderItems).values({
        ...snapshot,
        id: crypto.randomUUID(),
        version: toVersion,
        returnRequestedQuantity:
          state.returnRequestedQuantity + (change?.requested ?? 0),
        returnReceivedQuantity:
          state.returnReceivedQuantity + (change?.received ?? 0),
        returnDismissedQuantity:
          state.returnDismissedQuantity + (change?.dismissed ?? 0),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
  }
  for (const row of shippingRows) {
    const { id: _id, deletedAt: _deletedAt, ...snapshot } = row;
    statements.push(
      db.insert(orderShippings).values({
        ...snapshot,
        id: crypto.randomUUID(),
        version: toVersion,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
  }
  for (const row of summaryRows) {
    const { id: _id, deletedAt: _deletedAt, ...snapshot } = row;
    statements.push(
      db.insert(orderSummaries).values({
        ...snapshot,
        id: crypto.randomUUID(),
        version: toVersion,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
  }
  for (const row of transactionRows) {
    const { id: _id, deletedAt: _deletedAt, ...snapshot } = row;
    statements.push(
      db.insert(orderTransactions).values({
        ...snapshot,
        id: crypto.randomUUID(),
        version: toVersion,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
  }
  for (const row of creditRows) {
    const { id: _id, deletedAt: _deletedAt, ...snapshot } = row;
    statements.push(
      db.insert(orderCreditLines).values({
        ...snapshot,
        id: crypto.randomUUID(),
        version: toVersion,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
  }
  return statements;
};

const readCurrentOrder = async (
  db: Awaited<ReturnType<typeof getDb>>,
  orderId: string,
) => {
  const order = firstOrNull(
    await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), isNull(orders.deletedAt)))
      .limit(1),
  );
  if (!order) return null;
  const states = await db
    .select()
    .from(orderItems)
    .where(
      and(
        eq(orderItems.orderId, orderId),
        eq(orderItems.version, order.version),
        isNull(orderItems.deletedAt),
      ),
    );
  return { order, states };
};

const resultForReturn = async (
  db: Awaited<ReturnType<typeof getDb>>,
  returnRow: typeof returns.$inferSelect,
): Promise<OrderReturnDTO> => {
  const items = await db
    .select({ item: returnItems, line: orderLineItems, reason: returnReasons })
    .from(returnItems)
    .innerJoin(orderLineItems, eq(orderLineItems.id, returnItems.itemId))
    .leftJoin(returnReasons, eq(returnReasons.id, returnItems.reasonId))
    .where(
      and(
        eq(returnItems.returnId, returnRow.id),
        isNull(returnItems.deletedAt),
      ),
    )
    .orderBy(asc(returnItems.createdAt), asc(returnItems.id));
  return {
    id: returnRow.id,
    orderId: returnRow.orderId,
    displayId: returnRow.displayId,
    claimId: returnRow.claimId,
    exchangeId: returnRow.exchangeId,
    status: returnRow.status,
    locationId: returnRow.locationId,
    requestedAt: returnRow.requestedAt,
    receivedAt: returnRow.receivedAt,
    canceledAt: returnRow.canceledAt,
    items: items.map(({ item, line, reason }) => ({
      id: item.id,
      itemId: item.itemId,
      reasonId: item.reasonId,
      title: line.title,
      sku: line.variantSku,
      quantity: item.quantity,
      receivedQuantity: item.receivedQuantity,
      damagedQuantity: item.damagedQuantity,
      reason: reason?.label ?? null,
      note: item.note,
    })),
  };
};

const resultForClaim = async (
  db: Awaited<ReturnType<typeof getDb>>,
  claimRow: typeof orderClaims.$inferSelect,
) => {
  const [rows, returnShippingRows, outboundShippingRows] = await Promise.all([
    db
      .select({ claimItem: orderClaimItems, line: orderLineItems })
      .from(orderClaimItems)
      .innerJoin(orderLineItems, eq(orderLineItems.id, orderClaimItems.itemId))
      .where(
        and(
          eq(orderClaimItems.claimId, claimRow.id),
          isNull(orderClaimItems.deletedAt),
          isNull(orderLineItems.deletedAt),
        ),
      )
      .orderBy(asc(orderClaimItems.createdAt), asc(orderClaimItems.id)),
    claimRow.returnId
      ? db
          .select({ method: orderShippingMethods })
          .from(orderShippings)
          .innerJoin(
            orderShippingMethods,
            and(
              eq(orderShippingMethods.id, orderShippings.shippingMethodId),
              isNull(orderShippingMethods.deletedAt),
            ),
          )
          .where(
            and(
              eq(orderShippings.returnId, claimRow.returnId),
              isNull(orderShippings.deletedAt),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
    db
      .select({ method: orderShippingMethods })
      .from(orderShippings)
      .innerJoin(
        orderShippingMethods,
        and(
          eq(orderShippingMethods.id, orderShippings.shippingMethodId),
          isNull(orderShippingMethods.deletedAt),
        ),
      )
      .where(
        and(
          eq(orderShippings.claimId, claimRow.id),
          isNull(orderShippings.deletedAt),
        ),
      )
      .limit(1),
  ]);
  const returnShipping = firstOrNull(returnShippingRows)?.method ?? null;
  const outboundShipping = firstOrNull(outboundShippingRows)?.method ?? null;
  return {
    id: claimRow.id,
    displayId: claimRow.displayId,
    returnId: claimRow.returnId,
    returnShipping: returnShipping
      ? { name: returnShipping.name, amount: returnShipping.amount }
      : null,
    outboundShipping: outboundShipping
      ? { name: outboundShipping.name, amount: outboundShipping.amount }
      : null,
    type: claimRow.type,
    refundAmount: claimRow.refundAmount,
    orderVersion: claimRow.orderVersion,
    createdAt: claimRow.createdAt,
    canceledAt: claimRow.canceledAt,
    items: rows.map(({ claimItem, line }) => ({
      id: claimItem.id,
      itemId: claimItem.itemId,
      title: line.title,
      sku: line.variantSku,
      quantity: claimItem.quantity,
      reason: claimItem.reason,
      note: claimItem.note,
      isAdditionalItem: claimItem.isAdditionalItem,
    })),
  };
};

const resultForExchange = async (
  db: Awaited<ReturnType<typeof getDb>>,
  exchangeRow: typeof orderExchanges.$inferSelect,
): Promise<OrderExchangeDTO> => {
  const [exchangeItems, returnRow, returnShippingRows, outboundShippingRows] =
    await Promise.all([
      db
        .select({ exchangeItem: orderExchangeItems, line: orderLineItems })
        .from(orderExchangeItems)
        .innerJoin(
          orderLineItems,
          eq(orderLineItems.id, orderExchangeItems.itemId),
        )
        .where(
          and(
            eq(orderExchangeItems.exchangeId, exchangeRow.id),
            isNull(orderExchangeItems.deletedAt),
            isNull(orderLineItems.deletedAt),
          ),
        )
        .orderBy(asc(orderExchangeItems.createdAt), asc(orderExchangeItems.id)),
      exchangeRow.returnId
        ? firstOrNull(
            await db
              .select()
              .from(returns)
              .where(
                and(
                  eq(returns.id, exchangeRow.returnId),
                  isNull(returns.deletedAt),
                ),
              )
              .limit(1),
          )
        : Promise.resolve(null),
      exchangeRow.returnId
        ? db
            .select({ method: orderShippingMethods })
            .from(orderShippings)
            .innerJoin(
              orderShippingMethods,
              and(
                eq(orderShippingMethods.id, orderShippings.shippingMethodId),
                isNull(orderShippingMethods.deletedAt),
              ),
            )
            .where(
              and(
                eq(orderShippings.returnId, exchangeRow.returnId),
                isNull(orderShippings.deletedAt),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
      db
        .select({ method: orderShippingMethods })
        .from(orderShippings)
        .innerJoin(
          orderShippingMethods,
          and(
            eq(orderShippingMethods.id, orderShippings.shippingMethodId),
            isNull(orderShippingMethods.deletedAt),
          ),
        )
        .where(
          and(
            eq(orderShippings.exchangeId, exchangeRow.id),
            isNull(orderShippings.deletedAt),
          ),
        )
        .limit(1),
    ]);
  const inboundItems = returnRow
    ? await db
        .select({ item: returnItems, line: orderLineItems })
        .from(returnItems)
        .innerJoin(orderLineItems, eq(orderLineItems.id, returnItems.itemId))
        .where(
          and(
            eq(returnItems.returnId, returnRow.id),
            isNull(returnItems.deletedAt),
            isNull(orderLineItems.deletedAt),
          ),
        )
        .orderBy(asc(returnItems.createdAt), asc(returnItems.id))
    : [];
  const locationName = returnRow?.locationId
    ? (firstOrNull(
        await db
          .select({ name: stockLocations.name })
          .from(stockLocations)
          .where(
            and(
              eq(stockLocations.id, returnRow.locationId),
              isNull(stockLocations.deletedAt),
            ),
          )
          .limit(1),
      )?.name ?? null)
    : null;
  const returnShipping = firstOrNull(returnShippingRows)?.method ?? null;
  const outboundShipping = firstOrNull(outboundShippingRows)?.method ?? null;
  return {
    id: exchangeRow.id,
    displayId: exchangeRow.displayId,
    returnId: exchangeRow.returnId,
    differenceDue: exchangeRow.differenceDue ?? 0,
    allowBackorder: exchangeRow.allowBackorder,
    createdAt: exchangeRow.createdAt,
    canceledAt: exchangeRow.canceledAt,
    returnStatus: returnRow?.status ?? null,
    locationName,
    returnShipping: returnShipping
      ? { name: returnShipping.name, amount: returnShipping.amount }
      : null,
    outboundShipping: outboundShipping
      ? { name: outboundShipping.name, amount: outboundShipping.amount }
      : null,
    inboundItems: inboundItems.map(({ item, line }) => ({
      id: item.id,
      itemId: item.itemId,
      title: line.title,
      sku: line.variantSku,
      quantity: item.quantity,
      receivedQuantity: item.receivedQuantity,
    })),
    items: exchangeItems.map(({ exchangeItem, line }) => ({
      id: exchangeItem.id,
      itemId: exchangeItem.itemId,
      title: line.title,
      sku: line.variantSku,
      quantity: exchangeItem.quantity,
      unitPrice: line.unitPrice ?? 0,
    })),
  };
};

type ReturnResult =
  | {
      success: true;
      returnId: string;
      displayId?: number;
      exchangeId?: string;
      claimId?: string;
      refundAmount?: number;
    }
  | {
      success: false;
      reason:
        | "NOT_FOUND"
        | "ORDER_CANCELED"
        | "INVALID_QUANTITY"
        | "INVALID_REASON"
        | "INVALID_LOCATION"
        | "INVALID_VARIANT"
        | "NO_PRICE"
        | "INVENTORY_UNAVAILABLE"
        | "RETURN_CLOSED"
        | "EXCHANGE_CLOSED"
        | "CONFLICT";
    };

type RefundClaimResult =
  | {
      success: true;
      returnId?: string;
      displayId: number;
      claimId: string;
      refundAmount: number;
    }
  | Extract<ReturnResult, { success: false }>;

type ReplacementClaimResult =
  | {
      success: true;
      returnId?: string;
      displayId: number;
      claimId: string;
    }
  | Extract<ReturnResult, { success: false }>;

const listOpenNoReturnClaimQuantities = async (
  db: Awaited<ReturnType<typeof getDb>>,
  orderId: string,
) => {
  const rows = await db
    .select({
      itemId: orderClaimItems.itemId,
      quantity: orderClaimItems.quantity,
    })
    .from(orderClaimItems)
    .innerJoin(orderClaims, eq(orderClaims.id, orderClaimItems.claimId))
    .where(
      and(
        eq(orderClaims.orderId, orderId),
        eq(orderClaims.type, "refund"),
        isNull(orderClaims.returnId),
        isNull(orderClaims.canceledAt),
        isNull(orderClaims.deletedAt),
        isNull(orderClaimItems.deletedAt),
      ),
    );
  const quantities = new Map<string, number>();
  for (const row of rows)
    quantities.set(
      row.itemId,
      (quantities.get(row.itemId) ?? 0) + row.quantity,
    );
  return quantities;
};

const runBatch = async (
  db: Awaited<ReturnType<typeof getDb>>,
  statements: BatchItem<"sqlite">[],
) => {
  if (statements.length === 0) return;
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
};

const runVersionedBatch = async (
  db: Awaited<ReturnType<typeof getDb>>,
  statements: BatchItem<"sqlite">[],
): Promise<boolean> => {
  try {
    await runBatch(db, statements);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("malformed json")) return false;
    throw error;
  }
};

const chunksOf = <T>(values: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    chunks.push(values.slice(index, index + size));
  return chunks;
};

export const orderReturnDal = {
  async listClaims(orderId: string) {
    const db = await getDb();
    const rows = await db
      .select()
      .from(orderClaims)
      .where(
        and(eq(orderClaims.orderId, orderId), isNull(orderClaims.deletedAt)),
      )
      .orderBy(asc(orderClaims.createdAt), asc(orderClaims.id));
    return Promise.all(rows.map((row) => resultForClaim(db, row)));
  },

  async listExchanges(orderId: string) {
    const db = await getDb();
    const rows = await db
      .select()
      .from(orderExchanges)
      .where(
        and(
          eq(orderExchanges.orderId, orderId),
          isNull(orderExchanges.deletedAt),
        ),
      )
      .orderBy(asc(orderExchanges.createdAt), asc(orderExchanges.id));
    return Promise.all(rows.map((row) => resultForExchange(db, row)));
  },

  async listPage(input: {
    orderId?: string;
    status?: OrderReturnDTO["status"];
    page?: number;
    offset?: number;
    limit: number;
  }) {
    const db = await getDb();
    const where = and(
      ...(input.orderId ? [eq(returns.orderId, input.orderId)] : []),
      ...(input.status ? [eq(returns.status, input.status)] : []),
      isNull(returns.deletedAt),
    );
    const [countRows, rows] = await Promise.all([
      db.select({ value: count() }).from(returns).where(where),
      db
        .select()
        .from(returns)
        .where(where)
        .orderBy(asc(returns.createdAt), asc(returns.id))
        .limit(input.limit)
        .offset(input.offset ?? ((input.page ?? 1) - 1) * input.limit),
    ]);
    return {
      returns: await Promise.all(rows.map((row) => resultForReturn(db, row))),
      total: Number(countRows[0]?.value ?? 0),
    };
  },

  async findById(id: string): Promise<OrderReturnDTO | null> {
    const db = await getDb();
    const row = firstOrNull(
      await db
        .select()
        .from(returns)
        .where(and(eq(returns.id, id), isNull(returns.deletedAt)))
        .limit(1),
    );
    return row ? resultForReturn(db, row) : null;
  },

  async listReturnableItems(orderId: string) {
    const db = await getDb();
    const current = await readCurrentOrder(db, orderId);
    if (!current) return null;
    const lines = await db
      .select({ line: orderLineItems })
      .from(orderItems)
      .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
      .where(
        and(
          eq(orderItems.orderId, orderId),
          eq(orderItems.version, current.order.version),
          isNull(orderItems.deletedAt),
          isNull(orderLineItems.deletedAt),
        ),
      );
    const lineById = new Map(lines.map(({ line }) => [line.id, line]));
    const noReturnClaimQuantityByItemId = await listOpenNoReturnClaimQuantities(
      db,
      orderId,
    );
    return {
      items: current.states.flatMap((state) => {
        const line = lineById.get(state.itemId);
        const available = availableRefundClaimQuantity({
          deliveredQuantity: state.deliveredQuantity,
          returnRequestedQuantity: state.returnRequestedQuantity,
          returnReceivedQuantity: state.returnReceivedQuantity,
          returnDismissedQuantity: state.returnDismissedQuantity,
          activeNoReturnClaimQuantity:
            noReturnClaimQuantityByItemId.get(state.itemId) ?? 0,
        });
        return line && available > 0
          ? [
              {
                id: line.id,
                productId: line.productId,
                title: line.title,
                sku: line.variantSku,
                deliveredQuantity: state.deliveredQuantity,
                returnableQuantity: available,
                unitPrice: state.unitPrice ?? line.unitPrice ?? 0,
              },
            ]
          : [];
      }),
    };
  },

  async createExchange(input: {
    orderId: string;
    locationId: string;
    allowBackorder: boolean;
    carryOverPromotions: boolean;
    sendNotification: boolean;
    returnShipping?: { name: string; amount: number };
    outboundShipping?: { name: string; amount: number };
    items: Array<{
      itemId: string;
      variantId: string;
      quantity: number;
      note?: string;
    }>;
    createdBy: string;
  }): Promise<ReturnResult> {
    const db = await getDb();
    const current = await readCurrentOrder(db, input.orderId);
    if (!current) return { success: false, reason: "NOT_FOUND" };
    if (current.order.canceledAt || current.order.isDraftOrder)
      return { success: false, reason: "ORDER_CANCELED" };
    const location = firstOrNull(
      await db
        .select({ id: stockLocations.id })
        .from(stockLocations)
        .where(
          and(
            eq(stockLocations.id, input.locationId),
            isNull(stockLocations.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!location) return { success: false, reason: "INVALID_LOCATION" };
    if (
      !input.items.length ||
      new Set(input.items.map((item) => item.itemId)).size !==
        input.items.length
    )
      return { success: false, reason: "INVALID_QUANTITY" };

    const itemIds = [...new Set(input.items.map((item) => item.itemId))];
    const variantIds = [...new Set(input.items.map((item) => item.variantId))];
    const [sourceRows, variantRows] = await Promise.all([
      db
        .select({ state: orderItems, line: orderLineItems })
        .from(orderItems)
        .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
        .where(
          and(
            eq(orderItems.orderId, input.orderId),
            eq(orderItems.version, current.order.version),
            inArray(orderItems.itemId, itemIds),
            isNull(orderItems.deletedAt),
            isNull(orderLineItems.deletedAt),
          ),
        ),
      db
        .select({ variant: productVariants, product: products })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .innerJoin(
          productSalesChannels,
          and(
            eq(productSalesChannels.productId, products.id),
            eq(
              productSalesChannels.salesChannelId,
              current.order.salesChannelId ?? "",
            ),
          ),
        )
        .where(
          and(
            inArray(productVariants.id, variantIds),
            eq(products.status, "published"),
            isNull(productVariants.deletedAt),
            isNull(products.deletedAt),
          ),
        ),
    ]);
    const sourceById = new Map(sourceRows.map((row) => [row.line.id, row]));
    const variantById = new Map(
      variantRows.map((row) => [row.variant.id, row]),
    );
    const noReturnClaimQuantityByItemId = await listOpenNoReturnClaimQuantities(
      db,
      input.orderId,
    );
    if (
      input.items.some((item) => {
        const source = sourceById.get(item.itemId);
        const available = source
          ? availableRefundClaimQuantity({
              deliveredQuantity: source.state.deliveredQuantity,
              returnRequestedQuantity: source.state.returnRequestedQuantity,
              returnReceivedQuantity: source.state.returnReceivedQuantity,
              returnDismissedQuantity: source.state.returnDismissedQuantity,
              activeNoReturnClaimQuantity:
                noReturnClaimQuantityByItemId.get(item.itemId) ?? 0,
            })
          : -1;
        return (
          !source ||
          !variantById.has(item.variantId) ||
          !Number.isInteger(item.quantity) ||
          item.quantity <= 0 ||
          item.quantity > available
        );
      })
    )
      return { success: false, reason: "INVALID_QUANTITY" };

    const now = new Date().toISOString();
    const resolvedItems = await Promise.all(
      input.items.map(async (item) => {
        const catalogue = variantById.get(item.variantId)!;
        const price = await pricingDal.resolveVariantPrice(item.variantId, {
          currencyCode: current.order.currencyCode,
          quantity: item.quantity,
          ...(current.order.regionId
            ? { regionId: current.order.regionId }
            : {}),
          ...(current.order.salesChannelId
            ? { salesChannelId: current.order.salesChannelId }
            : {}),
          ...(current.order.customerId
            ? { customerId: current.order.customerId }
            : {}),
        });
        return { ...item, ...catalogue, price };
      }),
    );
    if (resolvedItems.some((item) => !item.price))
      return { success: false, reason: "NO_PRICE" };

    const activeVariantIds = resolvedItems.map((item) => item.variant.id);
    const inventoryRows = activeVariantIds.length
      ? await db
          .select({
            link: productVariantInventoryItems,
            inventory: inventoryItems,
          })
          .from(productVariantInventoryItems)
          .innerJoin(
            inventoryItems,
            eq(inventoryItems.id, productVariantInventoryItems.inventoryItemId),
          )
          .where(
            and(
              inArray(productVariantInventoryItems.variantId, activeVariantIds),
              isNull(inventoryItems.deletedAt),
            ),
          )
      : [];
    const inventoryByVariant = new Map<string, typeof inventoryRows>();
    for (const row of inventoryRows) {
      const group = inventoryByVariant.get(row.link.variantId) ?? [];
      group.push(row);
      inventoryByVariant.set(row.link.variantId, group);
    }
    if (
      resolvedItems.some(
        (item) =>
          item.variant.manageInventory &&
          (inventoryByVariant.get(item.variant.id)?.length ?? 0) === 0,
      )
    )
      return { success: false, reason: "INVALID_VARIANT" };

    const effectiveBackorder = (variantAllows: boolean) =>
      input.allowBackorder || variantAllows;
    const requiredByInventoryItem = new Map<string, number>();
    for (const item of resolvedItems) {
      if (
        !item.variant.manageInventory ||
        effectiveBackorder(item.variant.allowBackorder)
      )
        continue;
      for (const { link } of inventoryByVariant.get(item.variant.id) ?? []) {
        requiredByInventoryItem.set(
          link.inventoryItemId,
          (requiredByInventoryItem.get(link.inventoryItemId) ?? 0) +
            item.quantity * link.requiredQuantity,
        );
      }
    }
    if (requiredByInventoryItem.size) {
      const levels = await db
        .select({
          inventoryItemId: inventoryLevels.inventoryItemId,
          stockedQuantity: inventoryLevels.stockedQuantity,
          reservedQuantity: inventoryLevels.reservedQuantity,
        })
        .from(inventoryLevels)
        .where(
          and(
            inArray(inventoryLevels.inventoryItemId, [
              ...requiredByInventoryItem.keys(),
            ]),
            eq(inventoryLevels.locationId, input.locationId),
            isNull(inventoryLevels.deletedAt),
          ),
        );
      const levelById = new Map(
        levels.map((row) => [row.inventoryItemId, row]),
      );
      if (
        [...requiredByInventoryItem].some(([id, quantity]) => {
          const level = levelById.get(id);
          return (
            !level || level.stockedQuantity - level.reservedQuantity < quantity
          );
        })
      )
        return { success: false, reason: "INVENTORY_UNAVAILABLE" };
    }

    const [returnDisplayRows, exchangeDisplayRows, address, region] =
      await Promise.all([
        db
          .select({ value: max(returns.displayId) })
          .from(returns)
          .where(
            and(eq(returns.orderId, input.orderId), isNull(returns.deletedAt)),
          ),
        db
          .select({ value: max(orderExchanges.displayId) })
          .from(orderExchanges)
          .where(
            and(
              eq(orderExchanges.orderId, input.orderId),
              isNull(orderExchanges.deletedAt),
            ),
          ),
        current.order.shippingAddressId
          ? firstOrNull(
              await db
                .select()
                .from(orderAddresses)
                .where(
                  and(
                    eq(orderAddresses.id, current.order.shippingAddressId),
                    isNull(orderAddresses.deletedAt),
                  ),
                )
                .limit(1),
            )
          : Promise.resolve(null),
        current.order.regionId
          ? firstOrNull(
              await db
                .select()
                .from(regions)
                .where(
                  and(
                    eq(regions.id, current.order.regionId),
                    isNull(regions.deletedAt),
                  ),
                )
                .limit(1),
            )
          : Promise.resolve(null),
      ]);
    const returnId = crypto.randomUUID();
    const exchangeId = crypto.randomUUID();
    const changeId = crypto.randomUUID();
    const nextVersion = current.order.version + 1;
    const returnDisplayId = Number(returnDisplayRows[0]?.value ?? 0) + 1;
    const displayId = Number(exchangeDisplayRows[0]?.value ?? 0) + 1;
    const replacementIds = new Map(
      resolvedItems.map((item) => [item.itemId, crypto.randomUUID()]),
    );
    const shippingCharges = [
      input.returnShipping
        ? {
            direction: "return" as const,
            ...input.returnShipping,
            shippingMethodId: crypto.randomUUID(),
          }
        : null,
      input.outboundShipping
        ? {
            direction: "outbound" as const,
            ...input.outboundShipping,
            shippingMethodId: crypto.randomUUID(),
          }
        : null,
    ].filter((charge) => charge !== null);
    const taxLines =
      region?.automaticTaxes && address?.countryCode
        ? await calculateTaxLines({
            context: {
              address: {
                address1: address.address1,
                address2: address.address2,
                city: address.city,
                countryCode: address.countryCode,
                provinceCode: address.province,
                postalCode: address.postalCode,
              },
              currencyCode: current.order.currencyCode,
              customerId: current.order.customerId,
            },
            itemLines: resolvedItems.map((item) => ({
              id: replacementIds.get(item.itemId)!,
              unitAmount: item.price!.amount,
              quantity: item.quantity,
              productId: item.product.id,
              productTypeId: item.product.typeId,
            })),
            shippingLines: shippingCharges.map((charge) => ({
              id: charge.shippingMethodId,
              amount: charge.amount,
            })),
          })
        : [];

    const sourceLineIds = sourceRows.map(({ line }) => line.id);
    const [sourceAdjustments, sourceTaxes] = sourceLineIds.length
      ? await Promise.all([
          db
            .select()
            .from(orderLineItemAdjustments)
            .where(
              and(
                inArray(orderLineItemAdjustments.itemId, sourceLineIds),
                eq(orderLineItemAdjustments.version, current.order.version),
                isNull(orderLineItemAdjustments.deletedAt),
              ),
            ),
          db
            .select()
            .from(orderLineItemTaxLines)
            .where(inArray(orderLineItemTaxLines.itemId, sourceLineIds)),
        ])
      : [[], []];
    const sourcePromotionIds = input.carryOverPromotions
      ? [
          ...new Set(
            sourceAdjustments.flatMap((adjustment) =>
              adjustment.promotionId && adjustment.amount > 0
                ? [adjustment.promotionId]
                : [],
            ),
          ),
        ]
      : [];
    const promotionRows = sourcePromotionIds.length
      ? await db
          .select({
            promotion: promotions,
            method: promotionApplicationMethods,
          })
          .from(promotions)
          .innerJoin(
            promotionApplicationMethods,
            and(
              eq(promotionApplicationMethods.promotionId, promotions.id),
              isNull(promotionApplicationMethods.deletedAt),
            ),
          )
          .where(
            and(
              inArray(promotions.id, sourcePromotionIds),
              isNull(promotions.deletedAt),
            ),
          )
      : [];
    const loadedPromotionRules = sourcePromotionIds.length
      ? await loadPromotionRules(
          sourcePromotionIds,
          promotionRows.map((row) => row.method.id),
        )
      : null;
    const promotionInputs = promotionRows.map(({ promotion, method }) => ({
      id: promotion.id,
      code: promotion.code,
      type: promotion.type,
      methodType: method.type,
      targetType: method.targetType,
      allocation: method.allocation,
      value: method.value ?? 0,
      currencyCode: method.currencyCode,
      maxQuantity: method.maxQuantity,
      applyToQuantity: method.applyToQuantity,
      buyRulesMinQuantity: method.buyRulesMinQuantity,
      rules: loadedPromotionRules?.promotion.get(promotion.id) ?? [],
      targetRules: loadedPromotionRules?.target.get(method.id) ?? [],
      buyRules: loadedPromotionRules?.buy.get(method.id) ?? [],
      isTaxInclusive: promotion.isTaxInclusive,
    }));
    const carriedAdjustments = input.carryOverPromotions
      ? evaluateExchangePromotionCarryOver({
          sourcePromotionIds,
          promotions: promotionInputs,
          cartAttributes: {
            currency_code: current.order.currencyCode,
            region_id: current.order.regionId,
            sales_channel_id: current.order.salesChannelId,
            email: current.order.email,
            subtotal: current.states.reduce(
              (sum, state) => sum + state.quantity * (state.unitPrice ?? 0),
              0,
            ),
          },
          lines: resolvedItems.map((item) => ({
            id: replacementIds.get(item.itemId)!,
            quantity: item.quantity,
            unitPrice: item.price!.amount,
            isDiscountable: item.product.discountable,
            attributes: {
              variant_id: item.variant.id,
              product_id: item.product.id,
              product_type_id: item.product.typeId,
              product_collection_id: item.product.collectionId,
              product_handle: item.product.handle,
              sku: item.variant.sku,
            },
          })),
        })
      : [];
    let differenceDue = 0;
    const stateChanges = new Map<
      string,
      { requested: number; received: number; dismissed: number }
    >();
    for (const item of resolvedItems) {
      const source = sourceById.get(item.itemId)!;
      const unitPrice = source.state.unitPrice ?? source.line.unitPrice ?? 0;
      const adjustmentAmounts = sourceAdjustments
        .filter((row) => row.itemId === source.line.id)
        .map((row) =>
          source.state.quantity > 0
            ? Math.round((row.amount * item.quantity) / source.state.quantity)
            : 0,
        );
      const inboundTotal = calculateAmountLine({
        quantity: item.quantity,
        unitPrice,
        isTaxInclusive: source.line.isTaxInclusive,
        adjustments: adjustmentAmounts,
        taxes: sourceTaxes
          .filter((row) => row.itemId === source.line.id)
          .map((row) => ({ rate: row.rate })),
      }).total;
      const outboundTaxes = taxLines
        .filter(
          (row) =>
            "lineItemId" in row &&
            row.lineItemId === replacementIds.get(item.itemId),
        )
        .map((row) => ({ rate: row.rate }));
      const outboundTotal = calculateAmountLine({
        quantity: item.quantity,
        unitPrice: item.price!.amount,
        taxes: outboundTaxes,
        adjustments: carriedAdjustments
          .filter(
            (adjustment) =>
              adjustment.itemId === replacementIds.get(item.itemId),
          )
          .map((adjustment) => adjustment.amount),
      }).total;
      differenceDue += outboundTotal - inboundTotal;
      const previous = stateChanges.get(source.state.itemId) ?? {
        requested: 0,
        received: 0,
        dismissed: 0,
      };
      previous.requested += item.quantity;
      stateChanges.set(source.state.itemId, previous);
    }
    for (const charge of shippingCharges) {
      const taxes = taxLines
        .filter(
          (tax) =>
            "shippingLineId" in tax &&
            tax.shippingLineId === charge.shippingMethodId,
        )
        .map((tax) => ({ rate: tax.rate }));
      differenceDue += calculateAmountLine({
        quantity: 1,
        unitPrice: charge.amount,
        adjustments: [],
        taxes,
      }).total;
    }

    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        versionGuard({
          orderId: input.orderId,
          version: current.order.version,
          states: current.states,
        }),
      ),
      db.insert(returns).values({
        id: returnId,
        orderId: input.orderId,
        displayId: returnDisplayId,
        orderVersion: nextVersion,
        status: "requested",
        locationId: input.locationId,
        exchangeId,
        createdBy: input.createdBy,
        requestedAt: now,
        noNotification: !input.sendNotification,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(orderExchanges).values({
        id: exchangeId,
        orderId: input.orderId,
        returnId,
        displayId,
        orderVersion: nextVersion,
        differenceDue,
        allowBackorder: input.allowBackorder,
        noNotification: !input.sendNotification,
        createdBy: input.createdBy,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(orderChanges).values({
        id: changeId,
        orderId: input.orderId,
        version: nextVersion,
        changeType: "exchange",
        status: "confirmed",
        returnId,
        exchangeId,
        createdBy: input.createdBy,
        requestedBy: input.createdBy,
        requestedAt: now,
        confirmedBy: input.createdBy,
        confirmedAt: now,
        carryOverPromotions: input.carryOverPromotions,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      }),
      db
        .update(orders)
        .set({ version: nextVersion, updatedAt: now })
        .where(eq(orders.id, input.orderId)),
    ];
    let ordering = 0;
    for (const item of resolvedItems) {
      const source = sourceById.get(item.itemId)!;
      const lineItemId = replacementIds.get(item.itemId)!;
      statements.push(
        db.insert(returnItems).values({
          id: crypto.randomUUID(),
          returnId,
          itemId: source.line.id,
          quantity: item.quantity,
          receivedQuantity: 0,
          damagedQuantity: 0,
          note: item.note ?? null,
          metadata: {},
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(orderChangeActions).values({
          id: crypto.randomUUID(),
          orderChangeId: changeId,
          orderId: input.orderId,
          returnId,
          exchangeId,
          ordering: ordering++,
          version: nextVersion,
          reference: "return_item",
          referenceId: source.line.id,
          action: "RETURN_ITEM",
          details: { quantity: item.quantity },
          internalNote: item.note ?? null,
          applied: true,
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(orderLineItems).values({
          id: lineItemId,
          title: item.product.title,
          subtitle: item.product.subtitle,
          thumbnail: null,
          variantId: item.variant.id,
          productId: item.product.id,
          productTitle: item.product.title,
          productDescription: item.product.description,
          productSubtitle: item.product.subtitle,
          productTypeId: item.product.typeId,
          productCollectionId: item.product.collectionId,
          productHandle: item.product.handle,
          variantSku: item.variant.sku,
          variantBarcode: item.variant.barcode,
          variantTitle: item.variant.title,
          requiresShipping: (
            inventoryByVariant.get(item.variant.id) ?? []
          ).some(({ inventory }) => inventory.requiresShipping),
          isDiscountable: item.product.discountable,
          isGiftcard: item.product.isGiftcard,
          isTaxInclusive: false,
          isCustomPrice: false,
          unitPrice: item.price!.amount,
          compareAtUnitPrice:
            item.price!.originalAmount !== item.price!.amount
              ? item.price!.originalAmount
              : null,
          metadata: {
            exchangeId,
            priceId: item.price!.priceId,
            priceListId: item.price!.priceListId,
          },
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(orderItems).values({
          id: crypto.randomUUID(),
          orderId: input.orderId,
          itemId: lineItemId,
          version: nextVersion,
          quantity: item.quantity,
          fulfilledQuantity: 0,
          deliveredQuantity: 0,
          shippedQuantity: 0,
          returnRequestedQuantity: 0,
          returnReceivedQuantity: 0,
          returnDismissedQuantity: 0,
          writtenOffQuantity: 0,
          unitPrice: item.price!.amount,
          compareAtUnitPrice:
            item.price!.originalAmount !== item.price!.amount
              ? item.price!.originalAmount
              : null,
          metadata: { exchangeId },
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(orderExchangeItems).values({
          id: crypto.randomUUID(),
          exchangeId,
          itemId: lineItemId,
          quantity: item.quantity,
          note: item.note ?? null,
          metadata: { sourceItemId: item.itemId },
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(orderChangeActions).values({
          id: crypto.randomUUID(),
          orderChangeId: changeId,
          orderId: input.orderId,
          exchangeId,
          ordering: ordering++,
          version: nextVersion,
          reference: "item",
          referenceId: lineItemId,
          action: "ITEM_ADD",
          details: {
            referenceId: lineItemId,
            quantity: item.quantity,
            unitPrice: item.price!.amount,
            metadata: { exchangeId },
            adjustments: carriedAdjustments
              .filter((adjustment) => adjustment.itemId === lineItemId)
              .map((adjustment) => ({
                promotionId: adjustment.promotionId,
                amount: adjustment.amount,
              })),
          },
          applied: true,
          createdAt: now,
          updatedAt: now,
        }),
      );

      for (const adjustment of carriedAdjustments.filter(
        (entry) => entry.itemId === lineItemId,
      ))
        statements.push(
          db.insert(orderLineItemAdjustments).values({
            id: crypto.randomUUID(),
            itemId: lineItemId,
            version: nextVersion,
            description: adjustment.code,
            code: adjustment.code,
            amount: adjustment.amount,
            providerId: null,
            promotionId: adjustment.promotionId,
            isTaxInclusive: adjustment.isTaxInclusive,
            createdAt: now,
            updatedAt: now,
          }),
        );

      if (item.variant.manageInventory) {
        const allowBackorder = effectiveBackorder(item.variant.allowBackorder);
        for (const { link } of inventoryByVariant.get(item.variant.id) ?? []) {
          const quantity = item.quantity * link.requiredQuantity;
          statements.push(
            batchGuard(
              db,
              sql`${allowBackorder ? 1 : 0} = 1 OR EXISTS (
                SELECT 1 FROM inventory_levels level
                WHERE level.inventory_item_id = ${link.inventoryItemId}
                  AND level.location_id = ${input.locationId}
                  AND level.deleted_at IS NULL
                  AND level.stocked_quantity - level.reserved_quantity >= ${quantity}
              )`,
            ),
            db
              .insert(inventoryLevels)
              .values({
                id: crypto.randomUUID(),
                inventoryItemId: link.inventoryItemId,
                locationId: input.locationId,
                stockedQuantity: 0,
                reservedQuantity: quantity,
                incomingQuantity: 0,
                metadata: {},
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: [
                  inventoryLevels.inventoryItemId,
                  inventoryLevels.locationId,
                ],
                targetWhere: isNull(inventoryLevels.deletedAt),
                set: {
                  reservedQuantity: sql`${inventoryLevels.reservedQuantity} + ${quantity}`,
                  updatedAt: now,
                },
              }),
            db.insert(reservationItems).values({
              id: crypto.randomUUID(),
              inventoryItemId: link.inventoryItemId,
              locationId: input.locationId,
              cartId: null,
              lineItemId,
              quantity,
              allowBackorder,
              description: `Order exchange #${displayId}`,
              createdBy: input.createdBy,
              expiresAt: null,
              metadata: { exchangeId },
              createdAt: now,
              updatedAt: now,
            }),
          );
        }
      }
    }
    for (const charge of shippingCharges) {
      const shippingLinkId = crypto.randomUUID();
      const referenceId = charge.direction === "return" ? returnId : exchangeId;
      statements.push(
        db.insert(orderShippingMethods).values({
          id: charge.shippingMethodId,
          name: charge.name,
          description: null,
          amount: charge.amount,
          isTaxInclusive: false,
          isCustomAmount: true,
          shippingOptionId: null,
          data: {},
          metadata: {},
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(orderShippings).values({
          id: shippingLinkId,
          orderId: input.orderId,
          shippingMethodId: charge.shippingMethodId,
          version: nextVersion,
          returnId: charge.direction === "return" ? returnId : null,
          exchangeId: charge.direction === "outbound" ? exchangeId : null,
          claimId: null,
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(orderChangeActions).values({
          id: crypto.randomUUID(),
          orderChangeId: changeId,
          orderId: input.orderId,
          returnId: charge.direction === "return" ? returnId : null,
          exchangeId: charge.direction === "outbound" ? exchangeId : null,
          ordering: ordering++,
          version: nextVersion,
          reference: "shipping_method",
          referenceId: charge.shippingMethodId,
          action: "SHIPPING_ADD",
          details: { amount: charge.amount, name: charge.name, referenceId },
          amount: charge.amount,
          applied: true,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    for (const tax of taxLines) {
      if ("lineItemId" in tax) {
        statements.push(
          db.insert(orderLineItemTaxLines).values({
            id: crypto.randomUUID(),
            itemId: tax.lineItemId,
            description: tax.name,
            code: tax.code,
            rate: tax.rate,
            providerId: tax.providerId,
            taxRateId: tax.taxRateId ?? null,
            data: tax.data ?? null,
            metadata: {},
            createdAt: now,
            updatedAt: now,
          }),
        );
      } else {
        statements.push(
          db.insert(orderShippingMethodTaxLines).values({
            id: crypto.randomUUID(),
            shippingMethodId: tax.shippingLineId,
            description: tax.name,
            code: tax.code,
            rate: tax.rate,
            providerId: tax.providerId,
            taxRateId: tax.taxRateId ?? null,
            data: tax.data ?? null,
            metadata: {},
            createdAt: now,
            updatedAt: now,
          }),
        );
      }
    }
    statements.push(
      ...(await snapshotRows({
        db,
        orderId: input.orderId,
        fromVersion: current.order.version,
        toVersion: nextVersion,
        now,
        states: current.states,
        stateChanges,
      })),
    );
    if (!(await runVersionedBatch(db, statements)))
      return { success: false, reason: "CONFLICT" };
    return { success: true, returnId, displayId, exchangeId };
  },

  async cancelExchange(input: {
    exchangeId: string;
    orderId?: string;
    canceledBy: string;
  }): Promise<ReturnResult> {
    const db = await getDb();
    const exchange = firstOrNull(
      await db
        .select()
        .from(orderExchanges)
        .where(
          and(
            eq(orderExchanges.id, input.exchangeId),
            ...(input.orderId
              ? [eq(orderExchanges.orderId, input.orderId)]
              : []),
            isNull(orderExchanges.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!exchange || !exchange.returnId)
      return { success: false, reason: "NOT_FOUND" };
    if (exchange.canceledAt)
      return { success: true, returnId: exchange.returnId };
    const returnRow = firstOrNull(
      await db
        .select()
        .from(returns)
        .where(
          and(eq(returns.id, exchange.returnId), isNull(returns.deletedAt)),
        )
        .limit(1),
    );
    if (!returnRow) return { success: false, reason: "NOT_FOUND" };
    const [returnItemRows, exchangeItems] = await Promise.all([
      db
        .select()
        .from(returnItems)
        .where(
          and(
            eq(returnItems.returnId, returnRow.id),
            isNull(returnItems.deletedAt),
          ),
        ),
      db
        .select({ exchangeItem: orderExchangeItems, line: orderLineItems })
        .from(orderExchangeItems)
        .innerJoin(
          orderLineItems,
          eq(orderLineItems.id, orderExchangeItems.itemId),
        )
        .where(
          and(
            eq(orderExchangeItems.exchangeId, exchange.id),
            isNull(orderExchangeItems.deletedAt),
            isNull(orderLineItems.deletedAt),
          ),
        ),
    ]);
    if (
      returnRow.status === "received" ||
      returnRow.status === "canceled" ||
      returnItemRows.some((item) => item.receivedQuantity > 0)
    )
      return { success: false, reason: "EXCHANGE_CLOSED" };

    const current = await readCurrentOrder(db, exchange.orderId);
    if (!current) return { success: false, reason: "NOT_FOUND" };
    if (current.order.canceledAt)
      return { success: false, reason: "ORDER_CANCELED" };
    const outboundLineIds = exchangeItems.map(({ line }) => line.id);
    const outboundStates = current.states.filter((state) =>
      outboundLineIds.includes(state.itemId),
    );
    if (
      outboundStates.length !== outboundLineIds.length ||
      outboundStates.some((state) => state.fulfilledQuantity > 0)
    )
      return { success: false, reason: "EXCHANGE_CLOSED" };

    const reservations = outboundLineIds.length
      ? await db
          .select()
          .from(reservationItems)
          .where(
            and(
              inArray(reservationItems.lineItemId, outboundLineIds),
              isNull(reservationItems.deletedAt),
            ),
          )
      : [];
    const changes = new Map<
      string,
      { requested: number; received: number; dismissed: number }
    >();
    const stateByItemId = new Map(
      current.states.map((state) => [state.itemId, state]),
    );
    for (const item of returnItemRows) {
      const outstanding = item.quantity - item.receivedQuantity;
      if (!outstanding) continue;
      const state = stateByItemId.get(item.itemId);
      if (!state || state.returnRequestedQuantity < outstanding)
        return { success: false, reason: "CONFLICT" };
      const change = changes.get(item.itemId) ?? {
        requested: 0,
        received: 0,
        dismissed: 0,
      };
      change.requested -= outstanding;
      change.dismissed += outstanding;
      changes.set(item.itemId, change);
    }

    const now = new Date().toISOString();
    const nextVersion = current.order.version + 1;
    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        versionGuard({
          orderId: exchange.orderId,
          version: current.order.version,
          states: current.states,
        }),
      ),
      db
        .update(orders)
        .set({ version: nextVersion, updatedAt: now })
        .where(eq(orders.id, exchange.orderId)),
      db
        .update(orderExchanges)
        .set({ canceledAt: now, updatedAt: now })
        .where(
          and(
            eq(orderExchanges.id, exchange.id),
            isNull(orderExchanges.canceledAt),
          ),
        ),
      db
        .update(returns)
        .set({ status: "canceled", canceledAt: now, updatedAt: now })
        .where(
          and(
            eq(returns.id, returnRow.id),
            eq(returns.status, returnRow.status),
            isNull(returns.deletedAt),
          ),
        ),
      db
        .update(orderChanges)
        .set({
          status: "canceled",
          canceledBy: input.canceledBy,
          canceledAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(orderChanges.exchangeId, exchange.id),
            eq(orderChanges.status, "confirmed"),
            isNull(orderChanges.deletedAt),
          ),
        ),
    ];
    for (const reservation of reservations) {
      statements.push(
        batchGuard(
          db,
          sql`EXISTS (
            SELECT 1 FROM inventory_levels level
            WHERE level.inventory_item_id = ${reservation.inventoryItemId}
              AND level.location_id = ${reservation.locationId}
              AND level.deleted_at IS NULL
              AND level.reserved_quantity >= ${reservation.quantity}
          )`,
        ),
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
              isNull(inventoryLevels.deletedAt),
            ),
          ),
        db
          .update(reservationItems)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              eq(reservationItems.id, reservation.id),
              isNull(reservationItems.deletedAt),
            ),
          ),
      );
    }
    statements.push(
      ...(await snapshotRows({
        db,
        orderId: exchange.orderId,
        fromVersion: current.order.version,
        toVersion: nextVersion,
        now,
        states: current.states,
        stateChanges: changes,
        excludeItemIds: new Set(outboundLineIds),
      })),
    );
    if (!(await runVersionedBatch(db, statements)))
      return { success: false, reason: "CONFLICT" };
    return { success: true, returnId: returnRow.id };
  },

  async create(input: {
    orderId: string;
    items: Array<{
      itemId: string;
      quantity: number;
      reasonId?: string;
      note?: string;
    }>;
    createdBy: string | null;
    ownership?: {
      customerId: string;
      email: string;
      salesChannelId?: string;
    };
  }): Promise<ReturnResult> {
    const db = await getDb();
    const current = await readCurrentOrder(db, input.orderId);
    if (!current) return { success: false, reason: "NOT_FOUND" };
    if (
      input.ownership &&
      current.order.customerId !== input.ownership.customerId &&
      current.order.email?.trim().toLowerCase() !== input.ownership.email
    ) {
      return { success: false, reason: "NOT_FOUND" };
    }
    if (current.order.canceledAt || current.order.isDraftOrder)
      return { success: false, reason: "ORDER_CANCELED" };
    const uniqueItemIds = new Set(input.items.map((item) => item.itemId));
    if (uniqueItemIds.size !== input.items.length)
      return { success: false, reason: "INVALID_QUANTITY" };
    const stateByItemId = new Map(
      current.states.map((state) => [state.itemId, state]),
    );
    const noReturnClaimQuantityByItemId = await listOpenNoReturnClaimQuantities(
      db,
      input.orderId,
    );
    if (
      input.items.some((item) => {
        const state = stateByItemId.get(item.itemId);
        const available = state
          ? availableRefundClaimQuantity({
              deliveredQuantity: state.deliveredQuantity,
              returnRequestedQuantity: state.returnRequestedQuantity,
              returnReceivedQuantity: state.returnReceivedQuantity,
              returnDismissedQuantity: state.returnDismissedQuantity,
              activeNoReturnClaimQuantity:
                noReturnClaimQuantityByItemId.get(item.itemId) ?? 0,
            })
          : -1;
        return (
          !state ||
          !Number.isInteger(item.quantity) ||
          item.quantity <= 0 ||
          item.quantity > available
        );
      })
    )
      return { success: false, reason: "INVALID_QUANTITY" };

    const reasonIds = input.items.flatMap((item) =>
      item.reasonId ? [item.reasonId] : [],
    );
    if (reasonIds.length) {
      const activeReasons = await db
        .select({ id: returnReasons.id })
        .from(returnReasons)
        .where(
          and(
            inArray(returnReasons.id, reasonIds),
            isNull(returnReasons.deletedAt),
          ),
        );
      if (activeReasons.length !== new Set(reasonIds).size)
        return { success: false, reason: "INVALID_REASON" };
    }

    const now = new Date().toISOString();
    const returnId = crypto.randomUUID();
    const changeId = crypto.randomUUID();
    const newVersion = current.order.version + 1;
    const displayRows = await db
      .select({ value: max(returns.displayId) })
      .from(returns)
      .where(
        and(eq(returns.orderId, input.orderId), isNull(returns.deletedAt)),
      );
    const displayId = Number(displayRows[0]?.value ?? 0) + 1;
    const stateChanges = new Map<
      string,
      { requested: number; received: number; dismissed: number }
    >();
    for (const item of input.items) {
      const previous = stateChanges.get(item.itemId) ?? {
        requested: 0,
        received: 0,
        dismissed: 0,
      };
      previous.requested += item.quantity;
      stateChanges.set(item.itemId, previous);
    }
    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        versionGuard({
          orderId: input.orderId,
          version: current.order.version,
          states: current.states,
          ownership: input.ownership,
        }),
      ),
      db.insert(returns).values({
        id: returnId,
        orderId: input.orderId,
        displayId,
        orderVersion: newVersion,
        status: "requested",
        createdBy: input.createdBy,
        requestedAt: now,
        noNotification: true,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(orderChanges).values({
        id: changeId,
        orderId: input.orderId,
        version: newVersion,
        changeType: "return_request",
        status: "requested",
        returnId,
        createdBy: input.createdBy,
        requestedBy: input.createdBy,
        requestedAt: now,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      }),
      db
        .update(orders)
        .set({ version: newVersion, updatedAt: now })
        .where(eq(orders.id, input.orderId)),
    ];
    for (const item of input.items) {
      const itemId = crypto.randomUUID();
      statements.push(
        db.insert(returnItems).values({
          id: itemId,
          returnId,
          itemId: item.itemId,
          reasonId: item.reasonId ?? null,
          quantity: item.quantity,
          note: item.note ?? null,
          metadata: {},
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(orderChangeActions).values({
          id: crypto.randomUUID(),
          orderChangeId: changeId,
          orderId: input.orderId,
          returnId,
          ordering: statements.length,
          version: newVersion,
          reference: "return_item",
          referenceId: item.itemId,
          action: "RETURN_ITEM",
          details: { quantity: item.quantity, reasonId: item.reasonId ?? null },
          internalNote: item.note ?? null,
          applied: true,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    statements.push(
      ...(await snapshotRows({
        db,
        orderId: input.orderId,
        fromVersion: current.order.version,
        toVersion: newVersion,
        now,
        states: current.states,
        stateChanges,
      })),
    );
    if (!(await runVersionedBatch(db, statements)))
      return { success: false, reason: "CONFLICT" };
    return { success: true, returnId, displayId };
  },

  /**
   * Confirm a replacement claim in one order-version write. Inbound items are
   * optional; outbound variants are separate zero-priced order lines and use
   * the normal inventory reservation and fulfillment path.
   */
  async createReplacementClaim(input: {
    orderId: string;
    locationId: string;
    sendNotification: boolean;
    returnShipping?: { name: string; amount: number };
    outboundShipping?: { name: string; amount: number };
    items: Array<{
      itemId: string;
      quantity: number;
      reason: "production_failure" | "other";
      note?: string;
    }>;
    outboundItems: Array<{
      variantId: string;
      quantity: number;
      note?: string;
    }>;
    createdBy: string;
  }): Promise<ReplacementClaimResult> {
    const db = await getDb();
    const current = await readCurrentOrder(db, input.orderId);
    if (!current) return { success: false, reason: "NOT_FOUND" };
    if (current.order.canceledAt || current.order.isDraftOrder)
      return { success: false, reason: "ORDER_CANCELED" };
    const location = firstOrNull(
      await db
        .select({ id: stockLocations.id })
        .from(stockLocations)
        .where(
          and(
            eq(stockLocations.id, input.locationId),
            isNull(stockLocations.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!location) return { success: false, reason: "INVALID_LOCATION" };
    const uniqueItemIds = new Set(input.items.map((item) => item.itemId));
    if (
      uniqueItemIds.size !== input.items.length ||
      !input.outboundItems.length ||
      (input.returnShipping && input.items.length === 0) ||
      input.outboundItems.some(
        (item) => !Number.isInteger(item.quantity) || item.quantity <= 0,
      )
    )
      return { success: false, reason: "INVALID_QUANTITY" };

    const itemRows = await db
      .select({ state: orderItems, line: orderLineItems })
      .from(orderItems)
      .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
      .where(
        and(
          eq(orderItems.orderId, input.orderId),
          eq(orderItems.version, current.order.version),
          inArray(orderItems.itemId, [...uniqueItemIds]),
          isNull(orderItems.deletedAt),
          isNull(orderLineItems.deletedAt),
        ),
      );
    const rowsByItemId = new Map(itemRows.map((row) => [row.line.id, row]));
    const existingNoReturnClaims = await db
      .select({
        itemId: orderClaimItems.itemId,
        quantity: orderClaimItems.quantity,
      })
      .from(orderClaimItems)
      .innerJoin(orderClaims, eq(orderClaims.id, orderClaimItems.claimId))
      .where(
        and(
          eq(orderClaims.orderId, input.orderId),
          eq(orderClaims.type, "refund"),
          isNull(orderClaims.returnId),
          isNull(orderClaims.canceledAt),
          isNull(orderClaims.deletedAt),
          isNull(orderClaimItems.deletedAt),
          inArray(orderClaimItems.itemId, [...uniqueItemIds]),
        ),
      );
    const noReturnClaimQuantityByItemId = new Map<string, number>();
    for (const item of existingNoReturnClaims)
      noReturnClaimQuantityByItemId.set(
        item.itemId,
        (noReturnClaimQuantityByItemId.get(item.itemId) ?? 0) + item.quantity,
      );
    if (
      input.items.some((claimItem) => {
        const row = rowsByItemId.get(claimItem.itemId);
        const available = row
          ? availableRefundClaimQuantity({
              deliveredQuantity: row.state.deliveredQuantity,
              returnRequestedQuantity: row.state.returnRequestedQuantity,
              returnReceivedQuantity: row.state.returnReceivedQuantity,
              returnDismissedQuantity: row.state.returnDismissedQuantity,
              activeNoReturnClaimQuantity:
                noReturnClaimQuantityByItemId.get(claimItem.itemId) ?? 0,
            })
          : -1;
        return (
          !row ||
          !row.line.variantId ||
          !Number.isInteger(claimItem.quantity) ||
          claimItem.quantity <= 0 ||
          claimItem.quantity > available
        );
      })
    )
      return { success: false, reason: "INVALID_QUANTITY" };

    const variantIds = [
      ...new Set(input.outboundItems.map((item) => item.variantId)),
    ];
    const [variantRows, links] = await Promise.all([
      db
        .select({ variant: productVariants, product: products })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .innerJoin(
          productSalesChannels,
          and(
            eq(productSalesChannels.productId, products.id),
            eq(
              productSalesChannels.salesChannelId,
              current.order.salesChannelId ?? "",
            ),
          ),
        )
        .where(
          and(
            inArray(productVariants.id, variantIds),
            eq(products.status, "published"),
            isNull(productVariants.deletedAt),
            isNull(products.deletedAt),
          ),
        ),
      db
        .select({
          link: productVariantInventoryItems,
          inventory: inventoryItems,
        })
        .from(productVariantInventoryItems)
        .innerJoin(
          inventoryItems,
          eq(inventoryItems.id, productVariantInventoryItems.inventoryItemId),
        )
        .where(
          and(
            inArray(productVariantInventoryItems.variantId, variantIds),
            isNull(inventoryItems.deletedAt),
          ),
        ),
    ]);
    const variantById = new Map(
      variantRows.map((row) => [row.variant.id, row]),
    );
    const linksByVariant = new Map<string, typeof links>();
    for (const row of links) {
      const group = linksByVariant.get(row.link.variantId) ?? [];
      group.push(row);
      linksByVariant.set(row.link.variantId, group);
    }
    if (
      input.outboundItems.some((item) => {
        const row = variantById.get(item.variantId);
        return (
          !row ||
          (row.variant.manageInventory &&
            !linksByVariant.get(row.variant.id)?.length)
        );
      })
    )
      return { success: false, reason: "INVALID_VARIANT" };

    const now = new Date().toISOString();
    const newVersion = current.order.version + 1;
    const returnId = input.items.length ? crypto.randomUUID() : undefined;
    const claimId = crypto.randomUUID();
    const changeId = crypto.randomUUID();
    const [returnDisplayRows, claimDisplayRows] = await Promise.all([
      db
        .select({ value: max(returns.displayId) })
        .from(returns)
        .where(
          and(eq(returns.orderId, input.orderId), isNull(returns.deletedAt)),
        ),
      db
        .select({ value: max(orderClaims.displayId) })
        .from(orderClaims)
        .where(
          and(
            eq(orderClaims.orderId, input.orderId),
            isNull(orderClaims.deletedAt),
          ),
        ),
    ]);
    const returnDisplayId = Number(returnDisplayRows[0]?.value ?? 0) + 1;
    const claimDisplayId = Number(claimDisplayRows[0]?.value ?? 0) + 1;
    const shippingCharges = [
      input.returnShipping
        ? {
            direction: "return" as const,
            ...input.returnShipping,
            shippingMethodId: crypto.randomUUID(),
          }
        : null,
      input.outboundShipping
        ? {
            direction: "outbound" as const,
            ...input.outboundShipping,
            shippingMethodId: crypto.randomUUID(),
          }
        : null,
    ].filter((charge) => charge !== null);
    const stateChanges = new Map<
      string,
      { requested: number; received: number; dismissed: number }
    >();
    const replacements = input.outboundItems.map((outboundItem) => {
      const row = variantById.get(outboundItem.variantId)!;
      return {
        outboundItem,
        lineItemId: crypto.randomUUID(),
        product: row.product,
        variant: row.variant,
        links: linksByVariant.get(row.variant.id) ?? [],
      };
    });
    // Reserve finite stock first so a permitted backorder cannot consume the
    // available balance before a non-backorder replacement in the same claim.
    replacements.sort(
      (left, right) =>
        Number(left.variant.allowBackorder) -
        Number(right.variant.allowBackorder),
    );
    for (const item of input.items) {
      const state = rowsByItemId.get(item.itemId)!.state;
      const previous = stateChanges.get(state.itemId) ?? {
        requested: 0,
        received: 0,
        dismissed: 0,
      };
      previous.requested += item.quantity;
      stateChanges.set(state.itemId, previous);
    }
    const requiredByInventoryItem = new Map<string, { quantity: number }>();
    for (const replacement of replacements) {
      if (!replacement.variant.manageInventory) continue;
      for (const { link } of replacement.links) {
        const previous = requiredByInventoryItem.get(link.inventoryItemId) ?? {
          quantity: 0,
        };
        if (!replacement.variant.allowBackorder)
          previous.quantity +=
            replacement.outboundItem.quantity * link.requiredQuantity;
        requiredByInventoryItem.set(link.inventoryItemId, previous);
      }
    }
    if (requiredByInventoryItem.size) {
      const levels = await db
        .select({
          inventoryItemId: inventoryLevels.inventoryItemId,
          stockedQuantity: inventoryLevels.stockedQuantity,
          reservedQuantity: inventoryLevels.reservedQuantity,
        })
        .from(inventoryLevels)
        .where(
          and(
            inArray(inventoryLevels.inventoryItemId, [
              ...requiredByInventoryItem.keys(),
            ]),
            eq(inventoryLevels.locationId, input.locationId),
            isNull(inventoryLevels.deletedAt),
          ),
        );
      const levelByInventoryItem = new Map(
        levels.map((level) => [level.inventoryItemId, level]),
      );
      if (
        [...requiredByInventoryItem].some(([inventoryItemId, required]) => {
          if (required.quantity <= 0) return false;
          const level = levelByInventoryItem.get(inventoryItemId);
          return (
            !level ||
            level.stockedQuantity - level.reservedQuantity < required.quantity
          );
        })
      )
        return { success: false, reason: "INVENTORY_UNAVAILABLE" };
    }

    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        versionGuard({
          orderId: input.orderId,
          version: current.order.version,
          states: current.states,
        }),
      ),
    ];
    if (returnId)
      statements.push(
        db.insert(returns).values({
          id: returnId,
          orderId: input.orderId,
          displayId: returnDisplayId,
          orderVersion: newVersion,
          status: "requested",
          locationId: input.locationId,
          claimId,
          createdBy: input.createdBy,
          requestedAt: now,
          noNotification: !input.sendNotification,
          metadata: {},
          createdAt: now,
          updatedAt: now,
        }),
      );
    statements.push(
      db.insert(orderClaims).values({
        id: claimId,
        orderId: input.orderId,
        returnId: returnId ?? null,
        displayId: claimDisplayId,
        orderVersion: newVersion,
        type: "replace",
        refundAmount: null,
        noNotification: !input.sendNotification,
        createdBy: input.createdBy,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(orderChanges).values({
        id: changeId,
        orderId: input.orderId,
        version: newVersion,
        changeType: "claim",
        status: "confirmed",
        returnId: returnId ?? null,
        claimId,
        createdBy: input.createdBy,
        requestedBy: input.createdBy,
        requestedAt: now,
        confirmedBy: input.createdBy,
        confirmedAt: now,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      }),
      db
        .update(orders)
        .set({ version: newVersion, updatedAt: now })
        .where(eq(orders.id, input.orderId)),
    );

    let ordering = 0;
    for (const item of input.items) {
      const sourceLine = rowsByItemId.get(item.itemId)!.line;
      const claimItemId = crypto.randomUUID();
      if (returnId)
        statements.push(
          db.insert(returnItems).values({
            id: crypto.randomUUID(),
            returnId,
            itemId: sourceLine.id,
            quantity: item.quantity,
            receivedQuantity: 0,
            damagedQuantity: 0,
            note: item.note ?? null,
            metadata: {},
            createdAt: now,
            updatedAt: now,
          }),
          db.insert(orderChangeActions).values({
            id: crypto.randomUUID(),
            orderChangeId: changeId,
            orderId: input.orderId,
            returnId,
            claimId,
            ordering: ordering++,
            version: newVersion,
            reference: "return_item",
            referenceId: sourceLine.id,
            action: "RETURN_ITEM",
            details: { quantity: item.quantity },
            internalNote: item.note ?? null,
            applied: true,
            createdAt: now,
            updatedAt: now,
          }),
        );
      statements.push(
        db.insert(orderClaimItems).values({
          id: claimItemId,
          claimId,
          itemId: sourceLine.id,
          reason: item.reason,
          quantity: item.quantity,
          isAdditionalItem: false,
          note: item.note ?? null,
          metadata: {},
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    for (const replacement of replacements) {
      const { outboundItem, lineItemId, product, variant, links } = replacement;
      const orderItemId = crypto.randomUUID();
      const outboundClaimItemId = crypto.randomUUID();
      statements.push(
        db.insert(orderLineItems).values({
          id: lineItemId,
          title: product.title,
          subtitle: product.subtitle,
          thumbnail: null,
          variantId: variant.id,
          productId: product.id,
          productTitle: product.title,
          productDescription: product.description,
          productSubtitle: product.subtitle,
          productTypeId: product.typeId,
          productCollectionId: product.collectionId,
          productHandle: product.handle,
          variantSku: variant.sku,
          variantBarcode: variant.barcode,
          variantTitle: variant.title,
          requiresShipping: links.some(
            ({ inventory }) => inventory.requiresShipping,
          ),
          isDiscountable: product.discountable,
          isGiftcard: product.isGiftcard,
          isTaxInclusive: false,
          isCustomPrice: true,
          unitPrice: 0,
          compareAtUnitPrice: null,
          metadata: { claimId },
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(orderItems).values({
          id: orderItemId,
          orderId: input.orderId,
          itemId: lineItemId,
          version: newVersion,
          quantity: outboundItem.quantity,
          fulfilledQuantity: 0,
          deliveredQuantity: 0,
          shippedQuantity: 0,
          returnRequestedQuantity: 0,
          returnReceivedQuantity: 0,
          returnDismissedQuantity: 0,
          writtenOffQuantity: 0,
          unitPrice: 0,
          compareAtUnitPrice: null,
          metadata: { claimId },
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(orderClaimItems).values({
          id: outboundClaimItemId,
          claimId,
          itemId: lineItemId,
          reason: null,
          quantity: outboundItem.quantity,
          isAdditionalItem: true,
          note: outboundItem.note ?? null,
          metadata: {},
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(orderChangeActions).values({
          id: crypto.randomUUID(),
          orderChangeId: changeId,
          orderId: input.orderId,
          claimId,
          ordering: ordering++,
          version: newVersion,
          reference: "item",
          referenceId: lineItemId,
          action: "ITEM_ADD",
          details: {
            referenceId: lineItemId,
            quantity: outboundItem.quantity,
            unitPrice: 0,
            metadata: { claimId },
          },
          applied: true,
          createdAt: now,
          updatedAt: now,
        }),
      );

      for (const { link } of variant.manageInventory ? links : []) {
        const quantity = outboundItem.quantity * link.requiredQuantity;
        const allowBackorder = variant.allowBackorder;
        statements.push(
          batchGuard(
            db,
            sql`${allowBackorder ? 1 : 0} = 1 OR EXISTS (
              SELECT 1 FROM inventory_levels level
              WHERE level.inventory_item_id = ${link.inventoryItemId}
                AND level.location_id = ${input.locationId}
                AND level.deleted_at IS NULL
                AND level.stocked_quantity - level.reserved_quantity >= ${quantity}
            )`,
          ),
          db
            .insert(inventoryLevels)
            .values({
              id: crypto.randomUUID(),
              inventoryItemId: link.inventoryItemId,
              locationId: input.locationId,
              stockedQuantity: 0,
              reservedQuantity: quantity,
              incomingQuantity: 0,
              metadata: {},
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [
                inventoryLevels.inventoryItemId,
                inventoryLevels.locationId,
              ],
              targetWhere: isNull(inventoryLevels.deletedAt),
              set: {
                reservedQuantity: sql`${inventoryLevels.reservedQuantity} + ${quantity}`,
                updatedAt: now,
              },
            }),
          db.insert(reservationItems).values({
            id: crypto.randomUUID(),
            inventoryItemId: link.inventoryItemId,
            locationId: input.locationId,
            cartId: null,
            lineItemId,
            quantity,
            allowBackorder,
            description: `Replacement claim #${claimDisplayId}`,
            createdBy: input.createdBy,
            expiresAt: null,
            metadata: { claimId },
            createdAt: now,
            updatedAt: now,
          }),
        );
      }
    }
    for (const charge of shippingCharges) {
      const shippingLinkId = crypto.randomUUID();
      const referenceId = charge.direction === "return" ? returnId! : claimId;
      statements.push(
        db.insert(orderShippingMethods).values({
          id: charge.shippingMethodId,
          name: charge.name,
          description: null,
          amount: charge.amount,
          isTaxInclusive: false,
          isCustomAmount: true,
          shippingOptionId: null,
          data: {},
          metadata: {},
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(orderShippings).values({
          id: shippingLinkId,
          orderId: input.orderId,
          shippingMethodId: charge.shippingMethodId,
          version: newVersion,
          returnId: charge.direction === "return" ? returnId! : null,
          exchangeId: null,
          claimId: charge.direction === "outbound" ? claimId : null,
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(orderChangeActions).values({
          id: crypto.randomUUID(),
          orderChangeId: changeId,
          orderId: input.orderId,
          returnId: charge.direction === "return" ? returnId! : null,
          claimId,
          ordering: ordering++,
          version: newVersion,
          reference: "shipping_method",
          referenceId: charge.shippingMethodId,
          action: "SHIPPING_ADD",
          details: {
            amount: charge.amount,
            name: charge.name,
            referenceId,
          },
          amount: charge.amount,
          applied: true,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    statements.push(
      ...(await snapshotRows({
        db,
        orderId: input.orderId,
        fromVersion: current.order.version,
        toVersion: newVersion,
        now,
        states: current.states,
        stateChanges,
      })),
    );
    if (!(await runVersionedBatch(db, statements)))
      return { success: false, reason: "CONFLICT" };
    return {
      success: true,
      ...(returnId ? { returnId } : {}),
      claimId,
      displayId: claimDisplayId,
    };
  },

  /**
   * Confirm a refund claim and its linked return as one versioned order write.
   * The amount is calculated from the order's historical line prices,
   * adjustments, and tax rates. This records the refund due; it deliberately
   * does not call a payment provider or create a refund transaction.
   */
  async createRefundClaim(input: {
    orderId: string;
    locationId?: string;
    returnItems?: boolean;
    sendNotification: boolean;
    items: Array<{
      itemId: string;
      quantity: number;
      reason: "missing_item" | "wrong_item" | "production_failure" | "other";
      note?: string;
    }>;
    createdBy: string;
  }): Promise<RefundClaimResult> {
    const db = await getDb();
    const returning = input.returnItems ?? true;
    const current = await readCurrentOrder(db, input.orderId);
    if (!current) return { success: false, reason: "NOT_FOUND" };
    if (current.order.canceledAt || current.order.isDraftOrder)
      return { success: false, reason: "ORDER_CANCELED" };
    if (returning) {
      if (!input.locationId)
        return { success: false, reason: "INVALID_LOCATION" };
      const location = firstOrNull(
        await db
          .select({ id: stockLocations.id })
          .from(stockLocations)
          .where(
            and(
              eq(stockLocations.id, input.locationId),
              isNull(stockLocations.deletedAt),
            ),
          )
          .limit(1),
      );
      if (!location) return { success: false, reason: "INVALID_LOCATION" };
    }

    const uniqueItemIds = new Set(input.items.map((item) => item.itemId));
    if (!input.items.length || uniqueItemIds.size !== input.items.length)
      return { success: false, reason: "INVALID_QUANTITY" };
    const itemRows = await db
      .select({ state: orderItems, line: orderLineItems })
      .from(orderItems)
      .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
      .where(
        and(
          eq(orderItems.orderId, input.orderId),
          eq(orderItems.version, current.order.version),
          inArray(orderItems.itemId, [...uniqueItemIds]),
          isNull(orderItems.deletedAt),
          isNull(orderLineItems.deletedAt),
        ),
      );
    const rowsByItemId = new Map(itemRows.map((row) => [row.line.id, row]));
    const existingNoReturnClaims = await db
      .select({
        itemId: orderClaimItems.itemId,
        quantity: orderClaimItems.quantity,
      })
      .from(orderClaimItems)
      .innerJoin(orderClaims, eq(orderClaims.id, orderClaimItems.claimId))
      .where(
        and(
          eq(orderClaims.orderId, input.orderId),
          eq(orderClaims.type, "refund"),
          isNull(orderClaims.returnId),
          isNull(orderClaims.canceledAt),
          isNull(orderClaims.deletedAt),
          isNull(orderClaimItems.deletedAt),
          inArray(orderClaimItems.itemId, [...uniqueItemIds]),
        ),
      );
    const noReturnClaimQuantityByItemId = new Map<string, number>();
    for (const item of existingNoReturnClaims)
      noReturnClaimQuantityByItemId.set(
        item.itemId,
        (noReturnClaimQuantityByItemId.get(item.itemId) ?? 0) + item.quantity,
      );
    if (
      input.items.some((claimItem) => {
        const row = rowsByItemId.get(claimItem.itemId);
        const available = row
          ? availableRefundClaimQuantity({
              deliveredQuantity: row.state.deliveredQuantity,
              returnRequestedQuantity: row.state.returnRequestedQuantity,
              returnReceivedQuantity: row.state.returnReceivedQuantity,
              returnDismissedQuantity: row.state.returnDismissedQuantity,
              activeNoReturnClaimQuantity:
                noReturnClaimQuantityByItemId.get(claimItem.itemId) ?? 0,
            })
          : -1;
        return (
          !row ||
          !Number.isInteger(claimItem.quantity) ||
          claimItem.quantity <= 0 ||
          claimItem.quantity > available
        );
      })
    )
      return { success: false, reason: "INVALID_QUANTITY" };

    const sourceLineIds = input.items.map((item) => item.itemId);
    const [sourceAdjustments, sourceTaxes] = await Promise.all([
      db
        .select()
        .from(orderLineItemAdjustments)
        .where(
          and(
            inArray(orderLineItemAdjustments.itemId, sourceLineIds),
            eq(orderLineItemAdjustments.version, current.order.version),
            isNull(orderLineItemAdjustments.deletedAt),
          ),
        ),
      db
        .select()
        .from(orderLineItemTaxLines)
        .where(inArray(orderLineItemTaxLines.itemId, sourceLineIds)),
    ]);
    const refundAmountsByItemId = new Map(
      input.items.map((claimItem) => {
        const { state, line } = rowsByItemId.get(claimItem.itemId)!;
        const refundLine = {
          quantity: claimItem.quantity,
          unitPrice: state.unitPrice ?? line.unitPrice ?? 0,
          isTaxInclusive: line.isTaxInclusive,
          adjustments: sourceAdjustments
            .filter((row) => row.itemId === line.id)
            .map((row) =>
              state.quantity > 0
                ? Math.round((row.amount * claimItem.quantity) / state.quantity)
                : 0,
            ),
          taxes: sourceTaxes
            .filter((row) => row.itemId === line.id)
            .map((row) => ({ rate: row.rate })),
        };
        return [
          claimItem.itemId,
          calculateOrderClaimRefundAmount([refundLine]),
        ] as const;
      }),
    );
    const refundAmount = [...refundAmountsByItemId.values()].reduce(
      (sum, amount) => sum + amount,
      0,
    );

    const now = new Date().toISOString();
    const newVersion = current.order.version + 1;
    const returnId = returning ? crypto.randomUUID() : undefined;
    const claimId = crypto.randomUUID();
    const changeId = crypto.randomUUID();
    const [returnDisplayRows, claimDisplayRows] = await Promise.all([
      db
        .select({ value: max(returns.displayId) })
        .from(returns)
        .where(
          and(eq(returns.orderId, input.orderId), isNull(returns.deletedAt)),
        ),
      db
        .select({ value: max(orderClaims.displayId) })
        .from(orderClaims)
        .where(
          and(
            eq(orderClaims.orderId, input.orderId),
            isNull(orderClaims.deletedAt),
          ),
        ),
    ]);
    const returnDisplayId = Number(returnDisplayRows[0]?.value ?? 0) + 1;
    const claimDisplayId = Number(claimDisplayRows[0]?.value ?? 0) + 1;
    const stateChanges = new Map<
      string,
      { requested: number; received: number; dismissed: number }
    >();
    for (const item of input.items) {
      if (!returning) continue;
      const state = rowsByItemId.get(item.itemId)!.state;
      const previous = stateChanges.get(state.itemId) ?? {
        requested: 0,
        received: 0,
        dismissed: 0,
      };
      previous.requested += item.quantity;
      stateChanges.set(state.itemId, previous);
    }

    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        versionGuard({
          orderId: input.orderId,
          version: current.order.version,
          states: current.states,
        }),
      ),
    ];
    if (returnId)
      statements.push(
        db.insert(returns).values({
          id: returnId,
          orderId: input.orderId,
          displayId: returnDisplayId,
          orderVersion: newVersion,
          status: "requested",
          locationId: input.locationId!,
          claimId,
          refundAmount,
          createdBy: input.createdBy,
          requestedAt: now,
          noNotification: !input.sendNotification,
          metadata: {},
          createdAt: now,
          updatedAt: now,
        }),
      );
    statements.push(
      db.insert(orderClaims).values({
        id: claimId,
        orderId: input.orderId,
        returnId: returnId ?? null,
        displayId: claimDisplayId,
        orderVersion: newVersion,
        type: "refund",
        refundAmount,
        noNotification: !input.sendNotification,
        createdBy: input.createdBy,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(orderChanges).values({
        id: changeId,
        orderId: input.orderId,
        version: newVersion,
        changeType: "claim",
        status: "confirmed",
        returnId: returnId ?? null,
        claimId,
        createdBy: input.createdBy,
        requestedBy: input.createdBy,
        requestedAt: now,
        confirmedBy: input.createdBy,
        confirmedAt: now,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      }),
      db
        .update(orders)
        .set({ version: newVersion, updatedAt: now })
        .where(eq(orders.id, input.orderId)),
    );

    let ordering = 0;
    for (const item of input.items) {
      const sourceLine = rowsByItemId.get(item.itemId)!.line;
      const claimItemId = crypto.randomUUID();
      if (returnId)
        statements.push(
          db.insert(returnItems).values({
            id: crypto.randomUUID(),
            returnId,
            itemId: sourceLine.id,
            quantity: item.quantity,
            receivedQuantity: 0,
            damagedQuantity: 0,
            note: item.note ?? null,
            metadata: {},
            createdAt: now,
            updatedAt: now,
          }),
          db.insert(orderChangeActions).values({
            id: crypto.randomUUID(),
            orderChangeId: changeId,
            orderId: input.orderId,
            returnId,
            claimId,
            ordering: ordering++,
            version: newVersion,
            reference: "return_item",
            referenceId: sourceLine.id,
            action: "RETURN_ITEM",
            details: { quantity: item.quantity },
            internalNote: item.note ?? null,
            applied: true,
            createdAt: now,
            updatedAt: now,
          }),
        );
      statements.push(
        db.insert(orderClaimItems).values({
          id: claimItemId,
          claimId,
          itemId: sourceLine.id,
          reason: item.reason,
          quantity: item.quantity,
          isAdditionalItem: false,
          note: item.note ?? null,
          metadata: {},
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(orderChangeActions).values({
          id: crypto.randomUUID(),
          orderChangeId: changeId,
          orderId: input.orderId,
          returnId: returnId ?? null,
          claimId,
          ordering: ordering++,
          version: newVersion,
          reference: "claim",
          referenceId: claimItemId,
          action: "REFUND",
          amount: refundAmountsByItemId.get(item.itemId) ?? 0,
          details: { quantity: item.quantity },
          applied: true,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    statements.push(
      ...(await snapshotRows({
        db,
        orderId: input.orderId,
        fromVersion: current.order.version,
        toVersion: newVersion,
        now,
        states: current.states,
        stateChanges,
      })),
    );
    if (!(await runVersionedBatch(db, statements)))
      return { success: false, reason: "CONFLICT" };
    return {
      success: true,
      ...(returnId ? { returnId } : {}),
      claimId,
      displayId: claimDisplayId,
      refundAmount,
    };
  },

  async receive(input: {
    returnId: string;
    locationId: string;
    items: Array<{
      returnItemId: string;
      quantity: number;
      damagedQuantity: number;
    }>;
  }): Promise<ReturnResult> {
    const db = await getDb();
    const returnRow = firstOrNull(
      await db
        .select()
        .from(returns)
        .where(and(eq(returns.id, input.returnId), isNull(returns.deletedAt)))
        .limit(1),
    );
    if (!returnRow) return { success: false, reason: "NOT_FOUND" };
    if (
      returnRow.status !== "requested" &&
      returnRow.status !== "partially_received"
    )
      return { success: false, reason: "RETURN_CLOSED" };
    const location = firstOrNull(
      await db
        .select({ id: stockLocations.id })
        .from(stockLocations)
        .where(
          and(
            eq(stockLocations.id, input.locationId),
            isNull(stockLocations.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!location) return { success: false, reason: "INVALID_LOCATION" };
    if (returnRow.locationId && returnRow.locationId !== input.locationId)
      return { success: false, reason: "INVALID_LOCATION" };
    const current = await readCurrentOrder(db, returnRow.orderId);
    if (!current) return { success: false, reason: "NOT_FOUND" };
    if (current.order.canceledAt)
      return { success: false, reason: "ORDER_CANCELED" };
    const returnItemRows = await db
      .select()
      .from(returnItems)
      .where(
        and(
          eq(returnItems.returnId, input.returnId),
          isNull(returnItems.deletedAt),
        ),
      );
    const returnItemById = new Map(
      returnItemRows.map((item) => [item.id, item]),
    );
    const lineStateById = new Map(
      current.states.map((state) => [state.itemId, state]),
    );
    const uniqueIds = new Set(input.items.map((item) => item.returnItemId));
    if (
      !input.items.length ||
      uniqueIds.size !== input.items.length ||
      input.items.some((received) => {
        const item = returnItemById.get(received.returnItemId);
        const state = item ? lineStateById.get(item.itemId) : null;
        return (
          !item ||
          !state ||
          !Number.isInteger(received.quantity) ||
          received.quantity <= 0 ||
          received.quantity > item.quantity - item.receivedQuantity ||
          !Number.isInteger(received.damagedQuantity) ||
          received.damagedQuantity < 0 ||
          received.damagedQuantity > received.quantity ||
          state.returnRequestedQuantity < received.quantity
        );
      })
    )
      return { success: false, reason: "INVALID_QUANTITY" };

    const lineItemIds = [
      ...new Set(
        input.items.flatMap((received) => {
          const item = returnItemById.get(received.returnItemId);
          const line = item ? lineStateById.get(item.itemId) : null;
          return line ? [line.itemId] : [];
        }),
      ),
    ];
    const itemLines = (
      await Promise.all(
        chunksOf(lineItemIds, 80).map((ids) =>
          db
            .select({ line: orderLineItems })
            .from(orderItems)
            .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
            .where(
              and(
                eq(orderItems.orderId, returnRow.orderId),
                eq(orderItems.version, current.order.version),
                inArray(orderItems.itemId, ids),
                isNull(orderItems.deletedAt),
                isNull(orderLineItems.deletedAt),
              ),
            ),
        ),
      )
    ).flat();
    const lineById = new Map(itemLines.map(({ line }) => [line.id, line]));
    const variantIds = [
      ...new Set(
        input.items.flatMap((received) => {
          const returnItem = returnItemById.get(received.returnItemId);
          const variantId = returnItem
            ? lineById.get(returnItem.itemId)?.variantId
            : null;
          return variantId ? [variantId] : [];
        }),
      ),
    ];
    const inventoryLinks = variantIds.length
      ? (
          await Promise.all(
            chunksOf(variantIds, 80).map((ids) =>
              db
                .select({ link: productVariantInventoryItems })
                .from(productVariantInventoryItems)
                .innerJoin(
                  productVariants,
                  eq(
                    productVariants.id,
                    productVariantInventoryItems.variantId,
                  ),
                )
                .where(
                  and(
                    inArray(productVariantInventoryItems.variantId, ids),
                    eq(productVariants.manageInventory, true),
                    isNull(productVariants.deletedAt),
                  ),
                ),
            ),
          )
        ).flat()
      : [];

    const now = new Date().toISOString();
    const nextVersion = current.order.version + 1;
    const itemChanges = new Map<
      string,
      { requested: number; received: number; dismissed: number }
    >();
    const byReturnItem = new Map(
      input.items.map((item) => [item.returnItemId, item]),
    );
    for (const received of input.items) {
      const returnItem = returnItemById.get(received.returnItemId)!;
      const lineId = returnItem.itemId;
      const change = itemChanges.get(lineId) ?? {
        requested: 0,
        received: 0,
        dismissed: 0,
      };
      change.requested -= received.quantity;
      change.received += received.quantity;
      itemChanges.set(lineId, change);
    }
    const isFullyReceived = returnItemRows.every(
      (item) =>
        item.receivedQuantity + (byReturnItem.get(item.id)?.quantity ?? 0) >=
        item.quantity,
    );
    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        versionGuard({
          orderId: returnRow.orderId,
          version: current.order.version,
          states: current.states,
        }),
      ),
      db
        .update(orders)
        .set({ version: nextVersion, updatedAt: now })
        .where(eq(orders.id, returnRow.orderId)),
      db
        .update(returns)
        .set({
          status: isFullyReceived ? "received" : "partially_received",
          locationId: input.locationId,
          receivedAt: isFullyReceived ? now : null,
          updatedAt: now,
        })
        .where(
          and(
            eq(returns.id, input.returnId),
            eq(returns.status, returnRow.status),
          ),
        ),
    ];
    for (const received of input.items) {
      const row = returnItemById.get(received.returnItemId)!;
      statements.push(
        db
          .update(returnItems)
          .set({
            receivedQuantity: row.receivedQuantity + received.quantity,
            damagedQuantity: row.damagedQuantity + received.damagedQuantity,
            updatedAt: now,
          })
          .where(
            and(
              eq(returnItems.id, row.id),
              eq(returnItems.receivedQuantity, row.receivedQuantity),
              isNull(returnItems.deletedAt),
            ),
          ),
      );
      const item = lineById.get(row.itemId);
      if (!item?.variantId) continue;
      const restockQuantity = received.quantity - received.damagedQuantity;
      if (restockQuantity <= 0) continue;
      for (const { link } of inventoryLinks.filter(
        ({ link }) => link.variantId === item.variantId,
      )) {
        const quantity = restockQuantity * link.requiredQuantity;
        statements.push(
          db
            .insert(inventoryLevels)
            .values({
              id: crypto.randomUUID(),
              inventoryItemId: link.inventoryItemId,
              locationId: input.locationId,
              stockedQuantity: quantity,
              reservedQuantity: 0,
              incomingQuantity: 0,
              metadata: {},
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [
                inventoryLevels.inventoryItemId,
                inventoryLevels.locationId,
              ],
              targetWhere: isNull(inventoryLevels.deletedAt),
              set: {
                stockedQuantity: sql`${inventoryLevels.stockedQuantity} + ${quantity}`,
                updatedAt: now,
              },
            }),
        );
      }
    }
    statements.push(
      ...(await snapshotRows({
        db,
        orderId: returnRow.orderId,
        fromVersion: current.order.version,
        toVersion: nextVersion,
        now,
        states: current.states,
        stateChanges: itemChanges,
      })),
    );
    if (isFullyReceived) {
      statements.push(
        db
          .update(orderChanges)
          .set({ status: "confirmed", confirmedAt: now, updatedAt: now })
          .where(
            and(
              eq(orderChanges.returnId, input.returnId),
              eq(orderChanges.status, "requested"),
              isNull(orderChanges.deletedAt),
            ),
          ),
      );
    }
    if (!(await runVersionedBatch(db, statements)))
      return { success: false, reason: "CONFLICT" };
    return { success: true, returnId: input.returnId };
  },

  async cancel(input: {
    returnId: string;
    canceledBy: string;
    ownership?: {
      orderId: string;
      customerId: string;
      email: string;
      salesChannelId: string;
    };
  }): Promise<ReturnResult> {
    const db = await getDb();
    const returnRow = firstOrNull(
      await db
        .select()
        .from(returns)
        .where(and(eq(returns.id, input.returnId), isNull(returns.deletedAt)))
        .limit(1),
    );
    if (!returnRow) return { success: false, reason: "NOT_FOUND" };
    if (input.ownership && returnRow.orderId !== input.ownership.orderId)
      return { success: false, reason: "NOT_FOUND" };
    const current = await readCurrentOrder(db, returnRow.orderId);
    if (!current) return { success: false, reason: "NOT_FOUND" };
    if (
      input.ownership &&
      current.order.customerId !== input.ownership.customerId &&
      current.order.email?.trim().toLowerCase() !== input.ownership.email
    )
      return { success: false, reason: "NOT_FOUND" };
    if (
      input.ownership &&
      current.order.salesChannelId !== input.ownership.salesChannelId
    )
      return { success: false, reason: "NOT_FOUND" };
    if (returnRow.claimId || returnRow.exchangeId)
      return { success: false, reason: "RETURN_CLOSED" };
    if (returnRow.status === "canceled")
      return { success: true, returnId: input.returnId };
    if (
      returnRow.status !== "requested" &&
      returnRow.status !== "partially_received"
    )
      return { success: false, reason: "RETURN_CLOSED" };
    if (current.order.canceledAt)
      return { success: false, reason: "ORDER_CANCELED" };
    const items = await db
      .select()
      .from(returnItems)
      .where(
        and(
          eq(returnItems.returnId, input.returnId),
          isNull(returnItems.deletedAt),
        ),
      );
    const lineStates = new Map(
      current.states.map((state) => [state.itemId, state]),
    );
    const changes = new Map<
      string,
      { requested: number; received: number; dismissed: number }
    >();
    for (const item of items) {
      const outstanding = item.quantity - item.receivedQuantity;
      if (!outstanding) continue;
      const state = lineStates.get(item.itemId);
      if (!state || state.returnRequestedQuantity < outstanding)
        return { success: false, reason: "CONFLICT" };
      const change = changes.get(item.itemId) ?? {
        requested: 0,
        received: 0,
        dismissed: 0,
      };
      change.requested -= outstanding;
      change.dismissed += outstanding;
      changes.set(item.itemId, change);
    }
    const now = new Date().toISOString();
    const nextVersion = current.order.version + 1;
    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        versionGuard({
          orderId: returnRow.orderId,
          version: current.order.version,
          states: current.states,
          ownership: input.ownership,
        }),
      ),
      db
        .update(orders)
        .set({ version: nextVersion, updatedAt: now })
        .where(eq(orders.id, returnRow.orderId)),
      db
        .update(returns)
        .set({ status: "canceled", canceledAt: now, updatedAt: now })
        .where(
          and(
            eq(returns.id, input.returnId),
            eq(returns.status, returnRow.status),
          ),
        ),
      db
        .update(orderChanges)
        .set({
          status: "canceled",
          canceledBy: input.canceledBy,
          canceledAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(orderChanges.returnId, input.returnId),
            eq(orderChanges.status, "requested"),
            isNull(orderChanges.deletedAt),
          ),
        ),
    ];
    statements.push(
      ...(await snapshotRows({
        db,
        orderId: returnRow.orderId,
        fromVersion: current.order.version,
        toVersion: nextVersion,
        now,
        states: current.states,
        stateChanges: changes,
      })),
    );
    if (!(await runVersionedBatch(db, statements)))
      return { success: false, reason: "CONFLICT" };
    return { success: true, returnId: input.returnId };
  },
};
