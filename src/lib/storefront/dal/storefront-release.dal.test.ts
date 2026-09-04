import Database from "better-sqlite3";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storefrontReleaseDal } from "./storefront-release.dal";

let sqlite: Database.Database;

const targetReleaseId = "22222222-2222-4222-8222-222222222222";
const validDocument = JSON.stringify({ version: 1, sections: [] });

function insertValidPublicationItems() {
  sqlite
    .prepare("INSERT INTO storefront_themes (id, storefront_id) VALUES (?, ?)")
    .run("theme-a", "storefront-a");
  sqlite
    .prepare(
      "INSERT INTO storefront_theme_templates (id, theme_id) VALUES (?, ?)",
    )
    .run("template-a", "theme-a");
  sqlite
    .prepare(
      "INSERT INTO storefront_theme_template_revisions (id, template_id, document) VALUES (?, ?, ?)",
    )
    .run("template-revision-a", "template-a", validDocument);
  sqlite
    .prepare("INSERT INTO storefront_pages (id, storefront_id) VALUES (?, ?)")
    .run("page-a", "storefront-a");
  sqlite
    .prepare(
      "INSERT INTO storefront_page_revisions (id, page_id, document) VALUES (?, ?, ?)",
    )
    .run("page-revision-a", "page-a", validDocument);
  sqlite.exec(`
    INSERT INTO storefront_content_publication_items
      (id, publication_id, item_type, content_id, revision_id)
    VALUES
      ('item-template-a', 'publication-b', 'template', 'template-a', 'template-revision-a'),
      ('item-page-a', 'publication-b', 'page', 'page-a', 'page-revision-a');
  `);
}

async function activateTarget() {
  return storefrontReleaseDal.activateRelease({
    storefrontId: "storefront-a",
    releaseId: targetReleaseId,
    expectedActiveReleaseId: null,
  });
}

vi.mock("cloudflare:workers", () => ({
  env: {
    DATABASE: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          sql,
          run: () => {
            const params = Object.fromEntries(
              args.map((value, index) => [String(index + 1), value]),
            );
            const result = sqlite.prepare(sql).run(params);
            return { meta: { changes: result.changes } };
          },
          all: () => ({
            results: sqlite
              .prepare(sql)
              .all(
                Object.fromEntries(
                  args.map((value, index) => [String(index + 1), value]),
                ),
              ),
          }),
        }),
      }),
      batch: async (
        statements: Array<{
          sql: string;
          run: () => unknown;
          all: () => unknown;
        }>,
      ) =>
        statements.map((statement) =>
          /^\s*SELECT/i.test(statement.sql) ? statement.all() : statement.run(),
        ),
    },
  },
}));

