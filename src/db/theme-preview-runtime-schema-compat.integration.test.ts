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
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  getTableConfig,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";

import { storefronts, storefrontThemes } from "@/db/storefront.schema";
import { storefrontDal } from "@/lib/storefront/dal/storefront.dal";
import { storefrontThemeDal } from "@/lib/storefront/dal/storefront-theme.dal";

/**
 * Migration 0080 (`storefront_themes.preview_runtime`) against the real D1
 * engine (Miniflare), each database in its own temporary persist directory
 * — never the shared `.wrangler` state, never a remote one.
 *
 * - Old code on the new schema is safe: what the code before #271 issues
 *   against `storefront_themes` runs on a database with 0080 applied, and an
 *   insert written the old way leaves the new column NULL. This is what lets
 *   a code-only rollback keep the column
 *   (scripts/rollback/0080_theme_preview_runtime.md).
 * - New code on the old schema is not: with 0080 not applied, the editor
 *   context read and the new Theme insert fail with "no such column". That is
 *   documented here, not tolerated: the deploy check
 *   (scripts/check-pending-migrations.mjs) is what keeps this code off a
 *   database without 0080, and nothing in the code falls back.
 */

const MIGRATIONS = join(process.cwd(), "drizzle");
const NOW = "2026-10-18T00:00:00.000Z";
const STOREFRONT = "11111111-1111-4111-8111-111111111111";
const THEME = "22222222-2222-4222-8222-222222222222";

type Database = Readonly<{
  d1: D1Database;
  dispose: () => Promise<void>;
  dir: string;
}>;

/** A fresh local D1 with every migration up to and including `last`. */
async function migratedDatabase(last: string): Promise<Database> {
  const dir = mkdtempSync(join(tmpdir(), "theme-preview-runtime-compat-"));
  writeFileSync(
    join(dir, "wrangler.json"),
    JSON.stringify({
      name: "theme-preview-runtime-compat",
      compatibility_date: "2025-09-02",
      d1_databases: [
        {
          binding: "DATABASE",
          database_name: "compat",
          database_id: "00000000-0000-0000-0000-000000000000",
        },
      ],
    }),
  );
  const proxy = await getPlatformProxy({
    configPath: join(dir, "wrangler.json"),
    persist: { path: join(dir, "state") },
  });
  const d1 = (proxy.env as { DATABASE: D1Database }).DATABASE;
  const files = readdirSync(MIGRATIONS)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort()
    .filter((file) => file <= last);
  expect(files.at(-1)).toBe(last);
  for (const file of files) {
    for (const statement of readFileSync(join(MIGRATIONS, file), "utf8").split(
      "--> statement-breakpoint",
    )) {
      if (statement.trim()) await d1.prepare(statement.trim()).run();
    }
  }
  return { d1, dir, dispose: () => proxy.dispose() };
}

/** Points the application's `getDb()` (and raw `env.DATABASE`) at `db`. */
function useDatabase(db: Database) {
  (env as unknown as { DATABASE: D1Database }).DATABASE = db.d1;
}

/**
 * `storefront_themes` as the code before #271 declares it
 * (origin/main 8155d10, src/db/storefront.schema.ts): every column but
 * `preview_runtime`. Drizzle names exactly the declared columns in an
 * insert, so this is the statement that code's `ensureDefault` issues.
 */
