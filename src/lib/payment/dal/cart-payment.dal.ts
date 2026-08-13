import { getDb } from "@/db";
import {
  cartPaymentCollections,
  regionPaymentProviders,
} from "@/db/link.schema";
import {
  paymentCollectionPaymentProviders,
  paymentCollections,
  paymentProviders,
  paymentSessions,
  payments,
} from "@/db/payment.schema";
import { cartDal } from "@/lib/cart/dal/cart.dal";
import { and, eq, inArray, isNull } from "drizzle-orm";

import type { PaymentCollectionDTO } from "../dto/payment.dto";
import { paymentProviderRegistry } from "../providers/payment-provider-registry.server";

type PaymentResult<T = undefined> =
  | { success: true; value: T }
  | {
      success: false;
      reason:
        | "NOT_FOUND"
        | "COMPLETED"
        | "NO_PROVIDER"
        | "PROVIDER_NOT_ALLOWED"
        | "PAYMENT_LOCKED"
        | "INVALID_SESSION";
    };

const collectionDto = async (
  id: string,
): Promise<PaymentCollectionDTO | null> => {
  const db = await getDb();
  const [collection] = await db
    .select()
    .from(paymentCollections)
    .where(
      and(eq(paymentCollections.id, id), isNull(paymentCollections.deletedAt)),
    )
    .limit(1);
  if (!collection) return null;
  const [providerLinks, sessions] = await Promise.all([
    db
      .select({ id: paymentCollectionPaymentProviders.paymentProviderId })
      .from(paymentCollectionPaymentProviders)
      .where(eq(paymentCollectionPaymentProviders.paymentCollectionId, id)),
    db
      .select()
      .from(paymentSessions)
      .where(
        and(
          eq(paymentSessions.paymentCollectionId, id),
          isNull(paymentSessions.deletedAt),
        ),
      ),
  ]);
  return {
    id: collection.id,
    amount: collection.amount,
    currencyCode: collection.currencyCode,
    status: collection.status,
    authorizedAmount: collection.authorizedAmount,
    capturedAmount: collection.capturedAmount,
    refundedAmount: collection.refundedAmount,
    providerIds: providerLinks.map((link) => link.id),
    sessions: sessions.map((session) => ({
      id: session.id,
      providerId: session.providerId,
      amount: session.amount,
      currencyCode: session.currencyCode,
      status: session.status,
      data: session.data ?? {},
    })),
  };
};

