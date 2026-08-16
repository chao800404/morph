import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("commerce module boundary migration", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (id text PRIMARY KEY NOT NULL);
      CREATE TABLE sales_channels (id text PRIMARY KEY NOT NULL);
      CREATE TABLE assets (id text PRIMARY KEY NOT NULL);
      CREATE TABLE product_collections (id text PRIMARY KEY NOT NULL);
      CREATE TABLE product_types (id text PRIMARY KEY NOT NULL);
      CREATE TABLE products (
        id text PRIMARY KEY NOT NULL,
        title text NOT NULL,
        handle text NOT NULL,
        subtitle text,
        description text,
        status text DEFAULT 'draft' NOT NULL,
        is_giftcard integer DEFAULT false NOT NULL,
        discountable integer DEFAULT true NOT NULL,
        collection_id text,
        type_id text,
        thumbnail_asset_id text REFERENCES assets(id) ON DELETE SET NULL,
        weight real, length real, width real, height real,
        origin_country text, hs_code text, mid_code text, material text,
        external_id text, metadata text DEFAULT '{}' NOT NULL,
        created_by text NOT NULL, updated_by text NOT NULL,
        created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
      );
      CREATE TABLE product_variants (
        id text PRIMARY KEY NOT NULL, product_id text NOT NULL,
        title text NOT NULL, sku text, barcode text, ean text, upc text,
        rank integer DEFAULT 0 NOT NULL, manage_inventory integer DEFAULT true NOT NULL,
        allow_backorder integer DEFAULT false NOT NULL,
        inventory_quantity integer DEFAULT 0 NOT NULL,
        weight real, length real, width real, height real, origin_country text,
        hs_code text, mid_code text, material text,
        thumbnail_asset_id text REFERENCES assets(id) ON DELETE SET NULL,
        metadata text, created_by text NOT NULL, updated_by text NOT NULL,
        created_at text NOT NULL, updated_at text NOT NULL, deleted_at text,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      );
      CREATE TABLE product_assets (
        product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        asset_id text NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        rank integer DEFAULT 0 NOT NULL, PRIMARY KEY(product_id, asset_id)
      );
      CREATE TABLE product_variant_assets (
        variant_id text NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
        asset_id text NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        rank integer DEFAULT 0 NOT NULL, PRIMARY KEY(variant_id, asset_id)
      );
      CREATE TABLE user_table_views (
        id text PRIMARY KEY NOT NULL,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        table_key text NOT NULL, name text DEFAULT 'Default' NOT NULL,
        configuration text NOT NULL, is_default integer DEFAULT true NOT NULL,
        created_at integer NOT NULL, updated_at integer NOT NULL
      );
      CREATE UNIQUE INDEX user_table_views_user_table_name_uq
        ON user_table_views(user_id, table_key, name);
      CREATE TABLE storefronts (
        id text PRIMARY KEY NOT NULL,
        sales_channel_id text NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
        name text NOT NULL, domain text, status text DEFAULT 'draft' NOT NULL,
        active_theme_id text, metadata text, created_at text NOT NULL,
        updated_at text NOT NULL, deleted_at text
      );
      CREATE UNIQUE INDEX storefronts_active_channel_unique
        ON storefronts(sales_channel_id) WHERE deleted_at IS NULL;
      CREATE UNIQUE INDEX storefronts_active_domain_unique
        ON storefronts(domain) WHERE deleted_at IS NULL AND domain IS NOT NULL;
      CREATE TABLE storefront_domains (id text PRIMARY KEY NOT NULL);
      CREATE TABLE storefront_themes (id text PRIMARY KEY NOT NULL);
      CREATE TABLE storefront_theme_templates (id text PRIMARY KEY NOT NULL);
      CREATE TABLE product_category_links (product_id text NOT NULL, category_id text NOT NULL);
      CREATE TABLE product_product_options (id text PRIMARY KEY NOT NULL);
      CREATE TABLE product_tag_links (product_id text NOT NULL, tag_id text NOT NULL);
      CREATE TABLE product_variant_option_values (id text PRIMARY KEY NOT NULL);
      CREATE TABLE product_variant_price_history (id text PRIMARY KEY NOT NULL);
      CREATE TABLE product_variant_prices (id text PRIMARY KEY NOT NULL);
      INSERT INTO users VALUES ('user-1');
      INSERT INTO sales_channels VALUES ('channel-1');
      INSERT INTO assets VALUES ('asset-1');
      INSERT INTO products (
        id, title, handle, thumbnail_asset_id, created_by, updated_by,
        created_at, updated_at
      ) VALUES ('product-1', 'Product', 'product', 'asset-1', 'user-1', 'user-1', 'now', 'now');
      INSERT INTO product_variants (
        id, product_id, title, thumbnail_asset_id, created_by, updated_by,
        created_at, updated_at
      ) VALUES ('variant-1', 'product-1', 'Default', 'asset-1', 'user-1', 'user-1', 'now', 'now');
      INSERT INTO product_assets VALUES ('product-1', 'asset-1', 0);
      INSERT INTO product_variant_assets VALUES ('variant-1', 'asset-1', 0);
      INSERT INTO user_table_views VALUES (
        'view-1', 'user-1', 'products', 'Default', '{}', true, 1, 1
      );
      INSERT INTO storefronts VALUES (
        'storefront-1', 'channel-1', 'Store', 'shop.example.com',
        'draft', NULL, NULL, 'now', 'now', NULL
      );
    `);

    db.exec(
      readFileSync(
        join(process.cwd(), "drizzle", "0031_gigantic_weapon_omega.sql"),
        "utf8",
      ),
    );
  });

  afterEach(() => db.close());

  it("preserves records while removing cross-module foreign keys", () => {
    expect(db.prepare("SELECT thumbnail_asset_id FROM products").get()).toEqual(
      {
        thumbnail_asset_id: "asset-1",
      },
    );
    expect(db.prepare("SELECT asset_id FROM product_assets").get()).toEqual({
      asset_id: "asset-1",
    });
    expect(db.prepare("SELECT user_id FROM user_table_views").get()).toEqual({
      user_id: "user-1",
    });
    expect(
      db.prepare("SELECT sales_channel_id FROM storefronts").get(),
    ).toEqual({
      sales_channel_id: "channel-1",
    });

    const foreignTables = [
      "products",
      "product_variants",
      "product_assets",
      "product_variant_assets",
      "user_table_views",
      "storefronts",
    ].flatMap(
      (table) =>
        db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
          table: string;
        }>,
    );
    expect(foreignTables.map((row) => row.table)).not.toContain("assets");
    expect(foreignTables.map((row) => row.table)).not.toContain("users");
    expect(foreignTables.map((row) => row.table)).not.toContain(
      "sales_channels",
    );
  });

  it("keeps same-module cascades and unique guards", () => {
    expect(
      (
        db.prepare("PRAGMA foreign_key_list(product_variants)").all() as Array<{
          table: string;
        }>
      ).map((row) => row.table),
    ).toContain("products");
    expect(() =>
      db
        .prepare(
          "INSERT INTO storefronts VALUES (?, ?, ?, ?, 'draft', NULL, NULL, 'now', 'now', NULL)",
        )
        .run("storefront-2", "channel-1", "Duplicate", "other.example.com"),
    ).toThrow(/UNIQUE constraint failed/);
  });
});
