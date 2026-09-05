import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { cartReservationDal } from "./cart-reservation.dal";

let sqlite: Database.Database;
let beforeBatch: (() => void) | undefined;
vi.mock("@/db", () => ({ getDb: vi.fn() }));
vi.mock("cloudflare:workers", () => ({
  env: {
    DATABASE: {
      prepare: (query: string) => ({
        bind: (...values: unknown[]) => ({
          run: () => {
            const result = sqlite
              .prepare(query)
              .run(
                Object.fromEntries(
                  values.map((value, i) => [String(i + 1), value]),
                ),
              );
            return { meta: { changes: result.changes } };
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

beforeEach(() => {
  beforeBatch = undefined;
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE reservation_items (id text, inventory_item_id text, location_id text, cart_id text, line_item_id text,
      quantity integer, allow_backorder integer, description text, external_id text, created_by text, expires_at text,
      metadata text, created_at text, updated_at text, deleted_at text);
    CREATE TABLE inventory_levels (inventory_item_id text, location_id text, reserved_quantity integer, updated_at text, deleted_at text,
      id text, stocked_quantity integer DEFAULT 20, incoming_quantity integer DEFAULT 0, metadata text, created_at text);
    CREATE TABLE product_variant_inventory_items (variant_id text, inventory_item_id text, required_quantity integer, created_at text, updated_at text);
    CREATE TABLE sales_channel_stock_locations (sales_channel_id text, stock_location_id text);
    INSERT INTO product_variant_inventory_items VALUES ('v','i',1,NULL,NULL);
    INSERT INTO sales_channel_stock_locations VALUES ('channel','l');
    INSERT INTO reservation_items (id,inventory_item_id,location_id,cart_id,line_item_id,quantity,expires_at)
      VALUES ('r','i','l','c','line',3,'2020-01-01T00:00:00.000Z');
    INSERT INTO inventory_levels (inventory_item_id,location_id,reserved_quantity) VALUES ('i','l',8);
  `);
  vi.mocked(getDb).mockResolvedValue(drizzle(sqlite) as never);
});

describe("actual reservation DAL atomic sync", () => {
  const input = {
    cartId: "c",
    lineItemId: "line",
    variantId: "v",
    salesChannelId: "channel",
    quantity: 6,
    allowBackorder: false,
  };
  beforeEach(() =>
    sqlite.exec(
      "UPDATE reservation_items SET expires_at = '2099-01-01T00:00:00.000Z'",
    ),
  );
  it("replaces the hold and inventory together, including reductions", async () => {
    expect(await cartReservationDal.syncLine(input)).toEqual({
      managed: true,
      success: true,
    });
    expect(quantity()).toBe(11);
    await cartReservationDal.syncLine({ ...input, quantity: 1 });
    expect(quantity()).toBe(6);
  });
  it.each([
    "UPDATE ON inventory_levels",
    "UPDATE ON reservation_items",
    "INSERT ON reservation_items",
  ])("rolls back on %s failure", async (event) => {
    sqlite.exec(
      `CREATE TRIGGER fail_sync BEFORE ${event} BEGIN SELECT RAISE(ABORT, 'injected'); END;`,
    );
    await expect(cartReservationDal.syncLine(input)).rejects.toThrow(
      "injected",
    );
    expect(quantity()).toBe(8);
    expect(
      sqlite
        .prepare(
          "SELECT quantity FROM reservation_items WHERE deleted_at IS NULL",
        )
        .all(),
    ).toEqual([{ quantity: 3 }]);
  });
  it("rejects a changed hold read-set without applying stale deltas", async () => {
    beforeBatch = () =>
      sqlite.exec(
        "UPDATE reservation_items SET quantity = 4; UPDATE inventory_levels SET reserved_quantity = 9",
      );
    expect(await cartReservationDal.syncLine(input)).toEqual({
      managed: true,
      success: false,
    });
    expect(quantity()).toBe(9);
  });
  it("rechecks stock acquired by another cart", async () => {
    beforeBatch = () =>
      sqlite.exec("UPDATE inventory_levels SET reserved_quantity = 19");
    expect(await cartReservationDal.syncLine(input)).toEqual({
      managed: true,
      success: false,
    });
    expect(quantity()).toBe(19);
  });
  it("only one concurrent plan for the same line can win", async () => {
    const results = await Promise.all([
      cartReservationDal.syncLine(input),
      cartReservationDal.syncLine({ ...input, quantity: 7 }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const holds = sqlite
      .prepare(
        "SELECT quantity FROM reservation_items WHERE deleted_at IS NULL",
      )
      .all() as Array<{ quantity: number }>;
    expect(holds).toHaveLength(1);
    expect(quantity()).toBe(5 + (holds[0]?.quantity ?? 0));
  });
});
afterEach(() => sqlite.close());
const quantity = () =>
  (
    sqlite
      .prepare("SELECT reserved_quantity q FROM inventory_levels")
      .get() as { q: number }
  ).q;

describe("actual reservation DAL atomic release", () => {
  it("sweep and remove-line release the same hold once", async () => {
    await Promise.all([
      cartReservationDal.releaseExpired(),
      cartReservationDal.releaseLine("line"),
    ]);
    expect(quantity()).toBe(5);
  });
  it("rechecks a renewal made after selecting expired rows", async () => {
    beforeBatch = () =>
      sqlite.exec(
        "UPDATE reservation_items SET expires_at = '2099-01-01T00:00:00.000Z'",
      );
    await cartReservationDal.releaseExpired();
    expect(quantity()).toBe(8);
  });
  it.each(["inventory_levels", "reservation_items"])(
    "rolls back the entire release on a %s write failure",
    async (table) => {
      sqlite.exec(
        `CREATE TRIGGER fail_write BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'injected'); END;`,
      );
      await expect(cartReservationDal.releaseLine("line")).rejects.toThrow(
        "injected",
      );
      expect(quantity()).toBe(8);
      expect(
        sqlite
          .prepare("SELECT id FROM reservation_items WHERE deleted_at IS NULL")
          .get(),
      ).toBeTruthy();
      sqlite.exec("DROP TRIGGER fail_write");
      await cartReservationDal.releaseExpired();
      expect(quantity()).toBe(5);
    },
  );
});
