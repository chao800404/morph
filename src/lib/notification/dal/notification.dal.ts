import { notifications } from "@/db/notification.schema";
import { getDb } from "@/db";
import type { JsonValue, Metadata } from "@/db/json";
import { firstOrNull } from "@/lib/db/single-row";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NotificationStatus } from "../types";
import type { OrderNotificationDTO } from "../dto/notification.dto";

export interface CreateNotificationAttemptInput {
  id: string;
  to: string;
  from: string | null;
  channel: string;
  template: string | null;
  triggerType: string | null;
  resourceType: string | null;
  resourceId: string | null;
  receiverId: string | null;
  originalNotificationId?: string | null;
  idempotencyKey: string | null;
  data?: Metadata | null;
  providerData: JsonValue | null;
  now: string;
}

export interface ListOrderNotificationsInput {
  orderId: string;
  page: number;
  limit: number;
}

export const notificationDal = {
  async listForOrder(input: ListOrderNotificationsInput): Promise<{
    notifications: OrderNotificationDTO[];
    total: number;
  }> {
    const db = await getDb();
    const where = and(
      eq(notifications.resourceType, "order"),
      eq(notifications.resourceId, input.orderId),
      isNull(notifications.deletedAt),
    );
    const totalRow = firstOrNull(
      await db.select({ total: count() }).from(notifications).where(where),
    );
    const rows = await db
      .select({
        id: notifications.id,
        recipient: notifications.to,
        channel: notifications.channel,
        template: notifications.template,
        status: notifications.status,
        triggerType: notifications.triggerType,
        externalId: notifications.externalId,
        createdAt: notifications.createdAt,
        updatedAt: notifications.updatedAt,
        hasData: sql<number>`CASE WHEN ${notifications.data} IS NULL THEN 0 ELSE 1 END`,
      })
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(input.limit)
      .offset((input.page - 1) * input.limit);

    const retriedIds =
      rows.length > 0
        ? new Set(
            (
              await db
                .select({
                  idempotencyKey: notifications.idempotencyKey,
                })
                .from(notifications)
                .where(
                  inArray(
                    notifications.idempotencyKey,
                    rows.map((row) => `order-placed-retry:${row.id}`),
                  ),
                )
            ).flatMap((row) =>
              row.idempotencyKey
                ? [row.idempotencyKey.slice("order-placed-retry:".length)]
                : [],
            ),
          )
        : new Set<string>();

    return {
      notifications: rows.map(({ hasData, ...row }) => ({
        ...row,
        canRetry:
          row.status === "failure" &&
          row.template === "order-placed" &&
          row.triggerType === "order.placed" &&
          hasData === 1 &&
          !retriedIds.has(row.id),
      })),
      total: totalRow?.total ?? 0,
    };
  },

  async findRetryableOrderPlaced(input: {
    orderId: string;
    notificationId: string;
  }) {
    const db = await getDb();
    const notification = firstOrNull(
      await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.id, input.notificationId),
            eq(notifications.channel, "email"),
            eq(notifications.template, "order-placed"),
            eq(notifications.triggerType, "order.placed"),
            eq(notifications.resourceType, "order"),
            eq(notifications.resourceId, input.orderId),
            eq(notifications.status, "failure"),
            isNull(notifications.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!notification?.data) return null;

    const retry = firstOrNull(
      await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          eq(
            notifications.idempotencyKey,
            `order-placed-retry:${notification.id}`,
          ),
        )
        .limit(1),
    );
    return retry ? null : notification;
  },

  async createAttempt(input: CreateNotificationAttemptInput): Promise<{
    created: boolean;
    notification: typeof notifications.$inferSelect;
  }> {
    const db = await getDb();
    const inserted = await db
      .insert(notifications)
      .values({
        id: input.id,
        providerId: null,
        to: input.to,
        from: input.from,
        channel: input.channel,
        template: input.template,
        data: input.data ?? null,
        providerData: input.providerData,
        status: "pending",
        triggerType: input.triggerType,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        receiverId: input.receiverId,
        originalNotificationId: input.originalNotificationId ?? null,
        idempotencyKey: input.idempotencyKey,
        externalId: null,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    const created = firstOrNull(inserted);
    if (created) return { created: true, notification: created };

    if (input.idempotencyKey) {
      const existing = firstOrNull(
        await db
          .select()
          .from(notifications)
          .where(eq(notifications.idempotencyKey, input.idempotencyKey))
          .limit(1),
      );
      if (existing) return { created: false, notification: existing };
    }

    throw new Error("Could not create notification attempt");
  },

  async finishAttempt(
    id: string,
    input: {
      status: Exclude<NotificationStatus, "pending">;
      externalId: string | null;
    },
  ): Promise<void> {
    const db = await getDb();
    await db
      .update(notifications)
      .set({
        status: input.status,
        externalId: input.externalId,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(eq(notifications.id, id), eq(notifications.status, "pending")),
      );
  },
};
