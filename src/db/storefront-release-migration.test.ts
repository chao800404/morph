import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function applyMigration(db: Database.Database, fileName: string) {
  const sql = fs.readFileSync(
    path.resolve(process.cwd(), "drizzle", fileName),
    "utf8",
  );
  for (const statement of sql.split(/--> statement-breakpoint/)) {
    const trimmed = statement.trim();
    if (trimmed) db.exec(trimmed);
  }
}

describe("storefront release migration regression", () => {
  it("preserves the active legacy release and disables unverifiable history through 0049", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE storefronts (id text PRIMARY KEY, active_release_id text, deleted_at text);
      CREATE TABLE storefront_themes (id text PRIMARY KEY);
      CREATE TABLE storefront_theme_templates (
        id text PRIMARY KEY,
        theme_id text NOT NULL,
        published_revision_id text,
        deleted_at text
      );
      CREATE TABLE storefront_pages (
        id text PRIMARY KEY,
        storefront_id text NOT NULL,
        published_revision_id text,
        deleted_at text
      );
      CREATE TABLE storefront_theme_revisions (id text PRIMARY KEY);
      CREATE TABLE storefront_theme_builds (id text PRIMARY KEY);
      CREATE TABLE storefront_releases (
        id text PRIMARY KEY,
        storefront_id text NOT NULL,
        theme_id text NOT NULL,
        source_revision_id text NOT NULL,
        theme_build_id text NOT NULL,
        status text NOT NULL,
        metadata text,
        created_by text,
        created_at text NOT NULL,
        updated_at text NOT NULL,
        deleted_at text
      );
      INSERT INTO storefronts (id, active_release_id)
        VALUES ('storefront-a', 'release-a');
      INSERT INTO storefront_themes (id) VALUES ('theme-a');
      INSERT INTO storefront_theme_revisions (id) VALUES ('source-a'), ('source-b');
      INSERT INTO storefront_theme_builds (id) VALUES ('build-a'), ('build-b');
      INSERT INTO storefront_theme_templates
        (id, theme_id, published_revision_id)
        VALUES ('template-a', 'theme-a', 'template-revision-current');
      INSERT INTO storefront_pages
        (id, storefront_id, published_revision_id)
        VALUES ('page-a', 'storefront-a', 'page-revision-current');
      INSERT INTO storefront_releases
        (id, storefront_id, theme_id, source_revision_id, theme_build_id,
         status, created_at, updated_at)
        VALUES ('release-a', 'storefront-a', 'theme-a', 'source-a', 'build-a',
                'active', '2026-01-01', '2026-01-01');
      INSERT INTO storefront_releases
        (id, storefront_id, theme_id, source_revision_id, theme_build_id,
         status, created_at, updated_at)
        VALUES ('release-b', 'storefront-a', 'theme-a', 'source-b', 'build-b',
                'superseded', '2025-12-01', '2025-12-01');
    `);

    applyMigration(db, "0046_curved_scream.sql");
    applyMigration(db, "0047_warm_umar.sql");
    applyMigration(db, "0048_legacy_release_content_publication.sql");
    applyMigration(db, "0049_correct_legacy_release_content_publication.sql");

    const release = db
      .prepare(
        `SELECT storefront_id, theme_id, source_revision_id, theme_build_id,
                content_publication_id, status
           FROM storefront_releases WHERE id = 'release-a'`,
      )
      .get() as {
      storefront_id: string;
      theme_id: string;
      source_revision_id: string;
      theme_build_id: string;
      content_publication_id: string | null;
      status: string;
    };
    expect(release).toEqual({
      storefront_id: "storefront-a",
      theme_id: "theme-a",
      source_revision_id: "source-a",
      theme_build_id: "build-a",
      content_publication_id: "legacy-release-a",
      status: "available",
    });
    expect(
      db.prepare(
        "SELECT content_publication_id FROM storefront_releases WHERE id = 'release-b'",
      ).get(),
    ).toEqual({ content_publication_id: null });
    expect(
      db.prepare(
        "SELECT id FROM storefront_content_publications ORDER BY id",
      ).all(),
    ).toEqual([{ id: "legacy-release-a" }]);
    expect(
      db.prepare(
        "SELECT publication_id, item_type, content_id, revision_id FROM storefront_content_publication_items ORDER BY item_type",
      ).all(),
    ).toEqual([
      {
        publication_id: "legacy-release-a",
        item_type: "page",
        content_id: "page-a",
        revision_id: "page-revision-current",
      },
      {
        publication_id: "legacy-release-a",
        item_type: "template",
        content_id: "template-a",
        revision_id: "template-revision-current",
      },
    ]);
    expect(
      (db
        .prepare("SELECT active_release_id FROM storefronts WHERE id = 'storefront-a'")
        .get() as { active_release_id: string }).active_release_id,
    ).toBe("release-a");

    const foreignKeys = db
      .prepare("PRAGMA foreign_key_list(storefront_releases)")
      .all() as Array<{ from: string; table: string; on_delete: string }>;
    expect(foreignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "content_publication_id",
          table: "storefront_content_publications",
          on_delete: "RESTRICT",
        }),
        expect.objectContaining({
          from: "source_revision_id",
          table: "storefront_theme_revisions",
          on_delete: "RESTRICT",
        }),
        expect.objectContaining({
          from: "theme_build_id",
          table: "storefront_theme_builds",
          on_delete: "RESTRICT",
        }),
      ]),
    );
    db.close();
  });
});
