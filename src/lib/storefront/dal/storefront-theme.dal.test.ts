import Database from "better-sqlite3";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storefrontThemeDal } from "./storefront-theme.dal";

vi.mock("@/db", () => ({ getDb: vi.fn() }));

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE storefronts (
      id text PRIMARY KEY NOT NULL,
      sales_channel_id text NOT NULL,
      name text NOT NULL,
      domain text,
      status text NOT NULL,
      active_theme_id text,
      metadata text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_themes (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      name text NOT NULL,
      status text NOT NULL,
      metadata text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_theme_templates (
      id text PRIMARY KEY NOT NULL,
      theme_id text NOT NULL,
      type text NOT NULL,
      name text NOT NULL,
      document text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    INSERT INTO storefronts
      (id, sales_channel_id, name, status, created_at, updated_at)
    VALUES
      ('storefront-a', 'channel-a', 'Store A', 'published', 'now', 'now'),
      ('storefront-b', 'channel-b', 'Store B', 'published', 'now', 'now');
    INSERT INTO storefront_themes
      (id, storefront_id, name, status, created_at, updated_at)
    VALUES
      ('theme-a', 'storefront-a', 'Theme A', 'published', 'now', 'now'),
      ('theme-b', 'storefront-b', 'Theme B', 'published', 'now', 'now');
    INSERT INTO storefront_theme_templates
      (id, theme_id, type, name, document, created_at, updated_at)
    VALUES
      ('template-b', 'theme-b', 'index', 'Home', '{"version":1,"sections":[]}', 'now', 'now');
  `);

  const db = drizzle(sqlite, { schema: storefrontSchema });
  vi.mocked(getDb).mockResolvedValue(
    db as unknown as Awaited<ReturnType<typeof getDb>>,
  );
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

describe("storefront theme DAL", () => {
  it("does not return a theme owned by another storefront", async () => {
    await expect(
      storefrontThemeDal.findEditorContext("storefront-a", "theme-b"),
    ).resolves.toBeNull();
  });

  it("rejects an invalid persisted template document", async () => {
    sqlite
      .prepare(
        `
        INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, created_at, updated_at)
        VALUES
          ('template-a', 'theme-a', 'index', 'Home', ?, 'now', 'now')
      `,
      )
      .run('{"version":1,"sections":[{"id":"hero"}]}');

    await expect(
      storefrontThemeDal.findEditorContext("storefront-a", "theme-a"),
    ).rejects.toThrow();
  });
});
