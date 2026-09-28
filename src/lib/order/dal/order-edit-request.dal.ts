import { getDb } from "@/db";
import type { JsonValue } from "@/db/json";
import {
  orderChangeActions,
  orderChanges,
  orderCreditLines,
  orderItems,
  orderLineItems,
  orderLineItemAdjustments,
  orderLineItemTaxLines,
  orderShippingMethodAdjustments,
  orderShippingMethods,
  orderShippingMethodTaxLines,
  orderShippings,
  orderSummaries,
  orderTransactions,
  orders,
} from "@/db/schema";
import { orderPaymentCollections, orderPromotions } from "@/db/link.schema";
import { firstOrNull } from "@/lib/db/single-row";
import { chunkForInsert } from "@/lib/product/dal/d1-batch";
import { calculateDraftOrderSummary } from "@/lib/order/draft-order";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { batchGuard } from "@/lib/db/batch-guard";

type OrderEditAction = {
  id: string;
  action: string;
  ordering: number;
  reference: string | null;
  referenceId: string | null;
  details: JsonValue;
  applied: boolean;
};

export type OrderEditRequest = {
  id: string;
  orderId: string;
  version: number;
  status: string | null;
  createdBy: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  updatedAt: string;
  actions: OrderEditAction[];
};

type EditResult =
  | { success: true; edit: OrderEditRequest }
  | {
      success: false;
      reason:
        | "NOT_FOUND"
        | "NOT_ORDER"
        | "EDIT_EXISTS"
        | "EDIT_NOT_FOUND"
        | "EDIT_NOT_REQUESTED"
        | "CONFLICT"
        | "INVALID_ACTION"
        | "ITEM_EDIT_UNSUPPORTED";
    };

export type OrderEditItemChangeInput =
  | { itemId: string; action: "ITEM_UPDATE"; quantity: number }
  | { itemId: string; action: "ITEM_REMOVE" };

const requestedStatuses = ["pending", "requested"] as const;

const pushSnapshotInserts = <Row, InsertRow>(input: {
  rows: Row[];
  create: (row: Row) => InsertRow;
  insert: (rows: InsertRow[]) => BatchItem<"sqlite">;
  statements: BatchItem<"sqlite">[];
}) => {
  const values = input.rows.map(input.create);
  const columnCount = Object.keys(values[0] ?? {}).length;
  for (const group of chunkForInsert(values, columnCount)) {
    input.statements.push(input.insert(group));
  }
};

const readRequestedEdit = async (orderId: string, editId?: string) => {
  const db = await getDb();
  const where = editId
    ? and(
        eq(orderChanges.id, editId),
        eq(orderChanges.orderId, orderId),
        eq(orderChanges.changeType, "edit"),
        eq(orderChanges.status, "requested"),
        isNull(orderChanges.deletedAt),
      )
    : and(
        eq(orderChanges.orderId, orderId),
        eq(orderChanges.changeType, "edit"),
        eq(orderChanges.status, "requested"),
        isNull(orderChanges.deletedAt),
      );
  const edit = firstOrNull(
    await db
      .select()
      .from(orderChanges)
      .where(where)
      .orderBy(asc(orderChanges.createdAt), asc(orderChanges.id))
      .limit(1),
  );
  if (!edit) return null;
  const actions = await db
    .select({
      id: orderChangeActions.id,
      action: orderChangeActions.action,
      ordering: orderChangeActions.ordering,
      reference: orderChangeActions.reference,
      referenceId: orderChangeActions.referenceId,
      details: orderChangeActions.details,
      applied: orderChangeActions.applied,
    })
    .from(orderChangeActions)
    .where(
      and(
        eq(orderChangeActions.orderChangeId, edit.id),
        isNull(orderChangeActions.deletedAt),
      ),
    )
    .orderBy(asc(orderChangeActions.ordering), asc(orderChangeActions.id));
  return { ...edit, actions } satisfies OrderEditRequest;
};

