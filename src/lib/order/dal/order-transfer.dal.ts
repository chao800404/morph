import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { customers } from "@/db/customer.schema";
import { orderTransfers, orders } from "@/db/order.schema";
import { firstOrNull } from "@/lib/db/single-row";
import { createInviteToken, hashInviteToken } from "@/lib/invite/token";
import { and, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";

type TransferFailure = "NOT_FOUND" | "PENDING";

const expirePending = async (orderId: string, now: string) => {
  const db = await getDb();
  await db
    .update(orderTransfers)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(orderTransfers.orderId, orderId),
        eq(orderTransfers.status, "pending"),
        lte(orderTransfers.expiresAt, now),
        isNull(orderTransfers.deletedAt),
      ),
    );
};

export const orderTransferDal = {
  async request(input: {
    orderId: string;
    customerId: string;
    userId: string;
    email: string;
    description: string | null;
    updateOrderEmail: boolean;
    salesChannelId: string;
    now: string;
  }): Promise<
    | {
        success: true;
        transferId: string;
        orderDisplayId: number;
        orderEmail: string;
        targetEmail: string;
        description: string | null;
        token: string;
      }
    | { success: false; reason: TransferFailure }
  > {
    const db = await getDb();
    const email = input.email.trim().toLowerCase();
    const targetAccounts = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.id, input.customerId),
          eq(customers.hasAccount, true),
          eq(sql`lower(${customers.email})`, email),
          isNull(customers.deletedAt),
        ),
      )
      .limit(1);
    if (!firstOrNull(targetAccounts))
      return { success: false, reason: "NOT_FOUND" };

    const eligibleOrders = await db
      .select({
        id: orders.id,
        customerId: orders.customerId,
        displayId: orders.displayId,
        email: orders.email,
      })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(
        and(
          eq(orders.id, input.orderId),
          eq(orders.salesChannelId, input.salesChannelId),
          isNotNull(orders.email),
          eq(orders.isDraftOrder, false),
          isNull(orders.canceledAt),
          sql`${orders.status} != 'canceled'`,
          isNull(orders.deletedAt),
          or(
            isNull(orders.customerId),
            and(
              eq(customers.hasAccount, false),
              eq(sql`lower(${customers.email})`, sql`lower(${orders.email})`),
              isNull(customers.deletedAt),
            ),
          ),
        ),
      )
      .limit(1);
    const order = firstOrNull(eligibleOrders);
    const orderEmail = order?.email?.trim().toLowerCase();
    if (!order || !orderEmail) return { success: false, reason: "NOT_FOUND" };

    await expirePending(order.id, input.now);
    const token = createInviteToken();
    const tokenHash = await hashInviteToken(token);
    const transferId = crypto.randomUUID();
    const expiresAt = new Date(
      Date.parse(input.now) + 30 * 60 * 1000,
    ).toISOString();
    const created = await db
      .insert(orderTransfers)
      .values({
        id: transferId,
        orderId: order.id,
        sourceCustomerId: order.customerId,
        requesterCustomerId: input.customerId,
        targetEmail: email,
        salesChannelId: input.salesChannelId,
        email: orderEmail,
        description: input.description,
        updateOrderEmail: input.updateOrderEmail,
        tokenHash,
        status: "pending",
        expiresAt,
        createdBy: input.userId,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning({ id: orderTransfers.id });
    if (!firstOrNull(created)) return { success: false, reason: "PENDING" };
    return {
      success: true,
      transferId,
      orderDisplayId: order.displayId,
      orderEmail,
      targetEmail: email,
      description: input.description,
      token,
    };
  },

  async cancel(input: {
    orderId: string;
    customerId: string;
    salesChannelId: string;
    now: string;
  }): Promise<boolean> {
    const db = await getDb();
    const rows = await db
      .update(orderTransfers)
      .set({ status: "canceled", canceledAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(orderTransfers.orderId, input.orderId),
          eq(orderTransfers.requesterCustomerId, input.customerId),
          eq(orderTransfers.salesChannelId, input.salesChannelId),
          eq(orderTransfers.status, "pending"),
          isNull(orderTransfers.deletedAt),
        ),
      )
      .returning({ id: orderTransfers.id });
    return firstOrNull(rows) !== null;
  },

  async decline(input: {
    orderId: string;
    salesChannelId: string;
    token: string;
    now: string;
  }): Promise<boolean> {
    const db = await getDb();
    const tokenHash = await hashInviteToken(input.token);
    const rows = await db
      .update(orderTransfers)
      .set({ status: "declined", declinedAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(orderTransfers.orderId, input.orderId),
          eq(orderTransfers.salesChannelId, input.salesChannelId),
          eq(orderTransfers.tokenHash, tokenHash),
          eq(orderTransfers.status, "pending"),
          sql`${orderTransfers.expiresAt} > ${input.now}`,
          isNull(orderTransfers.deletedAt),
        ),
      )
      .returning({ id: orderTransfers.id });
    return firstOrNull(rows) !== null;
  },

  async accept(input: {
    orderId: string;
    salesChannelId: string;
    token: string;
    now: string;
  }): Promise<boolean> {
    const db = await getDb();
    const tokenHash = await hashInviteToken(input.token);
    const candidates = await db
      .select({
        sourceCustomerId: orderTransfers.sourceCustomerId,
        requesterCustomerId: orderTransfers.requesterCustomerId,
        targetEmail: orderTransfers.targetEmail,
        orderEmail: orderTransfers.email,
        updateOrderEmail: orderTransfers.updateOrderEmail,
      })
      .from(orderTransfers)
      .where(
        and(
          eq(orderTransfers.orderId, input.orderId),
          eq(orderTransfers.salesChannelId, input.salesChannelId),
          eq(orderTransfers.tokenHash, tokenHash),
          eq(orderTransfers.status, "pending"),
          sql`${orderTransfers.expiresAt} > ${input.now}`,
          isNull(orderTransfers.deletedAt),
        ),
      )
      .limit(1);
    const transfer = firstOrNull(candidates);
    if (!transfer) return false;
    const finalEmail = transfer.updateOrderEmail
      ? transfer.targetEmail
      : transfer.orderEmail;
    const updateOrderEmail = transfer.updateOrderEmail ? 1 : 0;

    const statements = [
      env.DATABASE.prepare(
        `
        UPDATE orders
        SET customer_id = ?1,
            email = CASE WHEN ?8 = 1 THEN ?9 ELSE email END,
            updated_at = ?2
        WHERE id = ?3
          AND customer_id IS ?4
          AND lower(email) = ?5
          AND sales_channel_id = ?6
          AND is_draft_order = 0
          AND canceled_at IS NULL
          AND status != 'canceled'
          AND deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM order_transfers t
            WHERE t.order_id = orders.id
              AND t.requester_customer_id = ?1
              AND t.source_customer_id IS ?4
              AND t.sales_channel_id = ?6
              AND lower(t.email) = ?5
              AND t.target_email = ?9
              AND t.update_order_email = ?8
              AND t.token_hash = ?7
              AND t.status = 'pending'
              AND t.expires_at > ?2
              AND t.deleted_at IS NULL
              AND EXISTS (
                SELECT 1 FROM customers c
                WHERE c.id = t.requester_customer_id
                  AND c.has_account = 1
                  AND c.deleted_at IS NULL
                  AND lower(c.email) = t.target_email
              )
          )
      `,
      ).bind(
        transfer.requesterCustomerId,
        input.now,
        input.orderId,
        transfer.sourceCustomerId,
        transfer.orderEmail,
        input.salesChannelId,
        tokenHash,
        updateOrderEmail,
        transfer.targetEmail,
      ),
      env.DATABASE.prepare(
        `
        UPDATE order_transfers
        SET status = CASE WHEN EXISTS (
          SELECT 1 FROM orders o
          WHERE o.id = order_transfers.order_id
            AND o.customer_id = ?1
            AND o.sales_channel_id = ?2
            AND lower(o.email) = ?3
            AND o.deleted_at IS NULL
        ) THEN 'accepted' ELSE 'invalid' END,
        accepted_at = ?4,
        updated_at = ?4
        WHERE order_id = ?5
          AND requester_customer_id = ?6
          AND sales_channel_id = ?7
          AND lower(email) = ?8
          AND target_email = ?9
          AND update_order_email = ?10
          AND token_hash = ?11
          AND status = 'pending'
          AND expires_at > ?4
          AND deleted_at IS NULL
      `,
      ).bind(
        transfer.requesterCustomerId,
        input.salesChannelId,
        finalEmail,
        input.now,
        input.orderId,
        transfer.requesterCustomerId,
        input.salesChannelId,
        transfer.orderEmail,
        transfer.targetEmail,
        updateOrderEmail,
        tokenHash,
      ),
    ];

    try {
      const [orderResult, transferResult] =
        await env.DATABASE.batch(statements);
      return (
        (orderResult?.meta.changes ?? 0) === 1 &&
        (transferResult?.meta.changes ?? 0) === 1
      );
    } catch {
      // The invalid sentinel violates the status CHECK, rolling back both
      // statements when the owner update did not happen.
      return false;
    }
  },
};
