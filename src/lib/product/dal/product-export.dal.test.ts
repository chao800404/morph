import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import type { ProductListItemDTO } from "../dto/product.dto";
import { productDal } from "./product.dal";
import { productExportDal } from "./product-export.dal";

let sqlite: Database.Database;

vi.mock("@/db", () => ({ getDb: vi.fn() }));
vi.mock("./product.dal", () => ({
  productDal: { listPage: vi.fn() },
}));

const product: ProductListItemDTO = {
  id: "product-1",
  title: "Mug",
  handle: "mug",
  subtitle: null,
  description: "Ceramic mug",
  status: "published",
  collectionId: null,
  typeId: null,
  discountable: true,
  thumbnailAssetId: "asset-product",
  weight: 200,
  length: null,
  width: null,
  height: null,
  originCountry: "TW",
  hsCode: null,
  midCode: null,
  material: "ceramic",
  metadata: { source: "test" },
  createdBy: "admin-1",
  updatedBy: "admin-1",
  createdAt: new Date("2026-09-28T00:00:00.000Z"),
  updatedAt: new Date("2026-09-28T00:00:00.000Z"),
  thumbnailUrl: "https://assets.test/mug.jpg",
  collectionTitle: null,
  typeValue: null,
  salesChannels: [],
  variantCount: 1,
};

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE product_variants (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL, title TEXT NOT NULL, sku TEXT, barcode TEXT,
      ean TEXT, upc TEXT, rank INTEGER NOT NULL, manage_inventory INTEGER NOT NULL,
      allow_backorder INTEGER NOT NULL, inventory_quantity INTEGER NOT NULL, weight REAL,
      length REAL, width REAL, height REAL, origin_country TEXT, hs_code TEXT, mid_code TEXT,
      material TEXT, thumbnail_asset_id TEXT, metadata TEXT, created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE product_variant_option_values (variant_id TEXT, option_value_id TEXT);
    CREATE TABLE product_option_values (id TEXT, option_id TEXT, value TEXT, rank INTEGER, deleted_at TEXT);
    CREATE TABLE product_options (id TEXT, title TEXT, rank INTEGER, deleted_at TEXT);
    CREATE TABLE product_variant_price_sets (variant_id TEXT, price_set_id TEXT);
    CREATE TABLE price_sets (id TEXT, deleted_at TEXT);
    CREATE TABLE prices (
      id TEXT, price_set_id TEXT, price_list_id TEXT, min_quantity INTEGER, max_quantity INTEGER,
      rules_count INTEGER, deleted_at TEXT, currency_code TEXT, amount INTEGER
    );
    CREATE TABLE product_variant_prices (variant_id TEXT, currency_code TEXT, amount INTEGER);
    CREATE TABLE product_variant_assets (variant_id TEXT, asset_id TEXT, rank INTEGER);
    CREATE TABLE assets (id TEXT, url TEXT, deleted_at TEXT);
    CREATE TABLE product_variant_inventory_items (variant_id TEXT, inventory_item_id TEXT, required_quantity REAL);
    CREATE TABLE inventory_items (id TEXT, title TEXT, sku TEXT, unit_of_measure TEXT, deleted_at TEXT);
    CREATE TABLE product_assets (product_id TEXT, asset_id TEXT, rank INTEGER);
    CREATE TABLE product_tag_links (product_id TEXT, tag_id TEXT);
    CREATE TABLE product_tags (id TEXT, value TEXT, deleted_at TEXT);
    CREATE TABLE product_category_links (product_id TEXT, category_id TEXT);
    CREATE TABLE product_categories (id TEXT, name TEXT, deleted_at TEXT);

    INSERT INTO product_variants VALUES (
      'variant-1', 'product-1', 'Large', 'MUG-L', 'BAR-1', 'EAN-1', 'UPC-1', 0, 1, 0, 5,
      300, 10, 11, 12, 'TW', 'HS-1', 'MID-1', 'stoneware', NULL, '{"finish":"matte"}',
      'admin-1', 'admin-1', '2026-09-28T00:00:00.000Z', '2026-09-28T00:00:00.000Z', NULL
    );
    INSERT INTO product_variant_option_values VALUES ('variant-1', 'option-value-1');
    INSERT INTO product_option_values VALUES ('option-value-1', 'option-1', 'Large', 0, NULL);
    INSERT INTO product_options VALUES ('option-1', 'Size', 0, NULL);
    INSERT INTO product_variant_price_sets VALUES ('variant-1', 'price-set-1');
    INSERT INTO price_sets VALUES ('price-set-1', NULL);
    INSERT INTO prices VALUES ('normalized-1', 'price-set-1', NULL, NULL, NULL, 0, NULL, 'twd', 32000);
    INSERT INTO product_variant_prices VALUES ('variant-1', 'twd', 10000);
    INSERT INTO product_variant_prices VALUES ('variant-1', 'usd', 900);
    INSERT INTO assets VALUES ('asset-product', 'https://assets.test/mug.jpg', NULL);
    INSERT INTO assets VALUES ('asset-variant', 'https://assets.test/mug-large.jpg', NULL);
    INSERT INTO product_assets VALUES ('product-1', 'asset-product', 0);
    INSERT INTO product_variant_assets VALUES ('variant-1', 'asset-variant', 0);
    INSERT INTO product_variant_inventory_items VALUES ('variant-1', 'item-1', 2);
    INSERT INTO inventory_items VALUES ('item-1', 'Clay', 'CLAY', 'kg', NULL);
    INSERT INTO product_tag_links VALUES ('product-1', 'tag-1');
    INSERT INTO product_tags VALUES ('tag-1', 'drinkware', NULL);
    INSERT INTO product_category_links VALUES ('product-1', 'category-1');
    INSERT INTO product_categories VALUES ('category-1', 'Kitchen', NULL);
  `);
  vi.mocked(getDb).mockResolvedValue(drizzle(sqlite) as never);
  vi.mocked(productDal.listPage).mockResolvedValue({
    products: [product],
    total: 1,
  });
});

afterEach(() => sqlite.close());

describe("product export DAL", () => {
  it("returns variants with option labels, current base prices, images, kits, and product labels", async () => {
    const result = await productExportDal.listPage({
      sortBy: "title",
      sortOrder: "asc",
      page: 1,
      limit: 100,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      product,
      imageUrls: ["https://assets.test/mug.jpg"],
      tags: ["drinkware"],
      categories: ["Kitchen"],
      variants: [
        {
          id: "variant-1",
          sku: "MUG-L",
          ean: "EAN-1",
          upc: "UPC-1",
          optionValues: [{ option: "Size", value: "Large" }],
          prices: [
            { currencyCode: "twd", amount: 32000 },
            { currencyCode: "usd", amount: 900 },
          ],
          imageUrls: ["https://assets.test/mug-large.jpg"],
          inventoryKit: [
            {
              inventoryItemId: "item-1",
              title: "Clay",
              requiredQuantity: 2,
            },
          ],
          metadata: { finish: "matte" },
        },
      ],
    });
  });

  it("returns an empty export page without querying child relations", async () => {
    vi.mocked(productDal.listPage).mockResolvedValue({
      products: [],
      total: 0,
    });
    await expect(
      productExportDal.listPage({
        sortBy: "title",
        sortOrder: "asc",
        page: 1,
        limit: 100,
        offset: 0,
      }),
    ).resolves.toEqual({ items: [], total: 0 });
  });
});
