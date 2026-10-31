// @vitest-environment node
/**
 * Why a resend of a Design element edit has to keep its origin (decision A,
 * handoff/2026-10-31/guard-a-decisions.md; inventory
 * guard-a-origin-inventory.md tests S1/S2), on real SQL (harness of
 * storefront-theme-files-design-element.test.ts).
 *
 * A delete judged ordinary at generation 1 is not sent, or not answered.
 * Meanwhile another write changes a component file: the deleted wrapper now
 * contains a section call site, while the route file itself, its id and its
 * version, stay as they were. Sent again at the newer generation:
 *
 * - tagged `operation: "design-element"`, the server recomputes the op on the
 *   newest snapshot and refuses it, writing nothing;
 * - as a plain save, the identical body lands and removes the section call
 *   site. That half is a control: it fixes the contract that a plain save is
 *   not judged (decision E, a capability guard), not a desired outcome.
 *
 * Both pass on 8f707df; the gap is that the editor's resend paths send the
 * plain form (visual-editor-shell-design-element-resend.test.tsx).
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { themeSourceStore } from "@/lib/storefront/storage/theme-storage.server";
import { applyDesignElementOperation } from "@/lib/storefront/compiler/design-element-operation";
import { deriveThemeRouteSections } from "@/lib/storefront/compiler/theme-route-sections";
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
const TEMPLATE_ID = "00000000-0000-4000-8000-000000000010";
const ROUTE_ID = "00000000-0000-4000-8000-000000000002";
const BANNER_ID = "00000000-0000-4000-8000-000000000004";
const ROUTE_PATH = "src/routes/guard.tsx";
const BANNER_PATH = "src/components/sections/GuardBanner.tsx";
const CARD_PATH = "src/components/sections/PromoCard.tsx";

const sectionComponent = (
  name: string,
  extraFields = "",
) => `export const contentFields = {
  title: { type: "text", label: "${name} title" },${extraFields}
} as const;

export default function ${name}({ title = "${name} default" }: { title?: string }) {
  return (
    <section>
      <h2>{title}</h2>
    </section>
  );
}
`;
/** GuardBanner as first stored: it lists PromoCard as its row component. */
const BANNER_WITH_ROWS = sectionComponent(
  "GuardBanner",
  `\n  items: { type: "array", label: "Items", of: "./PromoCard" },`,
);
/** GuardBanner as another tab saves it: PromoCard is no longer its row. */
const BANNER_WITHOUT_ROWS = sectionComponent("GuardBanner");
const CARD_SOURCE = sectionComponent("PromoCard");

// The guard fixture of storefront-theme-files-design-element.test.ts, with a
// wrapper around a PromoCard that is a row component of GuardBanner.
const ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import GuardHero from "../components/sections/GuardHero";
import GuardBanner from "../components/sections/GuardBanner";
import PromoCard from "../components/sections/PromoCard";

export const Route = createFileRoute("/guard")({
  component: GuardRoute,
});

