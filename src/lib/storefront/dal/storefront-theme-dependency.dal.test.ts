import Database from "better-sqlite3";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storefrontThemeDependencyDal } from "./storefront-theme-dependency.dal";

vi.mock("@/db", () => ({ getDb: vi.fn() }));

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE storefronts (
      id text PRIMARY KEY NOT NULL,
      sales_channel_id text NOT NULL,
      name text NOT NULL,
      status text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_themes (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      name text NOT NULL,
      status text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
    VALUES ('storefront-a', 'channel-a', 'Store A', 'draft', 'now', 'now'),
           ('storefront-b', 'channel-b', 'Store B', 'draft', 'now', 'now');
    INSERT INTO storefront_themes (id, storefront_id, name, status, created_at, updated_at)
    VALUES ('theme-a', 'storefront-a', 'Theme A', 'draft', 'now', 'now'),
           ('theme-b', 'storefront-b', 'Theme B', 'draft', 'now', 'now');
  `);
  const db = drizzle(sqlite, { schema: storefrontSchema });
  vi.mocked(getDb).mockResolvedValue(db as any);
});

afterEach(() => {
  sqlite.close();
});

describe("theme dependency ownership against soft-deleted rows", () => {
  const owns = (storefrontId: string, themeId: string) =>
    storefrontThemeDependencyDal.verifyThemeOwnership(storefrontId, themeId);

  it("accepts a live theme of a live storefront", async () => {
    expect(await owns("storefront-a", "theme-a")).toBe(true);
  });

  it("refuses another storefront's theme", async () => {
    expect(await owns("storefront-a", "theme-b")).toBe(false);
  });

  it("refuses a soft-deleted theme", async () => {
    sqlite.exec(
      "UPDATE storefront_themes SET deleted_at = 'deleted' WHERE id = 'theme-a'",
    );
    expect(await owns("storefront-a", "theme-a")).toBe(false);
  });

  it("refuses a live theme whose storefront is soft-deleted", async () => {
    sqlite.exec(
      "UPDATE storefronts SET deleted_at = 'deleted' WHERE id = 'storefront-a'",
    );
    expect(await owns("storefront-a", "theme-a")).toBe(false);
    await expect(
      storefrontThemeDependencyDal.upsertRequested({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        packageName: "left-pad",
        packageVersion: "1.3.0",
      }),
    ).rejects.toThrow("Theme not found or does not belong to storefront");
    expect(await owns("storefront-b", "theme-b")).toBe(true);
  });
});