const oldStorefrontThemes = sqliteTable("storefront_themes", {
  id: text("id").primaryKey(),
  storefrontId: text("storefront_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"),
  publishedSourceRevisionId: text("published_source_revision_id"),
  sourceGeneration: integer("source_generation").notNull().default(1),
  sourceIndexVersion: integer("source_index_version"),
  sourceIndexStatus: text("source_index_status"),
  sourceIndex: text("source_index", { mode: "json" }),
  releaseGeneration: integer("release_generation").notNull().default(1),
  framework: text("framework"),
  metadata: text("metadata", { mode: "json" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

const columnNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table)
    .columns.map((column) => column.name)
    .sort();

/**
 * The message of a rejection and every error it was caused by; Drizzle
 * reports "Failed query: …" and keeps D1's own error as the cause. Fails
 * the test if the promise does not reject.
 */
async function failureOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const messages: string[] = [];
    for (let at: unknown = error; at instanceof Error; at = at.cause) {
      messages.push(at.message);
    }
    return messages.join("\n");
  }
  throw new Error("Expected the call to fail, and it succeeded.");
}

let withRuntime: Database;
let withoutRuntime: Database;

beforeAll(async () => {
  withRuntime = await migratedDatabase("0080_theme_preview_runtime.sql");
  withoutRuntime = await migratedDatabase("0079_preview_content_tickets.sql");
}, 240_000);

afterAll(async () => {
  for (const db of [withRuntime, withoutRuntime]) {
    if (!db) continue;
    await db.dispose();
    rmSync(db.dir, { recursive: true, force: true });
  }
});

describe("old code on a database with 0080", () => {
  beforeAll(async () => {
    useDatabase(withRuntime);
    await withRuntime.d1
      .prepare(
        `INSERT OR IGNORE INTO storefronts (id, sales_channel_id, name, status, metadata, created_at, updated_at)
         VALUES (?1, 'channel-old-code', 'Online Store', 'published', '{}', ?2, ?2)`,
      )
      .bind(STOREFRONT, NOW)
      .run();
  });

  it("pins the old declaration: today's columns minus preview_runtime", () => {
    // If the table gains or loses another column, this pin is stale and
    // says so here rather than passing on a statement nobody issues.
    expect(columnNames(oldStorefrontThemes)).toEqual(
      columnNames(storefrontThemes).filter(
        (name) => name !== "preview_runtime",
      ),
    );
  });

  it("inserts a Theme the old way, and the new column is NULL", async () => {
    const db = drizzle(withRuntime.d1);
    const insert = db.insert(oldStorefrontThemes).values({
      // The values ensureDefault passed before #271.
      id: THEME,
      storefrontId: STOREFRONT,
      name: "Default",
      status: "published",
      metadata: {},
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(insert.toSQL().sql).not.toContain("preview_runtime");
    await insert;
    expect(
      await withRuntime.d1
        .prepare(
          "SELECT name, preview_runtime FROM storefront_themes WHERE id = ?1",
        )
        .bind(THEME)
        .first(),
    ).toEqual({ name: "Default", preview_runtime: null });
  });

  it("reads the editor context the old way", async () => {
    // findEditorContext's selection before #271: named columns, no
    // `themePreviewRuntime`.
    const db = drizzle(withRuntime.d1);
    const rows = await db
      .select({
        storefrontId: storefronts.id,
        storefrontName: storefronts.name,
        storefrontDomain: storefronts.domain,
        storefrontStatus: storefronts.status,
        activeReleaseId: storefronts.activeReleaseId,
        themeId: storefrontThemes.id,
        themeName: storefrontThemes.name,
        themeStatus: storefrontThemes.status,
        themeReleaseGeneration: storefrontThemes.releaseGeneration,
        themeFramework: storefrontThemes.framework,
      })
      .from(storefrontThemes)
      .innerJoin(storefronts, eq(storefrontThemes.storefrontId, storefronts.id))
      .where(
        and(
          eq(storefronts.id, STOREFRONT),
          eq(storefrontThemes.id, THEME),
          isNull(storefronts.deletedAt),
          isNull(storefrontThemes.deletedAt),
        ),
      )
      .limit(1);
    expect(rows).toEqual([
      expect.objectContaining({ themeId: THEME, themeFramework: null }),
    ]);
  });

  // Raw statements #271 does not change, so they are the old code's own.
  // One per kind the old code issues against the table: an existence check
  // guarding a write, a named-column read, a generation bump with the
  // source index, and the publish pointer write. Every other raw statement
  // on storefront_themes is one of these kinds and names its columns.
  it.each([
    [
      "the source-generation guard (storefront-theme-file.dal.ts:75)",
      `SELECT CASE WHEN EXISTS (
        SELECT 1 FROM storefront_themes
        WHERE id = ?1
          AND storefront_id = ?2
          AND source_generation = ?3
          AND deleted_at IS NULL
      ) THEN 1 ELSE json('') END AS ok`,
      [THEME, STOREFRONT, 1],
    ],
    [
      "the generation read (storefront-theme.dal.ts:505)",
      "SELECT source_generation AS generation FROM storefront_themes WHERE id = ?1 AND storefront_id = ?2 AND deleted_at IS NULL",
      [THEME, STOREFRONT],
    ],
    [
      "the generation bump with the source index (storefront-theme-file.dal.ts:256)",
      `UPDATE storefront_themes
      SET source_generation = source_generation + 1,
          source_index_version = ?1,
          source_index_status = ?2,
          source_index = ?3,
          updated_at = ?4
      WHERE id = ?5 AND storefront_id = ?6 AND deleted_at IS NULL`,
      [1, "ready", "{}", NOW, THEME, STOREFRONT],
    ],
    [
      "the publish pointer (storefront-theme.dal.ts:2007)",
      `UPDATE storefront_themes
          SET published_source_revision_id = ?1, release_generation = release_generation + 1, updated_at = ?2
          WHERE id = ?3 AND storefront_id = ?4 AND deleted_at IS NULL`,
      ["revision-1", NOW, THEME, STOREFRONT],
    ],
  ] as const)("runs %s", async (_label, statement, values) => {
    await expect(
      withRuntime.d1
        .prepare(statement)
        .bind(...values)
        .run(),
    ).resolves.toMatchObject({ success: true });
    expect(
      await withRuntime.d1
        .prepare("SELECT preview_runtime FROM storefront_themes WHERE id = ?1")
        .bind(THEME)
        .first(),
    ).toEqual({ preview_runtime: null });
  });
});

/**
 * Every statement that writes an existing `storefront_themes` row in the
 * code before #271, the full list from `git grep` on 8155d10 and on
 * origin/main 6e55687 (which adds the Starter upgrade record write from
 * #260 in place of the Drizzle one), outside tests:
 *
 * - storefront-theme-file.dal.ts:256: source generation bump with the source index.
 * - storefront-theme-file.dal.ts:275: source generation bump only.
 * - storefront-theme-manifest-migration.dal.ts:565: legacy manifest archive (metadata json_set) and generation bump.
 * - storefront-theme.dal.ts:1908: publish pointer and release generation.
 * - storefront-theme.dal.ts:2060: publish pointer restore after a failed publish.
 * - storefront.dal.ts:145 (8155d10): Drizzle `.update(storefrontThemes).set({ metadata, updatedAt })`.
 * - storefront.dal.ts:308 (origin/main): the Starter upgrade record, metadata json_set under a revision CAS.
 *
 * Inserts only create rows. All of them are run here, not a sample, each
 * with arguments that make it write (one row changed), so "unchanged" is
 * never the trivial result of a statement that matched nothing.
 */
const OLD_ROW_WRITES: ReadonlyArray<
  readonly [
    label: string,
    write: (d1: D1Database, themeId: string) => Promise<D1Result | void>,
  ]
> = [
  [
    "storefront-theme-file.dal.ts:256",
    (d1, themeId) =>
      d1
        .prepare(
          `UPDATE storefront_themes
      SET source_generation = source_generation + 1,
          source_index_version = ?1,
          source_index_status = ?2,
          source_index = ?3,
          updated_at = ?4
      WHERE id = ?5 AND storefront_id = ?6 AND deleted_at IS NULL`,
        )
        .bind(1, "ready", "{}", NOW, themeId, STOREFRONT)
        .run(),
  ],
  [
    "storefront-theme-file.dal.ts:275",
    (d1, themeId) =>
      d1
        .prepare(
          `UPDATE storefront_themes
    SET source_generation = source_generation + 1, updated_at = ?1
    WHERE id = ?2 AND storefront_id = ?3 AND deleted_at IS NULL`,
        )
        .bind(NOW, themeId, STOREFRONT)
        .run(),
  ],
  [
    "storefront-theme-manifest-migration.dal.ts:565",
    async (d1, themeId) => {
      const current = await d1
        .prepare(
          "SELECT source_generation AS g FROM storefront_themes WHERE id = ?1",
        )
        .bind(themeId)
        .first<{ g: number }>();
      return d1
        .prepare(
          `UPDATE storefront_themes
        SET metadata = json_set(
              COALESCE(metadata, '{}'),
              '$.legacyManifestArchive',
              json(?1)
            ),
            source_generation = source_generation + 1,
            source_index_version = ?2,
            source_index_status = ?3,
            source_index = ?4,
            updated_at = ?5
        WHERE id = ?6 AND storefront_id = ?7
          AND source_generation = ?8 AND deleted_at IS NULL`,
        )
        .bind(
          JSON.stringify({ version: 1, migratedAt: NOW }),
          1,
          "ready",
          "{}",
          NOW,
          themeId,
          STOREFRONT,
          current!.g,
        )
        .run();
    },
  ],
  [
    "storefront-theme.dal.ts:1908",
    (d1, themeId) =>
      d1
        .prepare(
          `UPDATE storefront_themes
          SET published_source_revision_id = ?1, release_generation = release_generation + 1, updated_at = ?2
          WHERE id = ?3 AND storefront_id = ?4 AND deleted_at IS NULL`,
        )
        .bind("revision-published", NOW, themeId, STOREFRONT)
        .run(),
  ],
  [
    "storefront-theme.dal.ts:2060",
    (d1, themeId) =>
      d1
        .prepare(
          `UPDATE storefront_themes SET published_source_revision_id = ?1, updated_at = ?2 WHERE id = ?3`,
        )
        .bind("revision-restored", NOW, themeId)
        .run(),
  ],
  [
    "storefront.dal.ts:145 (8155d10, Drizzle)",
    async (d1, themeId) => {
      await drizzle(d1)
        .update(oldStorefrontThemes)
        .set({ metadata: { starterTemplateVersion: 29 }, updatedAt: NOW })
        .where(eq(oldStorefrontThemes.id, themeId));
    },
  ],
  [
    "storefront.dal.ts:308 (origin/main, Starter upgrade record)",
    (d1, themeId) =>
      d1
        .prepare(
          `UPDATE storefront_themes
       SET metadata = json_set(
             COALESCE(metadata, '{}'),
             '$.starterTemplateVersion', ?1,
             '$.starterUpgradeRecordRevision', ?2
           ),
           updated_at = ?3
       WHERE id = ?4
         AND CASE
               WHEN json_valid(COALESCE(metadata, '{}')) THEN
                 CASE
                   WHEN json_type(COALESCE(metadata, '{}')) = 'object' THEN
                     CASE COALESCE(json_type(metadata, '$.starterUpgradeRecordRevision'), 'null')
                       WHEN 'null' THEN 0 = ?5
                       WHEN 'integer' THEN
                         json_extract(metadata, '$.starterUpgradeRecordRevision') = ?5
                       WHEN 'real' THEN
                         CASE
                           WHEN json_extract(metadata, '$.starterUpgradeRecordRevision')
                              = CAST(json_extract(metadata, '$.starterUpgradeRecordRevision') AS INTEGER)
                           THEN json_extract(metadata, '$.starterUpgradeRecordRevision') = ?5
                           ELSE 0
                         END
                       ELSE 0
                     END
                   ELSE 0
                 END
               ELSE 0
             END`,
        )
        .bind(29, 1, NOW, themeId, 0)
        .run(),
  ],
];

describe("old code keeps a runtime a Theme already records", () => {
  const recordedThemes = [
    ["33333333-3333-4333-8333-333333333333", "start"],
    ["44444444-4444-4444-8444-444444444444", "client"],
  ] as const;

  const row = (themeId: string) =>
    withRuntime.d1
      .prepare(
        "SELECT preview_runtime, updated_at, metadata FROM storefront_themes WHERE id = ?1",
      )
      .bind(themeId)
      .first<{
        preview_runtime: string | null;
        updated_at: string;
        metadata: string;
      }>();

  beforeEach(async () => {
    useDatabase(withRuntime);
    // Its own storefront row, so this block does not lean on another's setup.
    await withRuntime.d1
      .prepare(
        `INSERT OR IGNORE INTO storefronts (id, sales_channel_id, name, status, metadata, created_at, updated_at)
         VALUES (?1, 'channel-old-code', 'Online Store', 'published', '{}', ?2, ?2)`,
      )
      .bind(STOREFRONT, NOW)
      .run();
    for (const [themeId, runtime] of recordedThemes) {
      await withRuntime.d1
        .prepare("DELETE FROM storefront_themes WHERE id = ?1")
        .bind(themeId)
        .run();
      await withRuntime.d1
        .prepare(
          `INSERT INTO storefront_themes
             (id, storefront_id, name, status, metadata, preview_runtime, created_at, updated_at)
           VALUES (?1, ?2, ?3, 'draft', '{}', ?4, 'before', 'before')`,
        )
        .bind(themeId, STOREFRONT, `Recorded ${runtime}`, runtime)
        .run();
    }
  });

  it.each(
    OLD_ROW_WRITES.flatMap(([label, write]) =>
      recordedThemes.map(
        ([themeId, runtime]) => [label, runtime, themeId, write] as const,
      ),
    ),
  )(
    "%s leaves a recorded %s as it was",
    async (_label, runtime, themeId, write) => {
      await write(withRuntime.d1, themeId);
      const after = await row(themeId);
      // It did write the row…
      expect(after?.updated_at).toBe(NOW);
      // …and the record is what it was.
      expect(after?.preview_runtime).toBe(runtime);
    },
  );

  it("would see a write that touched the column (control)", async () => {
    // The same check, on a statement that does name the column: the
    // assertion above can fail.
    const [themeId] = recordedThemes[0];
    await withRuntime.d1
      .prepare(
        "UPDATE storefront_themes SET preview_runtime = NULL, updated_at = ?1 WHERE id = ?2",
      )
      .bind(NOW, themeId)
      .run();
    const after = await row(themeId);
    expect(after?.updated_at).toBe(NOW);
    expect(after?.preview_runtime).not.toBe("start");
  });
});

describe("new code on a database without 0080", () => {
  beforeAll(() => useDatabase(withoutRuntime));

  it("has no preview_runtime column there", async () => {
    const columns = await withoutRuntime.d1
      .prepare("PRAGMA table_info(storefront_themes)")
      .all<{ name: string }>();
    expect(columns.results.map((column) => column.name)).not.toContain(
      "preview_runtime",
    );
  });

  it("cannot read the editor context", async () => {
    expect(
      await failureOf(storefrontThemeDal.findEditorContext(STOREFRONT, THEME)),
    ).toMatch(/no such column: [\w".]*preview_runtime/);
  });

  it("cannot create the Starter Theme", async () => {
    expect(
      await failureOf(storefrontDal.ensureDefault("channel-new-code")),
    ).toMatch(/table storefront_themes has no column named preview_runtime/);
    expect(
      await withoutRuntime.d1
        .prepare("SELECT count(*) AS n FROM storefront_themes")
        .first(),
    ).toEqual({ n: 0 });
  });
});