const snapshotVersionRows = async (input: {
  orderId: string;
  fromVersion: number;
  toVersion: number;
  now: string;
  itemChanges?: Map<string, OrderEditItemChangeInput>;
  summaryTotals?: JsonValue;
}) => {
  const db = await getDb();
  const [
    items,
    shippings,
    summaries,
    transactions,
    creditLines,
    itemAdjustments,
    shippingAdjustments,
  ] = await Promise.all([
    db
      .select()
      .from(orderItems)
      .where(
        and(
          eq(orderItems.orderId, input.orderId),
          eq(orderItems.version, input.fromVersion),
          isNull(orderItems.deletedAt),
        ),
      ),
    db
      .select()
      .from(orderShippings)
      .where(
        and(
          eq(orderShippings.orderId, input.orderId),
          eq(orderShippings.version, input.fromVersion),
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
          eq(orderSummaries.orderId, input.orderId),
          eq(orderSummaries.version, input.fromVersion),
          isNull(orderSummaries.deletedAt),
        ),
      ),
    db
      .select()
      .from(orderTransactions)
      .where(
        and(
          eq(orderTransactions.orderId, input.orderId),
          eq(orderTransactions.version, input.fromVersion),
          isNull(orderTransactions.deletedAt),
        ),
      ),
    db
      .select()
      .from(orderCreditLines)
      .where(
        and(
          eq(orderCreditLines.orderId, input.orderId),
          eq(orderCreditLines.version, input.fromVersion),
          isNull(orderCreditLines.deletedAt),
        ),
      ),
    db
      .select()
      .from(orderLineItemAdjustments)
      .where(
        and(
          eq(orderLineItemAdjustments.version, input.fromVersion),
          inArray(
            orderLineItemAdjustments.itemId,
            db
              .select({ id: orderItems.itemId })
              .from(orderItems)
              .where(
                and(
                  eq(orderItems.orderId, input.orderId),
                  eq(orderItems.version, input.fromVersion),
                  isNull(orderItems.deletedAt),
                ),
              ),
          ),
          isNull(orderLineItemAdjustments.deletedAt),
        ),
      ),
    db
      .select()
      .from(orderShippingMethodAdjustments)
      .where(
        and(
          eq(orderShippingMethodAdjustments.version, input.fromVersion),
          inArray(
            orderShippingMethodAdjustments.shippingMethodId,
            db
              .select({ id: orderShippings.shippingMethodId })
              .from(orderShippings)
              .where(
                and(
                  eq(orderShippings.orderId, input.orderId),
                  eq(orderShippings.version, input.fromVersion),
                  isNull(orderShippings.returnId),
                  isNull(orderShippings.exchangeId),
                  isNull(orderShippings.claimId),
                  isNull(orderShippings.deletedAt),
                ),
              ),
          ),
          isNull(orderShippingMethodAdjustments.deletedAt),
        ),
      ),
  ]);

  const statements: BatchItem<"sqlite">[] = [];
  pushSnapshotInserts({
    rows: items.filter(({ itemId }) =>
      input.itemChanges?.get(itemId)?.action === "ITEM_REMOVE" ? false : true,
    ),
    create: (row) => {
      const { id: _id, deletedAt: _deletedAt, ...snapshot } = row;
      const change = input.itemChanges?.get(row.itemId);
      return {
        ...snapshot,
        ...(change?.action === "ITEM_UPDATE"
          ? { quantity: change.quantity }
          : {}),
        id: crypto.randomUUID(),
        version: input.toVersion,
        createdAt: input.now,
        updatedAt: input.now,
        deletedAt: null,
      };
    },
    insert: (rows) => db.insert(orderItems).values(rows),
    statements,
  });
  pushSnapshotInserts({
    rows: shippings,
    create: (row) => {
      const { id: _id, deletedAt: _deletedAt, ...snapshot } = row;
      return {
        ...snapshot,
        id: crypto.randomUUID(),
        version: input.toVersion,
        createdAt: input.now,
        updatedAt: input.now,
        deletedAt: null,
      };
    },
    insert: (rows) => db.insert(orderShippings).values(rows),
    statements,
  });
  pushSnapshotInserts({
    rows: summaries,
    create: (row) => {
      const { id: _id, deletedAt: _deletedAt, ...snapshot } = row;
      return {
        ...snapshot,
        ...(input.summaryTotals !== undefined
          ? { totals: input.summaryTotals }
          : {}),
        id: crypto.randomUUID(),
        version: input.toVersion,
        createdAt: input.now,
        updatedAt: input.now,
        deletedAt: null,
      };
    },
    insert: (rows) => db.insert(orderSummaries).values(rows),
    statements,
  });
  pushSnapshotInserts({
    rows: transactions,
    create: (row) => {
      const { id: _id, deletedAt: _deletedAt, ...snapshot } = row;
      return {
        ...snapshot,
        id: crypto.randomUUID(),
        version: input.toVersion,
        createdAt: input.now,
        updatedAt: input.now,
        deletedAt: null,
      };
    },
    insert: (rows) => db.insert(orderTransactions).values(rows),
    statements,
  });
  pushSnapshotInserts({
    rows: creditLines,
    create: (row) => {
      const { id: _id, deletedAt: _deletedAt, ...snapshot } = row;
      return {
        ...snapshot,
        id: crypto.randomUUID(),
        version: input.toVersion,
        createdAt: input.now,
        updatedAt: input.now,
        deletedAt: null,
      };
    },
    insert: (rows) => db.insert(orderCreditLines).values(rows),
    statements,
  });
  pushSnapshotInserts({
    rows: itemAdjustments,
    create: (row) => {
      const { id: _id, deletedAt: _deletedAt, ...snapshot } = row;
      return {
        ...snapshot,
        id: crypto.randomUUID(),
        version: input.toVersion,
        createdAt: input.now,
        updatedAt: input.now,
        deletedAt: null,
      };
    },
    insert: (rows) => db.insert(orderLineItemAdjustments).values(rows),
    statements,
  });
  pushSnapshotInserts({
    rows: shippingAdjustments,
    create: (row) => {
      const { id: _id, deletedAt: _deletedAt, ...snapshot } = row;
      return {
        ...snapshot,
        id: crypto.randomUUID(),
        version: input.toVersion,
        createdAt: input.now,
        updatedAt: input.now,
        deletedAt: null,
      };
    },
    insert: (rows) => db.insert(orderShippingMethodAdjustments).values(rows),
    statements,
  });
  return statements;
};

const readOrderAndEdit = async (input: {
  orderId: string;
  editId?: string;
  ownership?: {
    customerId: string;
    email: string;
    salesChannelId: string | null;
  };
}) => {
  const db = await getDb();
  const order = firstOrNull(
    await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), isNull(orders.deletedAt)))
      .limit(1),
  );
  if (!order) return { success: false as const, reason: "NOT_FOUND" as const };
  if (order.isDraftOrder || order.canceledAt)
    return { success: false as const, reason: "NOT_ORDER" as const };
  if (
    input.ownership &&
    (input.ownership.salesChannelId === null ||
      (order.customerId !== input.ownership.customerId &&
        order.email?.trim().toLowerCase() !==
          input.ownership.email.trim().toLowerCase()))
  )
    return { success: false as const, reason: "NOT_FOUND" as const };
  if (
    input.ownership?.salesChannelId &&
    order.salesChannelId !== input.ownership.salesChannelId
  )
    return { success: false as const, reason: "NOT_FOUND" as const };
  const edit = await readRequestedEdit(input.orderId, input.editId);
  return {
    success: true as const,
    order,
    edit: edit && edit.version === order.version + 1 ? edit : null,
  };
};

const parseUpdateDetails = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    (record.email !== undefined && typeof record.email !== "string") ||
    (record.noNotification !== undefined &&
      typeof record.noNotification !== "boolean") ||
    (record.email === undefined && record.noNotification === undefined)
  )
    return null;
  return {
    ...(typeof record.email === "string" ? { email: record.email } : {}),
    ...(typeof record.noNotification === "boolean"
      ? { noNotification: record.noNotification }
      : {}),
  };
};

