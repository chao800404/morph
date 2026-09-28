import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { metadata, timestamps } from "./columns";

/**
 * Customer-owned store credit accounts.
 *
 * Amounts are stored in currency minor units. `balance` is a transactionally
 * maintained guard/cache for D1's conditional debits; the transaction ledger
 * remains the audit history. Codes are claim credentials and are only stored
 * as hashes.
 */
export const storeCreditAccounts = sqliteTable(
  "store_credit_accounts",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id"),
    codeHash: text("code_hash").notNull(),
    currencyCode: text("currency_code").notNull(),
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    balance: integer("balance").notNull().default(0),
    metadata: metadata(),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("store_credit_accounts_code_hash_unique").on(table.codeHash),
    index("store_credit_accounts_customer_active_idx").on(
      table.customerId,
      table.deletedAt,
      table.status,
    ),
    index("store_credit_accounts_currency_active_idx").on(
      table.currencyCode,
      table.deletedAt,
      table.status,
    ),
    check(
      "store_credit_accounts_balance_nonnegative",
      sql`${table.balance} >= 0`,
    ),
  ],
);

/** Immutable money movements for store credit accounts. */
export const storeCreditTransactions = sqliteTable(
  "store_credit_transactions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => storeCreditAccounts.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["credit", "debit"] }).notNull(),
    amount: integer("amount").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    reference: text("reference"),
    referenceId: text("reference_id"),
    note: text("note"),
    metadata: metadata(),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("store_credit_transactions_account_idempotency_unique").on(
      table.accountId,
      table.idempotencyKey,
    ),
    index("store_credit_transactions_account_created_idx").on(
      table.accountId,
      table.createdAt,
    ),
    check(
      "store_credit_transactions_amount_positive",
      sql`${table.amount} > 0`,
    ),
  ],
);
