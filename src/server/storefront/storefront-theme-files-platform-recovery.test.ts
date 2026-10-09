// @vitest-environment node
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { materializeThemeBuildInput } from "@/lib/storefront/compiler/theme-build-materializer";
import { LocalViteThemeBuildRunner } from "@/lib/storefront/compiler/local-vite-theme-build-runner";
import { START_TOOLCHAIN } from "@/lib/storefront/compiler/sandbox-toolchain.test-support";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import {
  themeRevisionStore,
  themeSourceStore,
} from "@/lib/storefront/storage/theme-storage.server";

/**
 * Recovering a Theme saved before the server refused the platform's build
 * files. Its workspace already holds `__entry.tsx`; nothing may write one now,
 * but the build refuses the Theme while it is there, so deleting it has to be
 * possible — and has to be enough.
 *
 * Real SQLite with the real migration, the production storage, the real
 * `deleteStorefrontThemeFile` handler (only `createServerFn` and the auth
 * middleware are stood in for; the transport and session are covered by
 * e2e/theme-path-refused.spec.ts), the production materializer and a real
 * local Vite build. The database harness is the one
 * `theme-binary-build.test.ts` uses.
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
const ENTRY_ID = "00000000-0000-4000-8000-0000000000e1";
const STALE = 'throw new Error("STALE_PLATFORM_ENTRY");';

/** A workspace as one saved before the refusal could have left it. */
function seedLegacyWorkspace() {
  const insert = sqlite.prepare(
    `INSERT INTO storefront_theme_files
      (id, storefront_id, theme_id, path, content, mime_type, is_entry, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'now', 'now')`,
  );
  STARTER_THEME_FILES.forEach((file, index) => {
    insert.run(
      `starter-${index}`,
      STORE,
      THEME,
      file.path,
      file.content,
      file.mimeType ?? "text/plain",
      file.isEntry ? 1 : 0,
    );
  });
  insert.run(ENTRY_ID, STORE, THEME, "__entry.tsx", STALE, "text/tsx", 0);
}

const queuedBuild = (id: string, revisionId: string) => ({
  id,
  storefrontId: STORE,
  themeId: THEME,
  sourceRevisionId: revisionId,
  status: "queued" as const,
  inputHash: null,
  compilerId: null,
  compilerVersion: null,
  framework: "tanstack-start",
  inputHashFormat: 2 as const,
  toolchainId: START_TOOLCHAIN.id,
  artifactPrefix: null,
  manifestJson: null,
  diagnosticsJson: null,
  errorMessage: null,
  startedAt: null,
  completedAt: null,
  createdBy: null,
  createdAt: "now",
  updatedAt: "now",
});

/** Freezes the workspace as a revision and returns its build input step. */
async function freeze(buildId: string) {
  const generation = (await themeSourceStore.getSourceGeneration(
    STORE,
    THEME,
  ))!;
  const created = await themeRevisionStore.createRevision(STORE, THEME, {
    message: buildId,
    expectedSourceGeneration: generation,
  });
  const revision = await themeRevisionStore.materializeRevision(
    STORE,
    THEME,
    created.id,
  );
  return () =>
    materializeThemeBuildInput({
      build: queuedBuild(buildId, revision.id),
      revision,
    });
}

type Result = { success: boolean; error?: string; message: string };

describe("a Theme holding a stale platform file", () => {
  it(
    "is refused by the build until the file is deleted through the API, then builds",
    { timeout: 300_000 },
    async () => {
      const { deleteStorefrontThemeFile } =
        await import("./storefront-theme-files.serverFn");
      const remove = (data: Record<string, unknown>) =>
        (
          deleteStorefrontThemeFile as unknown as (args: {
            data: unknown;
          }) => Promise<Result>
        )({ data });

      seedLegacyWorkspace();

      // 1. The build refuses the Theme as it is.
      expect(await freeze("stale-entry-blocked")).toThrow(
        /PLATFORM_OWNED_THEME_BUILD_PATH/,
      );

      // 2. The deletion is still held to the file's version and to the
      // generation the caller read.
      const generation = (await themeSourceStore.getSourceGeneration(
        STORE,
        THEME,
      ))!;
      const target = {
        storefrontId: STORE,
        themeId: THEME,
        path: "__entry.tsx",
        expectedFileId: ENTRY_ID,
      };
      expect(
        await remove({
          ...target,
          expectedVersion: 2,
          expectedSourceGeneration: generation,
        }),
      ).toMatchObject({ success: false, error: "FILE_VERSION_CONFLICT" });
      expect(
        await remove({
          ...target,
          expectedVersion: 1,
          expectedSourceGeneration: generation + 1,
        }),
      ).toMatchObject({ success: false, error: "SOURCE_GENERATION_CONFLICT" });

      // 3. Deleted through the API, as the author would.
      const deleted = await remove({
        ...target,
        expectedVersion: 1,
        expectedSourceGeneration: generation,
      });
      expect(deleted.success, deleted.message).toBe(true);
      expect(
        (await themeSourceStore.listFiles(STORE, THEME)).map(
          (file) => file.path,
        ),
      ).not.toContain("__entry.tsx");

      // 4. The next revision builds, and nothing of the stale copy ships.
      const input = (await freeze("stale-entry-recovered"))();
      expect(input.files.map((file) => file.path)).not.toContain("__entry.tsx");
      const result = await new LocalViteThemeBuildRunner({
        workDirPrefix: ".morph-builds/stale-platform-file-recovery",
        maxDurationMs: 280_000,
      }).run(input);
      expect(
        result.success,
        result.success ? undefined : result.errorMessage,
      ).toBe(true);
      if (!result.success) return;
      expect(result.artifacts.length).toBeGreaterThan(0);
      for (const artifact of result.artifacts) {
        if (typeof artifact.content === "string") {
          expect(artifact.content, artifact.path).not.toContain(
            "STALE_PLATFORM_ENTRY",
          );
        }
      }
    },
  );
});
