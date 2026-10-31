// @vitest-environment node
/**
 * The Design structure capability guard on real SQL (harness of
 * storefront-theme-files-design-element-resend.test.ts): tagged
 * `operation: "design-structure"` writes are judged on one snapshot and
 * committed against its generation; untagged Code saves keep their usual
 * checks (handoff/2026-10-31/server-structure-guard-proposal.md).
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { themeSourceStore } from "@/lib/storefront/storage/theme-storage.server";
import { reorderThemeRouteSections } from "@/lib/storefront/compiler/theme-route-sections";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";

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
const SCHEMA = `
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
      document text,
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
  `;

const ROUTE_ID = "00000000-0000-4000-8000-000000000002";
const DATA_ID = "00000000-0000-4000-8000-000000000003";
const ROUTE_PATH = "src/routes/index.tsx";
const DATA_PATH = "src/server/home.ts";

const fields = (name: string) => `export const contentFields = {
  title: { type: "text", label: "Title" },
};
export default function ${name}({ title = "Default title" }: any) {
  return <section><h1>{title}</h1></section>;
}`;
// The 2B fixture (theme-route-structure-dependency-lock.test.ts): the route's
// lock follows its loader's module while the route file stays the same.
const ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/sections/Hero";
import Banner from "../components/sections/Banner";
import Promo from "../components/sections/Promo";
import { getHome } from "../server/home";

export const Route = createFileRoute("/")({
  loader: () => getHome(),
  component: Home,
});

function Home() {
  const page = Route.useLoaderData();
  return (
    <main>
      <Hero {...content("hero")} />
      <Banner {...content("banner")} />
      <Promo {...page.promo} />
    </main>
  );
}`;
const DATA_OPEN = `import { createServerFn } from "@tanstack/react-start";
export const getHome = createServerFn().handler(() => ({ promo: { title: "Static" } }));`;
const DATA_LOCKED = `import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
export const getHome = createServerFn().handler(() => morph.pages.get("/"));`;

let seededData = DATA_OPEN;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(SCHEMA);
  sqlite.exec(`
    INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
    VALUES ('${STORE}', 'channel-a', 'Store A', 'draft', 'now', 'now');
    INSERT INTO storefront_themes (id, storefront_id, name, status, source_generation, created_at, updated_at)
    VALUES ('${THEME}', '${STORE}', 'Theme A', 'draft', 1, 'now', 'now');
  `);
  applyBinaryFilesMigration();
  r2.objects.clear();
  const db = drizzle(sqlite, { schema: storefrontSchema });
  vi.mocked(getDb).mockResolvedValue(db as any);
});

afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function seedTheme(data: string) {
  seededData = data;
  let n = 100;
  const id = () =>
    `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;
  const insert = sqlite.prepare(
    `INSERT INTO storefront_theme_files
      (id, storefront_id, theme_id, path, content, mime_type, is_entry, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'text/typescript', 0, 1, 'now', 'now')`,
  );
  for (const [fileId, path, content] of [
    ...livePreviewPlatformFiles().map(
      (file) => [id(), file.path, file.content ?? ""] as const,
    ),
    [id(), "src/components/sections/Hero.tsx", fields("Hero")] as const,
    [id(), "src/components/sections/Banner.tsx", fields("Banner")] as const,
    [id(), "src/components/sections/Promo.tsx", fields("Promo")] as const,
    [DATA_ID, DATA_PATH, data] as const,
    [ROUTE_ID, ROUTE_PATH, ROUTE_SOURCE] as const,
  ]) {
    insert.run(fileId, STORE, THEME, path, content);
  }
}

type SaveResult = {
  success: boolean;
  error?: string;
  message: string;
  data?: Record<string, unknown>;
};
async function serverFns() {
  return (await import("./storefront-theme-files.serverFn")) as unknown as {
    saveStorefrontThemeFile: (args: { data: unknown }) => Promise<SaveResult>;
    saveStorefrontThemeFilesBatch: (args: {
      data: unknown;
    }) => Promise<SaveResult>;
  };
}

const readGeneration = () =>
  (
    sqlite
      .prepare(
        `SELECT source_generation AS g FROM storefront_themes WHERE id = ?`,
      )
      .get(THEME) as { g: number }
  ).g;
const readFile = (path: string) =>
  sqlite
    .prepare(
      `SELECT content, version FROM storefront_theme_files
       WHERE theme_id = ? AND path = ? AND deleted_at IS NULL`,
    )
    .get(THEME, path) as { content: string; version: number } | undefined;
const countRevisions = () =>
  (
    sqlite
      .prepare(
        `SELECT COUNT(*) AS count FROM storefront_theme_revisions WHERE theme_id = ?`,
      )
      .get(THEME) as { count: number }
  ).count;
const COPY_PATH = "src/components/sections/Promo-index.tsx";
/** Everything a refused write must leave as it was. */
function stateNow() {
  return {
    generation: readGeneration(),
    route: readFile(ROUTE_PATH),
    data: readFile(DATA_PATH),
    copy: readFile(COPY_PATH) ?? null,
    revisions: countRevisions(),
  };
}

