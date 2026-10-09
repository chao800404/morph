// @vitest-environment node
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { starterThemeWorkspaceFiles } from "@/lib/storefront/starter-theme-files";
import { STARTER_THEME_CONTENT_MODULE_SOURCE } from "@/lib/storefront/starter-theme-v3-files";
import { THEME_CONTENT_MODULE_PATH } from "@/lib/storefront/theme-content-slots";
import { themeSourceStore } from "@/lib/storefront/storage/theme-storage.server";

/**
 * `src/morph/content.ts` is the author's file: the server takes edits and
 * deletions of it like any other source file, and the explicit restore writes
 * the Starter module back only while it is missing, under the same create
 * precondition and source generation as any create.
 *
 * Real SQLite with the real migration, the production storage and the real
 * handlers; only `createServerFn` and the auth middleware are stood in for.
 * The request the editor's restore command sends is pinned by
 * editor-code-workspace.test.tsx; this proves what the server does with it.
 * The database harness is the one `theme-binary-build.test.ts` uses.
 */

vi.mock("@tanstack/react-start", () => {
  type Validator = (data: unknown) => unknown;
  type Handler = (args: {
    data: unknown;
    context: { user: { id: string } };
  }) => unknown;
  function builder(validator: Validator = (data) => data) {
    return {
      validator: (next: Validator) => builder(next),
      middleware: () => builder(validator),
      handler:
        (handler: Handler) =>
        ({ data }: { data: unknown }) =>
          handler({ data: validator(data), context: { user: { id: "u1" } } }),
    };
  }
  return { createServerFn: () => builder() };
});

vi.mock("@/server/middleware/auth.middleware", () => ({
  commerceAdminMiddleware: {},
}));

const r2 = vi.hoisted(() => {
  const objects = new Map<string, Uint8Array>();
  const object = (bytes: Uint8Array) => ({
    body: bytes,
    size: bytes.byteLength,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
    text: async () => new TextDecoder().decode(bytes),
  });
  const bucket = {
    async get(key: string) {
      const bytes = objects.get(key);
      return bytes ? object(bytes) : null;
    },
    async head(key: string) {
      const bytes = objects.get(key);
      return bytes ? { size: bytes.byteLength } : null;
    },
    async put(
      key: string,
      value: Uint8Array,
      options?: { onlyIf?: { etagDoesNotMatch?: string } },
    ) {
      if (options?.onlyIf?.etagDoesNotMatch === "*" && objects.has(key)) {
        return null;
      }
      objects.set(key, new Uint8Array(value));
      return { key, size: value.byteLength };
    },
    async delete(key: string) {
      objects.delete(key);
    },
    async list() {
      return { objects: [], truncated: false };
    },
  };
  return { objects, bucket };
});