export const cartPaymentDal = {
  async listProviders(regionId: string): Promise<string[]> {
    const db = await getDb();
    const rows = await db
      .select({ id: paymentProviders.id })
      .from(regionPaymentProviders)
      .innerJoin(
        paymentProviders,
        and(
          eq(paymentProviders.id, regionPaymentProviders.paymentProviderId),
          eq(paymentProviders.isEnabled, true),
          isNull(paymentProviders.deletedAt),
        ),
      )
      .where(eq(regionPaymentProviders.regionId, regionId));
    return rows.map((row) => row.id);
  },

  async ensureCollection(
    cartId: string,
    salesChannelId: string,
  ): Promise<PaymentResult<PaymentCollectionDTO>> {
    const cart = await cartDal.findById(cartId, salesChannelId);
    if (!cart) return { success: false, reason: "NOT_FOUND" };
    if (cart.completedAt) return { success: false, reason: "COMPLETED" };
    const providerIds = await this.listProviders(cart.regionId);
    if (!providerIds.length) return { success: false, reason: "NO_PROVIDER" };
    const db = await getDb();
    const [link] = await db
      .select({ id: cartPaymentCollections.paymentCollectionId })
      .from(cartPaymentCollections)
      .innerJoin(
        paymentCollections,
        and(
          eq(paymentCollections.id, cartPaymentCollections.paymentCollectionId),
          isNull(paymentCollections.deletedAt),
        ),
      )
      .where(eq(cartPaymentCollections.cartId, cartId))
      .limit(1);
    const now = new Date().toISOString();
    const collectionId = link?.id ?? crypto.randomUUID();
    if (link) {
      const current = await collectionDto(collectionId);
      if (!current) return { success: false, reason: "NOT_FOUND" };
      if (
        current.authorizedAmount !== null &&
        current.authorizedAmount > 0 &&
        current.amount !== cart.total
      )
        return { success: false, reason: "PAYMENT_LOCKED" };
      await db
        .update(paymentCollections)
        .set({ amount: cart.total, updatedAt: now })
        .where(eq(paymentCollections.id, collectionId));
      await db
        .update(paymentSessions)
        .set({ amount: cart.total, updatedAt: now })
        .where(
          and(
            eq(paymentSessions.paymentCollectionId, collectionId),
            inArray(paymentSessions.status, [
              "pending",
              "pending_authorization",
              "requires_more",
            ]),
            isNull(paymentSessions.deletedAt),
          ),
        );
    } else {
      await db.insert(paymentCollections).values({
        id: collectionId,
        currencyCode: cart.currencyCode,
        amount: cart.total,
        status: "not_paid",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(cartPaymentCollections).values({
        cartId,
        paymentCollectionId: collectionId,
        createdAt: now,
        updatedAt: now,
      });
    }
    await db
      .delete(paymentCollectionPaymentProviders)
      .where(
        eq(paymentCollectionPaymentProviders.paymentCollectionId, collectionId),
      );
    await db.insert(paymentCollectionPaymentProviders).values(
      providerIds.map((paymentProviderId) => ({
        paymentCollectionId: collectionId,
        paymentProviderId,
      })),
    );
    return { success: true, value: (await collectionDto(collectionId))! };
  },

  async createSession(
    cartId: string,
    salesChannelId: string,
    providerId: string,
  ): Promise<PaymentResult<PaymentCollectionDTO>> {
    const ensured = await this.ensureCollection(cartId, salesChannelId);
    if (!ensured.success) return ensured;
    if (!ensured.value.providerIds.includes(providerId))
      return { success: false, reason: "PROVIDER_NOT_ALLOWED" };
    const provider = paymentProviderRegistry.get(providerId);
    const result = await provider.initiate({
      amount: ensured.value.amount,
      currencyCode: ensured.value.currencyCode,
      context: { cartId },
      data: {},
    });
    const db = await getDb();
    const now = new Date().toISOString();
    const sessionStatus =
      result.status === "refunded" ? ("error" as const) : result.status;
    await db
      .update(paymentSessions)
      .set({ status: "canceled", updatedAt: now })
      .where(
        and(
          eq(paymentSessions.paymentCollectionId, ensured.value.id),
          eq(paymentSessions.providerId, providerId),
          inArray(paymentSessions.status, [
            "pending",
            "pending_authorization",
            "requires_more",
          ]),
          isNull(paymentSessions.deletedAt),
        ),
      );
    await db.insert(paymentSessions).values({
      id: crypto.randomUUID(),
      paymentCollectionId: ensured.value.id,
      currencyCode: ensured.value.currencyCode,
      amount: ensured.value.amount,
      providerId,
      status: sessionStatus,
      data: result.data,
      context: { cartId },
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    await db
      .update(paymentCollections)
      .set({ status: "awaiting", updatedAt: now })
      .where(eq(paymentCollections.id, ensured.value.id));
    return { success: true, value: (await collectionDto(ensured.value.id))! };
  },

  async authorizeSession(
    cartId: string,
    salesChannelId: string,
    sessionId: string,
  ): Promise<PaymentResult<PaymentCollectionDTO>> {
    const ensured = await this.ensureCollection(cartId, salesChannelId);
    if (!ensured.success) return ensured;
    const db = await getDb();
    const [session] = await db
      .select()
      .from(paymentSessions)
      .where(
        and(
          eq(paymentSessions.id, sessionId),
          eq(paymentSessions.paymentCollectionId, ensured.value.id),
          isNull(paymentSessions.deletedAt),
        ),
      )
      .limit(1);
    if (!session || session.status === "canceled" || session.status === "error")
      return { success: false, reason: "INVALID_SESSION" };
    const [existingPayment] = await db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.paymentSessionId, session.id),
          isNull(payments.deletedAt),
        ),
      )
      .limit(1);
    if (existingPayment)
      return { success: true, value: (await collectionDto(ensured.value.id))! };
    const result = await paymentProviderRegistry
      .get(session.providerId)
      .authorize({
        amount: session.amount,
        currencyCode: session.currencyCode,
        context: session.context ?? {},
        data: session.data ?? {},
      });
    if (result.status !== "authorized" && result.status !== "captured")
      return { success: false, reason: "INVALID_SESSION" };
    const now = new Date().toISOString();
    await db.insert(payments).values({
      id: crypto.randomUUID(),
      paymentCollectionId: ensured.value.id,
      paymentSessionId: session.id,
      currencyCode: session.currencyCode,
      amount: session.amount,
      providerId: session.providerId,
      capturedAt: result.status === "captured" ? now : null,
      data: result.data,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    await db
      .update(paymentSessions)
      .set({
        status: result.status,
        authorizedAt: now,
        data: result.data,
        updatedAt: now,
      })
      .where(eq(paymentSessions.id, session.id));
    await db
      .update(paymentCollections)
      .set({
        status: result.status === "captured" ? "captured" : "authorized",
        authorizedAmount: session.amount,
        ...(result.status === "captured"
          ? { capturedAmount: session.amount }
          : {}),
        updatedAt: now,
      })
      .where(eq(paymentCollections.id, ensured.value.id));
    return { success: true, value: (await collectionDto(ensured.value.id))! };
  },
};