/** The reorder Design computes on the route while it is open. */
function reordered() {
  const files = [
    ...livePreviewPlatformFiles(),
    { path: "src/components/sections/Hero.tsx", content: fields("Hero") },
    { path: "src/components/sections/Banner.tsx", content: fields("Banner") },
    { path: "src/components/sections/Promo.tsx", content: fields("Promo") },
    { path: DATA_PATH, content: DATA_OPEN },
    { path: ROUTE_PATH, content: ROUTE_SOURCE },
  ];
  const result = reorderThemeRouteSections(ROUTE_SOURCE, files, ROUTE_PATH, [
    "banner",
    "hero",
  ]);
  if (!result.changed) throw new Error("fixture: the reorder is refused");
  return result.code;
}

const single = (content: string, extra: Record<string, unknown> = {}) => ({
  storefrontId: STORE,
  themeId: THEME,
  path: ROUTE_PATH,
  content,
  expectedFileId: ROUTE_ID,
  expectedVersion: 1,
  expectedSourceGeneration: 1,
  operation: "design-structure",
  ...extra,
});
const routeWrite = (content: string) => ({
  path: ROUTE_PATH,
  content,
  expectedFileId: ROUTE_ID,
  expectedVersion: 1,
});
const batch = (extra: Record<string, unknown>) => ({
  storefrontId: STORE,
  themeId: THEME,
  deletions: [],
  expectedSourceGeneration: 1,
  createRevision: true,
  operation: "design-structure",
  ...extra,
});

describe("the Design structure guard on a single file (real SQL)", () => {
  it("a tagged reorder of an open route is saved against the snapshot's generation", async () => {
    seedTheme(DATA_OPEN);
    const { saveStorefrontThemeFile } = await serverFns();

    const res = await saveStorefrontThemeFile({ data: single(reordered()) });

    expect(res.success).toBe(true);
    expect(readGeneration()).toBe(2);
    expect(readFile(ROUTE_PATH)).toEqual({ content: reordered(), version: 2 });
  });

  it("a tagged reorder of a locked route is refused, and nothing is written", async () => {
    seedTheme(DATA_LOCKED);
    const { saveStorefrontThemeFile } = await serverFns();
    const before = stateNow();

    const res = await saveStorefrontThemeFile({ data: single(reordered()) });

    expect(res.success).toBe(false);
    expect(res.error).toBe("DESIGN_STRUCTURE_LOCKED");
    expect(res.message).toMatch(/reads its content through its route loader/);
    expect(stateNow()).toEqual(before);
  });

  it("control: the same body as an untagged Code save is saved, with its usual checks", async () => {
    seedTheme(DATA_LOCKED);
    const { saveStorefrontThemeFile } = await serverFns();

    const res = await saveStorefrontThemeFile({
      data: single(reordered(), { operation: undefined }),
    });

    expect(res.success).toBe(true);
    expect(readFile(ROUTE_PATH)).toEqual({ content: reordered(), version: 2 });
  });

  it("a tagged write without expectedSourceGeneration is refused before anything is read", async () => {
    seedTheme(DATA_OPEN);
    const { saveStorefrontThemeFile } = await serverFns();
    const before = stateNow();

    const res = await saveStorefrontThemeFile({
      data: single(reordered(), { expectedSourceGeneration: undefined }),
    });

    expect(res.success).toBe(false);
    expect(stateNow()).toEqual(before);
  });
});

