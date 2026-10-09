// @vitest-environment node
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isBinaryThemeFile,
  type ThemeSourceRevisionManifest,
} from "@/lib/storefront/dto/storefront-theme-file.dto";
import {
  summarizePublicUrlRewrite,
  withPublicUrlRewrites,
} from "../editor/public-url-move-batch";
import { planConfirmedPublicUrlRewrite } from "../service/public-url-rewrite-batch";
import { copyLibraryAssetToPublic } from "../service/library-asset-to-public";
import {
  assertPublishPublicFiles,
  findPublishPublicFileProblems,
} from "../service/publish-public-files-check";
import { storefrontThemeFileDal } from "../dal/storefront-theme-file.dal";
import { normalizeRevisionSnapshot } from "../compiler/theme-build-materializer";
import {
  resolveThemeRollbackPlan,
  rollbackFileOf,
} from "../editor/theme-rollback-plan";
import { CloudflareR2ThemeSourceBlobStore } from "./cloudflare-r2-theme-source-blob-store";
import { THEME_PUBLIC_LIMITS } from "../theme-public-files";
import { declaredPng, solidPng } from "../theme-image.test-support";
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
// The SVG gate, which nothing at runtime can open: these tests replace its
// module to exercise the wiring behind it through the real write path.
const svgGate = vi.hoisted(() => ({ value: "closed" as "closed" | "open" }));
vi.mock("../theme-public-svg-gate", () => ({
  themePublicSvgGate: () => svgGate.value,
}));

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
  svgGate.value = "closed";
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

  it("reads one binary file's reference by path, for its own storefront only", async () => {
    seedSource();
    const bytes = png(90);
    await upload("public/images/hero.png", bytes);

    expect(
      await d1ThemeSourceStore.getBinaryFileByPath(
        STORE,
        THEME,
        "public/images/hero.png",
      ),
    ).toMatchObject({
      encoding: "binary",
      blobDigest: sha256(bytes),
      sizeBytes: 90,
      mimeType: "image/png",
    });
    // A source file is not a binary one, and another storefront's view of
    // this Theme finds nothing.
    expect(
      await d1ThemeSourceStore.getBinaryFileByPath(
        STORE,
        THEME,
        "src/routes/index.tsx",
      ),
    ).toBeNull();
    sqlite.exec(`
      INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
      VALUES ('storefront-b', 'channel-a', 'Store B', 'draft', 'now', 'now');
    `);
    expect(
      await d1ThemeSourceStore.getBinaryFileByPath(
        "storefront-b",
        THEME,
        "public/images/hero.png",
      ),
    ).toBeNull();
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
    // Refused before the rows are compared: no text is written in public/ at
    // all, which is what keeps a text SVG away from `validateSvg`. It used to
    // reach the row guard and fail as a version conflict; the file is kept
    // either way, and that is what this asserts.
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
    ).rejects.toThrow("Files in public/ are uploaded, not written as text");
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

describe("previewing a rollback over binary files", () => {
  // What `previewStorefrontThemeRollback` compares: the stored workspace
  // against the stored revision, both read from D1 and R2 as they are.
  it("names an image replaced since the revision as rewritten", async () => {
    seedSource();
    const saved = await upload("public/images/hero.png", png(55));
    await d1ThemeSourceStore.saveBinaryFile(
      STORE,
      THEME,
      {
        path: "public/images/hero.png",
        bytes: png(80, 3),
        expectedFileId: saved.id,
        expectedVersion: saved.version,
      },
      { expectedSourceGeneration: saved.sourceGeneration },
    );

    const [current, revision] = await Promise.all([
      d1ThemeSourceStore.getWorkspaceSnapshot(STORE, THEME),
      revisions().materializeRevisionByNumber(STORE, THEME, 1),
    ]);
    const plan = resolveThemeRollbackPlan({
      current: current.map(rollbackFileOf),
      target: revision.snapshot.map(rollbackFileOf),
    });

    expect(plan.rewritten).toEqual(["public/images/hero.png"]);
    expect(plan.unchanged).toEqual(["src/routes/index.tsx"]);
    expect(plan.restored).toEqual([]);
    expect(plan.removed).toEqual([]);
  });
});

describe("copying a library asset into public/", () => {
  const ASSET_ID = "22222222-2222-4222-8222-222222222222";

  /** A library asset whose bytes sit where the library keeps them. */
  function libraryAsset(bytes: Uint8Array, extension = "png") {
    const url = `/assets/${ASSET_ID}.${extension}`;
    r2.objects.set(url.slice(1), new Uint8Array(bytes));
    return {
      findAsset: async (id: string) =>
        id === ASSET_ID ? { id, url, size: bytes.byteLength } : null,
      readAssetBytes: async (key: string) => {
        const object = await r2.bucket.get(key);
        return object ? new Uint8Array(await object.arrayBuffer()) : null;
      },
      saveBinaryFile: d1ThemeSourceStore.saveBinaryFile,
    };
  }

  it("stores the library's bytes as the Theme's own, by their digest", async () => {
    seedSource();
    const bytes = png(120, 3);
    const before = generation();

    const result = await copyLibraryAssetToPublic(libraryAsset(bytes), {
      storefrontId: STORE,
      themeId: THEME,
      assetId: ASSET_ID,
      path: "public/images/logo.png",
      expectedSourceGeneration: before,
    });

    expect(result).toMatchObject({ ok: true, sourceGeneration: before + 1 });
    expect(fileRow("public/images/logo.png")).toMatchObject({
      encoding: "binary",
      blob_digest: sha256(bytes),
      size_bytes: 120,
      mime_type: "image/png",
    });
    // A copy: the Theme's blob, apart from the library's object.
    expect(r2.objects.has(`theme-source/${sha256(bytes)}`)).toBe(true);
    expect(r2.objects.has(`assets/${ASSET_ID}.png`)).toBe(true);
  });

  it("refuses a format public/ does not serve, and writes nothing", async () => {
    seedSource();
    const before = generation();
    const svg = new TextEncoder().encode("<svg onload=alert(1)>");

    await expect(
      copyLibraryAssetToPublic(libraryAsset(svg, "svg"), {
        storefrontId: STORE,
        themeId: THEME,
        assetId: ASSET_ID,
        path: "public/images/logo.png",
        expectedSourceGeneration: before,
      }),
    ).rejects.toThrow("THEME_PUBLIC_FILE_REFUSED");
    expect(generation()).toBe(before);
    expect(fileRow("public/images/logo.png")).toBeUndefined();
  });

  it("does not write over a file already at the path", async () => {
    seedSource();
    const existing = png(50, 1);
    await upload("public/images/logo.png", existing);

    await expect(
      copyLibraryAssetToPublic(libraryAsset(png(60, 2)), {
        storefrontId: STORE,
        themeId: THEME,
        assetId: ASSET_ID,
        path: "public/images/logo.png",
        expectedSourceGeneration: generation(),
      }),
    ).rejects.toThrow("CONFLICT");
    expect(fileRow("public/images/logo.png")?.blob_digest).toBe(
      sha256(existing),
    );
  });
});

describe("moving and copying binary files in a batch", () => {
  const rows = (path: string) =>
    sqlite
      .prepare(
        "SELECT id, blob_digest, size_bytes, mime_type, deleted_at FROM storefront_theme_files WHERE path = ?",
      )
      .all(path) as Array<{
      id: string;
      blob_digest: string;
      size_bytes: number;
      mime_type: string;
      deleted_at: string | null;
    }>;

  it("moves one in a single transaction: new row, same bytes, old one gone, one revision", async () => {
    seedSource();
    const bytes = png(55);
    const saved = await upload("public/images/hero.png", bytes);
    const before = generation();

    await d1ThemeSourceStore.saveFilesBatch(STORE, THEME, [], {
      expectedSourceGeneration: before,
      binaryCopies: [
        {
          from: "public/images/hero.png",
          to: "public/img/hero.png",
          expectedFileId: saved.id,
          expectedVersion: saved.version,
        },
      ],
      deletions: [
        {
          path: "public/images/hero.png",
          expectedFileId: saved.id,
          expectedVersion: saved.version,
        },
      ],
    });

    expect(fileRow("public/images/hero.png")).toBeUndefined();
    expect(fileRow("public/img/hero.png")).toMatchObject({
      encoding: "binary",
      blob_digest: sha256(bytes),
      size_bytes: 55,
      mime_type: "image/png",
      version: 1,
    });
    expect(generation()).toBe(before + 1);
    // The revision it leaves names the moved file, by the same digest.
    expect(
      latestManifest()?.files.map((file) => [file.path, file.digest]),
    ).toContainEqual(["public/img/hero.png", sha256(bytes)]);
    // Nothing was uploaded again: the one blob is the one there was.
    expect(
      [...r2.objects.keys()].filter((key) => key.endsWith(sha256(bytes))),
    ).toHaveLength(1);
  });

  it("copies one and keeps the source", async () => {
    seedSource();
    const saved = await upload("public/images/hero.png", png(55));

    await d1ThemeSourceStore.saveFilesBatch(STORE, THEME, [], {
      expectedSourceGeneration: generation(),
      binaryCopies: [
        {
          from: "public/images/hero.png",
          to: "public/images/hero-copy.png",
          expectedFileId: saved.id,
          expectedVersion: saved.version,
        },
      ],
    });

    expect(fileRow("public/images/hero.png")).toBeDefined();
    expect(fileRow("public/images/hero-copy.png")?.blob_digest).toBe(
      fileRow("public/images/hero.png")?.blob_digest,
    );
  });

  it("writes nothing when the source changed after it was planned", async () => {
    seedSource();
    const saved = await upload("public/images/hero.png", png(55));
    const planned = {
      from: "public/images/hero.png",
      to: "public/img/hero.png",
      sourceFileId: saved.id,
      sourceVersion: saved.version,
      blobDigest: saved.blobDigest,
      sizeBytes: saved.sizeBytes,
      mimeType: saved.mimeType,
    };
    // Replaced between the store's check and the batch.
    sqlite
      .prepare(
        "UPDATE storefront_theme_files SET version = version + 1 WHERE path = 'public/images/hero.png'",
      )
      .run();

    await expect(
      storefrontThemeFileDal.saveFilesBatch(STORE, THEME, [], {
        expectedSourceGeneration: generation(),
        binaryCopies: [planned],
        deletions: [
          {
            path: "public/images/hero.png",
            expectedFileId: saved.id,
            expectedVersion: saved.version + 1,
          },
        ],
      }),
    ).rejects.toThrow("CONFLICT_VERSION_MISMATCH");
    expect(rows("public/img/hero.png")).toEqual([]);
    expect(fileRow("public/images/hero.png")).toBeDefined();
  });

  it("refuses a new name in another format, and changes nothing", async () => {
    seedSource();
    const saved = await upload("public/images/hero.png", png(55));
    const before = generation();

    await expect(
      d1ThemeSourceStore.saveFilesBatch(STORE, THEME, [], {
        expectedSourceGeneration: before,
        binaryCopies: [
          {
            from: "public/images/hero.png",
            to: "public/images/hero.jpg",
            expectedFileId: saved.id,
            expectedVersion: saved.version,
          },
        ],
      }),
    ).rejects.toThrow("THEME_PUBLIC_FILE_REFUSED");
    expect(generation()).toBe(before);
    expect(rows("public/images/hero.jpg")).toEqual([]);
  });
});

describe("moving a binary file with its URL references rewritten", () => {
  const HERO_SOURCE = 'export default () => <img src="/images/hero.png" />;';
  const MOVE = { from: "public/images/hero.png", to: "public/img/hero.png" };

  function seedHero() {
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_files
          (id, storefront_id, theme_id, path, content, mime_type, version, created_at, updated_at)
         VALUES ('file-hero', ?, ?, 'src/Hero.tsx', ?, 'text/typescript', 3, 'now', 'now')`,
      )
      .run(STORE, THEME, HERO_SOURCE);
  }

  /** What the batch server function does with `publicUrlRewrite`. */
  async function confirmFromSnapshot(
    expected: ReturnType<typeof summarizePublicUrlRewrite>,
    binary: { id: string; version: number },
    expectedSourceGeneration = generation(),
  ) {
    const copy = {
      ...MOVE,
      expectedFileId: binary.id,
      expectedVersion: binary.version,
    };
    const deletions = [
      {
        path: MOVE.from,
        expectedFileId: binary.id,
        expectedVersion: binary.version,
      },
    ];
    const confirmed = await planConfirmedPublicUrlRewrite(d1ThemeSourceStore, {
      storefrontId: STORE,
      themeId: THEME,
      expectedSourceGeneration,
      files: [],
      deletions,
      binaryCopies: [copy],
      publicUrlRewrite: {
        moves: [MOVE],
        expected,
        acknowledgeUnresolved: false,
      },
    });
    return { confirmed, copy, deletions };
  }

  async function review() {
    const entries = await d1ThemeSourceStore.getWorkspaceSnapshot(STORE, THEME);
    const planned = withPublicUrlRewrites({
      saved: entries
        .filter((entry) => !isBinaryThemeFile(entry))
        .map((entry) => ({
          id: entry.id,
          path: entry.path,
          content: entry.content,
          version: entry.version,
        })),
      files: [],
      deletions: [{ path: MOVE.from }],
      binaryCopies: [MOVE],
      rewrites: [MOVE],
    });
    if (!planned.ok) throw new Error(planned.reason);
    return summarizePublicUrlRewrite(planned.plan);
  }

  it("moves the file and rewrites the reference in one transaction", async () => {
    seedSource();
    seedHero();
    const saved = await upload("public/images/hero.png", png(40));
    const expected = await review();
    expect(expected).toEqual({
      paths: ["src/Hero.tsx"],
      rewriteCount: 1,
      unresolvedCount: 0,
    });
    const before = generation();

    const { confirmed, copy, deletions } = await confirmFromSnapshot(
      expected,
      saved,
    );
    if (!confirmed.ok) throw new Error(confirmed.reason);
    const files = confirmed.files;
    await d1ThemeSourceStore.saveFilesBatch(STORE, THEME, files, {
      expectedSourceGeneration: before,
      binaryCopies: [copy],
      deletions,
      createRevision: true,
    });

    expect(fileRow("public/images/hero.png")).toBeUndefined();
    expect(fileRow("public/img/hero.png")?.blob_digest).toBe(saved.blobDigest);
    expect(fileRow("src/Hero.tsx")).toMatchObject({
      content: HERO_SOURCE.replace("/images/hero.png", "/img/hero.png"),
      version: 4,
    });
    expect(generation()).toBe(before + 1);
    const manifest = latestManifest()?.files.map((file) => file.path);
    expect(manifest).toContain("public/img/hero.png");
    expect(manifest).not.toContain("public/images/hero.png");
  });

  it("writes nothing when the referencing file is saved before the batch lands", async () => {
    seedSource();
    seedHero();
    const saved = await upload("public/images/hero.png", png(40));
    const expected = await review();
    const before = generation();
    const { confirmed, copy, deletions } = await confirmFromSnapshot(
      expected,
      saved,
    );
    if (!confirmed.ok) throw new Error(confirmed.reason);
    const files = confirmed.files;

    // Someone else saves the file between the server's plan and its write.
    sqlite
      .prepare(
        "UPDATE storefront_theme_files SET version = version + 1, content = 'export default 2;' WHERE path = 'src/Hero.tsx'",
      )
      .run();

    await expect(
      d1ThemeSourceStore.saveFilesBatch(STORE, THEME, files, {
        expectedSourceGeneration: before,
        binaryCopies: [copy],
        deletions,
      }),
    ).rejects.toThrow("CONFLICT_VERSION_MISMATCH");
    expect(fileRow("public/images/hero.png")).toBeDefined();
    expect(rows("public/img/hero.png")).toEqual([]);
    expect(fileRow("src/Hero.tsx")?.content).toBe("export default 2;");
  });

  it("refuses to plan against a Theme saved since the review, and writes nothing", async () => {
    seedSource();
    seedHero();
    const saved = await upload("public/images/hero.png", png(40));
    const expected = await review();
    const reviewedAt = generation();

    // A save through the store, which advances the generation.
    await d1ThemeSourceStore.saveFile(
      STORE,
      THEME,
      "src/Other.tsx",
      'export const logo = "/images/hero.png";',
      "text/typescript",
      { expectedSourceGeneration: reviewedAt, expectMissing: true },
    );

    const { confirmed } = await confirmFromSnapshot(
      expected,
      saved,
      reviewedAt,
    );
    expect(confirmed).toMatchObject({
      ok: false,
      error: "SOURCE_GENERATION_CONFLICT",
    });

    // Reviewed again at the new generation, the new reference is seen and
    // the old summary no longer matches.
    const { confirmed: again } = await confirmFromSnapshot(expected, saved);
    expect(again).toMatchObject({
      ok: false,
      error: "PUBLIC_URL_REWRITE_STALE",
    });
    expect(fileRow("public/images/hero.png")).toBeDefined();
    expect(fileRow("src/Hero.tsx")?.content).toBe(HERO_SOURCE);
  });

  const rows = (path: string) =>
    sqlite
      .prepare("SELECT id FROM storefront_theme_files WHERE path = ?")
      .all(path);
});

describe("building a revision with binary files", () => {
  it("carries them by reference, apart from the source", () => {
    const result = normalizeRevisionSnapshot(
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
    );
    expect(result.files.map((file) => file.path)).toEqual([
      "src/routes/index.tsx",
    ]);
    expect(result.binaryFiles).toEqual([
      {
        path: "public/a.png",
        digest: "a".repeat(64),
        sizeBytes: 1,
        mimeType: "image/png",
      },
    ]);
  });
});

describe("SVG in public/, behind the gate", () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  const CLEAN = encode(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#c00"/></svg>',
  );
  const HANDLER = encode(
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>',
  );
  const DOCTYPE = encode(
    '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  const ASSET_ID = "33333333-3333-4333-8333-333333333333";
  const librarySvg = (bytes: Uint8Array) => {
    const url = `/assets/${ASSET_ID}.svg`;
    r2.objects.set(url.slice(1), new Uint8Array(bytes));
    return {
      findAsset: async (id: string) =>
        id === ASSET_ID ? { id, url, size: bytes.byteLength } : null,
      readAssetBytes: async (key: string) => {
        const object = await r2.bucket.get(key);
        return object ? new Uint8Array(await object.arrayBuffer()) : null;
      },
      saveBinaryFile: d1ThemeSourceStore.saveBinaryFile,
    };
  };
  const copy = (bytes: Uint8Array) =>
    copyLibraryAssetToPublic(librarySvg(bytes), {
      storefrontId: STORE,
      themeId: THEME,
      assetId: ASSET_ID,
      path: "public/images/logo.svg",
      expectedSourceGeneration: generation(),
    });
  const themeBlobs = () =>
    [...r2.objects.keys()].filter((key) => key.startsWith("theme-source/"));

  it("refuses every SVG while the gate is closed, however clean", async () => {
    seedSource();
    await expect(upload("public/logo.svg", CLEAN)).rejects.toThrow(
      "SVG files are not supported yet",
    );
    await expect(copy(CLEAN)).rejects.toThrow(
      "SVG files are not supported yet",
    );
    expect(themeBlobs()).toEqual([]);
    expect(generation()).toBe(1);
  });

  it("stores a clean SVG byte for byte once the gate is open", async () => {
    svgGate.value = "open";
    seedSource();
    const saved = await upload("public/logo.svg", CLEAN);
    expect(saved).toMatchObject({
      mimeType: "image/svg+xml",
      blobDigest: sha256(CLEAN),
      sizeBytes: CLEAN.byteLength,
    });
    expect(r2.objects.get(`theme-source/${sha256(CLEAN)}`)).toEqual(CLEAN);
  });

  it("refuses what validateSvg refuses, with its reason, and writes nothing", async () => {
    svgGate.value = "open";
    seedSource();
    await expect(upload("public/a.svg", HANDLER)).rejects.toThrow(
      "Event handler attributes are not allowed",
    );
    await expect(upload("public/b.svg", DOCTYPE)).rejects.toThrow("DOCTYPE");
    const oversized = new Uint8Array(2 * 1024 * 1024 + 1).fill(0x20);
    oversized.set(CLEAN);
    await expect(upload("public/c.svg", oversized)).rejects.toThrow(
      "SVG files are limited to 2 MB",
    );
    // Compressed SVG cannot be parsed before it is stored.
    await expect(upload("public/d.svgz", CLEAN)).rejects.toThrow(
      "THEME_PUBLIC_FILE_REFUSED",
    );
    expect(themeBlobs()).toEqual([]);
    expect(generation()).toBe(1);
  });

  it("checks a library SVG's own bytes on copy, whatever the library recorded", async () => {
    svgGate.value = "open";
    seedSource();
    // The library's metadata is not consulted: only the bytes read here are.
    await expect(copy(HANDLER)).rejects.toThrow(
      "Event handler attributes are not allowed",
    );
    expect(fileRow("public/images/logo.svg")).toBeUndefined();
    await expect(copy(CLEAN)).resolves.toMatchObject({ ok: true });
    expect(fileRow("public/images/logo.svg")).toMatchObject({
      mime_type: "image/svg+xml",
      blob_digest: sha256(CLEAN),
    });
  });
});

describe("the check before a publish activates a revision", () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  const CLEAN = encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>',
  );
  const HANDLER = encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4" onclick="x()"/></svg>',
  );
  let reads = 0;
  const deps = {
    getRevision: (id: string) => revisions().getRevision(STORE, THEME, id),
    readBlob: (digest: string) => {
      reads += 1;
      return d1ThemeSourceStore.readBinaryFile(digest);
    },
  };
  const latestRevisionId = () =>
    (
      sqlite
        .prepare(
          "SELECT id FROM storefront_theme_revisions ORDER BY revision_number DESC LIMIT 1",
        )
        .get() as { id: string }
    ).id;
  /** Rewrites one manifest entry, as a revision stored under other rules. */
  const editManifest = (
    revisionId: string,
    edit: (manifest: ThemeSourceRevisionManifest) => void,
  ) => {
    const row = sqlite
      .prepare(
        "SELECT source_manifest FROM storefront_theme_revisions WHERE id = ?",
      )
      .get(revisionId) as { source_manifest: string };
    const manifest = JSON.parse(
      row.source_manifest,
    ) as ThemeSourceRevisionManifest;
    edit(manifest);
    sqlite
      .prepare(
        "UPDATE storefront_theme_revisions SET source_manifest = ? WHERE id = ?",
      )
      .run(JSON.stringify(manifest), revisionId);
  };

  beforeEach(() => {
    reads = 0;
  });

  it("passes raster files without reading their bytes", async () => {
    seedSource();
    await upload("public/images/hero.png", png());
    expect(
      await findPublishPublicFileProblems(deps, latestRevisionId()),
    ).toEqual([]);
    expect(reads).toBe(0);
  });

  it.each([
    ["robots.txt", "User-agent: *\nDisallow:\n", "text/plain; charset=utf-8"],
    [
      "sitemap.xml",
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>',
      "application/xml; charset=utf-8",
    ],
    ["data.json", '{"hello":"世界"}', "application/json; charset=utf-8"],
    [
      "site.webmanifest",
      '{"name":"Shop"}',
      "application/manifest+json; charset=utf-8",
    ],
  ])(
    "stores, freezes and checks uploaded %s through the existing bytes path",
    async (name, content, mimeType) => {
      seedSource();
      const bytes = new TextEncoder().encode(content);
      const saved = await upload(`public/${name}`, bytes);
      expect(saved).toMatchObject({
        mimeType,
        blobDigest: sha256(bytes),
        sizeBytes: bytes.byteLength,
      });
      expect(r2.objects.get(`theme-source/${sha256(bytes)}`)).toEqual(bytes);
      // Metadata-only revisions intentionally have no inline source snapshot.
      // Exercise the same blob-backed materialization used by the build.
      const revision = await revisions().materializeRevision(
        STORE,
        THEME,
        latestRevisionId(),
      );
      expect(revision).not.toBeNull();
      const input = normalizeRevisionSnapshot(revision!.snapshot, revision!.id);
      expect(input.binaryFiles).toEqual([
        expect.objectContaining({
          path: `public/${name}`,
          mimeType,
          digest: sha256(bytes),
        }),
      ]);
      expect(await findPublishPublicFileProblems(deps, revision!.id)).toEqual(
        [],
      );
      expect(reads).toBe(1);
    },
  );

  it("rejects invalid text before any blob or workspace write", async () => {
    seedSource();
    const before = generation();
    await expect(
      upload("public/site.webmanifest", new TextEncoder().encode("[]")),
    ).rejects.toThrow("A web manifest must be a JSON object");
    expect(generation()).toBe(before);
    expect(fileRow("public/site.webmanifest")).toBeUndefined();
    expect(r2.objects.size).toBe(0);
  });

  it("rechecks data text content, digest and size before publishing", async () => {
    seedSource();
    await upload("public/data.json", new TextEncoder().encode("{}"));
    const revisionId = latestRevisionId();
    const invalid = new TextEncoder().encode("{broken");
    await blobStore().putImmutable({
      digest: sha256(invalid),
      content: invalid,
      mimeType: "application/json",
    });
    editManifest(revisionId, (manifest) => {
      const entry = manifest.files.find(
        (file) => file.path === "public/data.json",
      )!;
      entry.digest = sha256(invalid);
      entry.sizeBytes = invalid.byteLength;
    });
    await expect(assertPublishPublicFiles(deps, revisionId)).rejects.toThrow(
      "valid JSON",
    );
    editManifest(revisionId, (manifest) => {
      manifest.files.find(
        (file) => file.path === "public/data.json",
      )!.sizeBytes = 6 * 1024 * 1024;
    });
    const previousReads = reads;
    await expect(assertPublishPublicFiles(deps, revisionId)).rejects.toThrow(
      "Files are limited to 5 MB",
    );
    expect(reads).toBe(previousReads);
  });

  it("reads and re-checks an SVG, under the gate and rules as they are now", async () => {
    svgGate.value = "open";
    seedSource();
    await upload("public/logo.svg", CLEAN);
    const revisionId = latestRevisionId();
    expect(await findPublishPublicFileProblems(deps, revisionId)).toEqual([]);
    expect(reads).toBe(1);

    // Stored while SVG was served; the gate closed again since.
    svgGate.value = "closed";
    await expect(assertPublishPublicFiles(deps, revisionId)).rejects.toThrow(
      "PUBLISH_PUBLIC_FILE_REFUSED: public/logo.svg: SVG files are not supported yet",
    );
  });

  it("refuses an SVG that rules stricter than its writer's refuse", async () => {
    svgGate.value = "open";
    seedSource();
    await upload("public/logo.svg", CLEAN);
    const revisionId = latestRevisionId();
    // Bytes that passed whatever checked them then, and fail today's rules.
    await blobStore().putImmutable({
      digest: sha256(HANDLER),
      content: HANDLER,
      mimeType: "image/svg+xml",
    });
    editManifest(revisionId, (manifest) => {
      const entry = manifest.files.find(
        (file) => file.path === "public/logo.svg",
      )!;
      entry.digest = sha256(HANDLER);
      entry.sizeBytes = HANDLER.byteLength;
    });
    expect(await findPublishPublicFileProblems(deps, revisionId)).toEqual([
      expect.stringContaining(
        "public/logo.svg: Event handler attributes are not allowed",
      ),
    ]);
  });

  it("refuses by name a blob the store cannot produce intact", async () => {
    svgGate.value = "open";
    seedSource();
    await upload("public/logo.svg", CLEAN);
    const revisionId = latestRevisionId();
    // Other bytes under the same key: this store verifies, and refuses them.
    r2.objects.set(`theme-source/${sha256(CLEAN)}`, HANDLER);
    expect(await findPublishPublicFileProblems(deps, revisionId)).toEqual([
      expect.stringMatching(
        /^public\/logo\.svg: The stored bytes could not be read \(THEME_SOURCE_BLOB_INTEGRITY_FAILURE/,
      ),
    ]);
    // And none at all.
    r2.objects.delete(`theme-source/${sha256(CLEAN)}`);
    expect(await findPublishPublicFileProblems(deps, revisionId)).toEqual([
      expect.stringContaining(
        "public/logo.svg: The stored bytes could not be read",
      ),
    ]);
  });

  it("checks the digest itself when the store does not", async () => {
    svgGate.value = "open";
    seedSource();
    await upload("public/logo.svg", CLEAN);
    const trusting = { ...deps, readBlob: async () => HANDLER };
    expect(
      await findPublishPublicFileProblems(trusting, latestRevisionId()),
    ).toEqual([
      "public/logo.svg: The stored bytes do not match the revision's digest.",
    ]);
  });

  it("refuses an oversized SVG without reading it", async () => {
    svgGate.value = "open";
    seedSource();
    await upload("public/logo.svg", CLEAN);
    const revisionId = latestRevisionId();
    editManifest(revisionId, (manifest) => {
      manifest.files.find(
        (file) => file.path === "public/logo.svg",
      )!.sizeBytes = 2 * 1024 * 1024 + 1;
    });
    expect(await findPublishPublicFileProblems(deps, revisionId)).toEqual([
      "public/logo.svg: SVG files are limited to 2 MB.",
    ]);
    expect(reads).toBe(0);
  });

  it("refuses a text file in public/, however it got into the revision", async () => {
    seedSource();
    await upload("public/images/hero.png", png());
    const revisionId = latestRevisionId();
    editManifest(revisionId, (manifest) => {
      manifest.files.push({
        path: "public/evil.svg",
        digest: sha256("<svg/>"),
        sizeBytes: 6,
        mimeType: "image/svg+xml",
        isEntry: false,
      });
    });
    expect(await findPublishPublicFileProblems(deps, revisionId)).toEqual([
      "public/evil.svg: Files in public/ are uploaded, not written as text.",
    ]);
  });

  it("refuses a revision it cannot find", async () => {
    await expect(
      assertPublishPublicFiles(deps, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow("PUBLISH_PUBLIC_FILE_REFUSED");
  });
});

describe("binary files under src/ (docs/astro-theme-plan.md 5.2.5)", () => {
  const source = (
    path: string,
    bytes: Uint8Array,
    expectedSourceGeneration = generation(),
    extra: { expectedFileId?: string; expectedVersion?: number } = {},
  ) =>
    d1ThemeSourceStore.saveBinaryFile(
      STORE,
      THEME,
      {
        path,
        bytes,
        ...(extra.expectedFileId
          ? extra
          : { expectMissing: true }),
      },
      { expectedSourceGeneration, allowSourceAssets: true },
    );
  /** A binary row as a write would leave it, without the write: for quotas. */
  const seedBinary = (path: string, sizeBytes: number) =>
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_files
          (id, storefront_id, theme_id, path, content, encoding, blob_digest, size_bytes, mime_type, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', 'binary', ?, ?, 'image/png', 1, 'now', 'now')`,
      )
      .run(`seed-${path}`, STORE, THEME, path, "c".repeat(64), sizeBytes);

  it("are refused by every caller that has not opted in, as before", async () => {
    seedSource();
    await expect(upload("src/assets/hero.png", solidPng(4, 4))).rejects.toThrow(
      "THEME_PUBLIC_FILE_REFUSED: src/assets/hero.png: Only files under public/",
    );
    expect(r2.objects.size).toBe(0);
    expect(generation()).toBe(1);
  });

  it("are stored by reference for a caller that has, and carried into the revision and the build", async () => {
    seedSource();
    const bytes = solidPng(16, 9);
    const saved = await source("src/assets/hero.png", bytes);
    expect(saved).toMatchObject({
      encoding: "binary",
      blobDigest: sha256(bytes),
      mimeType: "image/png",
    });
    expect(r2.objects.get(`theme-source/${sha256(bytes)}`)).toEqual(bytes);
    const revision = await revisions().materializeRevision(
      STORE,
      THEME,
      (
        sqlite
          .prepare(
            "SELECT id FROM storefront_theme_revisions ORDER BY revision_number DESC LIMIT 1",
          )
          .get() as { id: string }
      ).id,
    );
    const input = normalizeRevisionSnapshot(revision!.snapshot, revision!.id);
    expect(input.binaryFiles).toEqual([
      expect.objectContaining({ path: "src/assets/hero.png", digest: sha256(bytes) }),
    ]);
  });

  it("refuses SVG, other formats, oversized images and unreadable headers, and writes nothing", async () => {
    seedSource();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    await expect(source("src/assets/logo.svg", svg)).rejects.toThrow("keep them in public/");
    await expect(source("src/assets/clip.mp4", png())).rejects.toThrow("Under src/, only PNG");
    await expect(
      source("src/assets/bomb.png", declaredPng(20_000, 20_000)),
    ).rejects.toThrow("16383 pixels a side");
    await expect(source("src/assets/bad.png", png())).rejects.toThrow(
      "dimensions could not be read",
    );
    await expect(source("src/.cache/x.png", solidPng(2, 2))).rejects.toThrow(
      "THEME_PUBLIC_FILE_REFUSED",
    );
    expect(r2.objects.size).toBe(0);
    expect(generation()).toBe(1);
  });

  it("share public/'s quota: count and total", async () => {
    seedSource();
    for (let index = 0; index < THEME_PUBLIC_LIMITS.maxFiles - 1; index++) {
      seedBinary(`public/seed/${index}.png`, 1);
    }
    await source("src/assets/last.png", solidPng(2, 2));
    await expect(source("src/assets/over.png", solidPng(2, 2))).rejects.toThrow(
      "public/ and src/ hold at most 200 binary files together",
    );

    sqlite.exec("DELETE FROM storefront_theme_files WHERE id LIKE 'seed-%'");
    seedBinary("public/big.png", THEME_PUBLIC_LIMITS.maxTotalBytes - 10);
    await expect(source("src/assets/more.png", solidPng(8, 8))).rejects.toThrow(
      "MB of binary files together",
    );
  });

  it("let only one of two writes from the same generation land", async () => {
    seedSource();
    for (let index = 0; index < THEME_PUBLIC_LIMITS.maxFiles - 1; index++) {
      seedBinary(`public/seed/${index}.png`, 1);
    }
    // Each fits the quota on its own; together they would exceed it.
    const from = generation();
    const results = await Promise.allSettled([
      source("src/assets/a.png", solidPng(3, 3), from),
      source("src/assets/b.png", solidPng(4, 4), from),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM storefront_theme_files WHERE encoding = 'binary' AND deleted_at IS NULL",
        )
        .get(),
    ).toEqual({ n: THEME_PUBLIC_LIMITS.maxFiles });
    expect(generation()).toBe(from + 1);
  });

  it("keep OCC: a replace from a stale version changes nothing", async () => {
    seedSource();
    const first = await source("src/assets/hero.png", solidPng(4, 4));
    const second = await source("src/assets/hero.png", solidPng(5, 5), generation(), {
      expectedFileId: first.id,
      expectedVersion: first.version,
    });
    expect(second.version).toBe(first.version + 1);
    // Another tab still holds the first version.
    await expect(
      source("src/assets/hero.png", solidPng(6, 6), generation(), {
        expectedFileId: first.id,
        expectedVersion: first.version,
      }),
    ).rejects.toThrow("CONFLICT_VERSION_MISMATCH");
    expect(fileRow("src/assets/hero.png")?.blob_digest).toBe(sha256(solidPng(5, 5)));
  });

  it("pass the publish check by path, unread, and are refused there when the rules refuse them", async () => {
    seedSource();
    await source("src/assets/hero.png", solidPng(4, 4));
    const revisionId = (
      sqlite
        .prepare(
          "SELECT id FROM storefront_theme_revisions ORDER BY revision_number DESC LIMIT 1",
        )
        .get() as { id: string }
    ).id;
    let reads = 0;
    const deps = {
      getRevision: (id: string) => revisions().getRevision(STORE, THEME, id),
      readBlob: (digest: string) => {
        reads += 1;
        return d1ThemeSourceStore.readBinaryFile(digest);
      },
    };
    expect(await findPublishPublicFileProblems(deps, revisionId)).toEqual([]);
    expect(reads).toBe(0);

    // A revision stored under other rules: a binary SVG under src/.
    const row = sqlite
      .prepare("SELECT source_manifest FROM storefront_theme_revisions WHERE id = ?")
      .get(revisionId) as { source_manifest: string };
    const manifest = JSON.parse(row.source_manifest) as ThemeSourceRevisionManifest;
    manifest.files.push({
      path: "src/assets/logo.svg",
      digest: "d".repeat(64),
      sizeBytes: 10,
      mimeType: "image/svg+xml",
      isEntry: false,
      encoding: "binary",
    });
    sqlite
      .prepare("UPDATE storefront_theme_revisions SET source_manifest = ? WHERE id = ?")
      .run(JSON.stringify(manifest), revisionId);
    expect(await findPublishPublicFileProblems(deps, revisionId)).toEqual([
      "src/assets/logo.svg: SVG files are not accepted under src/; keep them in public/.",
    ]);
  });

  it("keep history: an earlier revision reads its own bytes, and rollback restores them", async () => {
    seedSource();
    const original = solidPng(4, 4, [10, 20, 30]);
    const saved = await source("src/assets/hero.png", original);
    const atOriginal = (
      sqlite
        .prepare("SELECT MAX(revision_number) AS n FROM storefront_theme_revisions")
        .get() as { n: number }
    ).n;
    await source("src/assets/hero.png", solidPng(4, 4, [200, 200, 200]), generation(), {
      expectedFileId: saved.id,
      expectedVersion: saved.version,
    });

    const earlier = await revisions().materializeRevisionByNumber(STORE, THEME, atOriginal);
    const entry = earlier.snapshot.find((file) => file.path === "src/assets/hero.png") as
      | { blobDigest: string }
      | undefined;
    expect(entry?.blobDigest).toBe(sha256(original));
    expect(await d1ThemeSourceStore.readBinaryFile(sha256(original))).toEqual(original);

    await revisions().rollbackToRevision(STORE, THEME, atOriginal, {
      expectedSourceGeneration: generation(),
    });
    expect(fileRow("src/assets/hero.png")?.blob_digest).toBe(sha256(original));
  });
});

describe("text in public/", () => {
  it("is refused at the write every text save goes through", async () => {
    seedSource();
    // Below every request schema: the DAL itself refuses.
    await expect(
      storefrontThemeFileDal.saveFilesBatch(
        STORE,
        THEME,
        [
          {
            path: "public/evil.svg",
            content: '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>',
            expectMissing: true,
          },
        ],
        { expectedSourceGeneration: 1 },
      ),
    ).rejects.toThrow("Files in public/ are uploaded, not written as text");
    expect(fileRow("public/evil.svg")).toBeUndefined();
    expect(generation()).toBe(1);
  });

  it("is refused by the build, whatever wrote it into the revision", () => {
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
            path: "public/evil.svg",
            content: "<svg/>",
            mimeType: "image/svg+xml",
            isEntry: false,
          },
        ],
        "revision-1",
      ),
    ).toThrow("PUBLIC_FILE_REFUSED");
  });
});
