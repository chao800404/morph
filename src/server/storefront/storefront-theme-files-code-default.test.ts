// @vitest-environment node
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  themeSourceStore,
} from "@/lib/storefront/storage/theme-storage.server";

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
const HERO_ID = "00000000-0000-4000-8000-000000000001";
const ROUTE_ID = "00000000-0000-4000-8000-000000000002";
const TEMPLATE_ID = "00000000-0000-4000-8000-000000000010";
const HERO_PATH = "src/components/Hero.tsx";
const ROUTE_PATH = "src/routes/index.tsx";

const HERO_SOURCE = `export const contentFields = {
  title: { type: "text", label: "Title" },
  desc: { type: "text", label: "Desc" },
};
export default function Hero({ title = "Default title", desc = "Default desc" }) {
  return (
    <section>
      <h1>{title}</h1>
      <p>{desc}</p>
    </section>
  );
}`;

const ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return (
    <main>
      <Hero title="Caller title" />
    </main>
  );
}`;

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
  `);

  sqlite.exec(`
    INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
    VALUES ('${STORE}', 'channel-a', 'Store A', 'draft', 'now', 'now');
    INSERT INTO storefront_themes (id, storefront_id, name, status, source_generation, created_at, updated_at)
    VALUES ('${THEME}', '${STORE}', 'Theme A', 'draft', 1, 'now', 'now');
    INSERT INTO storefront_theme_templates (id, theme_id, type, name, route_path, document, updated_at)
    VALUES (
      '${TEMPLATE_ID}',
      '${THEME}',
      'index',
      'Home',
      '/',
      '{"sections":[{"id":"hero","type":"Hero","enabled":true,"props":{"title":"Stored title","desc":"Stored desc"}}]}',
      'now'
    );
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

function seedFiles(
  files: ReadonlyArray<{ id: string; path: string; content: string; version?: number }>,
) {
  const insert = sqlite.prepare(
    `INSERT INTO storefront_theme_files
      (id, storefront_id, theme_id, path, content, mime_type, is_entry, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'text/typescript', 0, ?, 'now', 'now')`,
  );
  for (const file of files) {
    insert.run(file.id, STORE, THEME, file.path, file.content, file.version ?? 1);
  }
}

function readRawTemplateRow() {
  return sqlite
    .prepare(
      `SELECT id, theme_id, type, name, route_path, document, updated_at, deleted_at
       FROM storefront_theme_templates WHERE id = ?`,
    )
    .get(TEMPLATE_ID);
}

function countRevisions(): number {
  const row = sqlite
    .prepare(`SELECT COUNT(*) AS count FROM storefront_theme_revisions WHERE theme_id = ?`)
    .get(THEME) as { count: number };
  return row.count;
}

type SaveResult = {
  success: boolean;
  error?: string;
  message: string;
  data?: Record<string, unknown>;
};

async function callSave(data: Record<string, unknown>): Promise<SaveResult> {
  const { saveStorefrontThemeFile } = await import(
    "./storefront-theme-files.serverFn"
  );
  return (
    saveStorefrontThemeFile as unknown as (args: {
      data: unknown;
    }) => Promise<SaveResult>
  )({ data });
}

describe("saveStorefrontThemeFile operation: 'code-default'", () => {
  it("patches only the target string default, ignores malicious client content, and leaves the Document untouched", async () => {
    seedFiles([
      { id: HERO_ID, path: HERO_PATH, content: HERO_SOURCE },
      { id: ROUTE_ID, path: ROUTE_PATH, content: ROUTE_SOURCE },
    ]);
    const templateBefore = readRawTemplateRow();

    const res = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: 'export default function Evil() { return <script>alert("xss")</script>; }',
      expectedFileId: HERO_ID,
      expectedVersion: 1,
      expectedSourceGeneration: 1,
      operation: "code-default",
      codeDefault: {
        componentPath: HERO_PATH,
        componentName: "Hero",
        fieldKey: "desc",
        expectedCurrentDefault: "Default desc",
        value: "Patched desc default",
      },
    });

    expect(res.success, res.message).toBe(true);
    expect(res.data?.noop).toBeUndefined();
    const savedHero = await themeSourceStore.getFileByPath(STORE, THEME, HERO_PATH);
    expect(savedHero?.version).toBe(2);
    expect(savedHero?.content).toBe(
      HERO_SOURCE.replace('"Default desc"', '"Patched desc default"'),
    );
    expect(savedHero?.content).not.toContain("Evil");
    expect(await themeSourceStore.getSourceGeneration(STORE, THEME)).toBe(2);
    expect(readRawTemplateRow()).toEqual(templateBefore);
  });

  it("refuses when operation and codeDefault proof are not strictly paired (missing proof, omitted operation with proof, or operation 'save' with proof), without falling through to normal save", async () => {
    seedFiles([
      { id: HERO_ID, path: HERO_PATH, content: HERO_SOURCE },
      { id: ROUTE_ID, path: ROUTE_PATH, content: ROUTE_SOURCE },
    ]);
    const revisionsBefore = countRevisions();
    const templateBefore = readRawTemplateRow();

    const missingProof = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: "// malicious full overwrite",
      expectedFileId: HERO_ID,
      expectedVersion: 1,
      expectedSourceGeneration: 1,
      operation: "code-default",
    });
    expect(missingProof.success).toBe(false);

    const omittedOperationWithProof = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: "// malicious full overwrite when operation omitted",
      expectedFileId: HERO_ID,
      expectedVersion: 1,
      expectedSourceGeneration: 1,
      codeDefault: {
        componentPath: HERO_PATH,
        componentName: "Hero",
        fieldKey: "desc",
        expectedCurrentDefault: "Default desc",
        value: "Patched desc default",
      },
    });
    expect(omittedOperationWithProof.success).toBe(false);

    const saveOperationWithProof = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: "// malicious full overwrite when operation is save",
      expectedFileId: HERO_ID,
      expectedVersion: 1,
      expectedSourceGeneration: 1,
      operation: "save",
      codeDefault: {
        componentPath: HERO_PATH,
        componentName: "Hero",
        fieldKey: "desc",
        expectedCurrentDefault: "Default desc",
        value: "Patched desc default",
      },
    });
    expect(saveOperationWithProof.success).toBe(false);

    const mismatchedComponentPath = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: "// malicious full overwrite when componentPath mismatches",
      expectedFileId: HERO_ID,
      expectedVersion: 1,
      expectedSourceGeneration: 1,
      operation: "code-default",
      codeDefault: {
        componentPath: ROUTE_PATH,
        componentName: "Hero",
        fieldKey: "desc",
        expectedCurrentDefault: "Default desc",
        value: "Patched desc default",
      },
    });
    expect(mismatchedComponentPath.success).toBe(false);

    const heroAfter = await themeSourceStore.getFileByPath(STORE, THEME, HERO_PATH);
    expect(heroAfter?.version).toBe(1);
    expect(heroAfter?.content).toBe(HERO_SOURCE);
    expect(await themeSourceStore.getSourceGeneration(STORE, THEME)).toBe(1);
    expect(countRevisions()).toBe(revisionsBefore);
    expect(readRawTemplateRow()).toEqual(templateBefore);
  });

  it("treats same-value save (including single-quoted literal) as a verified no-op without bumping file version, sourceGeneration, or revisions", async () => {
    const singleQuoteHero = HERO_SOURCE.replace('"Default desc"', "'Same'");
    seedFiles([
      { id: HERO_ID, path: HERO_PATH, content: singleQuoteHero },
      { id: ROUTE_ID, path: ROUTE_PATH, content: ROUTE_SOURCE },
    ]);
    const revisionsBefore = countRevisions();

    const res = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: "// ignored client content",
      expectedFileId: HERO_ID,
      expectedVersion: 1,
      expectedSourceGeneration: 1,
      operation: "code-default",
      codeDefault: {
        componentPath: HERO_PATH,
        fieldKey: "desc",
        expectedCurrentDefault: "Same",
        value: "Same",
      },
    });

    expect(res.success, res.message).toBe(true);
    expect(res.data?.noop).toBe(true);
    expect(res.data?.version).toBe(1);
    expect(res.data?.sourceGeneration).toBe(1);
    const heroAfter = await themeSourceStore.getFileByPath(STORE, THEME, HERO_PATH);
    expect(heroAfter?.version).toBe(1);
    expect(heroAfter?.content).toBe(singleQuoteHero);
    expect(await themeSourceStore.getSourceGeneration(STORE, THEME)).toBe(1);
    expect(countRevisions()).toBe(revisionsBefore);

    // Same-value no-op still enforces OCC and stale default checks:
    const staleVersion = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: "",
      expectedFileId: HERO_ID,
      expectedVersion: 2,
      expectedSourceGeneration: 1,
      operation: "code-default",
      codeDefault: {
        componentPath: HERO_PATH,
        fieldKey: "desc",
        expectedCurrentDefault: "Same",
        value: "Same",
      },
    });
    expect(staleVersion).toMatchObject({
      success: false,
      error: "FILE_VERSION_CONFLICT",
    });

    const staleGen = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: "",
      expectedFileId: HERO_ID,
      expectedVersion: 1,
      expectedSourceGeneration: 2,
      operation: "code-default",
      codeDefault: {
        componentPath: HERO_PATH,
        fieldKey: "desc",
        expectedCurrentDefault: "Same",
        value: "Same",
      },
    });
    expect(staleGen).toMatchObject({
      success: false,
      error: "SOURCE_GENERATION_CONFLICT",
    });
  });

  it("refuses when expectedCurrentDefault does not match the current AST default (SOURCE_DEFAULT_STALE)", async () => {
    seedFiles([
      { id: HERO_ID, path: HERO_PATH, content: HERO_SOURCE },
      { id: ROUTE_ID, path: ROUTE_PATH, content: ROUTE_SOURCE },
    ]);

    const res = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: "",
      expectedFileId: HERO_ID,
      expectedVersion: 1,
      expectedSourceGeneration: 1,
      operation: "code-default",
      codeDefault: {
        componentPath: HERO_PATH,
        fieldKey: "desc",
        expectedCurrentDefault: "Outdated default",
        value: "New default",
      },
    });

    expect(res).toMatchObject({
      success: false,
      error: "SOURCE_DEFAULT_STALE",
    });
    expect((await themeSourceStore.getFileByPath(STORE, THEME, HERO_PATH))?.version).toBe(1);
    expect(await themeSourceStore.getSourceGeneration(STORE, THEME)).toBe(1);
  });

  it("re-proves call sites on current workspace source and refuses passed-by-caller, spread-by-caller, call-site-unknown, and missing defaults", async () => {
    seedFiles([
      { id: HERO_ID, path: HERO_PATH, content: HERO_SOURCE },
      { id: ROUTE_ID, path: ROUTE_PATH, content: ROUTE_SOURCE },
    ]);

    // 1. `title` is passed by ROUTE_SOURCE (`<Hero title="Caller title" />`)
    const passed = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: "",
      expectedFileId: HERO_ID,
      expectedVersion: 1,
      expectedSourceGeneration: 1,
      operation: "code-default",
      codeDefault: {
        componentPath: HERO_PATH,
        fieldKey: "title",
        expectedCurrentDefault: "Default title",
        value: "Attempted title default",
      },
    });
    expect(passed).toMatchObject({
      success: false,
      error: "SOURCE_DEFAULT_PASSED_BY_CALLER",
    });

    // 2. Non-existent default prop
    const missing = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: "",
      expectedFileId: HERO_ID,
      expectedVersion: 1,
      expectedSourceGeneration: 1,
      operation: "code-default",
      codeDefault: {
        componentPath: HERO_PATH,
        fieldKey: "subtitle",
        expectedCurrentDefault: "",
        value: "Sub",
      },
    });
    expect(missing).toMatchObject({
      success: false,
      error: "SOURCE_DEFAULT_MISSING",
    });

    // 3. Route updated to spread props (`<Hero {...props} />`)
    sqlite
      .prepare(`UPDATE storefront_theme_files SET content = ? WHERE id = ?`)
      .run(
        ROUTE_SOURCE.replace('<Hero title="Caller title" />', "<Hero {...({} as any)} />"),
        ROUTE_ID,
      );
    const spread = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: "",
      expectedFileId: HERO_ID,
      expectedVersion: 1,
      expectedSourceGeneration: 1,
      operation: "code-default",
      codeDefault: {
        componentPath: HERO_PATH,
        fieldKey: "desc",
        expectedCurrentDefault: "Default desc",
        value: "Attempted desc",
      },
    });
    expect(spread).toMatchObject({
      success: false,
      error: "SOURCE_DEFAULT_SPREAD_BY_CALLER",
    });

    // 4. Route updated so Hero is not rendered anywhere -> call-site-unknown
    sqlite
      .prepare(`UPDATE storefront_theme_files SET content = ? WHERE id = ?`)
      .run(
        ROUTE_SOURCE.replace('<Hero title="Caller title" />', "<div />"),
        ROUTE_ID,
      );
    const unknownCallSite = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: "",
      expectedFileId: HERO_ID,
      expectedVersion: 1,
      expectedSourceGeneration: 1,
      operation: "code-default",
      codeDefault: {
        componentPath: HERO_PATH,
        fieldKey: "desc",
        expectedCurrentDefault: "Default desc",
        value: "Attempted desc",
      },
    });
    expect(unknownCallSite).toMatchObject({
      success: false,
      error: "SOURCE_DEFAULT_CALL_SITE_UNKNOWN",
    });

    expect((await themeSourceStore.getFileByPath(STORE, THEME, HERO_PATH))?.content).toBe(
      HERO_SOURCE,
    );
  });

  it("disambiguates multiple components in the same file by componentName and refuses ambiguous or unknown components", async () => {
    const multiSource = `export function Hero({ title = "Hero one" }) { return <h1>{title}</h1>; }
export function Card({ title = "Card two" }) { return <p>{title}</p>; }`;
    const multiRoute = `import { createFileRoute } from "@tanstack/react-router";
import { Hero, Card } from "../components/Hero";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return <main><Hero /><Card /></main>;
}`;
    seedFiles([
      { id: HERO_ID, path: HERO_PATH, content: multiSource },
      { id: ROUTE_ID, path: ROUTE_PATH, content: multiRoute },
    ]);

    // Without componentName -> ambiguous
    const ambiguous = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: "",
      expectedFileId: HERO_ID,
      expectedVersion: 1,
      expectedSourceGeneration: 1,
      operation: "code-default",
      codeDefault: {
        componentPath: HERO_PATH,
        fieldKey: "title",
        expectedCurrentDefault: "Card two",
        value: "Card updated",
      },
    });
    expect(ambiguous).toMatchObject({
      success: false,
      error: "SOURCE_DEFAULT_AMBIGUOUS",
    });

    // With unknown componentName -> component-unknown
    const unknownComp = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: "",
      expectedFileId: HERO_ID,
      expectedVersion: 1,
      expectedSourceGeneration: 1,
      operation: "code-default",
      codeDefault: {
        componentPath: HERO_PATH,
        componentName: "MissingComp",
        fieldKey: "title",
        expectedCurrentDefault: "Card two",
        value: "Card updated",
      },
    });
    expect(unknownComp).toMatchObject({
      success: false,
      error: "SOURCE_DEFAULT_COMPONENT_UNKNOWN",
    });

    // With componentName: "Card" -> patches only Card's default
    const patched = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: "",
      expectedFileId: HERO_ID,
      expectedVersion: 1,
      expectedSourceGeneration: 1,
      operation: "code-default",
      codeDefault: {
        componentPath: HERO_PATH,
        componentName: "Card",
        fieldKey: "title",
        expectedCurrentDefault: "Card two",
        value: "Card updated",
      },
    });
    expect(patched.success, patched.message).toBe(true);
    const saved = await themeSourceStore.getFileByPath(STORE, THEME, HERO_PATH);
    expect(saved?.content).toBe(
      `export function Hero({ title = "Hero one" }) { return <h1>{title}</h1>; }\nexport function Card({ title = "Card updated" }) { return <p>{title}</p>; }`,
    );
  });

  it("enforces file version and sourceGeneration OCC on code-default writes", async () => {
    seedFiles([
      { id: HERO_ID, path: HERO_PATH, content: HERO_SOURCE, version: 3 },
      { id: ROUTE_ID, path: ROUTE_PATH, content: ROUTE_SOURCE },
    ]);

    const wrongVersion = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: "",
      expectedFileId: HERO_ID,
      expectedVersion: 2,
      expectedSourceGeneration: 1,
      operation: "code-default",
      codeDefault: {
        componentPath: HERO_PATH,
        fieldKey: "desc",
        expectedCurrentDefault: "Default desc",
        value: "Next desc",
      },
    });
    expect(wrongVersion).toMatchObject({
      success: false,
      error: "FILE_VERSION_CONFLICT",
    });

    const wrongGen = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: "",
      expectedFileId: HERO_ID,
      expectedVersion: 3,
      expectedSourceGeneration: 99,
      operation: "code-default",
      codeDefault: {
        componentPath: HERO_PATH,
        fieldKey: "desc",
        expectedCurrentDefault: "Default desc",
        value: "Next desc",
      },
    });
    expect(wrongGen).toMatchObject({
      success: false,
      error: "SOURCE_GENERATION_CONFLICT",
    });
  });

  it("preserves normal Code Mode save behavior and response shape when operation is omitted", async () => {
    seedFiles([
      { id: HERO_ID, path: HERO_PATH, content: HERO_SOURCE },
      { id: ROUTE_ID, path: ROUTE_PATH, content: ROUTE_SOURCE },
    ]);
    const nextContent = `${HERO_SOURCE}\n// code mode comment\n`;

    const res = await callSave({
      storefrontId: STORE,
      themeId: THEME,
      path: HERO_PATH,
      content: nextContent,
      expectedFileId: HERO_ID,
      expectedVersion: 1,
      expectedSourceGeneration: 1,
    });

    expect(res.success, res.message).toBe(true);
    expect(Object.keys(res.data ?? {}).sort()).toEqual(
      [
        "content",
        "createdAt",
        "id",
        "isEntry",
        "mimeType",
        "path",
        "sourceGeneration",
        "storefrontId",
        "themeId",
        "updatedAt",
        "version",
      ].sort(),
    );
    expect(res.data?.content).toBe(nextContent);
    expect(res.data?.version).toBe(2);
    expect(res.data?.sourceGeneration).toBe(2);
  });
});
