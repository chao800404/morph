import { getDb } from "@/db";
import type { JsonValue } from "@/db/json";
import {
  orderChangeActions,
  orderChanges,
  orderItems,
  orderLineItems,
  orderShippings,
  orderShippingMethods,
  orders,
} from "@/db/schema";
import { firstOrNull } from "@/lib/db/single-row";
import { chunkForInsert } from "@/lib/product/dal/d1-batch";
import { and, asc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { batchGuard } from "@/lib/db/batch-guard";

export type DraftOrderEditItemInput =
  | {
      variantId: string;
      quantity: number;
      unitPrice?: number;
      compareAtUnitPrice?: number;
    }
  | {
      title: string;
      sku?: string;
      quantity: number;
      unitPrice: number;
      compareAtUnitPrice?: number;
    };

export type DraftOrderEditAction = {
  id: string;
  ordering: number;
  action: string;
  reference: string | null;
  referenceId: string | null;
  details: JsonValue;
  internalNote: string | null;
  applied: boolean;
};

export type DraftOrderEdit = {
  id: string;
  orderId: string;
  version: number;
  status: string | null;
  createdBy: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  updatedAt: string;
  actions: DraftOrderEditAction[];
};

type EditFailureReason =
  | "NOT_FOUND"
  | "NOT_DRAFT"
  | "VERSION_CONFLICT"
  | "EDIT_EXISTS"
  | "EDIT_NOT_FOUND"
  | "EDIT_NOT_PENDING"
  | "ITEM_NOT_FOUND"
  | "SHIPPING_METHOD_NOT_FOUND"
  | "ACTION_NOT_FOUND"
  | "EMPTY_EDIT";

type DraftOrderEditActionType =
  | "ITEM_ADD"
  | "ITEM_UPDATE"
  | "ITEM_REMOVE"
  | "SHIPPING_ADD"
  | "SHIPPING_UPDATE"
  | "SHIPPING_REMOVE"
  | "PROMOTION_ADD"
  | "PROMOTION_REMOVE"
  | "ORDER_UPDATE";

type DraftOrderEditActionInput = {
  action: DraftOrderEditActionType;
  reference?: string;
  referenceId?: string;
  details: JsonValue;
  internalNote?: string;
};

const activeEditStatuses = ["pending", "requested"] as const;

const monotonicTimestamp = (previous: string) =>
  new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();

async function readActiveEdit(orderId: string) {
  const db = await getDb();
  return firstOrNull(
    await db
      .select()
      .from(orderChanges)
      .where(
        and(
          eq(orderChanges.orderId, orderId),
          eq(orderChanges.changeType, "edit"),
          inArray(orderChanges.status, [...activeEditStatuses]),
          isNull(orderChanges.deletedAt),
        ),
      )
      .orderBy(asc(orderChanges.createdAt), asc(orderChanges.id))
      .limit(1),
  );
}

async function readActions(editId: string): Promise<DraftOrderEditAction[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: orderChangeActions.id,
      ordering: orderChangeActions.ordering,
      action: orderChangeActions.action,
      reference: orderChangeActions.reference,
      referenceId: orderChangeActions.referenceId,
      details: orderChangeActions.details,
      internalNote: orderChangeActions.internalNote,
      applied: orderChangeActions.applied,
    })
    .from(orderChangeActions)
    .where(
      and(
        eq(orderChangeActions.orderChangeId, editId),
        isNull(orderChangeActions.deletedAt),
      ),
    )
    .orderBy(asc(orderChangeActions.ordering), asc(orderChangeActions.id));
  return rows;
}

async function getEditAndOrder(orderId: string) {
  const db = await getDb();
  const order = firstOrNull(
    await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), isNull(orders.deletedAt)))
      .limit(1),
  );
  if (!order) return { reason: "NOT_FOUND" as const };
  if (!order.isDraftOrder || order.status !== "draft" || order.canceledAt)
    return { reason: "NOT_DRAFT" as const };
  const edit = await readActiveEdit(orderId);
  if (!edit) return { reason: "EDIT_NOT_FOUND" as const };
  if (edit.version !== order.version + 1)
    return { reason: "VERSION_CONFLICT" as const };
  return { order, edit };
}

