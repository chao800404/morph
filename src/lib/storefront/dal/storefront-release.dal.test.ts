import Database from "better-sqlite3";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storefrontReleaseDal } from "./storefront-release.dal";

let sqlite: Database.Database;

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
            results: sqlite.prepare(sql).all(
              Object.fromEntries(
                args.map((value, index) => [String(index + 1), value]),
              ),
            ),
          }),
        }),
      }),
      batch: async (statements: Array<{ sql: string; run: () => unknown; all: () => unknown }>) =>
        statements.map((statement) =>
          /^\s*SELECT/i.test(statement.sql)
            ? statement.all()
            : statement.run(),
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
    INSERT INTO storefront_theme_builds
      (id, status, artifact_prefix, manifest_json)
    VALUES
      ('build-a', 'succeeded', 'themes/a', '{}'),
      ('build-b', 'succeeded', 'themes/b', '{}');
    INSERT INTO storefront_releases
      (id, storefront_id, theme_id, source_revision_id, theme_build_id, status, created_at, updated_at)
    VALUES
      ('11111111-1111-4111-8111-111111111111', 'storefront-a', 'theme-a', 'source-a', 'build-a', 'available', '2026-01-01', '2026-01-01'),
      ('22222222-2222-4222-8222-222222222222', 'storefront-a', 'theme-a', 'source-b', 'build-b', 'available', '2026-01-02', '2026-01-02');
  `);
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

describe("storefront release DAL", () => {
  it("lists release history newest first", async () => {
    const history = await storefrontReleaseDal.listHistory("storefront-a");
    expect(history.map((release) => release.id)).toEqual([
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("activates a release with an OCC-protected atomic pointer switch", async () => {
    const activated = await storefrontReleaseDal.activateRelease({
      storefrontId: "storefront-a",
      releaseId: "22222222-2222-4222-8222-222222222222",
      expectedActiveReleaseId: null,
    });
    expect(activated.id).toBe("22222222-2222-4222-8222-222222222222");
    expect(
      (sqlite
        .prepare("SELECT active_release_id FROM storefronts WHERE id = 'storefront-a'")
        .get() as { active_release_id: string }).active_release_id,
    ).toBe("22222222-2222-4222-8222-222222222222");
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
