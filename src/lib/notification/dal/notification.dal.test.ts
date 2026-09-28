import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { notificationDal } from "./notification.dal";

let sqlite: Database.Database;

vi.mock("@/db", () => ({ getDb: vi.fn() }));

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY NOT NULL,
      provider_id TEXT,
      "to" TEXT NOT NULL,
      "from" TEXT,
      channel TEXT NOT NULL,
      template TEXT,
      data TEXT,
      provider_data TEXT,
      status TEXT NOT NULL,
      trigger_type TEXT,
      resource_type TEXT,
      resource_id TEXT,
      receiver_id TEXT,
      original_notification_id TEXT,
      idempotency_key TEXT,
      external_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX notifications_resource_idx
      ON notifications(resource_type, resource_id);
  `);
  vi.mocked(getDb).mockResolvedValue(drizzle(sqlite) as never);
});

afterEach(() => sqlite.close());

const insert = (input: {
  id: string;
  orderId: string;
  createdAt: string;
  deletedAt?: string | null;
  status?: "pending" | "success" | "failure";
  template?: string;
  triggerType?: string;
  data?: string | null;
  originalNotificationId?: string | null;
  idempotencyKey?: string;
}) => {
  sqlite
    .prepare(
      `INSERT INTO notifications (
        id, "to", channel, template, data, provider_data, status, trigger_type,
        resource_type, resource_id, original_notification_id, idempotency_key, external_id,
        created_at, updated_at, deleted_at
      ) VALUES (
        @id, 'buyer@example.com', 'email', @template,
        @data, '{"adapterId":"resend"}',
        @status, @triggerType, 'order', @orderId,
        @originalNotificationId,
        @idempotencyKey, 'provider-message-id', @createdAt, @createdAt,
        @deletedAt
      )`,
    )
    .run({
      ...input,
      template: input.template ?? "order-claim-created",
      triggerType: input.triggerType ?? "order.claim.created",
      data:
        input.data === undefined
          ? '{"private":"template payload"}'
          : input.data,
      status: input.status ?? "success",
      originalNotificationId: input.originalNotificationId ?? null,
      idempotencyKey: input.idempotencyKey ?? "private-idempotency-key",
      deletedAt: input.deletedAt ?? null,
    });
};

describe("notification DAL order history", () => {
  it("returns only active notifications for the requested order with bounded pagination", async () => {
    insert({
      id: "notification-new",
      orderId: "order-1",
      createdAt: "2026-09-27T10:00:00.000Z",
    });
    insert({
      id: "notification-old",
      orderId: "order-1",
      createdAt: "2026-09-27T09:00:00.000Z",
    });
    insert({
      id: "notification-other",
      orderId: "order-2",
      createdAt: "2026-09-27T11:00:00.000Z",
    });
    insert({
      id: "notification-deleted",
      orderId: "order-1",
      createdAt: "2026-09-27T12:00:00.000Z",
      deletedAt: "2026-09-27T12:01:00.000Z",
    });

    const firstPage = await notificationDal.listForOrder({
      orderId: "order-1",
      page: 1,
      limit: 1,
    });
    const secondPage = await notificationDal.listForOrder({
      orderId: "order-1",
      page: 2,
      limit: 1,
    });

    expect(firstPage).toEqual({
      total: 2,
      notifications: [
        {
          id: "notification-new",
          recipient: "buyer@example.com",
          channel: "email",
          template: "order-claim-created",
          status: "success",
          triggerType: "order.claim.created",
          externalId: "provider-message-id",
          canRetry: false,
          createdAt: "2026-09-27T10:00:00.000Z",
          updatedAt: "2026-09-27T10:00:00.000Z",
        },
      ],
    });
    expect(secondPage.notifications.map(({ id }) => id)).toEqual([
      "notification-old",
    ]);
    expect(JSON.stringify(firstPage)).not.toContain("private");
    expect(JSON.stringify(firstPage)).not.toContain("idempotency");
  });

  it("uses the id as a deterministic ordering tie-breaker", async () => {
    const createdAt = "2026-09-27T10:00:00.000Z";
    insert({ id: "notification-z", orderId: "order-1", createdAt });
    insert({ id: "notification-a", orderId: "order-1", createdAt });

    const result = await notificationDal.listForOrder({
      orderId: "order-1",
      page: 1,
      limit: 10,
    });

    expect(result.notifications.map(({ id }) => id)).toEqual([
      "notification-z",
      "notification-a",
    ]);
  });

  it("only offers retries for a failed placed-order message without a retry child", async () => {
    const data = JSON.stringify({
      appName: "Morph",
      orderDisplayId: 42,
      items: [],
      total: "$12.00",
    });
    insert({
      id: "failed-order-email",
      orderId: "order-1",
      createdAt: "2026-09-27T12:00:00.000Z",
      status: "failure",
      template: "order-placed",
      triggerType: "order.placed",
      data,
    });
    insert({
      id: "already-retried-order-email",
      orderId: "order-1",
      createdAt: "2026-09-27T12:01:00.000Z",
      status: "success",
      template: "order-placed",
      triggerType: "order.placed",
      data,
      originalNotificationId: "failed-order-email",
      idempotencyKey: "order-placed-retry:failed-order-email",
    });
    insert({
      id: "failed-without-snapshot",
      orderId: "order-1",
      createdAt: "2026-09-27T12:02:00.000Z",
      status: "failure",
      template: "order-placed",
      triggerType: "order.placed",
      data: null,
    });

    const result = await notificationDal.listForOrder({
      orderId: "order-1",
      page: 1,
      limit: 10,
    });

    expect(
      result.notifications.find(({ id }) => id === "failed-order-email")
        ?.canRetry,
    ).toBe(false);
    expect(
      result.notifications.find(({ id }) => id === "failed-without-snapshot")
        ?.canRetry,
    ).toBe(false);
    expect(
      await notificationDal.findRetryableOrderPlaced({
        orderId: "order-1",
        notificationId: "failed-order-email",
      }),
    ).toBeNull();
  });

  it("returns a failed order email's saved content while it has no retry child", async () => {
    const data = JSON.stringify({
      appName: "Morph",
      orderDisplayId: 42,
      items: [],
      total: "$12.00",
    });
    insert({
      id: "failed-order-email",
      orderId: "order-1",
      createdAt: "2026-09-27T12:00:00.000Z",
      status: "failure",
      template: "order-placed",
      triggerType: "order.placed",
      data,
    });

    await expect(
      notificationDal.findRetryableOrderPlaced({
        orderId: "order-1",
        notificationId: "failed-order-email",
      }),
    ).resolves.toMatchObject({
      id: "failed-order-email",
      to: "buyer@example.com",
      data: JSON.parse(data),
      status: "failure",
    });
    const history = await notificationDal.listForOrder({
      orderId: "order-1",
      page: 1,
      limit: 10,
    });
    expect(history.notifications[0]?.canRetry).toBe(true);
  });
});
