import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { metadata, timestamps } from "./columns";

/**
 * Tax — which rate applies where.
 *
 * Translated from Medusa's Tax Module; see `region.schema.ts` for the
 * translation rules.
 *
 * A tax region is a country, optionally narrowed to a province. Provinces are
 * children of their country rather than a separate table because the lookup is
 * "find the most specific region for this address", and a self-reference makes
 * that one query.
 */
export const taxProviders = sqliteTable("tax_providers", {
  /** The provider's own handle, e.g. `tp_system`. Not generated. */
  id: text("id").primaryKey(),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

export const taxRegions = sqliteTable(
  "tax_regions",
  {
    id: text("id").primaryKey(),
    countryCode: text("country_code").notNull(),
    provinceCode: text("province_code"),
    parentId: text("parent_id").references(
      (): AnySQLiteColumn => taxRegions.id,
      { onDelete: "cascade" },
    ),
    providerId: text("provider_id").references(() => taxProviders.id, {
      onDelete: "set null",
    }),
    metadata: metadata(),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tax_regions_country_province_unique")
      .on(table.countryCode, table.provinceCode)
      .where(sql`${table.deletedAt} IS NULL`),
    // The country-level row is the one a lookup falls back to, so there must
    // be exactly one. The composite index above does not enforce it: in SQLite,
    // as in Postgres, NULLs are distinct, so two rows with a null province both
    // pass it.
    uniqueIndex("tax_regions_country_toplevel_unique")
      .on(table.countryCode)
      .where(sql`${table.provinceCode} IS NULL AND ${table.deletedAt} IS NULL`),
    // A province inherits its country's provider; letting it name its own
    // would make the resolved provider depend on which row you started from.
    check(
      "tax_regions_provider_top_level_check",
      sql`${table.parentId} IS NULL OR ${table.providerId} IS NULL`,
    ),
    // A child region is by definition a province of its parent country.
    check(
      "tax_regions_country_top_level_check",
      sql`${table.parentId} IS NULL OR ${table.provinceCode} IS NOT NULL`,
    ),
  ],
);

/**
 * A rate within a region, e.g. 5% VAT.
 *
 * `rate` is a percentage as a float — 8.25 means 8.25%, not 0.0825. It is one
 * of the few `real` columns here; rounding it to an integer would misprice
 * every jurisdiction with a fractional rate.
 */
export const taxRates = sqliteTable(
  "tax_rates",
  {
    id: text("id").primaryKey(),
    taxRegionId: text("tax_region_id")
      .notNull()
      .references(() => taxRegions.id, { onDelete: "cascade" }),
    rate: real("rate"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** The rate used when nothing more specific matched. */
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Stacks on top of the default instead of replacing it. */
    isCombinable: integer("is_combinable", { mode: "boolean" })
      .notNull()
      .default(false),
    metadata: metadata(),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (table) => [
    index("tax_rates_region_active_idx").on(table.taxRegionId, table.deletedAt),
    uniqueIndex("tax_rates_one_default_per_region")
      .on(table.taxRegionId)
      .where(sql`${table.isDefault} = 1 AND ${table.deletedAt} IS NULL`),
  ],
);

/**
 * What a non-default rate applies to.
 *
 * `reference` names the kind of thing (`product`, `product_type`) and
 * `referenceId` the row — a plain id, because the target lives in another
 * module.
 */
export const taxRateRules = sqliteTable(
  "tax_rate_rules",
  {
    id: text("id").primaryKey(),
    taxRateId: text("tax_rate_id")
      .notNull()
      .references(() => taxRates.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    referenceId: text("reference_id").notNull(),
    metadata: metadata(),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tax_rate_rules_rate_reference_unique")
      .on(table.taxRateId, table.referenceId)
      .where(sql`${table.deletedAt} IS NULL`),
    index("tax_rate_rules_reference_active_idx").on(
      table.referenceId,
      table.deletedAt,
    ),
  ],
);
