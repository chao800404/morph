import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { inventoryDal } from "./inventory.dal";

let sqlite: Database.Database;
let beforeBatch: (() => void) | undefined;

vi.mock("@/db", () => ({ getDb: vi.fn() }));
vi.mock("cloudflare:workers", () => ({
  env: {
    DATABASE: {
      prepare: (query: string) => ({
        bind: (...values: unknown[]) => ({
          run: () => {
            const statement = sqlite.prepare(query);
            const parameters = Object.fromEntries(
              values.map((value, index) => [String(index + 1), value]),
            );
            return /^\s*SELECT\b/i.test(query)
              ? statement.all(parameters)
              : statement.run(parameters);
          },
        }),
      }),
      batch: async (statements: Array<{ run: () => unknown }>) => {
        beforeBatch?.();
        beforeBatch = undefined;
        return sqlite.transaction(() =>
          statements.map((statement) => statement.run()),
        )();
      },
    },
  },
}));

const timestamp = "2026-09-01T00:00:00.000Z";
const locationA = "location-a";
const locationB = "location-b";

const runBatch = (input: {
  creates?: Array<{
    inventoryItemId: string;
    locationId: string;
    stockedQuantity: number;
    incomingQuantity: number;
  }>;
  updates?: Array<{
    id: string;
    inventoryItemId?: string;
    locationId?: string;
    stockedQuantity?: number;
    incomingQuantity?: number;
  }>;
  deleteIds?: string[];
  force?: boolean;
}) =>
  inventoryDal.batchLocationLevels({
    creates: input.creates ?? [],
    updates: input.updates ?? [],
    deleteIds: input.deleteIds ?? [],
    force: input.force ?? false,
  });

