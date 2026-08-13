import { getDb } from "@/db";
import { orderPaymentCollections } from "@/db/link.schema";
import { orderTransactions } from "@/db/order.schema";
import {
  captures,
  paymentCollections,
  payments,
  refunds,
} from "@/db/payment.schema";
import { and, eq, isNull } from "drizzle-orm";

import { paymentProviderRegistry } from "../providers/payment-provider-registry.server";

type PaymentOperationResult =
  | { success: true; amount: number }
  | {
      success: false;
      reason: "NOT_FOUND" | "INVALID_AMOUNT" | "NOT_AUTHORIZED" | "CAPTURED";
    };

const paymentForOrder = async (orderId: string) => {
  const db = await getDb();
  const [row] = await db
    .select({ collection: paymentCollections, payment: payments })
    .from(orderPaymentCollections)
    .innerJoin(
      paymentCollections,
      and(
        eq(paymentCollections.id, orderPaymentCollections.paymentCollectionId),
        isNull(paymentCollections.deletedAt),
      ),
    )
    .leftJoin(
      payments,
      and(
        eq(payments.paymentCollectionId, paymentCollections.id),
        isNull(payments.deletedAt),
        isNull(payments.canceledAt),
      ),
    )
    .where(eq(orderPaymentCollections.orderId, orderId))
    .limit(1);
  return row ?? null;
};

export const orderPaymentDal = {
  async capture(
    orderId: string,
    requestedAmount?: number,
  ): Promise<PaymentOperationResult> {
    const row = await paymentForOrder(orderId);
    if (!row?.payment) return { success: false, reason: "NOT_FOUND" };
    const alreadyCaptured = row.collection.capturedAmount ?? 0;
    const authorized = row.collection.authorizedAmount ?? 0;
    const available = authorized - alreadyCaptured;
    const amount = requestedAmount ?? available;
    if (!Number.isInteger(amount) || amount <= 0 || amount > available)
      return { success: false, reason: "INVALID_AMOUNT" };
    const provider = paymentProviderRegistry.get(row.payment.providerId);
    const result = await provider.capture({
      amount,
      currencyCode: row.payment.currencyCode,
      context: { orderId, paymentId: row.payment.id },
      data: row.payment.data ?? {},
    });
    if (result.status !== "captured")
      return { success: false, reason: "NOT_AUTHORIZED" };
    const db = await getDb();
    const now = new Date().toISOString();
    const captureId = crypto.randomUUID();
    await db.batch([
      db.insert(captures).values({
        id: captureId,
        paymentId: row.payment.id,
        amount,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      }),
      db
        .update(payments)
        .set({
          capturedAt: alreadyCaptured + amount >= authorized ? now : null,
          data: result.data,
          updatedAt: now,
        })
        .where(eq(payments.id, row.payment.id)),
      db
        .update(paymentCollections)
        .set({
          capturedAmount: alreadyCaptured + amount,
          status:
            alreadyCaptured + amount >= authorized
              ? "captured"
              : "partially_captured",
          updatedAt: now,
        })
        .where(eq(paymentCollections.id, row.collection.id)),
      db.insert(orderTransactions).values({
        id: crypto.randomUUID(),
        orderId,
        version: 1,
        amount,
        currencyCode: row.payment.currencyCode,
        reference: "capture",
        referenceId: captureId,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    return { success: true, amount };
  },

  async refund(
    orderId: string,
    amount: number,
    options?: { reasonId?: string; note?: string; createdBy?: string },
  ): Promise<PaymentOperationResult> {
    const row = await paymentForOrder(orderId);
    if (!row?.payment) return { success: false, reason: "NOT_FOUND" };
    const captured = row.collection.capturedAmount ?? 0;
    const alreadyRefunded = row.collection.refundedAmount ?? 0;
    if (
      !Number.isInteger(amount) ||
      amount <= 0 ||
      amount > captured - alreadyRefunded
    )
      return { success: false, reason: "INVALID_AMOUNT" };
    const result = await paymentProviderRegistry
      .get(row.payment.providerId)
      .refund({
        amount,
        currencyCode: row.payment.currencyCode,
        context: { orderId, paymentId: row.payment.id },
        data: row.payment.data ?? {},
      });
    if (result.status === "error")
      return { success: false, reason: "NOT_AUTHORIZED" };
    const db = await getDb();
    const now = new Date().toISOString();
    const refundId = crypto.randomUUID();
    await db.batch([
      db.insert(refunds).values({
        id: refundId,
        paymentId: row.payment.id,
        refundReasonId: options?.reasonId ?? null,
        amount,
        note: options?.note ?? null,
        createdBy: options?.createdBy ?? null,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      }),
      db
        .update(paymentCollections)
        .set({ refundedAmount: alreadyRefunded + amount, updatedAt: now })
        .where(eq(paymentCollections.id, row.collection.id)),
      db.insert(orderTransactions).values({
        id: crypto.randomUUID(),
        orderId,
        version: 1,
        amount: -amount,
        currencyCode: row.payment.currencyCode,
        reference: "refund",
        referenceId: refundId,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    return { success: true, amount };
  },

  async cancelAuthorization(orderId: string): Promise<PaymentOperationResult> {
    const row = await paymentForOrder(orderId);
    if (!row?.payment) return { success: false, reason: "NOT_FOUND" };
    if ((row.collection.capturedAmount ?? 0) > 0)
      return { success: false, reason: "CAPTURED" };
    const result = await paymentProviderRegistry
      .get(row.payment.providerId)
      .cancel({
        amount: row.payment.amount,
        currencyCode: row.payment.currencyCode,
        context: { orderId, paymentId: row.payment.id },
        data: row.payment.data ?? {},
      });
    if (result.status !== "canceled")
      return { success: false, reason: "NOT_AUTHORIZED" };
    const db = await getDb();
    const now = new Date().toISOString();
    await db.batch([
      db
        .update(payments)
        .set({ canceledAt: now, data: result.data, updatedAt: now })
        .where(eq(payments.id, row.payment.id)),
      db
        .update(paymentCollections)
        .set({ status: "canceled", updatedAt: now })
        .where(eq(paymentCollections.id, row.collection.id)),
    ]);
    return { success: true, amount: row.payment.amount };
  },
};
