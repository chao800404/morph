import { getDb } from "@/db";
import { fulfillmentItems, fulfillments } from "@/db/fulfillment.schema";
import { inventoryLevels, reservationItems } from "@/db/inventory.schema";
import {
  orderFulfillments,
  orderPaymentCollections,
  productVariantInventoryItems,
} from "@/db/link.schema";
import {
  orderCreditLines,
  orderItems,
  orderLineItems,
  orders,
} from "@/db/order.schema";
import { storeCreditAccounts, storeCreditTransactions } from "@/db/schema";
import { paymentCollections } from "@/db/payment.schema";
import { orderPaymentDal } from "@/lib/payment/dal/order-payment.dal";
import { getConfig } from "@/server/get-config";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { fulfillmentProviderRegistry } from "@/lib/fulfillment/providers/fulfillment-provider-registry.server";
import { batchGuard } from "@/lib/db/batch-guard";

type CancelOrderResult =
  | { success: true }
  | {
      success: false;
      reason:
        | "NOT_FOUND"
        | "ALREADY_SHIPPED"
        | "PAYMENT_CAPTURED"
        | "STORE_CREDIT_UNAVAILABLE";
    };

type CancellationCreditRefund = { accountId: string; amount: number };

const findCancellationCreditRefunds = async (
  db: Awaited<ReturnType<typeof getDb>>,
  order: typeof orders.$inferSelect,
): Promise<CancellationCreditRefund[] | null> => {
  const creditLines = await db
    .select({
      accountId: orderCreditLines.referenceId,
      amount: orderCreditLines.amount,
    })
    .from(orderCreditLines)
    .where(
      and(
        eq(orderCreditLines.orderId, order.id),
        eq(orderCreditLines.version, order.version),
        inArray(orderCreditLines.reference, [
          "store_credit_account",
          "gift_card_account",
        ]),
        isNull(orderCreditLines.deletedAt),
      ),
    );
  if (creditLines.length === 0) return [];
  const debitRows = await db
    .select({
      accountId: storeCreditTransactions.accountId,
      amount: storeCreditTransactions.amount,
    })
    .from(storeCreditTransactions)
    .where(
      and(
        eq(storeCreditTransactions.type, "debit"),
        eq(storeCreditTransactions.idempotencyKey, `order:${order.id}`),
        eq(storeCreditTransactions.reference, "order"),
        eq(storeCreditTransactions.referenceId, order.id),
      ),
    );
  const amountByAccount = (
    rows: Array<{ accountId: string | null; amount: number }>,
  ) => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      if (
        !row.accountId ||
        !Number.isSafeInteger(row.amount) ||
        row.amount <= 0
      )
        return null;
      const total = (totals.get(row.accountId) ?? 0) + row.amount;
      if (!Number.isSafeInteger(total)) return null;
      totals.set(row.accountId, total);
    }
    return totals;
  };
  const lineTotals = amountByAccount(creditLines);
  const debitTotals = amountByAccount(debitRows);
  if (!lineTotals || !debitTotals || lineTotals.size !== debitTotals.size)
    return null;
  for (const [accountId, amount] of lineTotals) {
    if (debitTotals.get(accountId) !== amount) return null;
  }

  const accountIds = [...lineTotals.keys()];
  if (accountIds.length === 0) return [];
  const idempotencyKey = `order-cancel:${order.id}`;
  const [accounts, priorRefunds] = await Promise.all([
    db
      .select({
        id: storeCreditAccounts.id,
        balance: storeCreditAccounts.balance,
        deletedAt: storeCreditAccounts.deletedAt,
      })
      .from(storeCreditAccounts)
      .where(inArray(storeCreditAccounts.id, accountIds)),
    db
      .select({
        accountId: storeCreditTransactions.accountId,
        type: storeCreditTransactions.type,
        amount: storeCreditTransactions.amount,
        reference: storeCreditTransactions.reference,
        referenceId: storeCreditTransactions.referenceId,
      })
      .from(storeCreditTransactions)
      .where(
        and(
          inArray(storeCreditTransactions.accountId, accountIds),
          eq(storeCreditTransactions.idempotencyKey, idempotencyKey),
        ),
      ),
  ]);
  const accountsById = new Map(
    accounts.map((account) => [account.id, account]),
  );
  const refundsByAccount = new Map(
    priorRefunds.map((refund) => [refund.accountId, refund]),
  );
  const refunds: CancellationCreditRefund[] = [];
  for (const [accountId, amount] of lineTotals) {
    const account = accountsById.get(accountId);
    if (
      !account ||
      account.deletedAt ||
      !Number.isSafeInteger(account.balance) ||
      account.balance < 0
    )
      return null;
    const priorRefund = refundsByAccount.get(accountId);
    if (priorRefund) {
      if (
        priorRefund.type !== "credit" ||
        priorRefund.amount !== amount ||
        priorRefund.reference !== "order_canceled" ||
        priorRefund.referenceId !== order.id
      )
        return null;
      continue;
    }
    if (!Number.isSafeInteger(account.balance + amount)) return null;
    refunds.push({ accountId, amount });
  }
  return refunds;
};

export const orderWorkflowDal = {
  async cancel(orderId: string, actorId?: string): Promise<CancelOrderResult> {
    getConfig();
    const db = await getDb();
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), isNull(orders.deletedAt)))
      .limit(1);
    if (!order) return { success: false, reason: "NOT_FOUND" };
    if (order.canceledAt) return { success: true };
    const creditRefunds = await findCancellationCreditRefunds(db, order);
    if (!creditRefunds)
      return { success: false, reason: "STORE_CREDIT_UNAVAILABLE" };
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
    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        sql`EXISTS (
          SELECT 1 FROM orders
          WHERE id = ${orderId}
            AND version = ${order.version}
            AND canceled_at IS NULL
        )`,
      ),
    ];
    for (const refund of creditRefunds) {
      statements.push(
        batchGuard(
          db,
          sql`EXISTS (
            SELECT 1 FROM store_credit_accounts
            WHERE id = ${refund.accountId}
              AND deleted_at IS NULL
              AND balance <= ${Number.MAX_SAFE_INTEGER - refund.amount}
          )`,
        ),
        db
          .update(storeCreditAccounts)
          .set({
            balance: sql`${storeCreditAccounts.balance} + ${refund.amount}`,
            updatedBy: actorId ?? null,
            updatedAt: now,
          })
          .where(
            and(
              eq(storeCreditAccounts.id, refund.accountId),
              isNull(storeCreditAccounts.deletedAt),
            ),
          ),
        db.insert(storeCreditTransactions).values({
          id: crypto.randomUUID(),
          accountId: refund.accountId,
          type: "credit",
          amount: refund.amount,
          idempotencyKey: `order-cancel:${orderId}`,
          reference: "order_canceled",
          referenceId: orderId,
          note: "Store credit returned after order cancellation",
          metadata: {},
          createdBy: actorId ?? null,
          createdAt: now,
        }),
      );
    }
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