beforeEach(() => {
  beforeBatch = undefined;
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE inventory_items (
      id text PRIMARY KEY, sku text, title text, description text, thumbnail text,
      unit_of_measure text, requires_shipping integer, weight real, length real,
      height real, width real, origin_country text, hs_code text, mid_code text,
      material text, metadata text, created_at text NOT NULL, updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE stock_locations (
      id text PRIMARY KEY, name text NOT NULL, address_id text, metadata text,
      created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
    );
    CREATE TABLE inventory_levels (
      id text PRIMARY KEY, inventory_item_id text NOT NULL, location_id text NOT NULL,
      stocked_quantity real NOT NULL, reserved_quantity real NOT NULL,
      incoming_quantity real NOT NULL, metadata text, created_at text NOT NULL,
      updated_at text NOT NULL, deleted_at text
    );
    CREATE UNIQUE INDEX inventory_levels_item_location_unique
      ON inventory_levels(inventory_item_id, location_id) WHERE deleted_at IS NULL;
    CREATE TABLE reservation_items (
      id text PRIMARY KEY, inventory_item_id text, location_id text, deleted_at text
    );
    INSERT INTO inventory_items (id, title, created_at, updated_at)
      VALUES ('item-a', 'A', '${timestamp}', '${timestamp}'),
             ('item-b', 'B', '${timestamp}', '${timestamp}');
    INSERT INTO stock_locations (id, name, created_at, updated_at)
      VALUES ('${locationA}', 'A', '${timestamp}', '${timestamp}'),
             ('${locationB}', 'B', '${timestamp}', '${timestamp}');
    INSERT INTO inventory_levels (
      id, inventory_item_id, location_id, stocked_quantity, reserved_quantity,
      incoming_quantity, metadata, created_at, updated_at
    ) VALUES
      ('level-stock', 'item-a', '${locationA}', 10, 2, 1, '{}', '${timestamp}', '${timestamp}'),
      ('level-empty', 'item-b', '${locationA}', 0, 0, 0, '{}', '${timestamp}', '${timestamp}');
  `);
  vi.mocked(getDb).mockResolvedValue(drizzle(sqlite) as never);
});

afterEach(() => sqlite.close());

describe("inventory location level batch DAL", () => {
  it("creates, updates, and deletes levels as one atomic batch", async () => {
    expect(
      await runBatch({
        creates: [
          {
            inventoryItemId: "item-a",
            locationId: locationB,
            stockedQuantity: 5,
            incomingQuantity: 2,
          },
        ],
        updates: [
          { id: "level-stock", stockedQuantity: 8, incomingQuantity: 4 },
        ],
        deleteIds: ["level-empty"],
      }),
    ).toBe("updated");
    expect(
      sqlite
        .prepare(
          "SELECT stocked_quantity, incoming_quantity FROM inventory_levels WHERE id = 'level-stock'",
        )
        .get(),
    ).toEqual({ stocked_quantity: 8, incoming_quantity: 4 });
    expect(
      sqlite
        .prepare(
          "SELECT stocked_quantity, incoming_quantity, deleted_at FROM inventory_levels WHERE inventory_item_id = 'item-a' AND location_id = ?",
        )
        .get(locationB),
    ).toMatchObject({
      stocked_quantity: 5,
      incoming_quantity: 2,
      deleted_at: null,
    });
    expect(
      sqlite
        .prepare(
          "SELECT deleted_at FROM inventory_levels WHERE id = 'level-empty'",
        )
        .get(),
    ).not.toEqual({ deleted_at: null });
  });

  it("lets force bypass stocked quantity but still protects active reservations", async () => {
    sqlite.exec(
      "UPDATE inventory_levels SET reserved_quantity = 0, incoming_quantity = 0 WHERE id = 'level-stock'",
    );
    expect(await runBatch({ deleteIds: ["level-stock"], force: true })).toBe(
      "updated",
    );
    sqlite.exec(`
      INSERT INTO inventory_levels (
        id, inventory_item_id, location_id, stocked_quantity, reserved_quantity,
        incoming_quantity, metadata, created_at, updated_at
      ) VALUES ('level-reserved', 'item-a', '${locationB}', 0, 0, 0, '{}', '${timestamp}', '${timestamp}');
      INSERT INTO reservation_items (id, inventory_item_id, location_id)
        VALUES ('reservation-a', 'item-a', '${locationB}');
    `);
    expect(await runBatch({ deleteIds: ["level-reserved"], force: true })).toBe(
      "in-use",
    );
    expect(
      sqlite
        .prepare(
          "SELECT deleted_at FROM inventory_levels WHERE id = 'level-reserved'",
        )
        .get(),
    ).toEqual({ deleted_at: null });
  });

  it("rolls back creates if any update in the same batch fails", async () => {
    sqlite.exec(`
      CREATE TRIGGER fail_level_update BEFORE UPDATE ON inventory_levels
      WHEN OLD.id = 'level-stock'
      BEGIN SELECT RAISE(ABORT, 'injected update failure'); END;
    `);
    await expect(
      runBatch({
        creates: [
          {
            inventoryItemId: "item-a",
            locationId: locationB,
            stockedQuantity: 3,
            incomingQuantity: 0,
          },
        ],
        updates: [{ id: "level-stock", stockedQuantity: 7 }],
      }),
    ).rejects.toThrow("injected update failure");
    expect(
      sqlite
        .prepare(
          "SELECT id FROM inventory_levels WHERE inventory_item_id = 'item-a' AND location_id = ? AND deleted_at IS NULL",
        )
        .get(locationB),
    ).toBeUndefined();
    expect(
      sqlite
        .prepare(
          "SELECT stocked_quantity FROM inventory_levels WHERE id = 'level-stock'",
        )
        .get(),
    ).toEqual({ stocked_quantity: 10 });
  });

  it("rechecks reserved quantity at the atomic write boundary", async () => {
    beforeBatch = () =>
      sqlite.exec(
        "UPDATE inventory_levels SET reserved_quantity = 9 WHERE id = 'level-stock'",
      );
    expect(
      await runBatch({
        updates: [{ id: "level-stock", stockedQuantity: 8 }],
      }),
    ).toBe("conflict");
    expect(
      sqlite
        .prepare(
          "SELECT stocked_quantity, reserved_quantity FROM inventory_levels WHERE id = 'level-stock'",
        )
        .get(),
    ).toEqual({ stocked_quantity: 10, reserved_quantity: 9 });
  });
});
