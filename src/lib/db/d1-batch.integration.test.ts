// @vitest-environment node
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";

import { getDb } from "@/db";
import { productDal } from "@/lib/product/dal/product.dal";
import { regionDal } from "@/lib/region/dal/region.dal";
import { storeCreditDal } from "@/lib/store-credit/dal/store-credit.dal";

import { batchGuard } from "./batch-guard";

/**
 * Batched writes against the real D1 engine (Miniflare), with every
 * migration applied.
 *
 * Every other DAL test runs on a better-sqlite3 stand-in, and two whole
 * classes of fault passed there while failing in the running app:
 * - a raw `db.run(sql)` statement with bound values inside `db.batch` throws
 *   "Cannot read properties of undefined (reading 'bind')" in drizzle's D1
 *   driver — creating a product failed on every attempt;
 * - `EXISTS (${builder})` renders doubled parentheses, a syntax error in
 *   D1's SQLite — creating a region failed on every attempt;
 * - a unique violation on a column index names the columns, not the index,
 *   so a check for the index name never matched — replaying a store credit
 *   adjustment returned a 500 instead of a conflict.
 * So these run the real DAL code against real D1, and the fake is not in
 * the path.
 */

let proxy: Awaited<ReturnType<typeof getPlatformProxy>> | null = null;
let dir = "";
let d1: D1Database;
const NOW = "2026-01-01T00:00:00.000Z";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "d1-batch-"));
  writeFileSync(
    join(dir, "wrangler.json"),
    JSON.stringify({
      name: "d1-batch-test",
      compatibility_date: "2025-09-02",
      d1_databases: [
        {
          binding: "DATABASE",
          database_name: "test",
          database_id: "00000000-0000-0000-0000-000000000000",
        },
      ],
    }),
  );
  proxy = await getPlatformProxy({
    configPath: join(dir, "wrangler.json"),
    persist: { path: join(dir, "state") },
  });
  d1 = (proxy.env as { DATABASE: D1Database }).DATABASE;
  const migrations = join(process.cwd(), "drizzle");
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    for (const statement of readFileSync(join(migrations, file), "utf8").split(
      "--> statement-breakpoint",
    )) {
      if (statement.trim()) await d1.prepare(statement.trim()).run();
    }
  }
  // What the application's code reads through getDb().
  (env as unknown as { DATABASE: D1Database }).DATABASE = d1;
}, 120_000);

afterAll(async () => {
  await proxy?.dispose();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const count = async (query: string, ...values: unknown[]) =>
  (await d1
    .prepare(query)
    .bind(...values)
    .first<{ n: number }>())!.n;

describe("batchGuard in a real D1 batch", () => {
  const gate = sqliteTable("batch_guard_gate", { id: text("id").primaryKey() });
  const rows = sqliteTable("batch_guard_rows", { id: text("id").primaryKey() });

  beforeAll(async () => {
    await d1.exec("CREATE TABLE batch_guard_gate (id TEXT PRIMARY KEY)");
    await d1.exec("CREATE TABLE batch_guard_rows (id TEXT PRIMARY KEY)");
    await d1.exec("INSERT INTO batch_guard_gate (id) VALUES ('open')");
  });

  // Bound values, and a query builder inside EXISTS: both shapes that broke.
  // Synchronous on purpose: awaiting a drizzle builder executes it.
  const open = (db: Awaited<ReturnType<typeof getDb>>, id: string) => {
    const opened = db
      .select({ id: gate.id })
      .from(gate)
      .where(sql`${gate.id} = ${id}`);
    return batchGuard(db, sql`EXISTS ${opened}`);
  };

  it("lets the batch commit when the condition holds", async () => {
    const db = await getDb();
    await db.batch([open(db, "open"), db.insert(rows).values({ id: "a" })]);
    expect(
      await count("SELECT count(*) AS n FROM batch_guard_rows WHERE id = 'a'"),
    ).toBe(1);
  });

  it("rolls the whole batch back when it does not", async () => {
    const db = await getDb();
    await expect(
      db.batch([open(db, "closed"), db.insert(rows).values({ id: "b" })]),
    ).rejects.toThrow("malformed JSON");
    expect(
      await count("SELECT count(*) AS n FROM batch_guard_rows WHERE id = 'b'"),
    ).toBe(0);
  });
});

describe("the DAL writes that failed only on real D1", () => {
  beforeAll(async () => {
    await d1
      .prepare(
        "INSERT OR IGNORE INTO payment_providers (id, is_enabled, created_at, updated_at) VALUES ('pp_manual_manual', 1, ?, ?)",
      )
      .bind(NOW, NOW)
      .run();
    await d1
      .prepare(
        "INSERT INTO region_countries (iso_2, iso_3, num_code, name, display_name, created_at, updated_at) VALUES ('tw', 'twn', '158', 'TAIWAN', 'Taiwan', ?, ?)",
      )
      .bind(NOW, NOW)
      .run();
  });

  it("creates a product with its default shipping profile", async () => {
    await productDal.create({
      id: "product-1",
      title: "D1 Tee",
      handle: "d1-tee",
      createdBy: "user-1",
      updatedBy: "user-1",
    });
    expect(
      await count("SELECT count(*) AS n FROM products WHERE id = 'product-1'"),
    ).toBe(1);
    expect(
      await count(
        "SELECT count(*) AS n FROM product_shipping_profiles WHERE product_id = 'product-1'",
      ),
    ).toBe(1);
  });

  it("creates a region with its country and provider, and refuses an unavailable provider", async () => {
    await regionDal.createWithAssociations({
      id: "region-1",
      name: "Taiwan",
      currencyCode: "twd",
      countries: ["tw"],
      paymentProviderIds: ["pp_manual_manual"],
    });
    expect(
      await count("SELECT count(*) AS n FROM regions WHERE id = 'region-1'"),
    ).toBe(1);
    expect(
      await count(
        "SELECT count(*) AS n FROM region_countries WHERE region_id = 'region-1'",
      ),
    ).toBe(1);
    expect(
      await count(
        "SELECT count(*) AS n FROM region_payment_providers WHERE region_id = 'region-1'",
      ),
    ).toBe(1);

    // The guard holds the region to providers that exist and are enabled.
    await expect(
      regionDal.createWithAssociations({
        id: "region-2",
        name: "Nowhere",
        currencyCode: "twd",
        countries: [],
        paymentProviderIds: ["pp_missing"],
      }),
    ).rejects.toThrow();
    expect(
      await count("SELECT count(*) AS n FROM regions WHERE id = 'region-2'"),
    ).toBe(0);
  });

  it("answers a replayed store credit adjustment with a conflict", async () => {
    await d1
      .prepare(
        "INSERT INTO store_credit_accounts (id, code_hash, currency_code, metadata, created_at, updated_at) VALUES ('account-1', 'hash-1', 'twd', '{}', ?, ?)",
      )
      .bind(NOW, NOW)
      .run();
    const adjust = (transactionId: string) =>
      storeCreditDal.adjustBalance({
        id: "account-1",
        transactionId,
        idempotencyKey: "key-1",
        type: "credit",
        amount: 3000,
        note: null,
        reference: "admin_adjustment",
        referenceId: transactionId,
        createdBy: null,
        now: NOW,
      });
    expect(await adjust("transaction-1")).toBe("updated");
    expect(await adjust("transaction-2")).toBe("conflict");
    expect(
      await count(
        "SELECT balance AS n FROM store_credit_accounts WHERE id = 'account-1'",
      ),
    ).toBe(3000);
  });
});
