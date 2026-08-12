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
 * Regions — a market, defined by a currency and the countries it serves.
 *
 * Translated from Medusa's Region Module. The translation rules are the same
 * ones `product.schema.ts` set out (text ids, ISO timestamp strings, soft
 * deletes, integer minor-unit money) plus one that only matters once there is
 * more than one module:
 *
 * **Ids that point at another module are plain `text`, not foreign keys.**
 * Medusa's modules are separately deployable and cannot hold a database-level
 * reference across the boundary; the join is declared in `link.schema.ts`
 * instead. Keeping that boundary means these files never import each other, so
 * no schema file can start an import cycle — and cycles are what produced the
 * `Cannot access 'X' before initialization` class of bug here before.
 * Within a module the references are real foreign keys.
 */
export const regions = sqliteTable(
  "regions",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    currencyCode: text("currency_code").notNull(),
    /** When true the region's tax rates are applied without asking the author. */
    automaticTaxes: integer("automatic_taxes", { mode: "boolean" })
      .notNull()
      .default(true),
    /** Whether storefront prices in this market are displayed with tax included. */
    isTaxInclusive: integer("is_tax_inclusive", { mode: "boolean" })
      .notNull()
      .default(false),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("regions_currency_active_idx").on(
      table.currencyCode,
      table.deletedAt,
    ),
    check(
      "regions_currency_code_check",
      sql`length(${table.currencyCode}) = 3 AND ${table.currencyCode} = lower(${table.currencyCode})`,
    ),
  ],
);

/**
 * The ISO 3166-1 country list, with the region each country is served by.
 *
 * A table rather than runtime ISO data — unlike `currencies`, which nothing
 * points at, a country is the thing a region, a tax region and a shipping zone
 * all attach to. `regionId` is nullable: a country exists whether or not the
 * store sells into it.
 */
export const regionCountries = sqliteTable(
  "region_countries",
  {
    iso2: text("iso_2").primaryKey(),
    // Nullable, unlike Medusa. The catalogue is derived from the runtime's ICU
    // data (see `lib/region/countries.ts`) rather than a hand-maintained file,
    // and ICU exposes no alpha-3 or numeric code. A wrong numeric code on a
    // customs declaration is worse than an absent one, so these stay empty
    // until something authoritative fills them.
    iso3: text("iso_3"),
    numCode: text("num_code"),
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    regionId: text("region_id").references(() => regions.id, {
      onDelete: "set null",
    }),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("region_countries_region_iso2_unique").on(
      table.regionId,
      table.iso2,
    ),
    check(
      "region_countries_iso_2_check",
      sql`length(${table.iso2}) = 2 AND ${table.iso2} = lower(${table.iso2})`,
    ),
  ],
);
