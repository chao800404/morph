import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { providerData, timestamps } from "./columns";
import type { JsonValue } from "./json";

export type NotificationStatus = "pending" | "success" | "failure";

/**
 * Notifications — what was sent to whom, and whether it arrived.
 *
 * Translated from Medusa's Notification Module; see `region.schema.ts` for the
 * translation rules.
 *
 * A log, not a queue. It exists so an agent can answer "did the shipping email
 * go out?" without asking the provider, and so a retry can be traced back to
 * the attempt it replaces.
 *
 * Two things to keep in mind when this is wired up. `to` is an email address or
 * a phone number, so these rows hold personal data and want a retention policy
 * — Medusa's own model file says the same. And `idempotencyKey` is what stops a
 * workflow that runs twice from emailing the customer twice; it is unique for
 * that reason, not for lookup.
 */
export const notificationProviders = sqliteTable(
  "notification_providers",
  {
    /** The provider's own handle, e.g. `sendgrid`. Not generated. */
    id: text("id").primaryKey(),
    handle: text("handle").notNull(),
    name: text("name").notNull(),
    isEnabled: integer("is_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    /** Which channels it serves, e.g. `["email"]`. */
    channels: text("channels", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    ...timestamps,
  },
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").references(
      () => notificationProviders.id,
      { onDelete: "set null" },
    ),
    /** An address, a phone number or a username — depends on the channel. */
    to: text("to").notNull(),
    from: text("from"),
    channel: text("channel").notNull(),
    /** The template's name in the provider's system. */
    template: text("template"),
    /** What the template renders with. */
    data: providerData("data"),
    /** Channel extras, e.g. cc and bcc. */
    providerData: text("provider_data", { mode: "json" }).$type<JsonValue>(),
    status: text("status")
      .$type<NotificationStatus>()
      .notNull()
      .default("pending"),
    /** What caused it: an event name, a workflow. */
    triggerType: text("trigger_type"),
    /** What it is about, e.g. `order` and an order id. */
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    /** Who it went to, as a domain id rather than an address. */
    receiverId: text("receiver_id"),
    /** Set when this is a retry, pointing at the attempt it replaces. */
    originalNotificationId: text("original_notification_id"),
    idempotencyKey: text("idempotency_key"),
    externalId: text("external_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("notifications_idempotency_key_unique")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    index("notifications_receiver_idx").on(table.receiverId),
    index("notifications_resource_idx").on(
      table.resourceType,
      table.resourceId,
    ),
    index("notifications_status_idx").on(table.status),
    check(
      "notifications_status_check",
      sql`${table.status} IN ('pending', 'success', 'failure')`,
    ),
  ],
);