vi.mock("cloudflare:workers", () => ({
  env: {
    R2_BUCKET: r2.bucket,
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
              const upper = sql.trim().toUpperCase();
              if (upper.startsWith("SELECT") || upper.includes("RETURNING")) {
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
      batch: async (statements: Array<any>) =>
        sqlite.transaction(() =>
          statements.map((s) => {
            if (typeof s.run === "function") return s.run();
            if (typeof s.all === "function") return s.all();
            return {};
          }),
        )(),
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
      active_release_id text,
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
      source_generation integer DEFAULT 1 NOT NULL,
      source_index_version integer,
      source_index_status text,
      source_index text,
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
      source_generation integer,
      message text,
      source text,
      snapshot text,
      source_manifest text,
      source_index text,
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
      route_path text,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE UNIQUE INDEX storefront_theme_templates_active_name_unique
      ON storefront_theme_templates (theme_id, type, name)
      WHERE deleted_at IS NULL;
    CREATE UNIQUE INDEX storefront_theme_templates_active_route_unique
      ON storefront_theme_templates (theme_id, route_path)
      WHERE route_path IS NOT NULL AND deleted_at IS NULL;
    CREATE TABLE storefront_theme_route_document_moves (
      id text PRIMARY KEY NOT NULL,
      theme_id text NOT NULL,
      from_route_path text NOT NULL,
      to_route_path text NOT NULL,
      source_generation integer NOT NULL,
      sequence integer NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE storefront_content_publication_items (
      id text PRIMARY KEY NOT NULL,
      item_type text NOT NULL,
      content_id text NOT NULL,
      metadata text NOT NULL DEFAULT '{}',
      deleted_at text
    );
    CREATE UNIQUE INDEX storefront_theme_files_unique_path_idx
    ON storefront_theme_files (storefront_id, theme_id, path)
    WHERE deleted_at IS NULL;
  `);

  sqlite.exec(`
    INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
    VALUES ('storefront-a', 'channel-a', 'Store A', 'draft', 'now', 'now');
    INSERT INTO storefront_themes (id, storefront_id, name, status, source_generation, created_at, updated_at)
    VALUES ('theme-a', 'storefront-a', 'Theme A', 'draft', 1, 'now', 'now');
  `);

  applyBinaryFilesMigration();
  r2.objects.clear();

  const db = drizzle(sqlite, { schema: storefrontSchema });
  vi.mocked(getDb).mockResolvedValue(db as any);
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

// The real migration, applied over the table as it was before it.
function applyBinaryFilesMigration() {
  const migration = readFileSync(
    resolve(process.cwd(), "drizzle/0059_theme_binary_files.sql"),
    "utf8",
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.replace(/--.*$/gm, "").trim()) sqlite.exec(statement);
  }
}

const STORE = "storefront-a";
const THEME = "theme-a";

type Result = {
  success: boolean;
  error?: string;
  message: string;
  data?: { id: string; version: number; sourceGeneration?: number };
};
const handlers = () => import("./storefront-theme-files.serverFn");
const call = (fn: unknown, data: Record<string, unknown>) =>
  (fn as (args: { data: unknown }) => Promise<Result>)({ data });

/** A Theme created from today's Starter. */
function seedStarterWorkspace() {
  const insert = sqlite.prepare(
    `INSERT INTO storefront_theme_files
      (id, storefront_id, theme_id, path, content, mime_type, is_entry, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'now', 'now')`,
  );
  starterThemeWorkspaceFiles().forEach((file, index) => {
    insert.run(
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      STORE,
      THEME,
      file.path,
      file.content,
      file.mimeType ?? "text/plain",
      file.isEntry ? 1 : 0,
    );
  });
}

const generation = async () =>
  (await themeSourceStore.getSourceGeneration(STORE, THEME))!;
const contentModule = async () =>
  (await themeSourceStore.listFiles(STORE, THEME)).find(
    (file) => file.path === THEME_CONTENT_MODULE_PATH,
  );

/** The request the editor's restore command sends. */
const restore = async (expectedSourceGeneration: number) =>
  call((await handlers()).saveStorefrontThemeFile, {
    storefrontId: STORE,
    themeId: THEME,
    path: THEME_CONTENT_MODULE_PATH,
    content: STARTER_THEME_CONTENT_MODULE_SOURCE,
    mimeType: "text/typescript",
    expectMissing: true,
    expectedSourceGeneration,
  });

async function deleteContentModule() {
  const existing = (await contentModule())!;
  const deleted = await call((await handlers()).deleteStorefrontThemeFile, {
    storefrontId: STORE,
    themeId: THEME,
    path: THEME_CONTENT_MODULE_PATH,
    expectedFileId: existing.id,
    expectedVersion: existing.version,
    expectedSourceGeneration: await generation(),
  });
  expect(deleted.success, deleted.message).toBe(true);
  expect(await contentModule()).toBeUndefined();
}

describe("the author's content module on the server", () => {
  it("takes an author's edit like any source file", async () => {
    seedStarterWorkspace();
    const existing = (await contentModule())!;
    const edited = `${STARTER_THEME_CONTENT_MODULE_SOURCE}\n// mine\n`;

    const saved = await call((await handlers()).saveStorefrontThemeFile, {
      storefrontId: STORE,
      themeId: THEME,
      path: THEME_CONTENT_MODULE_PATH,
      content: edited,
      mimeType: "text/typescript",
      expectedFileId: existing.id,
      expectedVersion: existing.version,
      expectedSourceGeneration: await generation(),
    });

    expect(saved.success, saved.message).toBe(true);
    expect((await contentModule())?.content).toBe(edited);
  });

  it("restores the Starter module after the author deleted it", async () => {
    seedStarterWorkspace();
    await deleteContentModule();

    const restored = await restore(await generation());

    expect(restored.success, restored.message).toBe(true);
    expect((await contentModule())?.content).toBe(
      STARTER_THEME_CONTENT_MODULE_SOURCE,
    );
  });

  it("never overwrites the author's module, even from a stale editor", async () => {
    seedStarterWorkspace();
    const existing = (await contentModule())!;
    const edited = "export const morph = { pages: { get() {} } }; // mine\n";
    const saved = await call((await handlers()).saveStorefrontThemeFile, {
      storefrontId: STORE,
      themeId: THEME,
      path: THEME_CONTENT_MODULE_PATH,
      content: edited,
      mimeType: "text/typescript",
      expectedFileId: existing.id,
      expectedVersion: existing.version,
      expectedSourceGeneration: await generation(),
    });
    expect(saved.success, saved.message).toBe(true);

    // An editor that still believes the file is missing, at the current
    // generation, so only the create precondition stands in the way.
    const restored = await restore(await generation());

    expect(restored.success).toBe(false);
    expect(restored.error).toBe("FILE_VERSION_CONFLICT");
    expect((await contentModule())?.content).toBe(edited);
  });

  it("refuses a restore when another tab changed the Theme first", async () => {
    seedStarterWorkspace();
    await deleteContentModule();
    const seenByThisTab = await generation();

    // Another tab saves an unrelated file in the meantime.
    const other = (await themeSourceStore.listFiles(STORE, THEME)).find(
      (file) => file.path === "src/routes/index.tsx",
    )!;
    const otherSave = await call((await handlers()).saveStorefrontThemeFile, {
      storefrontId: STORE,
      themeId: THEME,
      path: other.path,
      content: `${other.content}\n// from another tab\n`,
      mimeType: "text/typescript",
      expectedFileId: other.id,
      expectedVersion: other.version,
      expectedSourceGeneration: seenByThisTab,
    });
    expect(otherSave.success, otherSave.message).toBe(true);

    const restored = await restore(seenByThisTab);

    expect(restored).toMatchObject({
      success: false,
      error: "SOURCE_GENERATION_CONFLICT",
    });
    expect(await contentModule()).toBeUndefined();
  });
});
