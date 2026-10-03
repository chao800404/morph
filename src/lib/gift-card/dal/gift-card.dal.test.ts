import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { giftCardDal } from "./gift-card.dal";

vi.mock("@/db", () => ({ getDb: vi.fn() }));

let sqlite: Database.Database;

/**
 * better-sqlite3's Drizzle driver has no `batch`. D1's does, and runs the
 * statements atomically, which is what a transaction here stands in for.
 */
function withBatch(db: ReturnType<typeof drizzle>) {
  return Object.assign(db, {
    batch: async (queries: Array<{ all(): unknown; run(): unknown }>) =>
      sqlite.transaction(() =>
        queries.map((query) => {
          try {
            return query.all();
          } catch {
            return query.run();
          }
        }),
      )(),
  });
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE store_credit_accounts (
      id text PRIMARY KEY, customer_id text, code_hash text NOT NULL,
      currency_code text NOT NULL, status text NOT NULL DEFAULT 'active',
      balance integer NOT NULL DEFAULT 0, metadata text, created_by text,
      updated_by text, created_at text NOT NULL, updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE gift_cards (
      id text PRIMARY KEY, store_credit_account_id text NOT NULL,
      code text NOT NULL, code_hash text NOT NULL, value integer NOT NULL,
      currency_code text NOT NULL, status text NOT NULL DEFAULT 'active',
      expires_at text, reference text, reference_id text, line_item_id text,
      note text, created_by text, updated_by text, created_at text NOT NULL,
      updated_at text NOT NULL, deleted_at text
    );
  `);
  vi.mocked(getDb).mockResolvedValue(
    withBatch(drizzle(sqlite, { schema })) as never,
  );
});

afterEach(() => {
  sqlite.close();
});

describe("giftCardDal.updateDetails", () => {
  /**
   * A redemption debits the account and moves its `updated_at`; it never
   * touches the gift card row. The two timestamps therefore diverge after the
   * first use, and an update that required them to match skipped the gift
   * card row while still reporting success — leaving the expiry the order
   * email reads behind the one checkout enforces.
   */
  it("keeps the gift card row in step after a redemption moved the account", async () => {
    sqlite.exec(`
      INSERT INTO store_credit_accounts
        (id, code_hash, currency_code, balance, metadata, created_at, updated_at)
      VALUES
        ('card-1', 'hash-1', 'usd', 400,
         '{"_morph_resource_type":"gift_card","_morph_expires_at":null}',
         '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z');
      INSERT INTO gift_cards
        (id, store_credit_account_id, code, code_hash, value, currency_code,
         created_at, updated_at)
      VALUES
        ('card-1', 'card-1', 'GIFT-AAAA', 'hash-1', 500, 'usd',
         '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
    `);

    const result = await giftCardDal.updateDetails({
      id: "card-1",
      expiresAt: "2027-01-01T00:00:00.000Z",
      note: "Extended by support",
      updatedBy: "admin-1",
      now: "2026-10-03T00:00:00.000Z",
    });

    expect(result).toBe("updated");
    expect(
      sqlite
        .prepare("SELECT expires_at, note FROM gift_cards WHERE id = 'card-1'")
        .get(),
    ).toEqual({
      expires_at: "2027-01-01T00:00:00.000Z",
      note: "Extended by support",
    });
  });

  it("writes neither row when the account changed since it was read", async () => {
    sqlite.exec(`
      INSERT INTO store_credit_accounts
        (id, code_hash, currency_code, balance, metadata, created_at, updated_at)
      VALUES
        ('card-1', 'hash-1', 'usd', 400,
         '{"_morph_resource_type":"gift_card"}',
         '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z');
      INSERT INTO gift_cards
        (id, store_credit_account_id, code, code_hash, value, currency_code,
         created_at, updated_at)
      VALUES
        ('card-1', 'card-1', 'GIFT-AAAA', 'hash-1', 500, 'usd',
         '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
    `);
    // A concurrent write lands between the read and the batch.
    const prepare = sqlite.prepare.bind(sqlite);
    let moved = false;
    vi.spyOn(sqlite, "prepare").mockImplementation(((source: string) => {
      if (!moved && /^\s*update/i.test(source)) {
        moved = true;
        prepare(
          "UPDATE store_credit_accounts SET updated_at = '2026-10-02T12:00:00.000Z' WHERE id = 'card-1'",
        ).run();
      }
      return prepare(source);
    }) as typeof sqlite.prepare);

    const result = await giftCardDal.updateDetails({
      id: "card-1",
      note: "Stale edit",
      updatedBy: "admin-1",
      now: "2026-10-03T00:00:00.000Z",
    });

    expect(result).toBe("conflict");
    expect(
      prepare("SELECT note FROM gift_cards WHERE id = 'card-1'").get(),
    ).toEqual({ note: null });
  });
});
