import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { stockLocationDal } from "./stock-location.dal";

let sqlite: Database.Database;

vi.mock("@/db", () => ({ getDb: vi.fn() }));

const createDatabase = () => {
  const database = drizzle(sqlite);
  return Object.assign(database, {
    batch: async (statements: Array<{ run: () => unknown }>) =>
      sqlite.transaction(() =>
        statements.map((statement) => statement.run()),
      )(),
  });
};

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE stock_location_addresses (
      id TEXT PRIMARY KEY,
      address_1 TEXT NOT NULL,
      address_2 TEXT,
      company TEXT,
      city TEXT,
      country_code TEXT NOT NULL,
      province TEXT,
      postal_code TEXT,
      phone TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE stock_locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE UNIQUE INDEX stock_locations_active_name_unique
      ON stock_locations(name) WHERE deleted_at IS NULL;
    CREATE TABLE sales_channel_stock_locations (
      sales_channel_id TEXT NOT NULL,
      stock_location_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (sales_channel_id, stock_location_id)
    );
    CREATE TABLE sales_channels (
      id TEXT PRIMARY KEY,
      deleted_at TEXT
    );
    CREATE TABLE location_fulfillment_providers (
      stock_location_id TEXT NOT NULL,
      fulfillment_provider_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (stock_location_id, fulfillment_provider_id)
    );
    CREATE TABLE location_fulfillment_sets (
      stock_location_id TEXT NOT NULL,
      fulfillment_set_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (stock_location_id, fulfillment_set_id)
    );
    CREATE TABLE fulfillment_sets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE UNIQUE INDEX fulfillment_sets_active_name_unique
      ON fulfillment_sets(name) WHERE deleted_at IS NULL;
    CREATE TABLE service_zones (
      id TEXT PRIMARY KEY,
      fulfillment_set_id TEXT NOT NULL,
      name TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE geo_zones (
      id TEXT PRIMARY KEY,
      service_zone_id TEXT NOT NULL,
      type TEXT NOT NULL,
      country_code TEXT NOT NULL,
      province_code TEXT,
      city TEXT,
      postal_expression TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE shipping_options (
      id TEXT PRIMARY KEY,
      service_zone_id TEXT NOT NULL,
      shipping_profile_id TEXT,
      provider_id TEXT,
      shipping_option_type_id TEXT,
      name TEXT NOT NULL,
      price_type TEXT NOT NULL,
      data TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE shipping_option_rules (
      id TEXT PRIMARY KEY,
      shipping_option_id TEXT NOT NULL,
      attribute TEXT NOT NULL,
      operator TEXT NOT NULL,
      value TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE shipping_option_price_sets (
      shipping_option_id TEXT NOT NULL,
      price_set_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (shipping_option_id, price_set_id)
    );
    CREATE TABLE carts (
      id TEXT PRIMARY KEY,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE cart_shipping_methods (
      id TEXT PRIMARY KEY,
      cart_id TEXT NOT NULL,
      shipping_option_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
  `);
  vi.mocked(getDb).mockResolvedValue(createDatabase() as never);
});

afterEach(() => sqlite.close());

const insertLocation = (
  id: string,
  name: string,
  deletedAt: string | null = null,
) =>
  sqlite
    .prepare(
      "INSERT INTO stock_locations (id, name, metadata, created_at, updated_at, deleted_at) VALUES (?, ?, '{}', ?, ?, ?)",
    )
    .run(
      id,
      name,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      deletedAt,
    );

describe("stock location aggregate writes", () => {
  it("creates the address and location atomically and preserves metadata", async () => {
    await stockLocationDal.create({
      id: "location-1",
      name: "Taipei Warehouse",
      metadata: { region: "north" },
      address: {
        address1: "No. 1, Section 1",
        countryCode: "tw",
        metadata: { source: "erp" },
      },
    });

    const location = await stockLocationDal.findById("location-1");
    expect(location).toMatchObject({
      id: "location-1",
      metadata: { region: "north" },
      address: {
        address1: "No. 1, Section 1",
        countryCode: "tw",
        metadata: { source: "erp" },
      },
    });
  });

  it("rolls back a newly inserted address when the location name conflicts", async () => {
    insertLocation("existing-location", "Taipei Warehouse");

    await expect(
      stockLocationDal.create({
        id: "new-location",
        name: "Taipei Warehouse",
        address: {
          address1: "No. 2",
          countryCode: "tw",
        },
      }),
    ).rejects.toThrow();

    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM stock_location_addresses")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("updates the address and location together and rejects a stale revision", async () => {
    await stockLocationDal.create({
      id: "location-1",
      name: "Old Name",
      address: {
        address1: "Old Street",
        countryCode: "tw",
        metadata: { source: "manual" },
      },
    });
    const existing = await stockLocationDal.findById("location-1");
    expect(existing).not.toBeNull();
    if (!existing) throw new Error("Fixture location was not created");

    const updated = await stockLocationDal.update(
      existing.id,
      {
        name: "New Name",
        address: {
          address1: "New Street",
          countryCode: "tw",
          metadata: { source: "erp" },
        },
      },
      existing.updatedAt.toISOString(),
    );
    const afterUpdate = await stockLocationDal.findById("location-1");
    const stale = await stockLocationDal.update(
      existing.id,
      { name: "Stale Name" },
      existing.updatedAt.toISOString(),
    );

    expect(updated).toBe(true);
    expect(afterUpdate).toMatchObject({
      name: "New Name",
      address: { address1: "New Street", metadata: { source: "erp" } },
    });
    expect(stale).toBe(false);
    expect((await stockLocationDal.findById("location-1"))?.name).toBe(
      "New Name",
    );
  });

  it("atomically removes every location-owned link when soft deleting", async () => {
    insertLocation("location-1", "To Delete");
    insertLocation("location-2", "Already Deleted", "2026-01-02T00:00:00.000Z");
    sqlite.exec(`
      INSERT INTO sales_channel_stock_locations VALUES ('channel-1', 'location-1', 'now', 'now');
      INSERT INTO location_fulfillment_providers VALUES ('location-1', 'manual_manual', 'now', 'now');
      INSERT INTO location_fulfillment_sets VALUES ('location-1', 'set-1', 'now', 'now');
    `);

    await expect(
      stockLocationDal.softDelete(["location-1", "location-2"]),
    ).rejects.toThrow();
    expect(
      sqlite
        .prepare(
          "SELECT deleted_at FROM stock_locations WHERE id = 'location-1'",
        )
        .get(),
    ).toEqual({ deleted_at: null });
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM location_fulfillment_sets")
        .get(),
    ).toEqual({ count: 1 });

    await stockLocationDal.softDelete(["location-1"]);
    expect(
      sqlite
        .prepare(
          "SELECT deleted_at FROM stock_locations WHERE id = 'location-1'",
        )
        .get(),
    ).not.toEqual({ deleted_at: null });
    for (const table of [
      "sales_channel_stock_locations",
      "location_fulfillment_providers",
      "location_fulfillment_sets",
    ]) {
      expect(
        sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(),
      ).toEqual({
        count: 0,
      });
    }
  });

  it("soft deletes an exclusive location shipping configuration and detaches prices", async () => {
    insertLocation("location-1", "To Delete");
    sqlite.exec(`
      INSERT INTO location_fulfillment_sets VALUES ('location-1', 'set-1', 'now', 'now');
      INSERT INTO fulfillment_sets VALUES ('set-1', 'Shipping', 'shipping', '{}', 'now', 'now', NULL);
      INSERT INTO service_zones VALUES ('zone-1', 'set-1', 'Taiwan', '{}', 'now', 'now', NULL);
      INSERT INTO geo_zones VALUES ('geo-1', 'zone-1', 'country', 'tw', NULL, NULL, NULL, '{}', 'now', 'now', NULL);
      INSERT INTO shipping_options VALUES ('option-1', 'zone-1', NULL, NULL, NULL, 'Standard', 'flat', '{}', '{}', 'now', 'now', NULL);
      INSERT INTO shipping_option_rules VALUES ('rule-1', 'option-1', 'total', 'gte', '100', 'now', 'now', NULL);
      INSERT INTO shipping_option_price_sets VALUES ('option-1', 'price-set-1', 'now', 'now');
    `);

    await stockLocationDal.softDelete(["location-1"]);

    for (const table of [
      "fulfillment_sets",
      "service_zones",
      "geo_zones",
      "shipping_options",
      "shipping_option_rules",
    ]) {
      expect(
        sqlite
          .prepare(`SELECT deleted_at FROM ${table} WHERE id = ?`)
          .get(
            table === "fulfillment_sets"
              ? "set-1"
              : table === "service_zones"
                ? "zone-1"
                : table === "geo_zones"
                  ? "geo-1"
                  : table === "shipping_options"
                    ? "option-1"
                    : "rule-1",
          ),
      ).not.toEqual({ deleted_at: null });
    }
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM shipping_option_price_sets")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("preserves fulfillment sets and shipping options shared by another location", async () => {
    insertLocation("location-1", "To Delete");
    insertLocation("location-2", "Keep");
    sqlite.exec(`
      INSERT INTO location_fulfillment_sets VALUES ('location-1', 'set-1', 'now', 'now');
      INSERT INTO location_fulfillment_sets VALUES ('location-2', 'set-1', 'now', 'now');
      INSERT INTO fulfillment_sets VALUES ('set-1', 'Shared Shipping', 'shipping', '{}', 'now', 'now', NULL);
      INSERT INTO service_zones VALUES ('zone-1', 'set-1', 'Taiwan', '{}', 'now', 'now', NULL);
      INSERT INTO shipping_options VALUES ('option-1', 'zone-1', NULL, NULL, NULL, 'Standard', 'flat', '{}', '{}', 'now', 'now', NULL);
    `);

    await stockLocationDal.softDelete(["location-1"]);

    expect(
      sqlite
        .prepare("SELECT deleted_at FROM fulfillment_sets WHERE id = 'set-1'")
        .get(),
    ).toEqual({ deleted_at: null });
    expect(
      sqlite
        .prepare(
          "SELECT deleted_at FROM shipping_options WHERE id = 'option-1'",
        )
        .get(),
    ).toEqual({ deleted_at: null });
    expect(
      sqlite
        .prepare(
          "SELECT stock_location_id FROM location_fulfillment_sets WHERE fulfillment_set_id = 'set-1'",
        )
        .all(),
    ).toEqual([{ stock_location_id: "location-2" }]);
  });

  it("applies sales-channel add/remove links atomically and preserves other links", async () => {
    insertLocation("location-1", "Main Warehouse");
    sqlite.exec(`
      INSERT INTO sales_channels VALUES ('channel-1', NULL);
      INSERT INTO sales_channels VALUES ('channel-2', NULL);
      INSERT INTO sales_channels VALUES ('channel-3', NULL);
      INSERT INTO sales_channel_stock_locations VALUES ('channel-1', 'location-1', 'now', 'now');
      INSERT INTO sales_channel_stock_locations VALUES ('channel-2', 'location-1', 'now', 'now');
    `);

    const updated = await stockLocationDal.batchChannels(
      "location-1",
      ["channel-3"],
      ["channel-1"],
    );

    expect(updated).toBe(true);
    expect(
      sqlite
        .prepare(
          "SELECT sales_channel_id FROM sales_channel_stock_locations WHERE stock_location_id = 'location-1' ORDER BY sales_channel_id",
        )
        .all(),
    ).toEqual([
      { sales_channel_id: "channel-2" },
      { sales_channel_id: "channel-3" },
    ]);
    await expect(
      stockLocationDal.batchChannels("location-1", ["missing"], ["channel-2"]),
    ).resolves.toBe(false);
    expect(
      sqlite
        .prepare(
          "SELECT sales_channel_id FROM sales_channel_stock_locations WHERE stock_location_id = 'location-1' ORDER BY sales_channel_id",
        )
        .all(),
    ).toEqual([
      { sales_channel_id: "channel-2" },
      { sales_channel_id: "channel-3" },
    ]);
  });

  it("creates and lists a location fulfillment set as one aggregate write", async () => {
    insertLocation("location-1", "Main Warehouse");

    await expect(
      stockLocationDal.createFulfillmentSet({
        id: "set-1",
        locationId: "location-1",
        name: "Taiwan delivery",
        type: "shipping",
        metadata: { source: "manual" },
      }),
    ).resolves.toBe(true);

    await expect(
      stockLocationDal.listFulfillmentSets("location-1"),
    ).resolves.toMatchObject([
      {
        id: "set-1",
        name: "Taiwan delivery",
        type: "shipping",
        metadata: { source: "manual" },
      },
    ]);
    expect(
      sqlite
        .prepare("SELECT fulfillment_set_id FROM location_fulfillment_sets")
        .all(),
    ).toEqual([{ fulfillment_set_id: "set-1" }]);
  });

  it("rolls back a duplicate fulfillment set and refuses a missing location", async () => {
    insertLocation("location-1", "Main Warehouse");
    sqlite.exec(`
      INSERT INTO fulfillment_sets VALUES ('set-1', 'Taiwan delivery', 'shipping', '{}', 'now', 'now', NULL);
    `);

    await expect(
      stockLocationDal.createFulfillmentSet({
        id: "set-2",
        locationId: "location-1",
        name: "Taiwan delivery",
        type: "pickup",
      }),
    ).rejects.toThrow();
    await expect(
      stockLocationDal.createFulfillmentSet({
        id: "set-3",
        locationId: "missing-location",
        name: "Pickup",
        type: "pickup",
      }),
    ).resolves.toBe(false);

    expect(
      sqlite.prepare("SELECT id FROM fulfillment_sets ORDER BY id").all(),
    ).toEqual([{ id: "set-1" }]);
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM location_fulfillment_sets")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("keeps the location when its shipping option is selected in an active cart", async () => {
    insertLocation("location-1", "In Use");
    sqlite.exec(`
      INSERT INTO location_fulfillment_sets VALUES ('location-1', 'set-1', 'now', 'now');
      INSERT INTO fulfillment_sets VALUES ('set-1', 'Shipping', 'shipping', '{}', 'now', 'now', NULL);
      INSERT INTO service_zones VALUES ('zone-1', 'set-1', 'Taiwan', '{}', 'now', 'now', NULL);
      INSERT INTO shipping_options VALUES ('option-1', 'zone-1', NULL, NULL, NULL, 'Standard', 'flat', '{}', '{}', 'now', 'now', NULL);
      INSERT INTO carts VALUES ('cart-1', NULL, 'now', 'now', NULL);
      INSERT INTO cart_shipping_methods VALUES ('method-1', 'cart-1', 'option-1', 'now', 'now', NULL);
    `);

    await expect(stockLocationDal.softDelete(["location-1"])).rejects.toThrow(
      "Shipping options for this location are selected in active carts",
    );
    expect(
      sqlite
        .prepare(
          "SELECT deleted_at FROM stock_locations WHERE id = 'location-1'",
        )
        .get(),
    ).toEqual({ deleted_at: null });
    expect(
      sqlite
        .prepare(
          "SELECT deleted_at FROM shipping_options WHERE id = 'option-1'",
        )
        .get(),
    ).toEqual({ deleted_at: null });
  });
});
