import Database from "better-sqlite3";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storefrontThemeDal } from "./storefront-theme.dal";

vi.mock("cloudflare:workers", () => ({
  env: {
    DATABASE: {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => {
          const hasNumbered = /\?\d+/.test(sql);
          const params = hasNumbered
            ? Object.fromEntries(args.map((val, idx) => [String(idx + 1), val]))
            : args;
          return {
            run: () => {
              const stmt = sqlite.prepare(sql);
              if (sql.trim().toUpperCase().startsWith("SELECT")) {
                const res = hasNumbered ? stmt.all(params) : stmt.all(...args);
                return { results: res };
              }
              const res = hasNumbered ? stmt.run(params) : stmt.run(...args);
              return { meta: { changes: res.changes } };
            },
            all: () => {
              const stmt = sqlite.prepare(sql);
              const res = hasNumbered ? stmt.all(params) : stmt.all(...args);
              return { results: res };
            },
            first: () => {
              const stmt = sqlite.prepare(sql);
              return hasNumbered ? stmt.get(params) : stmt.get(...args);
            },
          };
        },
      }),
      batch: async (statements: Array<any>) => {
        return statements.map((s) => {
          if (typeof s.run === "function") return s.run();
          if (typeof s.all === "function") return s.all();
          return {};
        });
      },
    },
  },
}));
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
      published_source_revision_id text,
      metadata text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_theme_files (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      theme_id text NOT NULL,
      path text NOT NULL,
      content text NOT NULL,
      mime_type text,
      is_entry integer DEFAULT 0,
      version integer DEFAULT 1,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_theme_revisions (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      theme_id text NOT NULL,
      revision_number integer NOT NULL,
      message text,
      source text,
      snapshot text,
      created_by text,
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
      draft_revision_id text,
      published_revision_id text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_theme_template_revisions (
      id text PRIMARY KEY NOT NULL,
      template_id text NOT NULL,
      version integer NOT NULL,
      document text NOT NULL,
      created_by text,
      created_at text NOT NULL,
      published_at text
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
  const testDb = Object.assign(db, {
    batch: async (queries: Array<{ execute: () => Promise<unknown> }>) =>
      Promise.all(queries.map((query) => query.execute())),
  });
  vi.mocked(getDb).mockResolvedValue(
    testDb as unknown as Awaited<ReturnType<typeof getDb>>,
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

  it("publishes the current draft revision without exposing older drafts", async () => {
    const draftDocument = JSON.stringify({
      version: 1,
      sections: [{ id: "hero", type: "hero", enabled: true, props: {} }],
    });
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, created_at, updated_at)
      VALUES
        ('template-a', 'theme-a', 'index', 'Home', '{"version":1,"sections":[]}',
         '11111111-1111-4111-8111-111111111111', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'template-a', 1,
         '${draftDocument.replaceAll("'", "''")}', 'now');
    `);

    await expect(
      storefrontThemeDal.publishTemplate({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-a",
      }),
    ).resolves.toEqual({
      revisionId: "11111111-1111-4111-8111-111111111111",
      sourceRevisionId: expect.any(String),
      unchanged: false,
    });

    const published = sqlite
      .prepare(
        "SELECT document, published_revision_id FROM storefront_theme_templates WHERE id = ?",
      )
      .get("template-a") as {
      document: string;
      published_revision_id: string | null;
    };
    expect(JSON.parse(published.document)).toEqual(JSON.parse(draftDocument));
    expect(published.published_revision_id).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("publishes explicit source revision snapshot and binds it to published_source_revision_id", async () => {
    const draftDocument = JSON.stringify({
      version: 1,
      sections: [{ id: "hero", type: "hero", enabled: true, props: {} }],
    });
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, created_at, updated_at)
      VALUES
        ('template-a', 'theme-a', 'index', 'Home', '{"version":1,"sections":[]}',
         '11111111-1111-4111-8111-111111111111', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'template-a', 1,
         '${draftDocument.replaceAll("'", "''")}', 'now');
      INSERT INTO storefront_theme_revisions
        (id, storefront_id, theme_id, revision_number, message, source, snapshot, created_at, updated_at)
      VALUES
        ('22222222-2222-4222-8222-222222222222', 'storefront-a', 'theme-a', 1,
         'Frozen checkpoint', 'publish', '[]', 'now', 'now');
    `);

    const res = await storefrontThemeDal.publishTemplate({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-a",
      sourceRevisionId: "22222222-2222-4222-8222-222222222222",
    });

    expect(res).toEqual({
      revisionId: "11111111-1111-4111-8111-111111111111",
      sourceRevisionId: "22222222-2222-4222-8222-222222222222",
      unchanged: false,
    });

    const theme = sqlite
      .prepare(
        "SELECT published_source_revision_id FROM storefront_themes WHERE id = ?",
      )
      .get("theme-a") as { published_source_revision_id: string | null };
    expect(theme.published_source_revision_id).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("aborts and throws when CAS guard fails on invalid source revision", async () => {
    const draftDocument = JSON.stringify({
      version: 1,
      sections: [{ id: "hero", type: "hero", enabled: true, props: {} }],
    });
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, created_at, updated_at)
      VALUES
        ('template-a', 'theme-a', 'index', 'Home', '{"version":1,"sections":[]}',
         '11111111-1111-4111-8111-111111111111', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'template-a', 1,
         '${draftDocument.replaceAll("'", "''")}', 'now');
    `);

    // Non-existent sourceRevisionId should fail the CAS guard (json('') in SQLite)
    await expect(
      storefrontThemeDal.publishTemplate({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-a",
        sourceRevisionId: "99999999-9999-4999-8999-999999999999",
      }),
    ).rejects.toThrow();
  });
});
