import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { metadata, providerData, timestamps } from "./columns";

export type PaymentCollectionStatus =
  | "not_paid"
  | "awaiting"
  | "authorized"
  | "partially_authorized"
  | "partially_captured"
  | "captured"
  | "completed"
  | "failed"
  | "canceled";

export type PaymentSessionStatus =
  | "pending"
  | "pending_authorization"
  | "requires_more"
  | "authorized"
  | "captured"
  | "error"
  | "canceled";

/**
 * Payment — the money side of a cart or an order.
 *
 * Translated from Medusa's Payment Module; see `region.schema.ts` for the
 * translation rules.
 *
 * The chain exists because paying is not one event:
 *
 * - a **collection** is the amount owed, and is what a cart or order links to
 * - a **session** is one attempt through one provider, and several can coexist
 *   while the shopper switches between card and bank transfer
 * - a **payment** is the attempt that succeeded
 * - **captures** and **refunds** are movements against it, each a row, because
 *   a payment can be captured in parts and refunded in parts
 *
 * Amounts are integer minor units. Every one is denormalised onto the
 * collection (`authorizedAmount`, `capturedAmount`, `refundedAmount`) so the
 * "is this paid?" check does not sum three child tables on every read.
 */
export const paymentProviders = sqliteTable("payment_providers", {
  /** The provider's own handle, e.g. `pp_stripe_stripe`. Not generated. */
  id: text("id").primaryKey(),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

export const paymentCollections = sqliteTable(
  "payment_collections",
  {
    id: text("id").primaryKey(),
    currencyCode: text("currency_code").notNull(),
    amount: integer("amount").notNull(),
    authorizedAmount: integer("authorized_amount"),
    capturedAmount: integer("captured_amount"),
    refundedAmount: integer("refunded_amount"),
    status: text("status")
      .$type<PaymentCollectionStatus>()
      .notNull()
      .default("not_paid"),
    completedAt: text("completed_at"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("payment_collections_status_active_idx").on(
      table.status,
      table.deletedAt,
    ),
    check(
      "payment_collections_status_check",
      sql`${table.status} IN ('not_paid', 'awaiting', 'authorized', 'partially_authorized', 'partially_captured', 'captured', 'completed', 'failed', 'canceled')`,
    ),
  ],
);

/** Which providers the shopper may pick from for one collection. */
export const paymentCollectionPaymentProviders = sqliteTable(
  "payment_collection_payment_providers",
  {
    paymentCollectionId: text("payment_collection_id")
      .notNull()
      .references(() => paymentCollections.id, { onDelete: "cascade" }),
    paymentProviderId: text("payment_provider_id")
      .notNull()
      .references(() => paymentProviders.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({
      columns: [table.paymentCollectionId, table.paymentProviderId],
    }),
    index("payment_collection_payment_providers_provider_idx").on(
      table.paymentProviderId,
    ),
  ],
);

/**
 * One attempt with one provider.
 *
 * `data` is the provider's own payload — a Stripe payment intent, say. It is
 * opaque here by design: the module must not need a code change to support a
 * new provider.
 */
export const paymentSessions = sqliteTable(
  "payment_sessions",
  {
    id: text("id").primaryKey(),
    paymentCollectionId: text("payment_collection_id")
      .notNull()
      .references(() => paymentCollections.id, { onDelete: "cascade" }),
    currencyCode: text("currency_code").notNull(),
    amount: integer("amount").notNull(),
    providerId: text("provider_id").notNull(),
    status: text("status")
      .$type<PaymentSessionStatus>()
      .notNull()
      .default("pending"),
    authorizedAt: text("authorized_at"),
    data: providerData("data"),
    /** What the storefront sent with the attempt: IP, billing address, etc. */
    context: providerData("context"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("payment_sessions_collection_active_idx").on(
      table.paymentCollectionId,
      table.deletedAt,
    ),
    check(
      "payment_sessions_status_check",
      sql`${table.status} IN ('pending', 'pending_authorization', 'requires_more', 'authorized', 'captured', 'error', 'canceled')`,
    ),
  ],
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    paymentCollectionId: text("payment_collection_id")
      .notNull()
      .references(() => paymentCollections.id, { onDelete: "cascade" }),
    paymentSessionId: text("payment_session_id")
      .notNull()
      .references(() => paymentSessions.id, { onDelete: "cascade" }),
    currencyCode: text("currency_code").notNull(),
    amount: integer("amount").notNull(),
    providerId: text("provider_id").notNull(),
    capturedAt: text("captured_at"),
    canceledAt: text("canceled_at"),
    data: providerData("data"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("payments_session_unique")
      .on(table.paymentSessionId)
      .where(sql`${table.deletedAt} IS NULL`),
    index("payments_collection_active_idx").on(
      table.paymentCollectionId,
      table.deletedAt,
    ),
    index("payments_provider_active_idx").on(
      table.providerId,
      table.deletedAt,
    ),
  ],
);

/** Money actually taken. Several per payment when captured in parts. */
export const captures = sqliteTable(
  "captures",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    createdBy: text("created_by"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("captures_payment_active_idx").on(table.paymentId, table.deletedAt),
    check("captures_amount_check", sql`${table.amount} > 0`),
  ],
);

/** The author-managed list a refund picks its reason from. */
export const refundReasons = sqliteTable(
  "refund_reasons",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    code: text("code").notNull(),
    description: text("description"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("refund_reasons_active_code_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const refunds = sqliteTable(
  "refunds",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    // `set null`, not cascade: retiring a reason from the list must not erase
    // the refunds already given for it.
    refundReasonId: text("refund_reason_id").references(
      () => refundReasons.id,
      { onDelete: "set null" },
    ),
    amount: integer("amount").notNull(),
    note: text("note"),
    createdBy: text("created_by"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("refunds_payment_active_idx").on(table.paymentId, table.deletedAt),
    check("refunds_amount_check", sql`${table.amount} > 0`),
  ],
);

/**
 * A customer as the provider knows them, e.g. a Stripe customer.
 *
 * Kept so a returning shopper can reuse a saved card. `externalId` is the
 * provider's id and nothing else — no card data is stored here, and none should
 * ever be.
 */
export const accountHolders = sqliteTable(
  "account_holders",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    externalId: text("external_id").notNull(),
    email: text("email"),
    data: providerData("data"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("account_holders_provider_external_unique")
      .on(table.providerId, table.externalId)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);
