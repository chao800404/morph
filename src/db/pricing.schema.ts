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
import type { JsonValue } from "./json";

/** `eq` is the plain case; the rest exist for quantity breaks. */
export type PricingRuleOperator = "eq" | "gt" | "gte" | "lt" | "lte";

export type PriceListStatus = "draft" | "active";

/**
 * `sale` shows the original price struck through; `override` replaces it
 * silently, which is how a contract price for one customer group works.
 */
export type PriceListType = "sale" | "override";

/**
 * Pricing — how a price is chosen, not just what it is.
 *
 * Translated from Medusa's Pricing Module; see `region.schema.ts` for the
 * translation rules.
 *
 * `productVariantPrices` already stores one amount per variant per currency,
 * and for a single-market shop that is the whole answer. It cannot express the
 * three things a real catalogue eventually needs, and each is a table here:
 *
 * - a different price per region or customer group → `priceRules`
 * - a cheaper unit price above a quantity → `prices.minQuantity`/`maxQuantity`
 * - a sale that starts and ends on a date → `priceLists`
 *
 * The indirection is the point. A variant does not own prices; it owns a
 * *price set* (joined in `link.schema.ts`), the set holds many prices, and
 * each price carries the rules that decide whether it applies. Resolving a
 * price means picking the highest-priority price whose rules all match.
 *
 * The two do not yet talk to each other: nothing writes a price set, and the
 * variant editor still writes `productVariantPrices`. Wiring the resolver is
 * the follow-up; this establishes the shape so the migration is additive.
 */
export const priceSets = sqliteTable("price_sets", {
  id: text("id").primaryKey(),
  ...timestamps,
});

/**
 * A scheduled or targeted set of prices, e.g. "Black Friday".
 *
 * `rulesCount` is Medusa's denormalised counter, kept because the resolver
 * checks "does this list have rules at all" on every lookup and that question
 * should not cost a join.
 */
export const priceLists = sqliteTable(
  "price_lists",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").$type<PriceListStatus>().notNull().default("draft"),
    type: text("type").$type<PriceListType>().notNull().default("sale"),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    rulesCount: integer("rules_count").notNull().default(0),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    // The resolver's hot path: active lists whose window contains now.
    index("price_lists_active_window_idx")
      .on(table.status, table.startsAt, table.endsAt)
      .where(sql`${table.deletedAt} IS NULL`),
    check(
      "price_lists_status_check",
      sql`${table.status} IN ('draft', 'active')`,
    ),
    check("price_lists_type_check", sql`${table.type} IN ('sale', 'override')`),
  ],
);

/** Who a price list applies to, e.g. `customer_group_id in [...]`. */
export const priceListRules = sqliteTable(
  "price_list_rules",
  {
    id: text("id").primaryKey(),
    priceListId: text("price_list_id")
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    attribute: text("attribute").notNull(),
    // An array of accepted values, so one rule covers "either of these groups".
    value: text("value", { mode: "json" }).$type<JsonValue>(),
    ...timestamps,
  },
  (table) => [
    index("price_list_rules_list_active_idx").on(
      table.priceListId,
      table.deletedAt,
    ),
    index("price_list_rules_attribute_active_idx").on(
      table.attribute,
      table.deletedAt,
    ),
  ],
);

/** One candidate amount. Integer minor units, as everywhere else here. */
export const prices = sqliteTable(
  "prices",
  {
    id: text("id").primaryKey(),
    priceSetId: text("price_set_id")
      .notNull()
      .references(() => priceSets.id, { onDelete: "cascade" }),
    priceListId: text("price_list_id").references(() => priceLists.id, {
      onDelete: "cascade",
    }),
    title: text("title"),
    currencyCode: text("currency_code").notNull(),
    amount: integer("amount").notNull(),
    /** Quantity break. Null on both means the price always applies. */
    minQuantity: integer("min_quantity"),
    maxQuantity: integer("max_quantity"),
    rulesCount: integer("rules_count").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("prices_set_active_idx").on(table.priceSetId, table.deletedAt),
    index("prices_list_active_idx").on(table.priceListId, table.deletedAt),
    index("prices_currency_active_idx").on(table.currencyCode, table.deletedAt),
    check("prices_amount_check", sql`${table.amount} >= 0`),
    check(
      "prices_currency_code_check",
      sql`length(${table.currencyCode}) = 3 AND ${table.currencyCode} = lower(${table.currencyCode})`,
    ),
    check(
      "prices_quantity_range_check",
      sql`${table.minQuantity} IS NULL OR ${table.maxQuantity} IS NULL OR ${table.maxQuantity} >= ${table.minQuantity}`,
    ),
  ],
);

/**
 * A condition on one price, e.g. `region_id eq reg_tw`.
 *
 * All of a price's rules must match for it to be a candidate; `priority`
 * breaks ties between prices that all match.
 */
export const priceRules = sqliteTable(
  "price_rules",
  {
    id: text("id").primaryKey(),
    priceId: text("price_id")
      .notNull()
      .references(() => prices.id, { onDelete: "cascade" }),
    attribute: text("attribute").notNull(),
    value: text("value").notNull(),
    operator: text("operator")
      .$type<PricingRuleOperator>()
      .notNull()
      .default("eq"),
    priority: integer("priority").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("price_rules_price_attribute_operator_unique")
      .on(table.priceId, table.attribute, table.operator)
      .where(sql`${table.deletedAt} IS NULL`),
    index("price_rules_attribute_value_active_idx").on(
      table.attribute,
      table.value,
      table.deletedAt,
    ),
    check(
      "price_rules_operator_check",
      sql`${table.operator} IN ('eq', 'gt', 'gte', 'lt', 'lte')`,
    ),
  ],
);

/**
 * Whether amounts for one currency or region are entered tax-inclusive.
 *
 * A display concern with a storage consequence: the same 100 means a different
 * net price in Taipei and Berlin, so the preference has to be recorded next to
 * the prices rather than decided when rendering.
 */
export const pricePreferences = sqliteTable(
  "price_preferences",
  {
    id: text("id").primaryKey(),
    attribute: text("attribute").notNull(),
    value: text("value"),
    isTaxInclusive: integer("is_tax_inclusive", { mode: "boolean" })
      .notNull()
      .default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("price_preferences_attribute_value_unique")
      .on(table.attribute, table.value)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);