const parseItemAction = (
  action: OrderEditAction,
): OrderEditItemChangeInput | null => {
  if (action.action !== "ITEM_UPDATE" && action.action !== "ITEM_REMOVE")
    return null;
  if (action.reference !== "item" || !action.referenceId) return null;
  if (
    !action.details ||
    typeof action.details !== "object" ||
    Array.isArray(action.details)
  )
    return null;
  const details = action.details as Record<string, unknown>;
  if (
    typeof details.title !== "string" ||
    !Number.isSafeInteger(details.previousQuantity) ||
    Number(details.previousQuantity) < 1
  )
    return null;
  if (action.action === "ITEM_REMOVE")
    return { itemId: action.referenceId, action: "ITEM_REMOVE" };
  if (
    !Number.isSafeInteger(details.quantity) ||
    Number(details.quantity) < 1 ||
    Number(details.quantity) >= Number(details.previousQuantity)
  )
    return null;
  return {
    itemId: action.referenceId,
    action: "ITEM_UPDATE",
    quantity: Number(details.quantity),
  };
};

const hasItemLifecycle = (state: typeof orderItems.$inferSelect) =>
  state.fulfilledQuantity > 0 ||
  state.deliveredQuantity > 0 ||
  state.shippedQuantity > 0 ||
  state.returnRequestedQuantity > 0 ||
  state.returnReceivedQuantity > 0 ||
  state.returnDismissedQuantity > 0 ||
  state.writtenOffQuantity > 0;

