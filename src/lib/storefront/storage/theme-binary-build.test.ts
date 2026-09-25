// @vitest-environment node
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { materializeThemeBuildInput } from "../compiler/theme-build-materializer";
import { LocalViteThemeBuildRunner } from "../compiler/local-vite-theme-build-runner";
import { CloudflareR2ThemeSourceBlobStore } from "./cloudflare-r2-theme-source-blob-store";
import {
  createD1ThemeRevisionStore,
  d1ThemeSourceStore,
  readThemeBinaryFile,
} from "./d1-theme-storage";

/**
 * Binary Theme files through the storage layer, against real SQLite with the
 * real migration and an R2 bucket held in memory: what is stored, what each
 * reader sees, and that revisions, rollback and the build never take the
 * empty `content` of a binary row for its bytes.
 */

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

const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

const STORE = "storefront-a";
const THEME = "theme-a";
const blobStore = () => new CloudflareR2ThemeSourceBlobStore(r2.bucket);
const revisions = () => createD1ThemeRevisionStore({ blobStore: blobStore() });

const upload = (
  path: string,
  bytes: Uint8Array,
  expectedSourceGeneration = 1,
) =>
  d1ThemeSourceStore.saveBinaryFile(
    STORE,
    THEME,
    { path, bytes, expectMissing: true },
    { expectedSourceGeneration },
  );

/**
 * The local build path's gate: a frozen revision holding a PNG, written and
 * read back by the production storage code, materialised by the production
 * materializer and built by a real Vite build in the local runner. The PNG
 * the build emits must be the stored bytes, with its type, exactly.
 */
describe("building a frozen revision with a binary file, locally", () => {
  it(
    "emits the stored bytes of public/ exactly",
    { timeout: 180_000 },
    async () => {
      sqlite
        .prepare(
          `INSERT INTO storefront_theme_files
          (id, storefront_id, theme_id, path, content, mime_type, is_entry, version, created_at, updated_at)
         VALUES
          ('css', ?, ?, 'src/styles/global.css', '@import "tailwindcss";', 'text/css', 0, 1, 'now', 'now'),
          ('page', ?, ?, 'src/pages/index.tsx', ?, 'text/typescript', 1, 1, 'now', 'now')`,
        )
        .run(
          STORE,
          THEME,
          STORE,
          THEME,
          `export default function Page() {\n  return <img src="/images/hero.png" alt="" />;\n}\n`,
        );
      // Every byte value, so any text decoding along the way would show.
      const bytes = new Uint8Array(200_000);
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = (index * 31 + 7) % 256;
      }
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      // Stored through the production upload, which records the revision.
      await upload("public/images/hero.png", bytes);
      const revision = await revisions().materializeRevisionByNumber(
        STORE,
        THEME,
        1,
      );
      expect(
        revision.snapshot.find(
          (file) => file.path === "public/images/hero.png",
        ),
      ).toMatchObject({ encoding: "binary", blobDigest: sha256(bytes) });

      const input = materializeThemeBuildInput({
        build: {
          id: "local-binary-gate",
          storefrontId: STORE,
          themeId: THEME,
          sourceRevisionId: revision.id,
          status: "queued",
          inputHash: null,
          compilerId: null,
          compilerVersion: null,
          artifactPrefix: null,
          manifestJson: null,
          diagnosticsJson: null,
          errorMessage: null,
          startedAt: null,
          completedAt: null,
          createdBy: null,
          createdAt: "now",
          updatedAt: "now",
        },
        revision,
        binaryFiles: "include",
      });
      expect(input.binaryFiles).toEqual([
        {
          path: "public/images/hero.png",
          digest: sha256(bytes),
          sizeBytes: bytes.byteLength,
          mimeType: "image/png",
        },
      ]);

      const store = blobStore();
      const result = await new LocalViteThemeBuildRunner({
        workDirPrefix: ".morph-builds/binary-gate",
        maxDurationMs: 150_000,
      }).run({
        ...input,
        readBinaryFile: (digest) => readThemeBinaryFile(store, digest),
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      const emitted = result.artifacts.find(
        (artifact) => artifact.path === "images/hero.png",
      );
      expect(emitted?.mimeType).toBe("image/png");
      expect(emitted?.content instanceof Uint8Array).toBe(true);
      const emittedBytes = emitted!.content as Uint8Array;
      expect(emittedBytes.byteLength).toBe(bytes.byteLength);
      expect(sha256(emittedBytes)).toBe(sha256(bytes));
    },
  );
});
