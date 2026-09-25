// @vitest-environment node
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemeSourceRevisionManifest } from "@/lib/storefront/dto/storefront-theme-file.dto";
import { storefrontThemeFileDal } from "../dal/storefront-theme-file.dal";
import { normalizeRevisionSnapshot } from "../compiler/theme-build-materializer";
import { CloudflareR2ThemeSourceBlobStore } from "./cloudflare-r2-theme-source-blob-store";
import {
  createD1ThemeRevisionStore,
  d1ThemeSourceStore,
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

/** A PNG signature followed by filler, `size` bytes in all. */
function png(size = 64, fill = 7) {
  const bytes = new Uint8Array(size).fill(fill);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

const STORE = "storefront-a";
const THEME = "theme-a";
const blobStore = () => new CloudflareR2ThemeSourceBlobStore(r2.bucket);
const revisions = () => createD1ThemeRevisionStore({ blobStore: blobStore() });

function seedSource() {
  sqlite
    .prepare(
      `INSERT INTO storefront_theme_files
        (id, storefront_id, theme_id, path, content, mime_type, version, created_at, updated_at)
       VALUES ('file-route', ?, ?, 'src/routes/index.tsx', 'export default 1;', 'text/typescript', 1, 'now', 'now')`,
    )
    .run(STORE, THEME);
}

const generation = () =>
  (
    sqlite
      .prepare("SELECT source_generation AS g FROM storefront_themes")
      .get() as { g: number }
  ).g;
const fileRow = (path: string) =>
  sqlite
    .prepare(
      "SELECT content, encoding, blob_digest, size_bytes, mime_type, version, deleted_at FROM storefront_theme_files WHERE path = ? AND deleted_at IS NULL",
    )
    .get(path) as
    | {
        content: string;
        encoding: string;
        blob_digest: string | null;
        size_bytes: number | null;
        mime_type: string;
        version: number;
      }
    | undefined;
const latestManifest = () => {
  const row = sqlite
    .prepare(
      "SELECT source_manifest FROM storefront_theme_revisions ORDER BY revision_number DESC LIMIT 1",
    )
    .get() as { source_manifest: string | null } | undefined;
  return row?.source_manifest
    ? (JSON.parse(row.source_manifest) as ThemeSourceRevisionManifest)
    : null;
};

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

describe("the binary files migration", () => {
  it("keeps every existing row source text", () => {
    seedSource();
    expect(fileRow("src/routes/index.tsx")).toMatchObject({
      encoding: "utf8",
      blob_digest: null,
      size_bytes: null,
    });
  });

  it("refuses rows whose columns disagree", () => {
    const insert = (values: string) => () =>
      sqlite.exec(
        `INSERT INTO storefront_theme_files
           (id, storefront_id, theme_id, path, content, encoding, blob_digest, size_bytes, created_at, updated_at)
         VALUES (${values}, 'now', 'now')`,
      );
    const digest = "a".repeat(64);
    // Bytes without a reference, or with a body, or a malformed digest.
    expect(insert(`'1','s','t','public/a.png','','binary',NULL,10`)).toThrow(
      "disagree",
    );
    expect(
      insert(`'2','s','t','public/a.png','x','binary','${digest}',10`),
    ).toThrow("disagree");
    expect(
      insert(`'3','s','t','public/a.png','','binary','${"A".repeat(64)}',10`),
    ).toThrow("disagree");
    expect(insert(`'4','s','t','public/a.png','','binary','abc',10`)).toThrow(
      "disagree",
    );
    expect(
      insert(`'5','s','t','public/a.png','','binary','${digest}',NULL`),
    ).toThrow("disagree");
    // Source carrying a reference.
    expect(
      insert(`'6','s','t','src/a.ts','x','utf8','${digest}',NULL`),
    ).toThrow("disagree");
    // And the one shape that is right.
    expect(
      insert(`'7','s','t','public/a.png','','binary','${digest}',10`),
    ).not.toThrow();

    seedSource();
    expect(() =>
      sqlite.exec(
        "UPDATE storefront_theme_files SET encoding = 'binary' WHERE path = 'src/routes/index.tsx'",
      ),
    ).toThrow("disagree");
  });
});

describe("storing a binary file", () => {
  it("puts the bytes in the blob store and the reference in the workspace", async () => {
    seedSource();
    const bytes = png(300);
    const saved = await upload("public/images/hero.png", bytes);

    const digest = sha256(bytes);
    expect(saved).toMatchObject({
      path: "public/images/hero.png",
      encoding: "binary",
      blobDigest: digest,
      sizeBytes: 300,
      mimeType: "image/png",
      version: 1,
      sourceGeneration: 2,
    });
    expect(r2.objects.get(`theme-source/${digest}`)).toEqual(bytes);
    expect(fileRow("public/images/hero.png")).toMatchObject({
      content: "",
      encoding: "binary",
      blob_digest: digest,
      size_bytes: 300,
      mime_type: "image/png",
    });
    expect(generation()).toBe(2);
  });

  it("shows source readers source only, and whole-workspace readers both kinds", async () => {
    seedSource();
    await upload("public/images/hero.png", png());

    const source = await storefrontThemeFileDal.listFiles(STORE, THEME);
    expect(source.map((file) => file.path)).toEqual(["src/routes/index.tsx"]);
    expect(
      await storefrontThemeFileDal.getFileByPath(
        STORE,
        THEME,
        "public/images/hero.png",
      ),
    ).toBeNull();

    const entries = await storefrontThemeFileDal.listWorkspaceEntries(
      STORE,
      THEME,
    );
    const binary = entries.find(
      (entry) => entry.path === "public/images/hero.png",
    );
    expect(binary).toMatchObject({ encoding: "binary", sizeBytes: 64 });
    // Never the empty string the row keeps.
    expect(binary && "content" in binary).toBe(false);
  });

  it("records the bytes' digest in the revision, not the empty body's", async () => {
    seedSource();
    const bytes = png(128);
    await upload("public/images/hero.png", bytes);

    const entry = latestManifest()?.files.find(
      (file) => file.path === "public/images/hero.png",
    );
    expect(entry).toEqual({
      path: "public/images/hero.png",
      digest: sha256(bytes),
      sizeBytes: 128,
      mimeType: "image/png",
      isEntry: false,
      encoding: "binary",
    });
    expect(entry?.digest).not.toBe(sha256(""));
  });

  it("refuses what the public file contract refuses, and writes nothing", async () => {
    seedSource();
    const svg = new TextEncoder().encode("<svg onload=alert(1)>");
    await expect(upload("public/logo.svg", svg)).rejects.toThrow(
      "THEME_PUBLIC_FILE_REFUSED",
    );
    await expect(upload("public/logo.png", svg)).rejects.toThrow(
      "not the format",
    );
    await expect(upload("public/assets/logo.png", png())).rejects.toThrow(
      "THEME_PUBLIC_FILE_REFUSED",
    );
    await expect(upload("public/_headers", png())).rejects.toThrow(
      "THEME_PUBLIC_FILE_REFUSED",
    );
    await expect(
      upload("public/huge.png", png(5 * 1024 * 1024 + 1)),
    ).rejects.toThrow("limited to 5 MB");

    expect(r2.objects.size).toBe(0);
    expect(
      (await storefrontThemeFileDal.listWorkspaceEntries(STORE, THEME)).map(
        (entry) => entry.path,
      ),
    ).toEqual(["src/routes/index.tsx"]);
    expect(generation()).toBe(1);
  });

  it("lets neither kind of file take the other's place", async () => {
    seedSource();
    // A path source already holds.
    sqlite.exec(
      `INSERT INTO storefront_theme_files (id, storefront_id, theme_id, path, content, created_at, updated_at)
       VALUES ('text-png', 'storefront-a', 'theme-a', 'public/taken.png', 'text', 'now', 'now')`,
    );
    await expect(upload("public/taken.png", png())).rejects.toThrow(
      "CONFLICT_VERSION_MISMATCH",
    );

    // A source write aimed at a binary file, with its real id and version.
    const saved = await upload("public/images/hero.png", png(), 1);
    await expect(
      storefrontThemeFileDal.saveFilesBatch(
        STORE,
        THEME,
        [
          {
            path: "public/images/hero.png",
            content: "not bytes",
            expectedFileId: saved.id,
            expectedVersion: saved.version,
          },
        ],
        { expectedSourceGeneration: saved.sourceGeneration },
      ),
    ).rejects.toThrow("CONFLICT_VERSION_MISMATCH");
    expect(fileRow("public/images/hero.png")).toMatchObject({
      encoding: "binary",
      content: "",
      version: 1,
    });
  });

  it("refuses a revision that could not name the bytes", async () => {
    seedSource();
    await upload("public/images/hero.png", png());
    const revisionsBefore = sqlite
      .prepare("SELECT COUNT(*) AS n FROM storefront_theme_revisions")
      .get();

    // A revision written without a manifest keeps source text only.
    await expect(
      storefrontThemeFileDal.saveFilesBatch(
        STORE,
        THEME,
        [
          {
            path: "src/routes/index.tsx",
            content: "export default 2;",
            expectedFileId: "file-route",
            expectedVersion: 1,
          },
        ],
        { expectedSourceGeneration: 2, createRevision: true },
      ),
    ).rejects.toThrow();
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM storefront_theme_revisions")
        .get(),
    ).toEqual(revisionsBefore);
    expect(fileRow("src/routes/index.tsx")?.content).toBe("export default 1;");
  });
});

describe("revisions of a workspace with binary files", () => {
  it("keeps the binary file in a revision a later source save writes", async () => {
    seedSource();
    const bytes = png(90);
    await upload("public/images/hero.png", bytes);

    await d1ThemeSourceStore.saveFile(
      STORE,
      THEME,
      "src/routes/index.tsx",
      "export default 2;",
      "text/typescript",
      {
        expectedSourceGeneration: 2,
        expectedFileId: "file-route",
        expectedVersion: 1,
        createRevision: true,
      },
    );

    const manifest = latestManifest();
    expect(manifest?.files.map((file) => file.path)).toEqual([
      "public/images/hero.png",
      "src/routes/index.tsx",
    ]);
    expect(
      manifest?.files.find((file) => file.path === "public/images/hero.png"),
    ).toMatchObject({ digest: sha256(bytes), encoding: "binary" });
  });

  it("reads a binary file back by reference once its bytes check out", async () => {
    seedSource();
    const bytes = png(40);
    await upload("public/images/hero.png", bytes);
    const revision = await revisions().materializeRevisionByNumber(
      STORE,
      THEME,
      1,
    );

    expect(
      revision.snapshot.find((file) => file.path === "public/images/hero.png"),
    ).toEqual({
      path: "public/images/hero.png",
      encoding: "binary",
      blobDigest: sha256(bytes),
      sizeBytes: 40,
      mimeType: "image/png",
      isEntry: false,
    });

    // Different bytes of the same length under that digest.
    r2.objects.set(`theme-source/${sha256(bytes)}`, png(40, 9));
    await expect(
      revisions().materializeRevisionByNumber(STORE, THEME, 1),
      // Caught by the blob store's own read; the materializer checks again
      // for stores that do not.
    ).rejects.toThrow("THEME_SOURCE_BLOB_INTEGRITY_FAILURE");
  });

  it("checks the bytes itself when a blob store does not", async () => {
    seedSource();
    const bytes = png(40);
    await upload("public/images/hero.png", bytes);
    // A store that hands back whatever it holds, unverified.
    const trusting = {
      putImmutable: async () => {},
      getImmutable: async (digest: string) =>
        digest === sha256(bytes)
          ? png(40, 9)
          : (r2.objects.get(`theme-source/${digest}`) ?? null),
    };
    await expect(
      createD1ThemeRevisionStore({
        blobStore: trusting,
      }).materializeRevisionByNumber(STORE, THEME, 1),
    ).rejects.toThrow("SOURCE_BLOB_DIGEST_MISMATCH");
  });

  it("brings a removed binary file back as the reference it was", async () => {
    seedSource();
    const bytes = png(55);
    const saved = await upload("public/images/hero.png", bytes);
    await d1ThemeSourceStore.deleteFile(
      STORE,
      THEME,
      "public/images/hero.png",
      saved.id,
      saved.version,
      { expectedSourceGeneration: saved.sourceGeneration },
    );
    expect(fileRow("public/images/hero.png")).toBeUndefined();

    await revisions().rollbackToRevision(STORE, THEME, 1, {
      expectedSourceGeneration: generation(),
    });

    expect(fileRow("public/images/hero.png")).toMatchObject({
      content: "",
      encoding: "binary",
      blob_digest: sha256(bytes),
      size_bytes: 55,
      mime_type: "image/png",
    });
    expect(fileRow("src/routes/index.tsx")).toMatchObject({
      encoding: "utf8",
      content: "export default 1;",
    });
  });
});

describe("building a revision with binary files", () => {
  it("fails by name until the build can place bytes", () => {
    expect(() =>
      normalizeRevisionSnapshot(
        [
          {
            path: "src/routes/index.tsx",
            content: "x",
            mimeType: "text/typescript",
            isEntry: false,
          },
          {
            path: "public/a.png",
            encoding: "binary",
            blobDigest: "a".repeat(64),
            sizeBytes: 1,
            mimeType: "image/png",
            isEntry: false,
          },
        ],
        "revision-1",
      ),
    ).toThrow("BINARY_THEME_FILE_NOT_BUILDABLE");
  });
});
