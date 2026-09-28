import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { campaignDal } from "./campaign.dal";

let sqlite: Database.Database;

vi.mock("@/db", () => ({ getDb: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: {} }));

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE promotion_campaigns (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      campaign_identifier TEXT NOT NULL,
      starts_at TEXT,
      ends_at TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE UNIQUE INDEX promotion_campaigns_active_identifier_unique
      ON promotion_campaigns(campaign_identifier) WHERE deleted_at IS NULL;
    CREATE TABLE promotion_campaign_budgets (
      id TEXT PRIMARY KEY NOT NULL,
      campaign_id TEXT NOT NULL REFERENCES promotion_campaigns(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      currency_code TEXT,
      "limit" INTEGER,
      used INTEGER NOT NULL DEFAULT 0,
      attribute TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      CHECK ("limit" IS NULL OR used <= "limit")
    );
    CREATE TABLE promotion_campaign_budget_usages (
      id TEXT PRIMARY KEY NOT NULL,
      budget_id TEXT NOT NULL REFERENCES promotion_campaign_budgets(id) ON DELETE CASCADE,
      attribute_value TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      "limit" INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE promotions (
      id TEXT PRIMARY KEY NOT NULL,
      campaign_id TEXT REFERENCES promotion_campaigns(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
  `);
  const db = drizzle(sqlite);
  Object.defineProperty(db, "batch", {
    configurable: true,
    value: async (statements: Array<{ run: () => unknown }>) =>
      sqlite.transaction(() =>
        statements.map((statement) => statement.run()),
      )(),
  });
  vi.mocked(getDb).mockResolvedValue(db as never);
});

afterEach(() => sqlite.close());

const seedCampaign = async (
  id: string,
  identifier = id,
  withBudget = false,
) => {
  await campaignDal.create({
    id,
    name: id,
    identifier,
    budget: withBudget
      ? { type: "use_by_attribute", limit: 5, attribute: "email" }
      : undefined,
  });
};

const campaignLink = (promotionId: string) =>
  sqlite
    .prepare("SELECT campaign_id FROM promotions WHERE id = ?")
    .get(promotionId) as { campaign_id: string | null };

describe("campaign DAL", () => {
  it("creates a campaign and reads its budget through the Admin DTO", async () => {
    await seedCampaign("campaign-1", "spring-sale", true);
    const result = await campaignDal.findById("campaign-1");

    expect(result).toMatchObject({
      id: "campaign-1",
      identifier: "spring-sale",
      budget: {
        type: "use_by_attribute",
        limit: 5,
        used: 0,
        attribute: "email",
      },
    });
    expect(
      await campaignDal.listPage({
        offset: 0,
        limit: 10,
        sortBy: "createdAt",
        sortOrder: "desc",
      }),
    ).toMatchObject({ total: 1, campaigns: [{ id: "campaign-1" }] });
  });

  it("rejects mixed-validity campaign links without partially adding or removing promotions", async () => {
    await seedCampaign("campaign-target");
    await seedCampaign("campaign-other");
    sqlite.exec(`
      INSERT INTO promotions VALUES ('belongs-elsewhere', 'campaign-other', '2026-09-27', NULL);
      INSERT INTO promotions VALUES ('new-promotion', NULL, '2026-09-27', NULL);
      INSERT INTO promotions VALUES ('remove-promotion', 'campaign-target', '2026-09-27', NULL);
    `);

    const result = await campaignDal.managePromotions("campaign-target", {
      add: ["belongs-elsewhere", "new-promotion"],
      remove: ["remove-promotion"],
    });

    expect(result).toEqual({ success: false, error: "PROMOTION_UNAVAILABLE" });
    expect(campaignLink("new-promotion").campaign_id).toBeNull();
    expect(campaignLink("remove-promotion").campaign_id).toBe(
      "campaign-target",
    );
  });

  it("adds and removes valid promotion links, then unlinks promotions on campaign deletion", async () => {
    await seedCampaign("campaign-target", "target", true);
    await seedCampaign("campaign-other", "other");
    sqlite.exec(`
      INSERT INTO promotions VALUES ('add-promotion', NULL, '2026-09-27', NULL);
      INSERT INTO promotions VALUES ('remove-promotion', 'campaign-target', '2026-09-27', NULL);
      INSERT INTO promotion_campaign_budget_usages
        (id, budget_id, attribute_value, used, "limit", created_at, updated_at)
      SELECT 'usage-1', id, 'shopper@example.com', 2, 5, '2026-09-27', '2026-09-27'
      FROM promotion_campaign_budgets WHERE campaign_id = 'campaign-target';
    `);

    expect(
      await campaignDal.managePromotions("campaign-target", {
        add: ["add-promotion"],
        remove: ["remove-promotion"],
      }),
    ).toEqual({ success: true });
    expect(campaignLink("add-promotion").campaign_id).toBe("campaign-target");
    expect(campaignLink("remove-promotion").campaign_id).toBeNull();

    expect(await campaignDal.softDelete("campaign-target")).toBe(true);
    expect(campaignLink("add-promotion").campaign_id).toBeNull();
    expect(
      sqlite
        .prepare("SELECT deleted_at FROM promotion_campaigns WHERE id = ?")
        .get("campaign-target"),
    ).toMatchObject({ deleted_at: expect.any(String) });
    expect(
      sqlite
        .prepare(
          "SELECT deleted_at FROM promotion_campaign_budgets WHERE campaign_id = ?",
        )
        .get("campaign-target"),
    ).toMatchObject({ deleted_at: expect.any(String) });
    expect(
      sqlite
        .prepare(
          "SELECT deleted_at FROM promotion_campaign_budget_usages WHERE id = ?",
        )
        .get("usage-1"),
    ).toMatchObject({ deleted_at: expect.any(String) });
  });
});
