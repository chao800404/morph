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
    CREATE TABLE stock_locations (
      id TEXT PRIMARY KEY,
      deleted_at TEXT
    );
    CREATE TABLE fulfillment_providers (
      id TEXT PRIMARY KEY,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE location_fulfillment_providers (
      stock_location_id TEXT NOT NULL,
      fulfillment_provider_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (stock_location_id, fulfillment_provider_id)
    );
    INSERT INTO stock_locations VALUES ('location-1', NULL);
    INSERT INTO stock_locations VALUES ('deleted-location', '2026-01-01T00:00:00.000Z');
    INSERT INTO fulfillment_providers VALUES (
      'manual_manual', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL
    );
    INSERT INTO fulfillment_providers VALUES (
      'disabled_provider', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL
    );
    INSERT INTO location_fulfillment_providers VALUES (
      'location-1', 'manual_manual', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
    INSERT INTO location_fulfillment_providers VALUES (
      'location-1', 'disabled_provider', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `);
  vi.mocked(getDb).mockResolvedValue(createDatabase() as never);
});

afterEach(() => sqlite.close());

const assignedProviderIds = (locationId: string) =>
  sqlite
    .prepare(
      "SELECT fulfillment_provider_id FROM location_fulfillment_providers WHERE stock_location_id = ? ORDER BY fulfillment_provider_id",
    )
    .all(locationId);

describe("stock location fulfillment provider DAL", () => {
  it("adds and removes only requested provider links in one logical batch", async () => {
    await stockLocationDal.batchFulfillmentProviderIds("location-1", {
      add: ["parcel_parcel"],
      remove: ["manual_manual"],
    });

    expect(assignedProviderIds("location-1")).toEqual([
      { fulfillment_provider_id: "disabled_provider" },
      { fulfillment_provider_id: "parcel_parcel" },
    ]);
    expect(
      sqlite
        .prepare("SELECT is_enabled FROM fulfillment_providers WHERE id = ?")
        .get("parcel_parcel"),
    ).toEqual({ is_enabled: 1 });
  });

  it("rolls back provider registration and links when the location is inactive", async () => {
    await expect(
      stockLocationDal.batchFulfillmentProviderIds("deleted-location", {
        add: ["parcel_parcel"],
        remove: [],
      }),
    ).rejects.toThrow();

    expect(
      sqlite
        .prepare("SELECT id FROM fulfillment_providers WHERE id = ?")
        .get("parcel_parcel"),
    ).toBeUndefined();
    expect(assignedProviderIds("deleted-location")).toEqual([]);
  });

  it("does not change unrelated location assignments", async () => {
    sqlite.exec(
      "INSERT INTO stock_locations VALUES ('location-2', NULL); INSERT INTO location_fulfillment_providers VALUES ('location-2', 'manual_manual', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');",
    );

    await stockLocationDal.batchFulfillmentProviderIds("location-1", {
      add: [],
      remove: ["manual_manual"],
    });

    expect(assignedProviderIds("location-2")).toEqual([
      { fulfillment_provider_id: "manual_manual" },
    ]);
  });
});
