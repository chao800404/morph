import { sql } from "drizzle-orm";
import {
  AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { Metadata } from "./json";

export type ProductStatus = "draft" | "published" | "archived";

// Both moved to `./json` once the other commerce modules needed them; the
// aliases stay so the catalogue's call sites keep reading in product terms.
export type { JsonValue } from "./json";
export type ProductMetadata = Metadata;

/**
 * Commerce catalogue schema.
 *
 * The shape follows Medusa's product module so the domain model is familiar and
 * a future import path stays open, but it is a translation rather than a copy:
 * Medusa runs MikroORM on Postgres, this runs Drizzle on D1/SQLite.
 *
 * Deliberate departures from Medusa:
 * - Primary keys are plain UUIDs, not prefixed ids (`prod_...`).
 * - Money is an integer in the currency's minor unit, not Medusa's
 *   numeric + raw-JSON BigNumber pair, which SQLite has no equivalent for.
 * - Images reference the existing `assets` table instead of storing bare URLs,
 *   so uploads keep going through the asset library.
 *
 * Local conventions follow `asset.schema.ts`: text ids, ISO timestamp strings
 * written by the DAL, `deletedAt` soft deletes, and active-only unique indexes
 * so a deleted row never blocks reuse of its handle or SKU.
 */

export const productCollections = sqliteTable(
  "product_collections",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    handle: text("handle").notNull(),
    description: text("description"),
    // Every other catalogue table carries one; collections were the omission.
    externalId: text("external_id"),
    metadata: text("metadata", { mode: "json" }).$type<ProductMetadata>(),
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

/** Free-form classification, e.g. "Clothing". One per product. */
export const productTypes = sqliteTable(
  "product_types",
  {
    id: text("id").primaryKey(),
    value: text("value").notNull(),
    externalId: text("external_id"),
    metadata: text("metadata", { mode: "json" }).$type<ProductMetadata>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("product_types_active_value_unique")
      .on(table.value)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

/** Free-form label. Many per product. */
export const productTags = sqliteTable(
  "product_tags",
  {
    id: text("id").primaryKey(),
    value: text("value").notNull(),
    externalId: text("external_id"),
    metadata: text("metadata", { mode: "json" }).$type<ProductMetadata>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("product_tags_active_value_unique")
      .on(table.value)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

/**
 * Category tree.
 *
 * `mpath` is the materialised path of ancestor ids, mirroring how
 * `asset_folders.idPath` works here: it lets one indexed range scan fetch a
 * whole subtree. Match with `gte`/`lt`, never `LIKE` — see rules.md on the
 * 50-byte pattern limit.
 */
export const productCategories = sqliteTable(
  "product_categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    handle: text("handle").notNull(),
    mpath: text("mpath").notNull(),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(false),
    isInternal: integer("is_internal", { mode: "boolean" })
      .notNull()
      .default(false),
    rank: integer("rank").notNull().default(0),
    parentCategoryId: text("parent_category_id").references(
      (): AnySQLiteColumn => productCategories.id,
      { onDelete: "cascade" },
    ),
    externalId: text("external_id"),
    metadata: text("metadata", { mode: "json" }).$type<ProductMetadata>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("product_categories_active_handle_unique")
      .on(table.handle)
      .where(sql`${table.deletedAt} IS NULL`),
    index("product_categories_mpath_idx").on(table.mpath),
    index("product_categories_parent_rank_idx").on(
      table.parentCategoryId,
      table.rank,
    ),
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
    isGiftcard: integer("is_giftcard", { mode: "boolean" })
      .notNull()
      .default(false),
    discountable: integer("discountable", { mode: "boolean" })
      .notNull()
      .default(true),
    collectionId: text("collection_id").references(
      () => productCollections.id,
      { onDelete: "set null" },
    ),
    typeId: text("type_id").references(() => productTypes.id, {
      onDelete: "set null",
    }),
    thumbnailAssetId: text("thumbnail_asset_id"),
    // Shipping and customs attributes. Variants may override each of these.
    // Real, not integer: a carrier's rate table takes 12.5 mm, and Medusa
    // models them as floats too.
    weight: real("weight"),
    length: real("length"),
    width: real("width"),
    height: real("height"),
    originCountry: text("origin_country"),
    hsCode: text("hs_code"),
    midCode: text("mid_code"),
    material: text("material"),
    externalId: text("external_id"),
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
    index("products_type_active_idx").on(table.typeId, table.deletedAt),
    check(
      "products_status_check",
      sql`${table.status} IN ('draft', 'published', 'archived')`,
    ),
  ],
);

export const productTagLinks = sqliteTable(
  "product_tag_links",
  {
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => productTags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.tagId] }),
    index("product_tag_links_tag_idx").on(table.tagId),
  ],
);

export const productCategoryLinks = sqliteTable(
  "product_category_links",
  {
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => productCategories.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.categoryId] }),
    index("product_category_links_category_idx").on(table.categoryId),
  ],
);

/**
 * An axis of variation, e.g. "Size".
 *
 * Options are global by default and reusable across products, which is what the
 * Options page manages. `isExclusive` marks one that belongs to a single product
 * and should not appear in that shared list. The unique title only applies to
 * global options, so two products may each have their own exclusive "Size".
 */
