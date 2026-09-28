import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { notifications } from "@/db/notification.schema";
import { sendEmailNotification } from "./email-notification.service";

let sqlite: Database.Database;

vi.mock("@/db", () => ({ getDb: vi.fn() }));

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE notification_providers (
      id TEXT PRIMARY KEY NOT NULL,
      handle TEXT NOT NULL,
      name TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      channels TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY NOT NULL,
      provider_id TEXT REFERENCES notification_providers(id) ON DELETE SET NULL,
      "to" TEXT NOT NULL,
      "from" TEXT,
      channel TEXT NOT NULL,
      template TEXT,
      data TEXT,
      provider_data TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      trigger_type TEXT,
      resource_type TEXT,
      resource_id TEXT,
      receiver_id TEXT,
      original_notification_id TEXT,
      idempotency_key TEXT,
      external_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      CHECK (status IN ('pending', 'success', 'failure'))
    );
    CREATE UNIQUE INDEX notifications_idempotency_key_unique
      ON notifications(idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX notifications_resource_idx
      ON notifications(resource_type, resource_id);
    CREATE INDEX notifications_status_idx ON notifications(status);
  `);
  vi.mocked(getDb).mockResolvedValue(drizzle(sqlite, { schema }) as never);
});

afterEach(() => sqlite.close());

const record = {
  template: "order-claim-created",
  triggerType: "order.claim.created",
  resourceType: "order_claim",
  resourceId: "claim-1",
  receiverId: "customer-1",
  idempotencyKey: "order-claim-created:claim-1",
};

describe("email notification service", () => {
  it("records provider success and returns the stored result on an idempotent retry", async () => {
    const send = vi.fn().mockResolvedValue({
      success: true,
      messageId: "provider-message-1",
    });
    const adapter = { id: "test-mail", send };

    const first = await sendEmailNotification({
      adapter,
      params: {
        to: "buyer@example.com",
        subject: "Your order update",
        html: "<p>Order update</p>",
      },
      record: { ...record, adapterId: adapter.id },
    });
    const second = await sendEmailNotification({
      adapter,
      params: {
        to: "buyer@example.com",
        subject: "Your order update",
        html: "<p>Order update</p>",
      },
      record: { ...record, adapterId: adapter.id },
    });

    expect(first).toEqual({ success: true, messageId: "provider-message-1" });
    expect(second).toEqual({ success: true, messageId: "provider-message-1" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await drizzle(sqlite, { schema }).select().from(notifications),
    ).toMatchObject([
      {
        to: "buyer@example.com",
        channel: "email",
        template: "order-claim-created",
        triggerType: "order.claim.created",
        resourceType: "order_claim",
        resourceId: "claim-1",
        receiverId: "customer-1",
        idempotencyKey: "order-claim-created:claim-1",
        providerData: { adapterId: "test-mail" },
        status: "success",
        externalId: "provider-message-1",
      },
    ]);
  });

  it("records provider rejection and prevents an automatic duplicate send", async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ success: false, error: "secret detail" });
    const input = {
      adapter: { send },
      params: {
        to: "buyer@example.com",
        subject: "Your order update",
        html: "<p>Order update</p>",
      },
      record,
    };

    await expect(sendEmailNotification(input)).resolves.toEqual({
      success: false,
      error: "Notification provider failed",
    });
    await expect(sendEmailNotification(input)).resolves.toEqual({
      success: false,
      error: "Notification was already attempted",
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await drizzle(sqlite, { schema }).select().from(notifications),
    ).toMatchObject([{ status: "failure", externalId: null }]);
  });

  it("records a thrown provider error without persisting its message", async () => {
    const send = vi.fn().mockRejectedValue(new Error("credential=secret"));

    await expect(
      sendEmailNotification({
        adapter: { send },
        params: {
          to: "buyer@example.com",
          subject: "Your order update",
          html: "<p>Order update</p>",
        },
        record,
      }),
    ).resolves.toEqual({
      success: false,
      error: "Notification provider failed",
    });
    expect(
      await drizzle(sqlite, { schema }).select().from(notifications),
    ).toMatchObject([{ status: "failure", providerData: null }]);
  });

  it("persists the retry snapshot and its source notification", async () => {
    const data = {
      appName: "Morph",
      orderDisplayId: 42,
      items: [],
      total: "$59.98",
    };
    const send = vi.fn().mockResolvedValue({
      success: true,
      messageId: "provider-retry-1",
    });
    const retryRecord = {
      ...record,
      template: "order-placed",
      triggerType: "order.placed",
      resourceId: "order-1",
      originalNotificationId: "notification-failed-1",
      idempotencyKey: "order-placed-retry:notification-failed-1",
      data,
    };

    const result = await sendEmailNotification({
      adapter: { send },
      params: {
        to: "buyer@example.com",
        subject: "Order #42 confirmed",
        html: "<p>Order confirmation</p>",
      },
      record: retryRecord,
    });

    expect(result).toEqual({ success: true, messageId: "provider-retry-1" });
    expect(
      await drizzle(sqlite, { schema }).select().from(notifications),
    ).toMatchObject([
      {
        template: "order-placed",
        triggerType: "order.placed",
        resourceId: "order-1",
        originalNotificationId: "notification-failed-1",
        idempotencyKey: "order-placed-retry:notification-failed-1",
        data,
        status: "success",
        externalId: "provider-retry-1",
      },
    ]);
  });
});
