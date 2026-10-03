import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { timestamps } from "./columns";

/**
 * The public Gift Card resource.
 *
 * Store credit remains the balance ledger and conditional debit guard. This
 * table holds the Gift Card identity that Medusa exposes separately from the
 * Store Credit Account: the code, original value, expiry, and the order line
 * that created it. The code is only read by the delivery/admin paths; cart
 * redemption continues to use the account's hash.
 */
export const giftCards = sqliteTable(
  "gift_cards",
  {
    id: text("id").primaryKey(),
    storeCreditAccountId: text("store_credit_account_id").notNull(),
    code: text("code").notNull(),
    codeHash: text("code_hash").notNull(),
    value: integer("value").notNull(),
    currencyCode: text("currency_code").notNull(),
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    expiresAt: text("expires_at"),
    reference: text("reference"),
    referenceId: text("reference_id"),
    lineItemId: text("line_item_id"),
    note: text("note"),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("gift_cards_code_unique").on(table.code),
    uniqueIndex("gift_cards_code_hash_unique").on(table.codeHash),
    uniqueIndex("gift_cards_store_credit_account_unique").on(
      table.storeCreditAccountId,
    ),
    index("gift_cards_reference_idx").on(
      table.reference,
      table.referenceId,
      table.deletedAt,
    ),
    index("gift_cards_line_item_idx").on(table.lineItemId, table.deletedAt),
  ],
);
