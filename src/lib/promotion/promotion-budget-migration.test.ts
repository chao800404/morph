import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("promotion budget database guards", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE promotion_campaigns (id text PRIMARY KEY NOT NULL);
      CREATE TABLE promotion_campaign_budgets (
        id text PRIMARY KEY NOT NULL,
        campaign_id text NOT NULL,
        type text NOT NULL,
        currency_code text,
        "limit" integer,
        used integer DEFAULT 0 NOT NULL,
        attribute text,
        created_at text NOT NULL,
        updated_at text NOT NULL,
        deleted_at text
      );
      CREATE TABLE promotion_campaign_budget_usages (
        id text PRIMARY KEY NOT NULL,
        budget_id text NOT NULL,
        attribute_value text NOT NULL,
        used integer DEFAULT 0 NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL,
        deleted_at text
      );
      CREATE TABLE promotions (
        id text PRIMARY KEY NOT NULL,
        code text NOT NULL,
        type text DEFAULT 'standard' NOT NULL,
        status text DEFAULT 'draft' NOT NULL,
        is_automatic integer DEFAULT false NOT NULL,
        is_tax_inclusive integer DEFAULT false NOT NULL,
        "limit" integer,
        used integer DEFAULT 0 NOT NULL,
        campaign_id text,
        metadata text,
        created_at text NOT NULL,
        updated_at text NOT NULL,
        deleted_at text
      );
      INSERT INTO promotion_campaigns VALUES ('campaign-1');
      INSERT INTO promotion_campaign_budgets VALUES (
        'budget-1', 'campaign-1', 'use_by_attribute', NULL, 2, 1,
        'email', '2026-01-01', '2026-01-01', NULL
      );
      INSERT INTO promotion_campaign_budget_usages VALUES (
        'usage-1', 'budget-1', 'buyer@example.com', 1,
        '2026-01-01', '2026-01-01', NULL
      );
      INSERT INTO promotions VALUES (
        'promotion-1', 'LIMITED', 'standard', 'active', false, false,
        2, 1, 'campaign-1', NULL, '2026-01-01', '2026-01-01', NULL
      );
    `);
    db.exec(
      readFileSync(
        join(process.cwd(), "drizzle", "0030_mushy_tombstone.sql"),
        "utf8",
      ),
    );
  });

  afterEach(() => db.close());

  it("backfills the per-attribute limit from its parent budget", () => {
    const row = db
      .prepare(
        "SELECT used, `limit` FROM promotion_campaign_budget_usages WHERE id = ?",
      )
      .get("usage-1") as { used: number; limit: number };
    expect(row).toEqual({ used: 1, limit: 2 });
  });

  it("rolls back an order-like transaction when any promotion cap is exceeded", () => {
    db.exec("CREATE TABLE checkout_orders (id text PRIMARY KEY NOT NULL)");
    const checkout = db.transaction(() => {
      db.prepare("INSERT INTO checkout_orders VALUES (?)").run("order-1");
      db.prepare(
        "UPDATE promotion_campaign_budget_usages SET used = used + 2 WHERE id = ?",
      ).run("usage-1");
    });

    expect(() => checkout()).toThrow(
      /promotion_campaign_budget_usages_limit_check/,
    );
    expect(
      db.prepare("SELECT count(*) AS value FROM checkout_orders").get(),
    ).toEqual({ value: 0 });
  });

  it("rejects global promotion and campaign budget overuse", () => {
    expect(() =>
      db
        .prepare("UPDATE promotions SET used = used + 2 WHERE id = ?")
        .run("promotion-1"),
    ).toThrow(/promotions_limit_check/);
    expect(() =>
      db
        .prepare(
          "UPDATE promotion_campaign_budgets SET used = used + 2 WHERE id = ?",
        )
        .run("budget-1"),
    ).toThrow(/promotion_campaign_budgets_limit_check/);
  });
});
