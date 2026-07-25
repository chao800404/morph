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
import { assets } from "./asset.schema";

export type ProductStatus = "draft" | "published" | "archived";

/**
 * Metadata crosses the server/client boundary, so it is constrained to values
 * that survive JSON serialisation. `Record<string, unknown>` would compile here
 * but fails TanStack Start's serialisability check at the server function.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ProductMetadata = Record<string, JsonValue>;

/**
 * Commerce catalogue schema.
 *
 * Conventions follow `asset.schema.ts`: text ids, ISO timestamp strings written
 * by the DAL, `deletedAt` soft deletes, and active-only unique indexes so a
 * deleted row never blocks reuse of its handle or SKU.
 *
 * Money is stored as an integer in the currency's minor unit (cents), never a
 * float. Prices live in their own table so a variant can be sold in several
 * currencies; retrofitting that onto a single column is painful.
 *
 * Inventory is tracked on the variant, which assumes one stock location. Adding
 * locations later means a new table keyed by variant id, so variant identity
 * does not have to change.
 */

export const productCollections = sqliteTable(
  "product_collections",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    handle: text("handle").notNull(),
    description: text("description"),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("product_collections_active_handle_unique")
      .on(table.handle)
      .where(sql`${table.deletedAt} IS NULL`),
    index("product_collections_active_idx").on(table.deletedAt),
  ],
);

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    handle: text("handle").notNull(),
    subtitle: text("subtitle"),
    description: text("description"),
    status: text("status").$type<ProductStatus>().notNull().default("draft"),
    collectionId: text("collection_id").references(
      () => productCollections.id,
      { onDelete: "set null" },
    ),
    thumbnailAssetId: text("thumbnail_asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    metadata: text("metadata", { mode: "json" })
      .$type<ProductMetadata>()
      .notNull()
      .default(sql`'{}'`),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("products_active_handle_unique")
      .on(table.handle)
      .where(sql`${table.deletedAt} IS NULL`),
    index("products_status_active_idx").on(table.status, table.deletedAt),
    index("products_collection_active_idx").on(
      table.collectionId,
      table.deletedAt,
    ),
    check(
      "products_status_check",
      sql`${table.status} IN ('draft', 'published', 'archived')`,
    ),
  ],
);

/**
 * Reusable option definitions managed at /dashboard/products/options.
 *
 * These are templates, not the options a product actually has. When a product
 * uses one, its values are copied into `product_options` /
 * `product_option_values` below. That copy is deliberate: renaming or deleting
 * a template later must never rewrite what an existing product sells, and
 * variants stay bound to their own product's value rows.
 */
export const optionTemplates = sqliteTable(
  "option_templates",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    rank: integer("rank").notNull().default(0),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("option_templates_active_title_unique")
      .on(table.title)
      .where(sql`${table.deletedAt} IS NULL`),
    index("option_templates_active_rank_idx").on(table.deletedAt, table.rank),
  ],
);

export const optionTemplateValues = sqliteTable(
  "option_template_values",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => optionTemplates.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    rank: integer("rank").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("option_template_values_template_value_unique").on(
      table.templateId,
      table.value,
    ),
    index("option_template_values_template_rank_idx").on(
      table.templateId,
      table.rank,
    ),
  ],
);

/** An axis of variation, e.g. "Size". Ordered by `rank` in the admin UI. */
export const productOptions = sqliteTable(
  "product_options",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    rank: integer("rank").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("product_options_product_title_unique").on(
      table.productId,
      table.title,
    ),
    index("product_options_product_rank_idx").on(table.productId, table.rank),
  ],
);

/** A value on an axis, e.g. "M". */
export const productOptionValues = sqliteTable(
  "product_option_values",
  {
    id: text("id").primaryKey(),
    optionId: text("option_id")
      .notNull()
      .references(() => productOptions.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    rank: integer("rank").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("product_option_values_option_value_unique").on(
      table.optionId,
      table.value,
    ),
    index("product_option_values_option_rank_idx").on(
      table.optionId,
      table.rank,
    ),
  ],
);

export const productVariants = sqliteTable(
  "product_variants",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sku: text("sku"),
    barcode: text("barcode"),
    rank: integer("rank").notNull().default(0),
    /** When false, the variant is always purchasable and quantity is ignored. */
    manageInventory: integer("manage_inventory", { mode: "boolean" })
      .notNull()
      .default(true),
    allowBackorder: integer("allow_backorder", { mode: "boolean" })
      .notNull()
      .default(false),
    inventoryQuantity: integer("inventory_quantity").notNull().default(0),
    weight: integer("weight"),
    length: integer("length"),
    width: integer("width"),
    height: integer("height"),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("product_variants_product_active_idx").on(
      table.productId,
      table.deletedAt,
    ),
    index("product_variants_product_rank_idx").on(table.productId, table.rank),
    uniqueIndex("product_variants_active_sku_unique")
      .on(table.sku)
      .where(sql`${table.deletedAt} IS NULL AND ${table.sku} IS NOT NULL`),
    check(
      "product_variants_inventory_quantity_check",
      sql`${table.inventoryQuantity} >= 0`,
    ),
  ],
);

/**
 * Which option value each variant carries. One row per axis, so a variant of a
 * two-axis product ("Size" × "Colour") has two rows.
 */
export const productVariantOptionValues = sqliteTable(
  "product_variant_option_values",
  {
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    optionValueId: text("option_value_id")
      .notNull()
      .references(() => productOptionValues.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.variantId, table.optionValueId] }),
    index("product_variant_option_values_value_idx").on(table.optionValueId),
  ],
);

/** Amounts are integers in the currency's minor unit. */
export const productVariantPrices = sqliteTable(
  "product_variant_prices",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    currencyCode: text("currency_code").notNull(),
    amount: integer("amount").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("product_variant_prices_variant_currency_unique").on(
      table.variantId,
      table.currencyCode,
    ),
    check("product_variant_prices_amount_check", sql`${table.amount} >= 0`),
    check(
      "product_variant_prices_currency_code_check",
      sql`length(${table.currencyCode}) = 3 AND ${table.currencyCode} = lower(${table.currencyCode})`,
    ),
  ],
);

/** Product gallery. Ordering is explicit so the admin can reorder images. */
export const productAssets = sqliteTable(
  "product_assets",
  {
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.assetId] }),
    index("product_assets_product_rank_idx").on(table.productId, table.rank),
    index("product_assets_asset_idx").on(table.assetId),
  ],
);