const calculateEditedOrderTotals = async (input: {
  orderId: string;
  version: number;
  itemChanges: Map<string, OrderEditItemChangeInput>;
}) => {
  const db = await getDb();
  const [
    items,
    shippings,
    summaryRows,
    creditRows,
    promotions,
    paymentRows,
    transactions,
  ] = await Promise.all([
    db
      .select({ item: orderLineItems, state: orderItems })
      .from(orderItems)
      .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
      .where(
        and(
          eq(orderItems.orderId, input.orderId),
          eq(orderItems.version, input.version),
          isNull(orderItems.deletedAt),
          isNull(orderLineItems.deletedAt),
        ),
      ),
    db
      .select({ state: orderShippings, method: orderShippingMethods })
      .from(orderShippings)
      .innerJoin(
        orderShippingMethods,
        eq(orderShippingMethods.id, orderShippings.shippingMethodId),
      )
      .where(
        and(
          eq(orderShippings.orderId, input.orderId),
          eq(orderShippings.version, input.version),
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
          eq(orderSummaries.orderId, input.orderId),
          eq(orderSummaries.version, input.version),
          isNull(orderSummaries.deletedAt),
        ),
      )
      .limit(1),
    db
      .select({ id: orderCreditLines.id })
      .from(orderCreditLines)
      .where(
        and(
          eq(orderCreditLines.orderId, input.orderId),
          eq(orderCreditLines.version, input.version),
          isNull(orderCreditLines.deletedAt),
        ),
      )
      .limit(1),
    db
      .select({ promotionId: orderPromotions.promotionId })
      .from(orderPromotions)
      .where(eq(orderPromotions.orderId, input.orderId))
      .limit(1),
    db
      .select({ id: orderPaymentCollections.orderId })
      .from(orderPaymentCollections)
      .where(eq(orderPaymentCollections.orderId, input.orderId))
      .limit(1),
    db
      .select({ id: orderTransactions.id })
      .from(orderTransactions)
      .where(
        and(
          eq(orderTransactions.orderId, input.orderId),
          eq(orderTransactions.version, input.version),
          isNull(orderTransactions.deletedAt),
        ),
      )
      .limit(1),
  ]);
  const currentItemIds = items.map(({ item }) => item.id);
  const shippingMethodIds = shippings.map(
    ({ state }) => state.shippingMethodId,
  );
  const [itemAdjustments, shippingAdjustments, itemTaxes, shippingTaxes] =
    await Promise.all([
      currentItemIds.length
        ? db
            .select({ id: orderLineItemAdjustments.id })
            .from(orderLineItemAdjustments)
            .where(
              and(
                inArray(orderLineItemAdjustments.itemId, currentItemIds),
                eq(orderLineItemAdjustments.version, input.version),
                isNull(orderLineItemAdjustments.deletedAt),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
      shippingMethodIds.length
        ? db
            .select({ id: orderShippingMethodAdjustments.id })
            .from(orderShippingMethodAdjustments)
            .where(
              and(
                inArray(
                  orderShippingMethodAdjustments.shippingMethodId,
                  shippingMethodIds,
                ),
                eq(orderShippingMethodAdjustments.version, input.version),
                isNull(orderShippingMethodAdjustments.deletedAt),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
      currentItemIds.length
        ? db
            .select({
              lineItemId: orderLineItemTaxLines.itemId,
              rate: orderLineItemTaxLines.rate,
              name: orderLineItemTaxLines.description,
              code: orderLineItemTaxLines.code,
              providerId: orderLineItemTaxLines.providerId,
            })
            .from(orderLineItemTaxLines)
            .where(
              and(
                inArray(orderLineItemTaxLines.itemId, currentItemIds),
                isNull(orderLineItemTaxLines.deletedAt),
              ),
            )
        : Promise.resolve([]),
      shippingMethodIds.length
        ? db
            .select({
              shippingLineId: orderShippingMethodTaxLines.shippingMethodId,
              rate: orderShippingMethodTaxLines.rate,
              name: orderShippingMethodTaxLines.description,
              code: orderShippingMethodTaxLines.code,
              providerId: orderShippingMethodTaxLines.providerId,
            })
            .from(orderShippingMethodTaxLines)
            .where(
              and(
                inArray(
                  orderShippingMethodTaxLines.shippingMethodId,
                  shippingMethodIds,
                ),
                isNull(orderShippingMethodTaxLines.deletedAt),
              ),
            )
        : Promise.resolve([]),
    ]);
  if (
    summaryRows.length !== 1 ||
    creditRows.length > 0 ||
    promotions.length > 0 ||
    paymentRows.length > 0 ||
    transactions.length > 0 ||
    itemAdjustments.length > 0 ||
    shippingAdjustments.length > 0
  )
    return null;
  const savedTotals = summaryRows[0]?.totals;
  const previousTotal =
    savedTotals &&
    typeof savedTotals === "object" &&
    !Array.isArray(savedTotals)
      ? (savedTotals as Record<string, unknown>).total
      : null;
  if (typeof previousTotal !== "number" || !Number.isSafeInteger(previousTotal))
    return null;

  const changedItems = new Map(items.map((row) => [row.item.id, row]));
  for (const [itemId] of input.itemChanges) {
    const row = changedItems.get(itemId);
    if (!row || hasItemLifecycle(row.state)) return null;
  }
  const remainingItems = items.filter(
    ({ item }) => input.itemChanges.get(item.id)?.action !== "ITEM_REMOVE",
  );
  if (!remainingItems.length) return null;
  const removedIds = new Set(
    [...input.itemChanges.entries()]
      .filter(([, change]) => change.action === "ITEM_REMOVE")
      .map(([itemId]) => itemId),
  );
  const totals = calculateDraftOrderSummary({
    items: remainingItems.map(({ item, state }) => ({
      id: item.id,
      quantity:
        input.itemChanges.get(item.id)?.action === "ITEM_UPDATE"
          ? (
              input.itemChanges.get(item.id) as Extract<
                OrderEditItemChangeInput,
                { action: "ITEM_UPDATE" }
              >
            ).quantity
          : state.quantity,
      unitPrice: state.unitPrice ?? item.unitPrice ?? 0,
      isTaxInclusive: item.isTaxInclusive,
    })),
    shippingMethods: shippings.map(({ method }) => ({
      id: method.id,
      amount: method.amount,
      isTaxInclusive: method.isTaxInclusive,
    })),
    taxLines: [
      ...itemTaxes
        .filter((line) => !removedIds.has(line.lineItemId))
        .map((line) => ({
          lineItemId: line.lineItemId,
          rate: line.rate,
          name: line.name ?? line.code,
          code: line.code,
          providerId: line.providerId ?? "",
        })),
      ...shippingTaxes.map((line) => ({
        shippingLineId: line.shippingLineId,
        rate: line.rate,
        name: line.name ?? line.code,
        code: line.code,
        providerId: line.providerId ?? "",
      })),
    ],
  });
  if (!totals) return null;
  return {
    totals,
    previousTotal,
    newTotal: totals.total,
  };
};

export const orderEditRequestDal = {
  async get(orderId: string) {
    const db = await getDb();
    const order = firstOrNull(
      await db
        .select({ version: orders.version, isDraftOrder: orders.isDraftOrder })
        .from(orders)
        .where(and(eq(orders.id, orderId), isNull(orders.deletedAt)))
        .limit(1),
    );
    if (!order || order.isDraftOrder) return null;
    const edit = await readRequestedEdit(orderId);
    return edit && edit.version === order.version + 1 ? edit : null;
  },

  async request(input: {
    orderId: string;
    actorId: string;
    email?: string;
    noNotification?: boolean;
    itemChanges?: OrderEditItemChangeInput[];
  }): Promise<EditResult> {
    const db = await getDb();
    const order = firstOrNull(
      await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, input.orderId), isNull(orders.deletedAt)))
        .limit(1),
    );
    if (!order) return { success: false, reason: "NOT_FOUND" };
    if (order.isDraftOrder || order.canceledAt)
      return { success: false, reason: "NOT_ORDER" };
    const itemChanges = input.itemChanges ?? [];
    if (
      itemChanges.length > 40 ||
      new Set(itemChanges.map((change) => change.itemId)).size !==
        itemChanges.length
    )
      return { success: false, reason: "INVALID_ACTION" };
    if (
      input.email === undefined &&
      input.noNotification === undefined &&
      itemChanges.length === 0
    )
      return { success: false, reason: "INVALID_ACTION" };

    const activeItems =
      itemChanges.length > 0
        ? await db
            .select({ item: orderLineItems, state: orderItems })
            .from(orderItems)
            .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
            .where(
              and(
                eq(orderItems.orderId, input.orderId),
                eq(orderItems.version, order.version),
                inArray(
                  orderItems.itemId,
                  itemChanges.map((change) => change.itemId),
                ),
                isNull(orderItems.deletedAt),
                isNull(orderLineItems.deletedAt),
              ),
            )
        : [];
    let proposedTotals: {
      previousTotal: number;
      newTotal: number;
    } | null = null;
    if (itemChanges.length > 0) {
      if (
        order.status !== "pending" ||
        activeItems.length !== itemChanges.length
      )
        return { success: false, reason: "ITEM_EDIT_UNSUPPORTED" };
      const rowsById = new Map(activeItems.map((row) => [row.item.id, row]));
      for (const change of itemChanges) {
        const row = rowsById.get(change.itemId);
        if (!row) return { success: false, reason: "INVALID_ACTION" };
        const state = row.state;
        const hasLifecycle =
          state.fulfilledQuantity > 0 ||
          state.deliveredQuantity > 0 ||
          state.shippedQuantity > 0 ||
          state.returnRequestedQuantity > 0 ||
          state.returnReceivedQuantity > 0 ||
          state.returnDismissedQuantity > 0 ||
          state.writtenOffQuantity > 0;
        if (
          hasLifecycle ||
          (change.action === "ITEM_UPDATE" &&
            (!Number.isSafeInteger(change.quantity) ||
              change.quantity < 1 ||
              change.quantity >= state.quantity))
        )
          return { success: false, reason: "ITEM_EDIT_UNSUPPORTED" };
      }

      const allItemIds = await db
        .select({ itemId: orderItems.itemId })
        .from(orderItems)
        .where(
          and(
            eq(orderItems.orderId, input.orderId),
            eq(orderItems.version, order.version),
            isNull(orderItems.deletedAt),
          ),
        );
      const removedItemIds = new Set(
        itemChanges
          .filter((change) => change.action === "ITEM_REMOVE")
          .map((change) => change.itemId),
      );
      if (
        allItemIds.length === 0 ||
        allItemIds.every((row) => removedItemIds.has(row.itemId))
      )
        return { success: false, reason: "ITEM_EDIT_UNSUPPORTED" };
      const shippingRows = await db
        .select({ shippingMethodId: orderShippings.shippingMethodId })
        .from(orderShippings)
        .where(
          and(
            eq(orderShippings.orderId, input.orderId),
            eq(orderShippings.version, order.version),
            isNull(orderShippings.returnId),
            isNull(orderShippings.exchangeId),
            isNull(orderShippings.claimId),
            isNull(orderShippings.deletedAt),
          ),
        );
      const [
        itemAdjustment,
        shippingAdjustment,
        creditLine,
        promotion,
        payment,
      ] = await Promise.all([
        allItemIds.length
          ? db
              .select({ id: orderLineItemAdjustments.id })
              .from(orderLineItemAdjustments)
              .where(
                and(
                  inArray(
                    orderLineItemAdjustments.itemId,
                    allItemIds.map((row) => row.itemId),
                  ),
                  eq(orderLineItemAdjustments.version, order.version),
                  isNull(orderLineItemAdjustments.deletedAt),
                ),
              )
              .limit(1)
          : Promise.resolve([]),
        shippingRows.length
          ? db
              .select({ id: orderShippingMethodAdjustments.id })
              .from(orderShippingMethodAdjustments)
              .where(
                and(
                  inArray(
                    orderShippingMethodAdjustments.shippingMethodId,
                    shippingRows.map((row) => row.shippingMethodId),
                  ),
                  eq(orderShippingMethodAdjustments.version, order.version),
                  isNull(orderShippingMethodAdjustments.deletedAt),
                ),
              )
              .limit(1)
          : Promise.resolve([]),
        db
          .select({ id: orderCreditLines.id })
          .from(orderCreditLines)
          .where(
            and(
              eq(orderCreditLines.orderId, input.orderId),
              eq(orderCreditLines.version, order.version),
              isNull(orderCreditLines.deletedAt),
            ),
          )
          .limit(1),
        db
          .select({ promotionId: orderPromotions.promotionId })
          .from(orderPromotions)
          .where(eq(orderPromotions.orderId, input.orderId))
          .limit(1),
        db
          .select({ id: orderPaymentCollections.orderId })
          .from(orderPaymentCollections)
          .where(eq(orderPaymentCollections.orderId, input.orderId))
          .limit(1),
      ]);
      if (
        itemAdjustment.length ||
        shippingAdjustment.length ||
        creditLine.length ||
        promotion.length ||
        payment.length
      )
        return { success: false, reason: "ITEM_EDIT_UNSUPPORTED" };
      const calculated = await calculateEditedOrderTotals({
        orderId: input.orderId,
        version: order.version,
        itemChanges: new Map(
          itemChanges.map((change) => [change.itemId, change]),
        ),
      });
      if (!calculated)
        return { success: false, reason: "ITEM_EDIT_UNSUPPORTED" };
      proposedTotals = {
        previousTotal: calculated.previousTotal,
        newTotal: calculated.newTotal,
      };
    }

    const editId = crypto.randomUUID();
    const version = order.version + 1;
    const now = new Date(
      Math.max(Date.now(), Date.parse(order.updatedAt) + 1),
    ).toISOString();
    const activeChange = db
      .select({ id: orderChanges.id })
      .from(orderChanges)
      .where(
        and(
          eq(orderChanges.orderId, input.orderId),
          inArray(orderChanges.status, [...requestedStatuses]),
          isNull(orderChanges.deletedAt),
        ),
      )
      .limit(1);
    const lineSnapshots = activeItems.map(({ state }) => ({
      id: state.id,
      itemId: state.itemId,
      quantity: state.quantity,
      fulfilledQuantity: state.fulfilledQuantity,
      deliveredQuantity: state.deliveredQuantity,
      shippedQuantity: state.shippedQuantity,
      returnRequestedQuantity: state.returnRequestedQuantity,
      returnReceivedQuantity: state.returnReceivedQuantity,
      returnDismissedQuantity: state.returnDismissedQuantity,
      writtenOffQuantity: state.writtenOffQuantity,
    }));
    const activeItemById = new Map(
      activeItems.map((row) => [row.item.id, row]),
    );
    const actionsToInsert: Array<typeof orderChangeActions.$inferInsert> =
      itemChanges.map((change, ordering) => {
        const row = activeItemById.get(change.itemId);
        if (!row) throw new Error("Validated order item disappeared");
        return {
          id: crypto.randomUUID(),
          orderChangeId: editId,
          orderId: input.orderId,
          ordering,
          version,
          reference: "item",
          referenceId: change.itemId,
          action: change.action,
          details: {
            title: row.item.title,
            previousQuantity: row.state.quantity,
            ...(change.action === "ITEM_UPDATE"
              ? { quantity: change.quantity }
              : {}),
            ...(ordering === 0 && proposedTotals
              ? {
                  previousOrderTotal: proposedTotals.previousTotal,
                  proposedOrderTotal: proposedTotals.newTotal,
                }
              : {}),
          },
          applied: false,
          createdAt: now,
          updatedAt: now,
        };
      });
    if (input.email !== undefined || input.noNotification !== undefined) {
      actionsToInsert.push({
        id: crypto.randomUUID(),
        orderChangeId: editId,
        orderId: input.orderId,
        ordering: actionsToInsert.length,
        version,
        reference: "order",
        referenceId: input.orderId,
        action: "ORDER_UPDATE",
        details: {
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.noNotification !== undefined
            ? { noNotification: input.noNotification }
            : {}),
        },
        applied: false,
        createdAt: now,
        updatedAt: now,
      });
    }
    const guardItemChanges = sql`
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(${JSON.stringify(lineSnapshots)}) expected
        LEFT JOIN order_items oi
          ON oi.id = json_extract(expected.value, '$.id')
         AND oi.order_id = ${input.orderId}
         AND oi.version = ${order.version}
         AND oi.deleted_at IS NULL
        WHERE oi.id IS NULL
           OR oi.item_id != json_extract(expected.value, '$.itemId')
           OR oi.quantity != json_extract(expected.value, '$.quantity')
           OR oi.fulfilled_quantity != json_extract(expected.value, '$.fulfilledQuantity')
           OR oi.delivered_quantity != json_extract(expected.value, '$.deliveredQuantity')
           OR oi.shipped_quantity != json_extract(expected.value, '$.shippedQuantity')
           OR oi.return_requested_quantity != json_extract(expected.value, '$.returnRequestedQuantity')
           OR oi.return_received_quantity != json_extract(expected.value, '$.returnReceivedQuantity')
           OR oi.return_dismissed_quantity != json_extract(expected.value, '$.returnDismissedQuantity')
           OR oi.written_off_quantity != json_extract(expected.value, '$.writtenOffQuantity')
      )
    `;
    const itemEditActivityGuard = itemChanges.length
      ? sql`
          AND NOT EXISTS (
            SELECT 1 FROM order_transactions ot
            WHERE ot.order_id = ${input.orderId}
              AND ot.version = ${order.version}
              AND ot.deleted_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM order_credit_lines ocl
            WHERE ocl.order_id = ${input.orderId}
              AND ocl.version = ${order.version}
              AND ocl.deleted_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM order_promotions op
            WHERE op.order_id = ${input.orderId}
          )
          AND NOT EXISTS (
            SELECT 1 FROM order_payment_collections opc
            WHERE opc.order_id = ${input.orderId}
          )
          AND NOT EXISTS (
            SELECT 1 FROM order_line_item_adjustments ila
            JOIN order_items oi
              ON oi.item_id = ila.item_id
             AND oi.order_id = ${input.orderId}
             AND oi.version = ${order.version}
             AND oi.deleted_at IS NULL
            WHERE ila.version = ${order.version}
              AND ila.deleted_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM order_shipping_method_adjustments osma
            JOIN order_shippings os
              ON os.shipping_method_id = osma.shipping_method_id
             AND os.order_id = ${input.orderId}
             AND os.version = ${order.version}
             AND os.return_id IS NULL
             AND os.exchange_id IS NULL
             AND os.claim_id IS NULL
             AND os.deleted_at IS NULL
            WHERE osma.version = ${order.version}
              AND osma.deleted_at IS NULL
          )
        `
      : sql``;
    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        sql`EXISTS (
            SELECT 1 FROM orders o
            WHERE o.id = ${input.orderId}
              AND o.version = ${order.version}
              AND o.updated_at = ${order.updatedAt}
              AND o.is_draft_order = 0
              AND o.canceled_at IS NULL
              AND o.deleted_at IS NULL
              AND (
                ${itemChanges.length > 0 ? sql`o.status = 'pending'` : sql`1 = 1`}
              )
              AND NOT EXISTS ${activeChange}
              ${guardItemChanges}
              ${itemEditActivityGuard}
          )`,
      ),
      db.insert(orderChanges).values({
        id: editId,
        orderId: input.orderId,
        version,
        changeType: "edit",
        status: "requested",
        createdBy: input.actorId,
        requestedBy: input.actorId,
        requestedAt: now,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      }),
    ];
    if (actionsToInsert.length) {
      const actionColumnCount = Object.keys(actionsToInsert[0] ?? {}).length;
      for (const actionGroup of chunkForInsert(
        actionsToInsert,
        actionColumnCount,
      ))
        statements.push(db.insert(orderChangeActions).values(actionGroup));
    }
    try {
      await db.batch(
        statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
    } catch {
      return (await readRequestedEdit(input.orderId))
        ? { success: false, reason: "EDIT_EXISTS" }
        : { success: false, reason: "CONFLICT" };
    }
    const edit = await this.get(input.orderId);
    return edit
      ? { success: true, edit }
      : { success: false, reason: "CONFLICT" };
  },

  async cancel(input: { orderId: string; editId: string; actorId: string }) {
    const current = await readOrderAndEdit(input);
    if (!current.success)
      return { success: false as const, reason: current.reason };
    if (!current.edit)
      return { success: false as const, reason: "EDIT_NOT_FOUND" as const };
    const db = await getDb();
    const now = new Date(
      Math.max(Date.now(), Date.parse(current.edit.updatedAt) + 1),
    ).toISOString();
    const changed = await db
      .update(orderChanges)
      .set({
        status: "canceled",
        canceledBy: input.actorId,
        canceledAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(orderChanges.id, current.edit.id),
          eq(orderChanges.orderId, input.orderId),
          eq(orderChanges.version, current.order.version + 1),
          eq(orderChanges.updatedAt, current.edit.updatedAt),
          eq(orderChanges.status, "requested"),
          isNull(orderChanges.deletedAt),
        ),
      );
    return Number(changed.meta.changes ?? 0) > 0
      ? { success: true as const }
      : { success: false as const, reason: "CONFLICT" as const };
  },

  async declineCustomer(input: {
    orderId: string;
    editId: string;
    customerId: string;
    actorId: string;
    email: string;
    salesChannelId: string | null;
  }): Promise<EditResult> {
    const current = await readOrderAndEdit({
      orderId: input.orderId,
      editId: input.editId,
      ownership: {
        customerId: input.customerId,
        email: input.email,
        salesChannelId: input.salesChannelId,
      },
    });
    if (!current.success) return { success: false, reason: current.reason };
    if (!current.edit) return { success: false, reason: "EDIT_NOT_FOUND" };
    const now = new Date(
      Math.max(Date.now(), Date.parse(current.edit.updatedAt) + 1),
    ).toISOString();
    const db = await getDb();
    try {
      await db.batch([
        batchGuard(
          db,
          sql`EXISTS (
            SELECT 1 FROM orders o
            WHERE o.id = ${input.orderId}
              AND o.version = ${current.order.version}
              AND o.updated_at = ${current.order.updatedAt}
              AND o.is_draft_order = 0
              AND o.canceled_at IS NULL
              AND o.deleted_at IS NULL
              AND o.sales_channel_id = ${input.salesChannelId}
              AND (o.customer_id = ${input.customerId} OR lower(o.email) = ${input.email.trim().toLowerCase()})
              AND EXISTS (
                SELECT 1 FROM order_changes oc
                WHERE oc.id = ${input.editId}
                  AND oc.order_id = o.id
                  AND oc.version = ${current.order.version + 1}
                  AND oc.status = 'requested'
                  AND oc.updated_at = ${current.edit.updatedAt}
                  AND oc.deleted_at IS NULL
              )
          )`,
        ),
        db
          .update(orderChanges)
          .set({
            status: "declined",
            declinedBy: input.actorId,
            declinedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(orderChanges.id, input.editId),
              eq(orderChanges.orderId, input.orderId),
              eq(orderChanges.version, current.order.version + 1),
              eq(orderChanges.updatedAt, current.edit.updatedAt),
              eq(orderChanges.status, "requested"),
              isNull(orderChanges.deletedAt),
            ),
          ),
      ] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    } catch {
      return { success: false, reason: "CONFLICT" };
    }
    return {
      success: true,
      edit: {
        ...current.edit,
        status: "declined",
        updatedAt: now,
      },
    };
  },

  async confirm(input: {
    orderId: string;
    editId: string;
    actorId: string;
    ownership?: {
      customerId: string;
      email: string;
      salesChannelId: string | null;
    };
  }): Promise<EditResult> {
    const current = await readOrderAndEdit({
      ...input,
      ownership: input.ownership,
    });
    if (!current.success) return { success: false, reason: current.reason };
    if (!current.edit) return { success: false, reason: "EDIT_NOT_FOUND" };
    const updateActions = current.edit.actions.filter(
      (action) => action.action === "ORDER_UPDATE",
    );
    const itemActions = current.edit.actions.filter(
      (action) =>
        action.action === "ITEM_UPDATE" || action.action === "ITEM_REMOVE",
    );
    if (
      current.edit.actions.length === 0 ||
      current.edit.actions.length !==
        updateActions.length + itemActions.length ||
      updateActions.length > 1
    )
      return { success: false, reason: "INVALID_ACTION" };
    const details: ReturnType<typeof parseUpdateDetails> = updateActions.length
      ? parseUpdateDetails(updateActions[0]!.details)
      : {};
    if (updateActions.length && !details)
      return { success: false, reason: "INVALID_ACTION" };

    const itemChanges = new Map<string, OrderEditItemChangeInput>();
    let itemStateSnapshots: Array<{
      id: string;
      itemId: string;
      quantity: number;
      fulfilledQuantity: number;
      deliveredQuantity: number;
      shippedQuantity: number;
      returnRequestedQuantity: number;
      returnReceivedQuantity: number;
      returnDismissedQuantity: number;
      writtenOffQuantity: number;
    }> = [];
    let summaryTotals: JsonValue | undefined;
    if (itemActions.length) {
      if (current.order.status !== "pending")
        return { success: false, reason: "ITEM_EDIT_UNSUPPORTED" };
      const parsedActions = itemActions.map((action) => ({
        action,
        change: parseItemAction(action),
      }));
      if (
        parsedActions.some(({ change }) => change === null) ||
        new Set(parsedActions.map(({ change }) => change!.itemId)).size !==
          itemActions.length
      )
        return { success: false, reason: "INVALID_ACTION" };
      for (const { change } of parsedActions)
        itemChanges.set(change!.itemId, change!);

      const db = await getDb();
      const changedRows = await db
        .select({ item: orderLineItems, state: orderItems })
        .from(orderItems)
        .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
        .where(
          and(
            eq(orderItems.orderId, input.orderId),
            eq(orderItems.version, current.order.version),
            inArray(orderItems.itemId, [...itemChanges.keys()]),
            isNull(orderItems.deletedAt),
            isNull(orderLineItems.deletedAt),
          ),
        );
      if (changedRows.length !== itemChanges.size)
        return { success: false, reason: "CONFLICT" };
      const changedRowsById = new Map(
        changedRows.map((row) => [row.item.id, row]),
      );
      for (const { action, change } of parsedActions) {
        const row = changedRowsById.get(change!.itemId);
        if (!row || hasItemLifecycle(row.state))
          return { success: false, reason: "ITEM_EDIT_UNSUPPORTED" };
        if (
          !action.details ||
          typeof action.details !== "object" ||
          Array.isArray(action.details)
        )
          return { success: false, reason: "INVALID_ACTION" };
        const actionDetails = action.details as Record<string, unknown>;
        if (
          actionDetails.title !== row.item.title ||
          actionDetails.previousQuantity !== row.state.quantity
        )
          return { success: false, reason: "CONFLICT" };
      }
      itemStateSnapshots = changedRows.map(({ state }) => ({
        id: state.id,
        itemId: state.itemId,
        quantity: state.quantity,
        fulfilledQuantity: state.fulfilledQuantity,
        deliveredQuantity: state.deliveredQuantity,
        shippedQuantity: state.shippedQuantity,
        returnRequestedQuantity: state.returnRequestedQuantity,
        returnReceivedQuantity: state.returnReceivedQuantity,
        returnDismissedQuantity: state.returnDismissedQuantity,
        writtenOffQuantity: state.writtenOffQuantity,
      }));
      const totals = await calculateEditedOrderTotals({
        orderId: input.orderId,
        version: current.order.version,
        itemChanges,
      });
      if (!totals) return { success: false, reason: "ITEM_EDIT_UNSUPPORTED" };
      summaryTotals = totals.totals;
    }

    const db = await getDb();
    const nextVersion = current.order.version + 1;
    const now = new Date(
      Math.max(Date.now(), Date.parse(current.order.updatedAt) + 1),
    ).toISOString();
    const itemStateGuard = itemStateSnapshots.length
      ? sql`
          AND NOT EXISTS (
            SELECT 1
            FROM json_each(${JSON.stringify(itemStateSnapshots)}) expected
            LEFT JOIN order_items oi
              ON oi.id = json_extract(expected.value, '$.id')
             AND oi.order_id = ${input.orderId}
             AND oi.version = ${current.order.version}
             AND oi.deleted_at IS NULL
            WHERE oi.id IS NULL
               OR oi.item_id != json_extract(expected.value, '$.itemId')
               OR oi.quantity != json_extract(expected.value, '$.quantity')
               OR oi.fulfilled_quantity != json_extract(expected.value, '$.fulfilledQuantity')
               OR oi.delivered_quantity != json_extract(expected.value, '$.deliveredQuantity')
               OR oi.shipped_quantity != json_extract(expected.value, '$.shippedQuantity')
               OR oi.return_requested_quantity != json_extract(expected.value, '$.returnRequestedQuantity')
               OR oi.return_received_quantity != json_extract(expected.value, '$.returnReceivedQuantity')
               OR oi.return_dismissed_quantity != json_extract(expected.value, '$.returnDismissedQuantity')
               OR oi.written_off_quantity != json_extract(expected.value, '$.writtenOffQuantity')
          )
          AND NOT EXISTS (
            SELECT 1 FROM order_transactions ot
            WHERE ot.order_id = ${input.orderId}
              AND ot.version = ${current.order.version}
              AND ot.deleted_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM order_credit_lines ocl
            WHERE ocl.order_id = ${input.orderId}
              AND ocl.version = ${current.order.version}
              AND ocl.deleted_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM order_promotions op
            WHERE op.order_id = ${input.orderId}
          )
          AND NOT EXISTS (
            SELECT 1 FROM order_payment_collections opc
            WHERE opc.order_id = ${input.orderId}
          )
          AND NOT EXISTS (
            SELECT 1 FROM order_line_item_adjustments ila
            JOIN order_items oi
              ON oi.item_id = ila.item_id
             AND oi.order_id = ${input.orderId}
             AND oi.version = ${current.order.version}
             AND oi.deleted_at IS NULL
            WHERE ila.version = ${current.order.version}
              AND ila.deleted_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM order_shipping_method_adjustments osma
            JOIN order_shippings os
              ON os.shipping_method_id = osma.shipping_method_id
             AND os.order_id = ${input.orderId}
             AND os.version = ${current.order.version}
             AND os.return_id IS NULL
             AND os.exchange_id IS NULL
             AND os.claim_id IS NULL
             AND os.deleted_at IS NULL
            WHERE osma.version = ${current.order.version}
              AND osma.deleted_at IS NULL
          )
        `
      : sql``;
    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        sql`EXISTS (
          SELECT 1 FROM orders o
          WHERE o.id = ${input.orderId}
            AND o.version = ${current.order.version}
            AND o.updated_at = ${current.order.updatedAt}
            AND o.is_draft_order = 0
            AND o.canceled_at IS NULL
            AND o.deleted_at IS NULL
            AND (
              ${itemChanges.size > 0 ? sql`o.status = 'pending'` : sql`1 = 1`}
            )
            AND (
              ${
                input.ownership
                  ? input.ownership.salesChannelId !== null
                    ? sql`o.customer_id = ${input.ownership.customerId} OR lower(o.email) = ${input.ownership.email.trim().toLowerCase()}`
                    : sql`1 = 0`
                  : sql`1 = 1`
              }
            )
            AND (
              ${
                input.ownership
                  ? input.ownership.salesChannelId !== null
                    ? sql`o.sales_channel_id = ${input.ownership.salesChannelId}`
                    : sql`1 = 0`
                  : sql`1 = 1`
              }
            )
            AND EXISTS (
              SELECT 1 FROM order_changes oc
              WHERE oc.id = ${current.edit.id}
                AND oc.order_id = o.id
                AND oc.version = ${nextVersion}
                AND oc.status = 'requested'
                AND oc.updated_at = ${current.edit.updatedAt}
                AND oc.deleted_at IS NULL
            )
            ${itemStateGuard}
        )`,
      ),
    ];
    statements.push(
      ...(await snapshotVersionRows({
        orderId: input.orderId,
        fromVersion: current.order.version,
        toVersion: nextVersion,
        now,
        ...(itemChanges.size ? { itemChanges } : {}),
        ...(summaryTotals !== undefined ? { summaryTotals } : {}),
      })),
    );
    statements.push(
      db
        .update(orders)
        .set({
          version: nextVersion,
          ...(details?.email !== undefined
            ? { email: details.email.trim() || null }
            : {}),
          ...(details?.noNotification !== undefined
            ? { noNotification: details.noNotification }
            : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(orders.id, input.orderId),
            eq(orders.version, current.order.version),
            eq(orders.updatedAt, current.order.updatedAt),
            eq(orders.isDraftOrder, false),
            isNull(orders.canceledAt),
            isNull(orders.deletedAt),
          ),
        ),
      db
        .update(orderChanges)
        .set({
          status: "confirmed",
          confirmedBy: input.actorId,
          confirmedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(orderChanges.id, current.edit.id),
            eq(orderChanges.orderId, input.orderId),
            eq(orderChanges.version, nextVersion),
            eq(orderChanges.updatedAt, current.edit.updatedAt),
            eq(orderChanges.status, "requested"),
            isNull(orderChanges.deletedAt),
          ),
        ),
      db
        .update(orderChangeActions)
        .set({ applied: true, updatedAt: now })
        .where(
          and(
            eq(orderChangeActions.orderChangeId, current.edit.id),
            eq(orderChangeActions.applied, false),
            isNull(orderChangeActions.deletedAt),
          ),
        ),
    );
    try {
      await db.batch(
        statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
    } catch {
      return { success: false, reason: "CONFLICT" };
    }
    return {
      success: true as const,
      edit: {
        ...current.edit,
        status: "confirmed",
        updatedAt: now,
        actions: current.edit.actions.map((editAction) => ({
          ...editAction,
          applied: true,
        })),
      },
    };
  },
};