describe("the Design structure guard on a batch (real SQL)", () => {
  it("a locked route cannot be unlocked by the same batch changing its loader's module: refused, nothing advanced", async () => {
    seedTheme(DATA_LOCKED);
    const { saveStorefrontThemeFilesBatch } = await serverFns();
    const before = stateNow();

    const res = await saveStorefrontThemeFilesBatch({
      data: batch({
        files: [
          routeWrite(reordered()),
          {
            path: DATA_PATH,
            content: DATA_OPEN,
            expectedFileId: DATA_ID,
            expectedVersion: 1,
          },
        ],
      }),
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe("DESIGN_STRUCTURE_LOCKED");
    expect(stateNow()).toEqual(before);
  });

  it("a batch that would lock an open route is refused, and nothing is advanced", async () => {
    seedTheme(DATA_OPEN);
    const { saveStorefrontThemeFilesBatch } = await serverFns();
    const before = stateNow();

    const res = await saveStorefrontThemeFilesBatch({
      data: batch({
        files: [
          routeWrite(reordered()),
          {
            path: DATA_PATH,
            content: DATA_LOCKED,
            expectedFileId: DATA_ID,
            expectedVersion: 1,
          },
        ],
      }),
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe("DESIGN_STRUCTURE_LOCKED");
    expect(stateNow()).toEqual(before);
  });

  it("a batch adding a page copy to an open route lands, copy and route together", async () => {
    seedTheme(DATA_OPEN);
    const { saveStorefrontThemeFilesBatch } = await serverFns();

    const res = await saveStorefrontThemeFilesBatch({
      data: batch({
        files: [
          {
            path: COPY_PATH,
            content: fields("PromoIndex"),
            expectMissing: true,
          },
          routeWrite(reordered()),
        ],
      }),
    });

    expect(res.success).toBe(true);
    expect(readGeneration()).toBe(2);
    expect(readFile(COPY_PATH)?.content).toBe(fields("PromoIndex"));
    expect(readFile(ROUTE_PATH)?.version).toBe(2);
  });

  it("a write landing after the check makes the batch's own CAS refuse all of it", async () => {
    seedTheme(DATA_OPEN);
    const { saveStorefrontThemeFilesBatch } = await serverFns();
    const snapshot = themeSourceStore.getSourceSnapshot.bind(themeSourceStore);
    vi.spyOn(themeSourceStore, "getSourceSnapshot").mockImplementationOnce(
      async (storefrontId, themeId) => {
        const read = await snapshot(storefrontId, themeId);
        // Another tab locks the route right after the guard's read.
        await themeSourceStore.saveFile(
          STORE,
          THEME,
          DATA_PATH,
          DATA_LOCKED,
          undefined,
          {
            expectedFileId: DATA_ID,
            expectedVersion: 1,
            expectMissing: false,
            expectedSourceGeneration: 1,
          },
        );
        return read;
      },
    );

    const res = await saveStorefrontThemeFilesBatch({
      data: batch({
        files: [
          {
            path: COPY_PATH,
            content: fields("PromoIndex"),
            expectMissing: true,
          },
          routeWrite(reordered()),
        ],
      }),
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe("SOURCE_GENERATION_CONFLICT");
    // The other write stands; nothing of the batch was written.
    expect(readGeneration()).toBe(2);
    expect(readFile(DATA_PATH)?.content).toBe(DATA_LOCKED);
    expect(readFile(ROUTE_PATH)).toEqual({ content: ROUTE_SOURCE, version: 1 });
    expect(readFile(COPY_PATH)).toBeUndefined();
    expect(seededData).toBe(DATA_OPEN);
  });
});
