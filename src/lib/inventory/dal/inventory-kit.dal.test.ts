import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { inventoryDal } from "./inventory.dal";

let sqlite: Database.Database;

vi.mock("@/db", () => ({ getDb: vi.fn() }));
vi.mock("cloudflare:workers", () => ({
  env: {
    DATABASE: {
      prepare: (query: string) => ({
        bind: (...values: unknown[]) => {
          const parameters = Object.fromEntries(
            values.map((value, index) => [String(index + 1), value]),
          );
          return {
            run: () => {
              const statement = sqlite.prepare(query);
              return /^\s*SELECT\b/i.test(query)
                ? statement.all(parameters)
                : statement.run(parameters);
            },
          };
        },
      }),
      batch: async (statements: Array<{ run: () => unknown }>) =>
        sqlite.transaction(() =>
          statements.map((statement) => statement.run()),
        )(),
    },
  },
}));

const expectedUpdatedAt = "2026-01-01T00:00:00.000Z";

const listLinks = () =>
  sqlite
    .prepare(
      "SELECT inventory_item_id, required_quantity FROM product_variant_inventory_items WHERE variant_id = 'variant-1' ORDER BY inventory_item_id",
    )
    .all();

const replace = (
  items: Array<{ inventoryItemId: string; requiredQuantity: number }>,
) =>
  inventoryDal.replaceVariantKit({
    productId: "product-1",
    variantId: "variant-1",
    expectedUpdatedAt,
    items,
    updatedBy: "admin-1",
  });

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE products (id text PRIMARY KEY, deleted_at text);
    CREATE TABLE product_variants (
      id text PRIMARY KEY, product_id text, updated_at text, updated_by text, deleted_at text
    );
    CREATE TABLE inventory_items (id text PRIMARY KEY, title text, sku text, unit_of_measure text, deleted_at text);
    CREATE TABLE inventory_levels (
      id text PRIMARY KEY, inventory_item_id text, location_id text, stocked_quantity real,
      reserved_quantity real, incoming_quantity real, updated_at text, deleted_at text
    );
    CREATE TABLE product_variant_inventory_items (
      variant_id text, inventory_item_id text, required_quantity real, created_at text, updated_at text,
      PRIMARY KEY (variant_id, inventory_item_id)
    );
    CREATE TABLE reservation_items (id text PRIMARY KEY, cart_id text, line_item_id text, deleted_at text);
    CREATE TABLE cart_line_items (id text PRIMARY KEY, variant_id text, deleted_at text);
    CREATE TABLE order_line_items (id text PRIMARY KEY, variant_id text, deleted_at text);
    INSERT INTO products VALUES ('product-1', NULL);
    INSERT INTO product_variants VALUES ('variant-1', 'product-1', '${expectedUpdatedAt}', 'admin-old', NULL);
    INSERT INTO inventory_items VALUES ('item-a', 'Frame', 'FRAME', 'kg', NULL);
    INSERT INTO inventory_items VALUES ('item-b', 'Wheel', 'WHEEL', 'kg', NULL);
    INSERT INTO inventory_items VALUES ('item-c', 'Seat', 'SEAT', 'kg', NULL);
    INSERT INTO product_variant_inventory_items VALUES ('variant-1', 'item-a', 1, '${expectedUpdatedAt}', '${expectedUpdatedAt}');
    INSERT INTO inventory_levels VALUES ('level-a', 'item-a', 'location-1', 10, 2, 1, '${expectedUpdatedAt}', NULL);
  `);
  vi.mocked(getDb).mockResolvedValue(drizzle(sqlite) as never);
});

describe("variant inventory kit DAL", () => {
  it("replaces all components and advances the variant version in one batch", async () => {
    expect(
      await replace([
        { inventoryItemId: "item-b", requiredQuantity: 2 },
        { inventoryItemId: "item-c", requiredQuantity: 1 },
      ]),
    ).toBe("updated");
    expect(listLinks()).toEqual([
      { inventory_item_id: "item-b", required_quantity: 2 },
      { inventory_item_id: "item-c", required_quantity: 1 },
    ]);
    expect(
      sqlite
        .prepare(
          "SELECT updated_by FROM product_variants WHERE id = 'variant-1'",
        )
        .get(),
    ).toEqual({ updated_by: "admin-1" });
    expect(
      sqlite
        .prepare(
          "SELECT updated_at FROM product_variants WHERE id = 'variant-1'",
        )
        .get(),
    ).not.toEqual({ updated_at: expectedUpdatedAt });
  });

  it("persists fractional inventory consumption per variant unit", async () => {
    expect(
      await replace([{ inventoryItemId: "item-b", requiredQuantity: 0.375 }]),
    ).toBe("updated");
    expect(
      sqlite
        .prepare(
          "SELECT required_quantity FROM product_variant_inventory_items WHERE variant_id = 'variant-1' AND inventory_item_id = 'item-b'",
        )
        .get(),
    ).toEqual({ required_quantity: 0.375 });
  });

  it.each([
    {
      name: "cart",
      insert: `INSERT INTO cart_line_items VALUES ('cart-line-1', 'variant-1', NULL);
        INSERT INTO reservation_items VALUES ('reservation-1', 'cart-1', 'cart-line-1', NULL);`,
    },
    {
      name: "unfulfilled order",
      insert: `INSERT INTO order_line_items VALUES ('order-line-1', 'variant-1', NULL);
        INSERT INTO reservation_items VALUES ('reservation-1', NULL, 'order-line-1', NULL);`,
    },
  ])(
    "protects the existing kit while a $name reservation is active",
    async ({ insert }) => {
      sqlite.exec(insert);
      expect(
        await replace([{ inventoryItemId: "item-b", requiredQuantity: 2 }]),
      ).toBe("active-reservations");
      expect(listLinks()).toEqual([
        { inventory_item_id: "item-a", required_quantity: 1 },
      ]);
      expect(
        sqlite
          .prepare(
            "SELECT updated_at FROM product_variants WHERE id = 'variant-1'",
          )
          .get(),
      ).toEqual({ updated_at: expectedUpdatedAt });
    },
  );

  it("rejects a stale editor without replacing the current associations", async () => {
    expect(
      await inventoryDal.replaceVariantKit({
        productId: "product-1",
        variantId: "variant-1",
        expectedUpdatedAt: "2025-12-31T00:00:00.000Z",
        items: [{ inventoryItemId: "item-b", requiredQuantity: 2 }],
        updatedBy: "admin-1",
      }),
    ).toBe("conflict");
    expect(listLinks()).toEqual([
      { inventory_item_id: "item-a", required_quantity: 1 },
    ]);
  });

  it("replaces multiple variant kits atomically in one D1 batch", async () => {
    sqlite.exec(
      `INSERT INTO product_variants VALUES ('variant-2', 'product-1', '${expectedUpdatedAt}', 'admin-old', NULL);
       INSERT INTO product_variant_inventory_items VALUES ('variant-2', 'item-c', 1, '${expectedUpdatedAt}', '${expectedUpdatedAt}');`,
    );
    expect(
      await inventoryDal.replaceVariantKits([
        {
          productId: "product-1",
          variantId: "variant-1",
          expectedUpdatedAt,
          items: [{ inventoryItemId: "item-b", requiredQuantity: 2 }],
          updatedBy: "admin-1",
        },
        {
          productId: "product-1",
          variantId: "variant-2",
          expectedUpdatedAt,
          items: [{ inventoryItemId: "item-a", requiredQuantity: 3 }],
          updatedBy: "admin-1",
        },
      ]),
    ).toBe("updated");
    expect(listLinks()).toEqual([
      { inventory_item_id: "item-b", required_quantity: 2 },
    ]);
    expect(
      sqlite
        .prepare(
          "SELECT inventory_item_id, required_quantity FROM product_variant_inventory_items WHERE variant_id = 'variant-2'",
        )
        .all(),
    ).toEqual([{ inventory_item_id: "item-a", required_quantity: 3 }]);
  });

  it("keeps every kit unchanged when any variant in the batch has a reservation", async () => {
    sqlite.exec(
      `INSERT INTO product_variants VALUES ('variant-2', 'product-1', '${expectedUpdatedAt}', 'admin-old', NULL);
       INSERT INTO product_variant_inventory_items VALUES ('variant-2', 'item-c', 1, '${expectedUpdatedAt}', '${expectedUpdatedAt}');
       INSERT INTO cart_line_items VALUES ('cart-line-2', 'variant-2', NULL);
       INSERT INTO reservation_items VALUES ('reservation-2', 'cart-2', 'cart-line-2', NULL);`,
    );
    expect(
      await inventoryDal.replaceVariantKits([
        {
          productId: "product-1",
          variantId: "variant-1",
          expectedUpdatedAt,
          items: [{ inventoryItemId: "item-b", requiredQuantity: 2 }],
          updatedBy: "admin-1",
        },
        {
          productId: "product-1",
          variantId: "variant-2",
          expectedUpdatedAt,
          items: [{ inventoryItemId: "item-a", requiredQuantity: 3 }],
          updatedBy: "admin-1",
        },
      ]),
    ).toBe("active-reservations");
    expect(listLinks()).toEqual([
      { inventory_item_id: "item-a", required_quantity: 1 },
    ]);
    expect(
      sqlite
        .prepare(
          "SELECT inventory_item_id, required_quantity FROM product_variant_inventory_items WHERE variant_id = 'variant-2'",
        )
        .all(),
    ).toEqual([{ inventory_item_id: "item-c", required_quantity: 1 }]);
  });

  it("rolls back the delete if inserting a kit component fails", async () => {
    sqlite.exec(
      "CREATE TRIGGER fail_kit_insert BEFORE INSERT ON product_variant_inventory_items BEGIN SELECT RAISE(ABORT, 'injected kit failure'); END;",
    );
    await expect(
      replace([{ inventoryItemId: "item-b", requiredQuantity: 2 }]),
    ).rejects.toThrow("injected kit failure");
    expect(listLinks()).toEqual([
      { inventory_item_id: "item-a", required_quantity: 1 },
    ]);
    expect(
      sqlite
        .prepare(
          "SELECT updated_at FROM product_variants WHERE id = 'variant-1'",
        )
        .get(),
    ).toEqual({ updated_at: expectedUpdatedAt });
  });

  it("reports stock by item while preserving each required quantity", async () => {
    const items = await inventoryDal.listVariantKit("variant-1");
    expect(items).toEqual([
      {
        inventoryItemId: "item-a",
        title: "Frame",
        sku: "FRAME",
        unitOfMeasure: "kg",
        requiredQuantity: 1,
        stockedQuantity: 10,
        reservedQuantity: 2,
        incomingQuantity: 1,
        availableQuantity: 8,
      },
    ]);
  });
});