async function createEditAction(input: {
  orderId: string;
  action: DraftOrderEditActionType;
  reference?: string;
  referenceId?: string;
  details: JsonValue;
  internalNote?: string;
}) {
  const current = await getEditAndOrder(input.orderId);
  if ("reason" in current)
    return {
      success: false as const,
      reason: current.reason ?? "EDIT_NOT_FOUND",
    };
  const { edit, order } = current;
  if (edit.status !== "pending")
    return { success: false as const, reason: "EDIT_NOT_PENDING" as const };

  const db = await getDb();
  if (input.action === "ITEM_UPDATE" || input.action === "ITEM_REMOVE") {
    const item = firstOrNull(
      await db
        .select({ id: orderItems.id })
        .from(orderItems)
        .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
        .where(
          and(
            eq(orderItems.orderId, input.orderId),
            eq(orderItems.itemId, input.referenceId ?? ""),
            eq(orderItems.version, order.version),
            isNull(orderItems.deletedAt),
            isNull(orderLineItems.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!item)
      return { success: false as const, reason: "ITEM_NOT_FOUND" as const };
  }
  if (
    input.action === "SHIPPING_UPDATE" ||
    input.action === "SHIPPING_REMOVE"
  ) {
    const method = firstOrNull(
      await db
        .select({ id: orderShippingMethods.id })
        .from(orderShippings)
        .innerJoin(
          orderShippingMethods,
          eq(orderShippingMethods.id, orderShippings.shippingMethodId),
        )
        .where(
          and(
            eq(orderShippings.orderId, input.orderId),
            eq(orderShippings.shippingMethodId, input.referenceId ?? ""),
            eq(orderShippings.version, order.version),
            isNull(orderShippings.returnId),
            isNull(orderShippings.exchangeId),
            isNull(orderShippings.claimId),
            isNull(orderShippings.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!method)
      return {
        success: false as const,
        reason: "SHIPPING_METHOD_NOT_FOUND" as const,
      };
  }

  const orderingRow = firstOrNull(
    await db
      .select({ value: max(orderChangeActions.ordering) })
      .from(orderChangeActions)
      .where(
        and(
          eq(orderChangeActions.orderChangeId, edit.id),
          isNull(orderChangeActions.deletedAt),
        ),
      ),
  );
  const actionId = crypto.randomUUID();
  const now = monotonicTimestamp(edit.updatedAt);
  const canMutateEdit = db
    .select({ id: orderChanges.id })
    .from(orderChanges)
    .innerJoin(orders, eq(orders.id, orderChanges.orderId))
    .where(
      and(
        eq(orderChanges.id, edit.id),
        eq(orderChanges.updatedAt, edit.updatedAt),
        eq(orderChanges.status, "pending"),
        eq(orderChanges.version, edit.version),
        eq(orderChanges.changeType, "edit"),
        isNull(orderChanges.deletedAt),
        eq(orders.version, order.version),
        eq(orders.id, input.orderId),
        eq(orders.isDraftOrder, true),
        eq(orders.status, "draft"),
        isNull(orders.canceledAt),
        isNull(orders.deletedAt),
      ),
    )
    .limit(1);
  const statements: BatchItem<"sqlite">[] = [
    batchGuard(db, sql`EXISTS ${canMutateEdit}`),
    db
      .update(orderChanges)
      .set({ updatedAt: now })
      .where(
        and(
          eq(orderChanges.id, edit.id),
          eq(orderChanges.updatedAt, edit.updatedAt),
          eq(orderChanges.status, "pending"),
          isNull(orderChanges.deletedAt),
        ),
      ),
    db.insert(orderChangeActions).values({
      id: actionId,
      orderChangeId: edit.id,
      orderId: input.orderId,
      ordering: (orderingRow?.value ?? -1) + 1,
      version: edit.version,
      reference:
        input.reference ??
        (input.action.startsWith("ITEM")
          ? "item"
          : input.action.startsWith("SHIPPING")
            ? "shipping_method"
            : "promotion"),
      referenceId: input.referenceId ?? null,
      action: input.action,
      details: input.details,
      internalNote: input.internalNote ?? null,
      applied: false,
      createdAt: now,
      updatedAt: now,
    }),
  ];
  try {
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    return {
      success: true as const,
      actionId,
      editId: edit.id,
      updatedAt: now,
    };
  } catch {
    return { success: false as const, reason: "VERSION_CONFLICT" as const };
  }
}

async function appendEditActions(
  orderId: string,
  actions: DraftOrderEditActionInput[],
) {
  if (!actions.length)
    return { success: false as const, reason: "EMPTY_EDIT" as const };
  const current = await getEditAndOrder(orderId);
  if ("reason" in current)
    return {
      success: false as const,
      reason: current.reason ?? "EDIT_NOT_FOUND",
    };
  const { edit, order } = current;
  if (edit.status !== "pending")
    return { success: false as const, reason: "EDIT_NOT_PENDING" as const };

  const db = await getDb();
  const orderingRow = firstOrNull(
    await db
      .select({ value: max(orderChangeActions.ordering) })
      .from(orderChangeActions)
      .where(
        and(
          eq(orderChangeActions.orderChangeId, edit.id),
          isNull(orderChangeActions.deletedAt),
        ),
      ),
  );
  const now = monotonicTimestamp(edit.updatedAt);
  const canMutate = db
    .select({ id: orderChanges.id })
    .from(orderChanges)
    .innerJoin(orders, eq(orders.id, orderChanges.orderId))
    .where(
      and(
        eq(orderChanges.id, edit.id),
        eq(orderChanges.updatedAt, edit.updatedAt),
        eq(orderChanges.status, "pending"),
        eq(orderChanges.version, edit.version),
        eq(orderChanges.changeType, "edit"),
        isNull(orderChanges.deletedAt),
        eq(orders.version, order.version),
        eq(orders.id, orderId),
        eq(orders.isDraftOrder, true),
        eq(orders.status, "draft"),
        isNull(orders.canceledAt),
        isNull(orders.deletedAt),
      ),
    )
    .limit(1);
  const rows = actions.map((action, index) => ({
    id: crypto.randomUUID(),
    orderChangeId: edit.id,
    orderId,
    ordering: (orderingRow?.value ?? -1) + index + 1,
    version: edit.version,
    reference: action.reference ?? null,
    referenceId: action.referenceId ?? null,
    action: action.action,
    details: action.details,
    internalNote: action.internalNote ?? null,
    applied: false,
    createdAt: now,
    updatedAt: now,
  }));
  const statements: BatchItem<"sqlite">[] = [
    batchGuard(db, sql`EXISTS ${canMutate}`),
    db
      .update(orderChanges)
      .set({ updatedAt: now })
      .where(
        and(
          eq(orderChanges.id, edit.id),
          eq(orderChanges.updatedAt, edit.updatedAt),
          eq(orderChanges.status, "pending"),
          isNull(orderChanges.deletedAt),
        ),
      ),
  ];
  for (const group of chunkForInsert(rows, 12))
    statements.push(db.insert(orderChangeActions).values(group));
  try {
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    return { success: true as const, editId: edit.id, updatedAt: now };
  } catch {
    return { success: false as const, reason: "VERSION_CONFLICT" as const };
  }
}

const asJsonRecord = (value: JsonValue): Record<string, JsonValue> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : null;

async function updatePendingAction(input: {
  orderId: string;
  actionId: string;
  action: "ITEM_ADD" | "SHIPPING_ADD";
  internalNote?: string;
  updateDetails(details: JsonValue): JsonValue | null;
}) {
  const current = await getEditAndOrder(input.orderId);
  if ("reason" in current)
    return {
      success: false as const,
      reason: current.reason ?? "EDIT_NOT_FOUND",
    };
  const { edit, order } = current;
  if (edit.status !== "pending")
    return { success: false as const, reason: "EDIT_NOT_PENDING" as const };
  const db = await getDb();
  const action = firstOrNull(
    await db
      .select({
        id: orderChangeActions.id,
        details: orderChangeActions.details,
        internalNote: orderChangeActions.internalNote,
        updatedAt: orderChangeActions.updatedAt,
      })
      .from(orderChangeActions)
      .where(
        and(
          eq(orderChangeActions.id, input.actionId),
          eq(orderChangeActions.orderChangeId, edit.id),
          eq(orderChangeActions.action, input.action),
          isNull(orderChangeActions.deletedAt),
          eq(orderChangeActions.applied, false),
        ),
      )
      .limit(1),
  );
  if (!action)
    return { success: false as const, reason: "ACTION_NOT_FOUND" as const };
  const details = input.updateDetails(action.details);
  if (!details)
    return { success: false as const, reason: "ACTION_NOT_FOUND" as const };
  const now = monotonicTimestamp(edit.updatedAt);
  const guard = db
    .select({ id: orderChanges.id })
    .from(orderChanges)
    .innerJoin(orders, eq(orders.id, orderChanges.orderId))
    .where(
      and(
        eq(orderChanges.id, edit.id),
        eq(orderChanges.updatedAt, edit.updatedAt),
        eq(orderChanges.status, "pending"),
        eq(orderChanges.version, edit.version),
        eq(orders.id, input.orderId),
        eq(orders.version, order.version),
        eq(orders.isDraftOrder, true),
        eq(orders.status, "draft"),
        isNull(orders.canceledAt),
        isNull(orders.deletedAt),
        isNull(orderChanges.deletedAt),
      ),
    )
    .limit(1);
  try {
    await db.batch([
      batchGuard(db, sql`EXISTS ${guard}`),
      db
        .update(orderChanges)
        .set({ updatedAt: now })
        .where(
          and(
            eq(orderChanges.id, edit.id),
            eq(orderChanges.updatedAt, edit.updatedAt),
            eq(orderChanges.status, "pending"),
            isNull(orderChanges.deletedAt),
          ),
        ),
      db
        .update(orderChangeActions)
        .set({
          details,
          internalNote: input.internalNote ?? action.internalNote,
          updatedAt: now,
        })
        .where(
          and(
            eq(orderChangeActions.id, action.id),
            eq(orderChangeActions.orderChangeId, edit.id),
            eq(orderChangeActions.updatedAt, action.updatedAt),
            eq(orderChangeActions.applied, false),
            isNull(orderChangeActions.deletedAt),
          ),
        ),
    ]);
    return { success: true as const, editId: edit.id, updatedAt: now };
  } catch {
    return { success: false as const, reason: "VERSION_CONFLICT" as const };
  }
}

export const draftOrderEditDal = {
  async get(orderId: string): Promise<DraftOrderEdit | null> {
    const edit = await readActiveEdit(orderId);
    if (!edit) return null;
    return {
      id: edit.id,
      orderId: edit.orderId,
      version: edit.version,
      status: edit.status,
      createdBy: edit.createdBy,
      requestedBy: edit.requestedBy,
      requestedAt: edit.requestedAt,
      updatedAt: edit.updatedAt,
      actions: await readActions(edit.id),
    };
  },

  async begin(
    orderId: string,
    expectedVersion: number,
    actorId?: string,
  ): Promise<
    | { success: true; edit: DraftOrderEdit }
    | { success: false; reason: EditFailureReason }
  > {
    const db = await getDb();
    const order = firstOrNull(
      await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), isNull(orders.deletedAt)))
        .limit(1),
    );
    if (!order) return { success: false, reason: "NOT_FOUND" };
    if (!order.isDraftOrder || order.status !== "draft" || order.canceledAt)
      return { success: false, reason: "NOT_DRAFT" };
    if (order.version !== expectedVersion)
      return { success: false, reason: "VERSION_CONFLICT" };
    if (await readActiveEdit(orderId))
      return { success: false, reason: "EDIT_EXISTS" };

    const editId = crypto.randomUUID();
    const now = new Date().toISOString();
    const noActiveEdit = db
      .select({ id: orderChanges.id })
      .from(orderChanges)
      .where(
        and(
          eq(orderChanges.orderId, orderId),
          eq(orderChanges.changeType, "edit"),
          inArray(orderChanges.status, [...activeEditStatuses]),
          isNull(orderChanges.deletedAt),
        ),
      )
      .limit(1);
    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        sql`EXISTS (
          SELECT 1 FROM orders o
          WHERE o.id = ${orderId}
            AND o.version = ${expectedVersion}
            AND o.updated_at = ${order.updatedAt}
            AND o.status = 'draft'
            AND o.is_draft_order = 1
            AND o.canceled_at IS NULL
            AND o.deleted_at IS NULL
            AND NOT EXISTS ${noActiveEdit}
        )`,
      ),
      db.insert(orderChanges).values({
        id: editId,
        orderId,
        version: expectedVersion + 1,
        changeType: "edit",
        status: "pending",
        createdBy: actorId ?? null,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      }),
    ];
    try {
      await db.batch(
        statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
    } catch {
      if (await readActiveEdit(orderId))
        return { success: false, reason: "EDIT_EXISTS" };
      const latest = firstOrNull(
        await db
          .select({
            isDraftOrder: orders.isDraftOrder,
            status: orders.status,
            version: orders.version,
            canceledAt: orders.canceledAt,
          })
          .from(orders)
          .where(and(eq(orders.id, orderId), isNull(orders.deletedAt)))
          .limit(1),
      );
      if (!latest) return { success: false, reason: "NOT_FOUND" };
      if (
        !latest.isDraftOrder ||
        latest.status !== "draft" ||
        latest.canceledAt
      )
        return { success: false, reason: "NOT_DRAFT" };
      return { success: false, reason: "VERSION_CONFLICT" };
    }
    const edit = await this.get(orderId);
    return edit
      ? { success: true, edit }
      : { success: false, reason: "EDIT_NOT_FOUND" };
  },

  async addItems(
    orderId: string,
    items: DraftOrderEditItemInput[],
  ): Promise<
    | { success: true; editId: string; updatedAt: string }
    | { success: false; reason: EditFailureReason }
  > {
    if (items.length === 0) return { success: false, reason: "EMPTY_EDIT" };
    return appendEditActions(
      orderId,
      items.map((item) => ({
        action: "ITEM_ADD",
        reference: "item",
        details: { item } satisfies JsonValue,
      })),
    );
  },

  async updateItem(input: {
    orderId: string;
    itemId: string;
    quantity: number;
    unitPrice?: number;
    compareAtUnitPrice?: number;
    internalNote?: string;
  }) {
    return createEditAction({
      orderId: input.orderId,
      action: "ITEM_UPDATE",
      referenceId: input.itemId,
      details: {
        quantity: input.quantity,
        ...(input.unitPrice !== undefined
          ? { unitPrice: input.unitPrice }
          : {}),
        ...(input.compareAtUnitPrice !== undefined
          ? { compareAtUnitPrice: input.compareAtUnitPrice }
          : {}),
      },
      internalNote: input.internalNote,
    });
  },

  async removeItem(input: { orderId: string; itemId: string }) {
    return createEditAction({
      orderId: input.orderId,
      action: "ITEM_REMOVE",
      referenceId: input.itemId,
      details: {},
    });
  },

  async addPromotions(orderId: string, codes: string[]) {
    const normalized = [...new Set(codes.map((code) => code.trim()))];
    if (!normalized.length || normalized.some((code) => !code))
      return { success: false as const, reason: "EMPTY_EDIT" as const };
    return appendEditActions(
      orderId,
      normalized.map((code) => ({
        action: "PROMOTION_ADD",
        reference: "promotion",
        referenceId: code,
        details: { code },
      })),
    );
  },

  async removePromotions(orderId: string, codes: string[]) {
    const normalized = [...new Set(codes.map((code) => code.trim()))];
    if (!normalized.length || normalized.some((code) => !code))
      return { success: false as const, reason: "EMPTY_EDIT" as const };
    return appendEditActions(
      orderId,
      normalized.map((code) => ({
        action: "PROMOTION_REMOVE",
        reference: "promotion",
        referenceId: code,
        details: { code },
      })),
    );
  },

  async updateOrderFields(input: {
    orderId: string;
    email?: string;
    noNotification?: boolean;
    shippingAddress?: JsonValue;
    billingAddress?: JsonValue;
  }) {
    const details: Record<string, JsonValue> = {};
    if (input.email !== undefined) details.email = input.email;
    if (input.noNotification !== undefined)
      details.noNotification = input.noNotification;
    if (input.shippingAddress !== undefined)
      details.shippingAddress = input.shippingAddress;
    if (input.billingAddress !== undefined)
      details.billingAddress = input.billingAddress;
    if (!Object.keys(details).length)
      return { success: false as const, reason: "EMPTY_EDIT" as const };
    return appendEditActions(input.orderId, [
      {
        action: "ORDER_UPDATE",
        reference: "order",
        details,
      },
    ]);
  },

  async addShippingMethod(input: {
    orderId: string;
    shippingOptionId: string;
    shippingProfileId: string;
    customAmount?: number;
    description?: string;
    internalNote?: string;
  }) {
    return appendEditActions(input.orderId, [
      {
        action: "SHIPPING_ADD",
        reference: "shipping_method",
        details: {
          shippingOptionId: input.shippingOptionId,
          shippingProfileId: input.shippingProfileId,
          ...(input.customAmount !== undefined
            ? { customAmount: input.customAmount }
            : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
        },
        internalNote: input.internalNote,
      },
    ]);
  },

  async updateShippingMethod(input: {
    orderId: string;
    methodId: string;
    customAmount?: number;
    description?: string;
    internalNote?: string;
  }) {
    return createEditAction({
      orderId: input.orderId,
      action: "SHIPPING_UPDATE",
      referenceId: input.methodId,
      details: {
        ...(input.customAmount !== undefined
          ? { customAmount: input.customAmount }
          : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
      },
      internalNote: input.internalNote,
    });
  },

  async removeShippingMethod(input: { orderId: string; methodId: string }) {
    return createEditAction({
      orderId: input.orderId,
      action: "SHIPPING_REMOVE",
      referenceId: input.methodId,
      details: {},
    });
  },

  async updateAddedItem(input: {
    orderId: string;
    actionId: string;
    quantity: number;
    unitPrice?: number;
    compareAtUnitPrice?: number;
    internalNote?: string;
  }): Promise<
    | { success: true; editId: string; updatedAt: string }
    | { success: false; reason: EditFailureReason }
  > {
    return updatePendingAction({
      orderId: input.orderId,
      actionId: input.actionId,
      action: "ITEM_ADD",
      internalNote: input.internalNote,
      updateDetails: (previous) => {
        const record = asJsonRecord(previous);
        const item = record?.item;
        const currentItem = item ? asJsonRecord(item) : null;
        if (!record || !currentItem) return null;
        return {
          ...record,
          item: {
            ...currentItem,
            quantity: input.quantity,
            ...(input.unitPrice !== undefined
              ? { unitPrice: input.unitPrice }
              : {}),
            ...(input.compareAtUnitPrice !== undefined
              ? { compareAtUnitPrice: input.compareAtUnitPrice }
              : {}),
          },
        };
      },
    });
  },

  async updateAddedShippingMethod(input: {
    orderId: string;
    actionId: string;
    customAmount?: number;
    description?: string;
    internalNote?: string;
  }) {
    return updatePendingAction({
      orderId: input.orderId,
      actionId: input.actionId,
      action: "SHIPPING_ADD",
      internalNote: input.internalNote,
      updateDetails: (previous) => {
        const details = asJsonRecord(previous);
        if (!details || typeof details.shippingOptionId !== "string")
          return null;
        return {
          ...details,
          ...(input.customAmount !== undefined
            ? { customAmount: input.customAmount }
            : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
        };
      },
    });
  },

  async removeAddedShippingMethod(input: {
    orderId: string;
    actionId: string;
  }) {
    const current = await getEditAndOrder(input.orderId);
    if ("reason" in current)
      return {
        success: false as const,
        reason: current.reason ?? "EDIT_NOT_FOUND",
      };
    const { edit, order } = current;
    if (edit.status !== "pending")
      return { success: false as const, reason: "EDIT_NOT_PENDING" as const };
    const db = await getDb();
    const action = firstOrNull(
      await db
        .select({
          id: orderChangeActions.id,
          updatedAt: orderChangeActions.updatedAt,
        })
        .from(orderChangeActions)
        .where(
          and(
            eq(orderChangeActions.id, input.actionId),
            eq(orderChangeActions.orderChangeId, edit.id),
            eq(orderChangeActions.action, "SHIPPING_ADD"),
            eq(orderChangeActions.applied, false),
            isNull(orderChangeActions.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!action)
      return { success: false as const, reason: "ACTION_NOT_FOUND" as const };
    const now = monotonicTimestamp(edit.updatedAt);
    const guard = db
      .select({ id: orderChanges.id })
      .from(orderChanges)
      .innerJoin(orders, eq(orders.id, orderChanges.orderId))
      .where(
        and(
          eq(orderChanges.id, edit.id),
          eq(orderChanges.updatedAt, edit.updatedAt),
          eq(orderChanges.status, "pending"),
          eq(orderChanges.version, edit.version),
          eq(orderChanges.changeType, "edit"),
          eq(orders.id, input.orderId),
          eq(orders.version, order.version),
          eq(orders.isDraftOrder, true),
          eq(orders.status, "draft"),
          isNull(orders.canceledAt),
          isNull(orders.deletedAt),
          isNull(orderChanges.deletedAt),
        ),
      )
      .limit(1);
    try {
      await db.batch([
        batchGuard(db, sql`EXISTS ${guard}`),
        db
          .update(orderChanges)
          .set({ updatedAt: now })
          .where(
            and(
              eq(orderChanges.id, edit.id),
              eq(orderChanges.updatedAt, edit.updatedAt),
              eq(orderChanges.status, "pending"),
              isNull(orderChanges.deletedAt),
            ),
          ),
        db
          .update(orderChangeActions)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              eq(orderChangeActions.id, action.id),
              eq(orderChangeActions.updatedAt, action.updatedAt),
              eq(orderChangeActions.applied, false),
              isNull(orderChangeActions.deletedAt),
            ),
          ),
      ]);
      return { success: true as const, editId: edit.id, updatedAt: now };
    } catch {
      return { success: false as const, reason: "VERSION_CONFLICT" as const };
    }
  },

  async removeAction(input: { orderId: string; actionId: string }) {
    const current = await getEditAndOrder(input.orderId);
    if ("reason" in current)
      return {
        success: false as const,
        reason: current.reason ?? "EDIT_NOT_FOUND",
      };
    const { edit } = current;
    if (edit.status !== "pending")
      return { success: false as const, reason: "EDIT_NOT_PENDING" as const };
    const db = await getDb();
    const action = firstOrNull(
      await db
        .select({
          id: orderChangeActions.id,
          updatedAt: orderChangeActions.updatedAt,
        })
        .from(orderChangeActions)
        .where(
          and(
            eq(orderChangeActions.id, input.actionId),
            eq(orderChangeActions.orderChangeId, edit.id),
            inArray(orderChangeActions.action, ["ITEM_ADD", "ITEM_UPDATE"]),
            eq(orderChangeActions.applied, false),
            isNull(orderChangeActions.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!action)
      return { success: false as const, reason: "ACTION_NOT_FOUND" as const };
    const now = monotonicTimestamp(edit.updatedAt);
    const guard = db
      .select({ id: orderChanges.id })
      .from(orderChanges)
      .where(
        and(
          eq(orderChanges.id, edit.id),
          eq(orderChanges.updatedAt, edit.updatedAt),
          eq(orderChanges.status, "pending"),
          isNull(orderChanges.deletedAt),
        ),
      )
      .limit(1);
    try {
      await db.batch([
        batchGuard(db, sql`EXISTS ${guard}`),
        db
          .update(orderChanges)
          .set({ updatedAt: now })
          .where(
            and(
              eq(orderChanges.id, edit.id),
              eq(orderChanges.updatedAt, edit.updatedAt),
              eq(orderChanges.status, "pending"),
              isNull(orderChanges.deletedAt),
            ),
          ),
        db
          .update(orderChangeActions)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              eq(orderChangeActions.id, action.id),
              eq(orderChangeActions.updatedAt, action.updatedAt),
              eq(orderChangeActions.applied, false),
              isNull(orderChangeActions.deletedAt),
            ),
          ),
      ]);
      return { success: true as const, editId: edit.id, updatedAt: now };
    } catch {
      return { success: false as const, reason: "VERSION_CONFLICT" as const };
    }
  },

  async request(orderId: string, actorId?: string) {
    const current = await getEditAndOrder(orderId);
    if ("reason" in current)
      return {
        success: false as const,
        reason: current.reason ?? "EDIT_NOT_FOUND",
      };
    const { edit } = current;
    if (edit.status !== "pending")
      return { success: false as const, reason: "EDIT_NOT_PENDING" as const };
    if (!(await readActions(edit.id)).length)
      return { success: false as const, reason: "EMPTY_EDIT" as const };
    const db = await getDb();
    const now = monotonicTimestamp(edit.updatedAt);
    const changed = await db
      .update(orderChanges)
      .set({
        status: "requested",
        requestedBy: actorId ?? null,
        requestedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(orderChanges.id, edit.id),
          eq(orderChanges.updatedAt, edit.updatedAt),
          eq(orderChanges.status, "pending"),
          isNull(orderChanges.deletedAt),
        ),
      );
    return Number(changed.meta.changes ?? 0) > 0
      ? { success: true as const, editId: edit.id, updatedAt: now }
      : { success: false as const, reason: "VERSION_CONFLICT" as const };
  },

  async cancel(orderId: string, actorId?: string) {
    const edit = await readActiveEdit(orderId);
    if (!edit)
      return { success: false as const, reason: "EDIT_NOT_FOUND" as const };
    const db = await getDb();
    const now = monotonicTimestamp(edit.updatedAt);
    const changed = await db
      .update(orderChanges)
      .set({
        status: "canceled",
        canceledBy: actorId ?? null,
        canceledAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(orderChanges.id, edit.id),
          eq(orderChanges.updatedAt, edit.updatedAt),
          inArray(orderChanges.status, [...activeEditStatuses]),
          isNull(orderChanges.deletedAt),
        ),
      );
    return Number(changed.meta.changes ?? 0) > 0
      ? { success: true as const, editId: edit.id }
      : { success: false as const, reason: "VERSION_CONFLICT" as const };
  },
};
