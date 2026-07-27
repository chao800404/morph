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

/**
 * The standard currency catalogue.
 *
 * Administrators do not author currency definitions. The catalogue is loaded
 * from the JavaScript runtime's ISO-4217 data and a store enables a subset,
 * matching Medusa's Currency Module / Store boundary.
 */
export const currencies = sqliteTable(
  "currencies",
  {
    code: text("code").primaryKey(),
    symbol: text("symbol").notNull(),
    symbolNative: text("symbol_native").notNull(),
    name: text("name").notNull(),
    decimalDigits: integer("decimal_digits").notNull().default(0),
    rounding: integer("rounding").notNull().default(0),
  },
  (table) => [
    check(
      "currencies_code_check",
      sql`length(${table.code}) = 3 AND ${table.code} = lower(${table.code})`,
    ),
    check(
      "currencies_decimal_digits_check",
      sql`${table.decimalDigits} >= 0`,
    ),
  ],
);

export const stores = sqliteTable("stores", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Currencies accepted by a store.
 *
 * One row is the default currency and every price currency must belong to this
 * set. `isTaxInclusive` is kept per currency because tax display can differ
 * between markets even when the currency code is the same.
 */
export const storeSupportedCurrencies = sqliteTable(
  "store_supported_currencies",
  {
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    currencyCode: text("currency_code")
      .notNull()
      .references(() => currencies.code, { onDelete: "restrict" }),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    isTaxInclusive: integer("is_tax_inclusive", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.storeId, table.currencyCode] }),
    index("store_supported_currencies_code_idx").on(table.currencyCode),
    uniqueIndex("store_supported_currencies_one_default")
      .on(table.storeId)
      .where(sql`${table.isDefault} = 1`),
  ],
);
