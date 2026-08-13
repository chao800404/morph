import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { metadata, timestamps } from "./columns";

/**
 * Inventory — what is physically stocked, and where.
 *
 * Translated from Medusa's Inventory Module; see `region.schema.ts` for the
 * translation rules.
 *
 * This is the module `productVariants.inventoryQuantity` stands in for today.
 * The variant column is a single number with no location and no reservations,
 * which is enough for one warehouse and wrong for two: it cannot say that six
 * are in Taipei and none in Berlin, and it cannot hold stock for a cart that
 * has not been paid for. Both are what these three tables add.
 *
 * A variant does not own an inventory item — the join is in `link.schema.ts`,
 * with a `requiredQuantity`, so a bundle can consume two of something per sale.
 */
export const inventoryItems = sqliteTable(
  "inventory_items",
  {
    id: text("id").primaryKey(),
    sku: text("sku"),
    title: text("title"),
    description: text("description"),
    thumbnail: text("thumbnail"),
    /** When false the item is digital and never enters a shipment. */
    requiresShipping: integer("requires_shipping", { mode: "boolean" })
      .notNull()
      .default(true),
    // Shipping and customs, same units and same `real` reasoning as
    // `products`: a carrier's rate table takes 12.5 mm.
    weight: real("weight"),
    length: real("length"),
    height: real("height"),
    width: real("width"),
    originCountry: text("origin_country"),
    hsCode: text("hs_code"),
    midCode: text("mid_code"),
    material: text("material"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("inventory_items_active_sku_unique")
      .on(table.sku)
      .where(sql`${table.deletedAt} IS NULL AND ${table.sku} IS NOT NULL`),
  ],
);

/**
 * How much of an item sits at one location.
 *
 * The three quantities are separate on purpose. `stocked` is what is on the
 * shelf, `reserved` is what is already promised to an unpaid order, and
 * `incoming` is what a purchase order will bring. Available is
 * `stocked - reserved` and is derived, never stored — a stored copy is the
 * field that goes stale and oversells.
 */
export const inventoryLevels = sqliteTable(
  "inventory_levels",
  {
    id: text("id").primaryKey(),
    inventoryItemId: text("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    /** A `stockLocations.id`. Plain text: different module. */
    locationId: text("location_id").notNull(),
    stockedQuantity: integer("stocked_quantity").notNull().default(0),
    reservedQuantity: integer("reserved_quantity").notNull().default(0),
    incomingQuantity: integer("incoming_quantity").notNull().default(0),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("inventory_levels_item_location_unique")
      .on(table.inventoryItemId, table.locationId)
      .where(sql`${table.deletedAt} IS NULL`),
    index("inventory_levels_location_active_idx").on(
      table.locationId,
      table.deletedAt,
    ),
    check(
      "inventory_levels_stocked_check",
      sql`${table.stockedQuantity} >= 0`,
    ),
    check(
      "inventory_levels_reserved_check",
      sql`${table.reservedQuantity} >= 0`,
    ),
    check(
      "inventory_levels_incoming_check",
      sql`${table.incomingQuantity} >= 0`,
    ),
  ],
);

/**
 * Stock held for a line item that has not shipped yet.
 *
 * Deleting a reservation is what releases the stock, so this table is the
 * reason `reservedQuantity` can be trusted: every unit of it is one of these
 * rows.
 */
export const reservationItems = sqliteTable(
  "reservation_items",
  {
    id: text("id").primaryKey(),
    inventoryItemId: text("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    /** A `stockLocations.id`. Plain text: different module. */
    locationId: text("location_id").notNull(),
    /** A `carts.id` while checkout is pending. Plain text: Cart module. */
    cartId: text("cart_id"),
    /** A cart line id before conversion, then the matching order line id. */
    lineItemId: text("line_item_id"),
    quantity: integer("quantity").notNull(),
    allowBackorder: integer("allow_backorder", { mode: "boolean" })
      .notNull()
      .default(false),
    description: text("description"),
    externalId: text("external_id"),
    createdBy: text("created_by"),
    expiresAt: text("expires_at"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("reservation_items_item_active_idx").on(
      table.inventoryItemId,
      table.deletedAt,
    ),
    index("reservation_items_location_active_idx").on(
      table.locationId,
      table.deletedAt,
    ),
    index("reservation_items_cart_active_idx").on(
      table.cartId,
      table.deletedAt,
    ),
    index("reservation_items_line_item_active_idx").on(
      table.lineItemId,
      table.deletedAt,
    ),
    uniqueIndex("reservation_items_line_item_inventory_location_unique")
      .on(table.lineItemId, table.inventoryItemId, table.locationId)
      .where(sql`${table.deletedAt} IS NULL AND ${table.lineItemId} IS NOT NULL`),
    check("reservation_items_quantity_check", sql`${table.quantity} > 0`),
  ],
);
