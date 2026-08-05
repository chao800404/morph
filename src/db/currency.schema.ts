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
import type { Metadata } from "./json";

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

/**
 * The store's own record.
 *
 * The three `default*Id` columns are plain text with no foreign key: each
 * points into a different commerce module, and that boundary is the one
 * `region.schema.ts` explains. They are what a request falls back to when it
 * names no channel, region or location of its own — a storefront call with a
 * publishable key resolves its channel, an admin call has none.
 */
export const stores = sqliteTable("stores", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  defaultSalesChannelId: text("default_sales_channel_id"),
  defaultRegionId: text("default_region_id"),
  defaultLocationId: text("default_location_id"),
  metadata: text("metadata", { mode: "json" }).$type<Metadata>(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * The languages the storefront is offered in.
 *
 * A table rather than a column on `stores` for the same reason
 * `storeSupportedCurrencies` is one: there are several, and one of them is the
 * default. Codes are BCP 47 language tags, e.g. `en-US` — not ISO 639, because
 * `zh-TW` and `zh-CN` are different storefronts.
 */
export const storeLocales = sqliteTable(
  "store_locales",
  {
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    localeCode: text("locale_code").notNull(),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.storeId, table.localeCode] }),
    uniqueIndex("store_locales_one_default")
      .on(table.storeId)
      .where(sql`${table.isDefault} = 1`),
  ],
);

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