function GuardRoute() {
  return (
    <main>
      <div className="stack">
        <GuardHero {...content("hero")} />
        <GuardBanner {...content("banner")} />
      </div>
      <aside className="promo">
        <PromoCard />
      </aside>
      <p className="note">Plain note</p>
    </main>
  );
}
`;
/** `line:column` of the first opening tag that starts with `needle`. */
function keyOf(source: string, needle: string) {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`fixture: ${needle} not found`);
  const before = source.slice(0, index);
  const line = before.split("\n").length;
  const column = index - before.lastIndexOf("\n");
  return `${line}:${column}`;
}
const REMOVE_PROMO = {
  kind: "remove-element",
  targetKey: keyOf(ROUTE_SOURCE, '<aside className="promo">'),
} as const;

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
  seedTheme();
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

function seedTheme() {
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
      (entry) => [id(), entry.path, entry.content ?? ""] as const,
    ),
    [
      id(),
      "package.json",
      JSON.stringify({
        dependencies: {
          "@tanstack/react-router": "1.0.0",
          "@tanstack/react-start": "1.0.0",
        },
      }),
    ] as const,
    [
      id(),
      "src/components/sections/GuardHero.tsx",
      sectionComponent("GuardHero"),
    ] as const,
    [BANNER_ID, BANNER_PATH, BANNER_WITH_ROWS] as const,
    [id(), CARD_PATH, CARD_SOURCE] as const,
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

async function callSave(data: Record<string, unknown>): Promise<SaveResult> {
  const { saveStorefrontThemeFile } =
    await import("./storefront-theme-files.serverFn");
  return (
    saveStorefrontThemeFile as unknown as (args: {
      data: unknown;
    }) => Promise<SaveResult>
  )({ data });
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
    .get(THEME, path) as { content: string; version: number };
const countRevisions = () =>
  (
    sqlite
      .prepare(
        `SELECT COUNT(*) AS count FROM storefront_theme_revisions WHERE theme_id = ?`,
      )
      .get(THEME) as { count: number }
  ).count;

/** Everything a refused write must leave as it was. */
function stateNow() {
  return {
    generation: readGeneration(),
    route: readFile(ROUTE_PATH),
    banner: readFile(BANNER_PATH),
    revisions: countRevisions(),
  };
}

/** The stored Theme's files, as the server's own snapshot reads them. */
async function storedFiles() {
  const snapshot = await themeSourceStore.getSourceSnapshot(STORE, THEME);
  if (!snapshot) throw new Error("fixture: no snapshot");
  return snapshot.files;
}

/** The delete as the editor computed it at generation 1. */
async function deleteBodyAtFirstGeneration() {
  const applied = applyDesignElementOperation(
    await storedFiles(),
    ROUTE_PATH,
    ROUTE_SOURCE,
    REMOVE_PROMO,
  );
  if (applied.status !== "ok") {
    throw new Error(`fixture: the delete is ${applied.status} at generation 1`);
  }
  return applied.code;
}

/** Another tab saves GuardBanner without its row field: generation 1 → 2. */
async function anotherTabDropsTheRowField() {
  const saved = await themeSourceStore.saveFile(
    STORE,
    THEME,
    BANNER_PATH,
    BANNER_WITHOUT_ROWS,
    undefined,
    {
      expectedFileId: BANNER_ID,
      expectedVersion: 1,
      expectMissing: false,
      expectedSourceGeneration: 1,
    },
  );
  expect(saved.sourceGeneration).toBe(2);
}

const resendBody = (content: string) => ({
  storefrontId: STORE,
  themeId: THEME,
  path: ROUTE_PATH,
  content,
  expectedFileId: ROUTE_ID,
  expectedVersion: 1,
  expectedSourceGeneration: 2,
});

describe("a Design element delete sent again after a component changed (real SQL)", () => {
  it("precondition: at generation 1 the wrapper holds no section and the tagged delete lands", async () => {
    const files = await storedFiles();
    const analysis = deriveThemeRouteSections(files, ROUTE_PATH);
    expect(analysis.sections.map((section) => section.slotId)).toEqual([
      "hero",
      "banner",
    ]);
    const body = await deleteBodyAtFirstGeneration();
    expect(body).not.toContain("<PromoCard />");

    const res = await callSave({
      ...resendBody(body),
      expectedSourceGeneration: 1,
      operation: "design-element",
      designElement: REMOVE_PROMO,
    });

    expect(res.success).toBe(true);
    expect(readFile(ROUTE_PATH)).toEqual({ content: body, version: 2 });
  });

  it("precondition: once GuardBanner drops the row field, the same delete touches a section call site", async () => {
    await anotherTabDropsTheRowField();
    const applied = applyDesignElementOperation(
      await storedFiles(),
      ROUTE_PATH,
      ROUTE_SOURCE,
      REMOVE_PROMO,
    );

    expect(applied).toMatchObject({
      status: "refused",
      error: "DESIGN_ELEMENT_TOUCHES_SECTIONS",
    });
    // The route file did not move: its id and version are what was sent against.
    expect(readFile(ROUTE_PATH)).toEqual({ content: ROUTE_SOURCE, version: 1 });
  });

  it("S1: sent again tagged at generation 2, it is judged on the newest snapshot, refused, and nothing is written", async () => {
    const body = await deleteBodyAtFirstGeneration();
    await anotherTabDropsTheRowField();
    const before = stateNow();

    const res = await callSave({
      ...resendBody(body),
      operation: "design-element",
      designElement: REMOVE_PROMO,
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe("DESIGN_ELEMENT_TOUCHES_SECTIONS");
    expect(stateNow()).toEqual(before);
    expect(readFile(ROUTE_PATH).content).toContain("<PromoCard />");
  });

  it("S2 control: the identical body sent as a plain save at generation 2 lands, removing the section call site", async () => {
    // Not a desired outcome: the contract that a plain save is not judged
    // (decision E). It is what the editor's resend paths send today.
    const body = await deleteBodyAtFirstGeneration();
    await anotherTabDropsTheRowField();

    const res = await callSave(resendBody(body));

    expect(res.success).toBe(true);
    expect(readGeneration()).toBe(3);
    expect(readFile(ROUTE_PATH)).toEqual({ content: body, version: 2 });
    expect(readFile(ROUTE_PATH).content).not.toContain("<PromoCard />");
  });
});

describe("the undo of a Design element delete, on real SQL (decision A, Q2)", () => {
  /** The tagged delete lands at generation 1: route v2, generation 2. */
  async function deleteLands() {
    const body = await deleteBodyAtFirstGeneration();
    const res = await callSave({
      ...resendBody(body),
      expectedSourceGeneration: 1,
      operation: "design-element",
      designElement: REMOVE_PROMO,
    });
    expect(res.success).toBe(true);
    expect(readGeneration()).toBe(2);
    return body;
  }
  const undoBody = (content: string, generation: number) => ({
    storefrontId: STORE,
    themeId: THEME,
    path: ROUTE_PATH,
    content,
    expectedFileId: ROUTE_ID,
    expectedVersion: 2,
    expectedSourceGeneration: generation,
    operation: "design-element",
    designElement: { kind: "undo", edit: REMOVE_PROMO },
  });

  it("an undo that reverses exactly the delete lands, putting the wrapper back", async () => {
    await deleteLands();

    const res = await callSave(undoBody(ROUTE_SOURCE, 2));

    expect(res.success).toBe(true);
    expect(readGeneration()).toBe(3);
    expect(readFile(ROUTE_PATH)).toEqual({ content: ROUTE_SOURCE, version: 3 });
  });

  it("an undo that would bring back a call site that is a section now is refused, and nothing is written", async () => {
    await deleteLands();
    // Another tab drops the row field: PromoCard's call site would come back
    // as a section.
    const saved = await themeSourceStore.saveFile(
      STORE,
      THEME,
      BANNER_PATH,
      BANNER_WITHOUT_ROWS,
      undefined,
      {
        expectedFileId: BANNER_ID,
        expectedVersion: 1,
        expectMissing: false,
        expectedSourceGeneration: 2,
      },
    );
    expect(saved.sourceGeneration).toBe(3);
    const before = stateNow();

    const res = await callSave(undoBody(ROUTE_SOURCE, 3));

    expect(res.success).toBe(false);
    expect(res.error).toBe("DESIGN_ELEMENT_TOUCHES_SECTIONS");
    expect(stateNow()).toEqual(before);
    expect(readFile(ROUTE_PATH).content).not.toContain("<PromoCard />");
  });

  it("an undo sending other text than the delete was made on is refused, and nothing is written", async () => {
    await deleteLands();
    const before = stateNow();

    const res = await callSave(
      undoBody(ROUTE_SOURCE.replace("Plain note", "Smuggled note"), 2),
    );

    expect(res.success).toBe(false);
    expect(res.error).toBe("DESIGN_ELEMENT_NOT_APPLICABLE");
    expect(stateNow()).toEqual(before);
  });
});
