import { sql } from "drizzle-orm";
import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { metadata, timestamps } from "./columns";

/**
 * Stock locations — a warehouse, a shop floor, a third-party fulfiller.
 *
 * Translated from Medusa's Stock Location Module; see `region.schema.ts` for
 * the translation rules.
 *
 * Inventory levels, fulfillment sets and sales channels all reference a
 * location by plain id across the module boundary, so this table is the one
 * place its name and address are stored.
 */
export const stockLocationAddresses = sqliteTable(
  "stock_location_addresses",
  {
    id: text("id").primaryKey(),
    address1: text("address_1").notNull(),
    address2: text("address_2"),
    company: text("company"),
    city: text("city"),
    countryCode: text("country_code").notNull(),
    phone: text("phone"),
    province: text("province"),
    postalCode: text("postal_code"),
    metadata: metadata(),
    ...timestamps,
  },
);

export const stockLocations = sqliteTable(
  "stock_locations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // Nullable, and `set null` rather than cascade: losing the address of a
    // warehouse must not delete the warehouse, along with every inventory
    // level that hangs off it.
    addressId: text("address_id").references(() => stockLocationAddresses.id, {
      onDelete: "set null",
    }),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("stock_locations_active_name_unique")
      .on(table.name)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);
