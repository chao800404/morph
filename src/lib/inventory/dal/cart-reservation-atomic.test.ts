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
    CREATE TABLE inventory_levels (inventory_item_id text, location_id text, reserved_quantity integer, updated_at text, deleted_at text);
    INSERT INTO reservation_items (id,inventory_item_id,location_id,cart_id,line_item_id,quantity,expires_at)
      VALUES ('r','i','l','c','line',3,'2020-01-01T00:00:00.000Z');
    INSERT INTO inventory_levels VALUES ('i','l',8,NULL,NULL);
  `);
  vi.mocked(getDb).mockResolvedValue(drizzle(sqlite) as never);
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