vi.mock("@/db", () => ({ getDb: vi.fn() }));

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE storefronts (
      id text PRIMARY KEY,
      active_release_id text,
      updated_at text,
      deleted_at text
    );
    CREATE TABLE storefront_theme_builds (
      id text PRIMARY KEY,
      status text NOT NULL,
      artifact_prefix text,
      manifest_json text,
      deleted_at text
    );
    CREATE TABLE storefront_themes (
      id text PRIMARY KEY,
      storefront_id text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_theme_templates (
      id text PRIMARY KEY,
      theme_id text NOT NULL,
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
      deleted_at text
    );
    CREATE TABLE storefront_page_revisions (
      id text PRIMARY KEY,
      page_id text NOT NULL,
      document text NOT NULL
    );
    CREATE TABLE storefront_content_publications (
      id text PRIMARY KEY,
      storefront_id text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_content_publication_items (
      id text PRIMARY KEY,
      publication_id text NOT NULL,
      item_type text NOT NULL,
      content_id text NOT NULL,
      revision_id text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_releases (
      id text PRIMARY KEY,
      storefront_id text NOT NULL,
      theme_id text NOT NULL,
      source_revision_id text NOT NULL,
      theme_build_id text NOT NULL,
      content_publication_id text,
      status text NOT NULL,
      metadata text,
      created_by text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
  `);
  vi.mocked(getDb).mockResolvedValue(
    drizzle(sqlite, { schema: storefrontSchema }) as never,
  );
  sqlite.exec(`
    INSERT INTO storefronts (id, active_release_id, updated_at) VALUES ('storefront-a', NULL, '2026-01-01');
    INSERT INTO storefront_content_publications (id, storefront_id)
      VALUES ('publication-a', 'storefront-a'), ('publication-b', 'storefront-a');
    INSERT INTO storefront_theme_builds
      (id, status, artifact_prefix, manifest_json)
    VALUES
      ('build-a', 'succeeded', 'themes/a', '{}'),
      ('build-b', 'succeeded', 'themes/b', '{}');
    INSERT INTO storefront_releases
      (id, storefront_id, theme_id, source_revision_id, theme_build_id, content_publication_id, status, created_at, updated_at)
    VALUES
      ('11111111-1111-4111-8111-111111111111', 'storefront-a', 'theme-a', 'source-a', 'build-a', 'publication-a', 'available', '2026-01-01', '2026-01-01'),
      ('22222222-2222-4222-8222-222222222222', 'storefront-a', 'theme-a', 'source-b', 'build-b', 'publication-b', 'available', '2026-01-02', '2026-01-02');
  `);
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

describe("storefront release DAL", () => {
  it("lists release history newest first", async () => {
    const history = await storefrontReleaseDal.listHistory("storefront-a");
    expect(history.releases.map((release) => release.id)).toEqual([
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
    ]);
    // The pager cannot tell a full page from the last one without the total.
    expect(history.pagination).toEqual({
      page: 1,
      limit: 50,
      total: 2,
      totalPages: 1,
    });
  });

  it("counts every release, not just the page it returned", async () => {
    const first = await storefrontReleaseDal.listHistory("storefront-a", {
      limit: 1,
    });
    expect(first.releases).toHaveLength(1);
    expect(first.pagination).toMatchObject({
      page: 1,
      total: 2,
      totalPages: 2,
    });

    const second = await storefrontReleaseDal.listHistory("storefront-a", {
      limit: 1,
      offset: 1,
    });
    expect(second.releases.map((release) => release.id)).toEqual([
      "11111111-1111-4111-8111-111111111111",
    ]);
    expect(second.pagination).toMatchObject({ page: 2, totalPages: 2 });
  });

  it("activates a release with an OCC-protected atomic pointer switch", async () => {
    insertValidPublicationItems();
    const activated = await activateTarget();
    expect(activated.id).toBe(targetReleaseId);
    expect(
      (
        sqlite
          .prepare(
            "SELECT active_release_id FROM storefronts WHERE id = 'storefront-a'",
          )
          .get() as { active_release_id: string }
      ).active_release_id,
    ).toBe(targetReleaseId);
  });

  it("rejects a legacy release without ContentPublication", async () => {
    sqlite.exec(
      "UPDATE storefront_releases SET content_publication_id = NULL WHERE id = '22222222-2222-4222-8222-222222222222'",
    );
    await expect(
      storefrontReleaseDal.activateRelease({
        storefrontId: "storefront-a",
        releaseId: "22222222-2222-4222-8222-222222222222",
        expectedActiveReleaseId: null,
      }),
    ).rejects.toThrow("RELEASE_NOT_ACTIVATABLE");
  });

  it.each([
    [
      "missing",
      "UPDATE storefront_releases SET content_publication_id = 'missing' WHERE id = '22222222-2222-4222-8222-222222222222'",
    ],
    [
      "deleted",
      "UPDATE storefront_content_publications SET deleted_at = '2026-01-03' WHERE id = 'publication-b'",
    ],
    [
      "cross-storefront",
      "UPDATE storefront_content_publications SET storefront_id = 'storefront-b' WHERE id = 'publication-b'",
    ],
  ])("rejects a %s ContentPublication", async (_case, sql) => {
    sqlite.exec(sql);
    await expect(activateTarget()).rejects.toThrow("RELEASE_NOT_ACTIVATABLE");
  });

  it("rejects a missing content revision", async () => {
    sqlite.exec(`
      INSERT INTO storefront_content_publication_items
        (id, publication_id, item_type, content_id, revision_id)
      VALUES ('item-missing', 'publication-b', 'page', 'page-missing', 'revision-missing');
    `);
    await expect(activateTarget()).rejects.toThrow("RELEASE_NOT_ACTIVATABLE");
  });

  it("rejects a deleted content owner", async () => {
    insertValidPublicationItems();
    sqlite.exec(
      "UPDATE storefront_pages SET deleted_at = '2026-01-03' WHERE id = 'page-a'",
    );
    await expect(activateTarget()).rejects.toThrow("RELEASE_NOT_ACTIVATABLE");
  });

  it("rejects a cross-storefront content owner", async () => {
    insertValidPublicationItems();
    sqlite.exec(`
      INSERT INTO storefronts (id, updated_at) VALUES ('storefront-b', '2026-01-03');
      UPDATE storefront_themes SET storefront_id = 'storefront-b' WHERE id = 'theme-a';
    `);
    await expect(activateTarget()).rejects.toThrow("RELEASE_NOT_ACTIVATABLE");
  });

  it("rejects a malformed content snapshot", async () => {
    insertValidPublicationItems();
    sqlite
      .prepare(
        "UPDATE storefront_theme_template_revisions SET document = ? WHERE id = ?",
      )
      .run(JSON.stringify({ version: 2, sections: [] }), "template-revision-a");
    await expect(activateTarget()).rejects.toThrow("RELEASE_NOT_ACTIVATABLE");
  });

  it("rejects unsupported navigation publication items", async () => {
    sqlite.exec(`
      INSERT INTO storefront_content_publication_items
        (id, publication_id, item_type, content_id, revision_id)
      VALUES ('item-navigation', 'publication-b', 'navigation', 'nav-a', 'nav-revision-a');
    `);
    await expect(activateTarget()).rejects.toThrow("RELEASE_NOT_ACTIVATABLE");
  });

  it("rejects a stale expected active release", async () => {
    sqlite.exec(
      "UPDATE storefronts SET active_release_id = '11111111-1111-4111-8111-111111111111'",
    );
    await expect(
      storefrontReleaseDal.activateRelease({
        storefrontId: "storefront-a",
        releaseId: "22222222-2222-4222-8222-222222222222",
        expectedActiveReleaseId: null,
      }),
    ).rejects.toThrow("RELEASE_ACTIVATION_CONFLICT");
  });
});

describe("renameRelease", () => {
  function readMetadata(id: string) {
    const row = sqlite
      .prepare("SELECT metadata FROM storefront_releases WHERE id = ?")
      .get(id) as { metadata: string | null };
    return row.metadata === null ? null : JSON.parse(row.metadata);
  }

  it("stores the note without touching what the release serves", async () => {
    await storefrontReleaseDal.renameRelease({
      storefrontId: "storefront-a",
      releaseId: targetReleaseId,
      note: "  Reworded the homepage hero  ",
    });

    expect(readMetadata(targetReleaseId)).toEqual({
      note: "Reworded the homepage hero",
    });
    // A release points at an immutable build and publication. Renaming must
    // never become a second way to change what production serves.
    const row = sqlite
      .prepare(
        "SELECT theme_build_id, content_publication_id, status FROM storefront_releases WHERE id = ?",
      )
      .get(targetReleaseId);
    expect(row).toMatchObject({
      theme_build_id: "build-b",
      content_publication_id: "publication-b",
      status: "available",
    });
  });

  it("keeps other metadata a release already carries", async () => {
    sqlite
      .prepare("UPDATE storefront_releases SET metadata = ? WHERE id = ?")
      .run(JSON.stringify({ deployedBy: "queue" }), targetReleaseId);

    await storefrontReleaseDal.renameRelease({
      storefrontId: "storefront-a",
      releaseId: targetReleaseId,
      note: "Hotfix",
    });

    expect(readMetadata(targetReleaseId)).toEqual({
      deployedBy: "queue",
      note: "Hotfix",
    });
  });

  it("clears the note when renamed to nothing", async () => {
    await storefrontReleaseDal.renameRelease({
      storefrontId: "storefront-a",
      releaseId: targetReleaseId,
      note: "First try",
    });
    await storefrontReleaseDal.renameRelease({
      storefrontId: "storefront-a",
      releaseId: targetReleaseId,
      note: "   ",
    });

    expect(readMetadata(targetReleaseId)).toBeNull();
  });

  it("refuses a release belonging to another storefront", async () => {
    await expect(
      storefrontReleaseDal.renameRelease({
        storefrontId: "storefront-b",
        releaseId: targetReleaseId,
        note: "Not mine",
      }),
    ).rejects.toThrow();

    expect(readMetadata(targetReleaseId)).toBeNull();
  });
});