export const productOptions = sqliteTable(
  "product_options",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    isExclusive: integer("is_exclusive", { mode: "boolean" })
      .notNull()
      .default(false),
    rank: integer("rank").notNull().default(0),
    metadata: text("metadata", { mode: "json" }).$type<ProductMetadata>(),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("product_options_global_title_unique")
      .on(table.title)
      .where(sql`${table.deletedAt} IS NULL AND ${table.isExclusive} = 0`),
    index("product_options_active_rank_idx").on(table.deletedAt, table.rank),
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
    metadata: text("metadata", { mode: "json" }).$type<ProductMetadata>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("product_option_values_option_value_unique")
      .on(table.optionId, table.value)
      .where(sql`${table.deletedAt} IS NULL`),
    index("product_option_values_option_rank_idx").on(
      table.optionId,
      table.rank,
    ),
  ],
);

/**
 * Which options a product uses.
 *
 * A product does not adopt an option wholesale — it picks the option, then picks
 * which of that option's values apply (see `productProductOptionValues`). That
 * is why this is an entity rather than a plain join table.
 */
export const productProductOptions = sqliteTable(
  "product_product_options",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    optionId: text("option_id")
      .notNull()
      .references(() => productOptions.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("product_product_options_unique").on(
      table.productId,
      table.optionId,
    ),
    index("product_product_options_product_rank_idx").on(
      table.productId,
      table.rank,
    ),
    index("product_product_options_option_idx").on(table.optionId),
  ],
);

/** The subset of an option's values that a product actually offers. */
export const productProductOptionValues = sqliteTable(
  "product_product_option_values",
  {
    productProductOptionId: text("product_product_option_id")
      .notNull()
      .references(() => productProductOptions.id, { onDelete: "cascade" }),
    optionValueId: text("option_value_id")
      .notNull()
      .references(() => productOptionValues.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.productProductOptionId, table.optionValueId],
    }),
    index("product_product_option_values_value_idx").on(table.optionValueId),
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
    ean: text("ean"),
    upc: text("upc"),
    rank: integer("rank").notNull().default(0),
    /** When false, the variant is always purchasable and quantity is ignored. */
    manageInventory: integer("manage_inventory", { mode: "boolean" })
      .notNull()
      .default(true),
    allowBackorder: integer("allow_backorder", { mode: "boolean" })
      .notNull()
      .default(false),
    inventoryQuantity: integer("inventory_quantity").notNull().default(0),
    // Override the product-level shipping and customs attributes.
    weight: real("weight"),
    length: real("length"),
    width: real("width"),
    height: real("height"),
    originCountry: text("origin_country"),
    hsCode: text("hs_code"),
    midCode: text("mid_code"),
    material: text("material"),
    thumbnailAssetId: text("thumbnail_asset_id"),
    metadata: text("metadata", { mode: "json" }).$type<ProductMetadata>(),
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
    uniqueIndex("product_variants_active_barcode_unique")
      .on(table.barcode)
      .where(sql`${table.deletedAt} IS NULL AND ${table.barcode} IS NOT NULL`),
    uniqueIndex("product_variants_active_ean_unique")
      .on(table.ean)
      .where(sql`${table.deletedAt} IS NULL AND ${table.ean} IS NOT NULL`),
    uniqueIndex("product_variants_active_upc_unique")
      .on(table.upc)
      .where(sql`${table.deletedAt} IS NULL AND ${table.upc} IS NOT NULL`),
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

/**
 * Append-only audit trail for base variant prices.
 *
 * Price lists describe scheduled or targeted prices; this table answers the
 * separate audit question of who changed the variant's ordinary price and
 * what the previous amount was.
 */
export const productVariantPriceHistory = sqliteTable(
  "product_variant_price_history",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    currencyCode: text("currency_code").notNull(),
    oldAmount: integer("old_amount"),
    newAmount: integer("new_amount"),
    changedBy: text("changed_by").notNull(),
    changedAt: text("changed_at").notNull(),
  },
  (table) => [
    index("product_variant_price_history_variant_date_idx").on(
      table.variantId,
      table.changedAt,
    ),
    check(
      "product_variant_price_history_currency_code_check",
      sql`length(${table.currencyCode}) = 3 AND ${table.currencyCode} = lower(${table.currencyCode})`,
    ),
  ],
);

/**
 * Product gallery.
 *
 * Medusa stores a bare `url` here; this references the asset library instead so
 * images keep their upload validation, R2 archival and soft-delete behaviour.
 */
export const productAssets = sqliteTable(
  "product_assets",
  {
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    assetId: text("asset_id").notNull(),
    rank: integer("rank").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.assetId] }),
    index("product_assets_product_rank_idx").on(table.productId, table.rank),
    index("product_assets_asset_idx").on(table.assetId),
  ],
);

/** Images shown for a specific variant, drawn from the product's gallery. */
export const productVariantAssets = sqliteTable(
  "product_variant_assets",
  {
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    assetId: text("asset_id").notNull(),
    rank: integer("rank").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.variantId, table.assetId] }),
    index("product_variant_assets_variant_rank_idx").on(
      table.variantId,
      table.rank,
    ),
    index("product_variant_assets_asset_idx").on(table.assetId),
  ],
);
