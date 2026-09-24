import Database from "better-sqlite3";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storefrontContentPublicationDal } from "./storefront-content-publication.dal";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ getDb: vi.fn() }));

let sqlite: Database.Database;

const doc = (marker: string) =>
  JSON.stringify({ version: 1, sections: [{ id: marker }] });

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE storefront_theme_templates (
      id text PRIMARY KEY,
      theme_id text NOT NULL,
      type text NOT NULL,
      name text NOT NULL,
      route_path text,
      draft_revision_id text,
      published_revision_id text,
      deleted_at text
    );
    CREATE TABLE storefront_theme_template_revisions (
      id text PRIMARY KEY,
      template_id text NOT NULL,
      document text NOT NULL
    );
    CREATE TABLE storefront_pages (
      id text PRIMARY KEY,
      storefront_id text NOT NULL,
      handle text NOT NULL,
      published_revision_id text,
      deleted_at text
    );
    CREATE TABLE storefront_page_revisions (
      id text PRIMARY KEY,
      page_id text NOT NULL,
      document text NOT NULL
    );
  `);
  vi.mocked(getDb).mockResolvedValue(
    drizzle(sqlite, { schema: storefrontSchema }) as never,
  );
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

describe("listDocumentsForPublish", () => {
  it("takes the target and the shell at their drafts, the rest as published", async () => {
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, route_path, draft_revision_id, published_revision_id, deleted_at)
      VALUES
        ('home', 'theme-a', 'index', 'Home', NULL, 'home-draft', 'home-live', NULL),
        ('shell', 'theme-a', 'layout', 'Layout', NULL, 'shell-draft', 'shell-live', NULL),
        ('about', 'theme-a', 'page', 'About', '/aboutus', 'about-draft', 'about-live', NULL),
        ('never', 'theme-a', 'product', 'Product', NULL, 'never-draft', NULL, NULL),
        ('gone', 'theme-a', 'blog', 'Blog', NULL, 'gone-draft', 'gone-live', '2026-01-01'),
        ('other', 'theme-b', 'index', 'Other', NULL, 'other-draft', 'other-live', NULL);
      INSERT INTO storefront_theme_template_revisions (id, template_id, document) VALUES
        ('home-draft', 'home', '${doc("home-draft")}'),
        ('home-live', 'home', '${doc("home-live")}'),
        ('shell-draft', 'shell', '${doc("shell-draft")}'),
        ('shell-live', 'shell', '${doc("shell-live")}'),
        ('about-draft', 'about', '${doc("about-draft")}'),
        ('about-live', 'about', '${doc("about-live")}'),
        ('never-draft', 'never', '${doc("never-draft")}'),
        ('gone-live', 'gone', '${doc("gone-live")}'),
        ('other-live', 'other', '${doc("other-live")}');
      INSERT INTO storefront_pages (id, storefront_id, handle, published_revision_id, deleted_at) VALUES
        ('faq', 'storefront-a', 'faq', 'faq-live', NULL),
        ('draft-only', 'storefront-a', 'soon', NULL, NULL),
        ('elsewhere', 'storefront-b', 'x', 'x-live', NULL);
      INSERT INTO storefront_page_revisions (id, page_id, document) VALUES
        ('faq-live', 'faq', '${doc("faq-live")}'),
        ('x-live', 'elsewhere', '${doc("x-live")}');
    `);

    const documents =
      await storefrontContentPublicationDal.listDocumentsForPublish({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "home",
      });

    const seen = documents
      .map(({ label, document }) => [
        label,
        (document as { sections: { id: string }[] }).sections[0]!.id,
      ])
      .sort();
    expect(seen).toEqual([
      ["/aboutus", "about-live"],
      ["/pages/faq", "faq-live"],
      ["Home", "home-draft"],
      ["Layout", "shell-draft"],
    ]);
  });
});
