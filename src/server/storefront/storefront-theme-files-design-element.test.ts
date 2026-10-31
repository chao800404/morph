// @vitest-environment node
/**
 * The server half of the Design structure guard for ordinary element edits
 * (operation "design-element"), on real SQL (better-sqlite3 behind the D1
 * binding, harness of storefront-theme-files-code-default.test.ts).
 *
 * A write that names a Design element edit is recomputed from one snapshot
 * of the Theme and refused when it touches a section, does not match, or
 * meets a newer generation; a refusal leaves files, generation, revisions and
 * the Document as they were. The editor's own check is not relied on here.
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
const LOCKED_ID = "00000000-0000-4000-8000-000000000003";
const ROUTE_PATH = "src/routes/guard.tsx";
const LOCKED_PATH = "src/routes/guard-locked.tsx";

const sectionComponent = (name: string) => `export const contentFields = {
  title: { type: "text", label: "${name} title" },
} as const;

export default function ${name}({ title = "${name} default" }: { title?: string }) {
  return (
    <section>
      <h2>{title}</h2>
    </section>
  );
}
`;
// The fixture of visual-editor-shell-element-structure-guard.test.tsx.
const ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import GuardHero from "../components/sections/GuardHero";
import GuardBanner from "../components/sections/GuardBanner";

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
      <p className="note">Plain note</p>
      <small className="fine">Fine print</small>
    </main>
  );
}
`;
const AT = {
  wrapper: "13:7",
  hero: "14:9",
  banner: "15:9",
  note: "17:7",
  fine: "18:7",
};
const LOCKED_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import GuardHero from "../components/sections/GuardHero";
import { getGuardPage } from "../server/guard";

export const Route = createFileRoute("/guard-locked")({
  loader: () => getGuardPage(),
  component: GuardLockedRoute,
});

function GuardLockedRoute() {
  const page = Route.useLoaderData();
  return (
    <main>
      <GuardHero {...page.hero} />
      <p className="note">Plain note</p>
      <small className="fine">Fine print</small>
    </main>
  );
}
`;
const LOCKED_AT = { hero: "14:7", note: "15:7", fine: "16:7" };
const LOCKED_DATA = `import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";

export const getGuardPage = createServerFn().handler(() =>
  morph.pages.get("/guard-locked"),
);
`;

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
  files: ReadonlyArray<{
    id: string;
    path: string;
    content: string;
    version?: number;
  }>,
) {
  const insert = sqlite.prepare(
    `INSERT INTO storefront_theme_files
      (id, storefront_id, theme_id, path, content, mime_type, is_entry, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'text/typescript', 0, ?, 'now', 'now')`,
  );
  for (const file of files) {
    insert.run(
      file.id,
      STORE,
      THEME,
      file.path,
      file.content,
      file.version ?? 1,
    );
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
    .prepare(
      `SELECT COUNT(*) AS count FROM storefront_theme_revisions WHERE theme_id = ?`,
    )
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
  const { saveStorefrontThemeFile } =
    await import("./storefront-theme-files.serverFn");
  return (
    saveStorefrontThemeFile as unknown as (args: {
      data: unknown;
    }) => Promise<SaveResult>
  )({ data });
}

function seedTheme() {
  let n = 100;
  const id = () =>
    `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;
  seedFiles([
    ...livePreviewPlatformFiles().map((entry) => ({
      id: id(),
      path: entry.path,
      content: entry.content ?? "",
    })),
    {
      id: id(),
      path: "package.json",
      content: JSON.stringify({
        dependencies: {
          "@tanstack/react-router": "1.0.0",
          "@tanstack/react-start": "1.0.0",
        },
      }),
    },
    {
      id: id(),
      path: "src/components/sections/GuardHero.tsx",
      content: sectionComponent("GuardHero"),
    },
    {
      id: id(),
      path: "src/components/sections/GuardBanner.tsx",
      content: sectionComponent("GuardBanner"),
    },
    { id: id(), path: "src/server/guard.ts", content: LOCKED_DATA },
    { id: ROUTE_ID, path: ROUTE_PATH, content: ROUTE_SOURCE },
    { id: LOCKED_ID, path: LOCKED_PATH, content: LOCKED_SOURCE },
  ]);
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

/** Everything a refused write must leave as it was. */
function stateNow() {
  return {
    generation: readGeneration(),
    route: readFile(ROUTE_PATH),
    locked: readFile(LOCKED_PATH),
    revisions: countRevisions(),
    template: readRawTemplateRow(),
  };
}

function designSave(
  path: string,
  fileId: string,
  content: string,
  designElement: Record<string, unknown>,
  expectedSourceGeneration = 1,
) {
  return callSave({
    storefrontId: STORE,
    themeId: THEME,
    path,
    content,
    expectedFileId: fileId,
    expectedVersion: 1,
    expectedSourceGeneration,
    operation: "design-element",
    designElement,
  });
}

const removeAt = (source: string, key: string) => {
  const result = applyDesignElementOperation(
    [{ path: ROUTE_PATH, content: source }],
    ROUTE_PATH,
    source,
    { kind: "remove-element", targetKey: key },
  );
  if (result.status !== "ok") throw new Error(`fixture: ${result.status}`);
  return result.code;
};

describe("saveStorefrontThemeFile operation 'design-element' (real SQL)", () => {
  beforeEach(() => seedTheme());

  it("refuses a delete of the wrapper that contains sections, and writes nothing", async () => {
    const before = stateNow();
    // What a client that skipped its own check would send.
    const withoutSections = ROUTE_SOURCE.replace(
      /\n      <div className="stack">[\s\S]*?<\/div>/,
      "",
    );
    const res = await designSave(ROUTE_PATH, ROUTE_ID, withoutSections, {
      kind: "remove-element",
      targetKey: AT.wrapper,
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe("DESIGN_ELEMENT_TOUCHES_SECTIONS");
    expect(stateNow()).toEqual(before);
  });

  it("refuses a sibling reorder of two section call sites, and writes nothing", async () => {
    const before = stateNow();
    const swapped = ROUTE_SOURCE.replace(
      '<GuardHero {...content("hero")} />\n        <GuardBanner {...content("banner")} />',
      '<GuardBanner {...content("banner")} />\n        <GuardHero {...content("hero")} />',
    );
    const res = await designSave(ROUTE_PATH, ROUTE_ID, swapped, {
      kind: "swap-siblings",
      firstKey: AT.hero,
      secondKey: AT.banner,
    });

    expect(res.error).toBe("DESIGN_ELEMENT_TOUCHES_SECTIONS");
    expect(stateNow()).toEqual(before);
  });

  it("refuses content that is not the named operation applied to the stored file", async () => {
    const before = stateNow();
    // The operation names an ordinary element; the content removes the sections.
    const withoutSections = ROUTE_SOURCE.replace(
      /\n      <div className="stack">[\s\S]*?<\/div>/,
      "",
    );
    const res = await designSave(ROUTE_PATH, ROUTE_ID, withoutSections, {
      kind: "remove-element",
      targetKey: AT.note,
    });

    expect(res.error).toBe("DESIGN_ELEMENT_CONTENT_MISMATCH");
    expect(stateNow()).toEqual(before);
  });

  it("refuses the loader-bound section call site of a locked route", async () => {
    const before = stateNow();
    const res = await designSave(
      LOCKED_PATH,
      LOCKED_ID,
      LOCKED_SOURCE.replace("\n      <GuardHero {...page.hero} />", ""),
      { kind: "remove-element", targetKey: LOCKED_AT.hero },
    );

    expect(res.error).toBe("DESIGN_ELEMENT_TOUCHES_SECTIONS");
    expect(stateNow()).toEqual(before);
  });

  for (const [label, path, id, source, at] of [
    ["the open route", ROUTE_PATH, ROUTE_ID, ROUTE_SOURCE, AT],
    [
      "the locked loader route",
      LOCKED_PATH,
      LOCKED_ID,
      LOCKED_SOURCE,
      LOCKED_AT,
    ],
  ] as const) {
    it(`saves an ordinary element delete on ${label} at the next generation`, async () => {
      const expected = applyDesignElementOperation(
        [{ path, content: source }],
        path,
        source,
        { kind: "remove-element", targetKey: at.note },
      );
      expect(expected.status).toBe("ok");
      const code = (expected as { code: string }).code;
      const res = await designSave(path, id, code, {
        kind: "remove-element",
        targetKey: at.note,
      });

      expect(res.success).toBe(true);
      expect(readGeneration()).toBe(2);
      expect(readFile(path)).toEqual({ content: code, version: 2 });
      expect(readFile(path).content).not.toContain("Plain note");
    });
  }

  it("refuses an operation against a stale generation, and writes nothing", async () => {
    sqlite
      .prepare(
        `UPDATE storefront_themes SET source_generation = 2 WHERE id = ?`,
      )
      .run(THEME);
    const before = stateNow();
    const res = await designSave(
      ROUTE_PATH,
      ROUTE_ID,
      removeAt(ROUTE_SOURCE, AT.note),
      { kind: "remove-element", targetKey: AT.note },
      1,
    );

    expect(res.error).toBe("SOURCE_GENERATION_CONFLICT");
    expect(stateNow()).toEqual(before);
  });

  it("refuses with the write's CAS when another write lands after the snapshot", async () => {
    const real = themeSourceStore.getSourceSnapshot.bind(themeSourceStore);
    const spy = vi
      .spyOn(themeSourceStore, "getSourceSnapshot")
      .mockImplementationOnce(async (storefrontId, themeId) => {
        const snapshot = await real(storefrontId, themeId);
        // Another tab saves an unrelated file between the guard's read and
        // its write: the generation moves on, the guard's snapshot does not.
        const other = await themeSourceStore.saveFile(
          STORE,
          THEME,
          "src/server/guard.ts",
          `${LOCKED_DATA}// changed elsewhere\n`,
          undefined,
          {
            expectedFileId: readFileId("src/server/guard.ts"),
            expectedVersion: 1,
            expectMissing: false,
            expectedSourceGeneration: 1,
          },
        );
        expect(other.sourceGeneration).toBe(2);
        return snapshot;
      });
    const res = await designSave(
      ROUTE_PATH,
      ROUTE_ID,
      removeAt(ROUTE_SOURCE, AT.note),
      { kind: "remove-element", targetKey: AT.note },
    );
    spy.mockRestore();

    expect(res.error).toBe("SOURCE_GENERATION_CONFLICT");
    // The other write stands; this one did not land, nothing partial.
    expect(readGeneration()).toBe(2);
    expect(readFile(ROUTE_PATH)).toEqual({ content: ROUTE_SOURCE, version: 1 });
    expect(readFile("src/server/guard.ts").content).toContain(
      "changed elsewhere",
    );
  });

  it("refuses at the snapshot when another write landed before it", async () => {
    await themeSourceStore.saveFile(
      STORE,
      THEME,
      "src/server/guard.ts",
      `${LOCKED_DATA}// changed elsewhere\n`,
      undefined,
      {
        expectedFileId: readFileId("src/server/guard.ts"),
        expectedVersion: 1,
        expectMissing: false,
        expectedSourceGeneration: 1,
      },
    );
    const before = stateNow();
    const res = await designSave(
      ROUTE_PATH,
      ROUTE_ID,
      removeAt(ROUTE_SOURCE, AT.note),
      { kind: "remove-element", targetKey: AT.note },
      1,
    );

    expect(res.error).toBe("SOURCE_GENERATION_CONFLICT");
    expect(stateNow()).toEqual(before);
  });

  it("judges on one batched snapshot, not on separate file and generation reads", async () => {
    const listFiles = vi.spyOn(themeSourceStore, "listFiles");
    const getGeneration = vi.spyOn(themeSourceStore, "getSourceGeneration");
    const snapshot = vi.spyOn(themeSourceStore, "getSourceSnapshot");
    const res = await designSave(
      ROUTE_PATH,
      ROUTE_ID,
      removeAt(ROUTE_SOURCE, AT.note),
      { kind: "remove-element", targetKey: AT.note },
    );

    expect(res.success).toBe(true);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(listFiles).not.toHaveBeenCalled();
    expect(getGeneration).not.toHaveBeenCalled();
  });

  it("refuses a designElement without the operation, and the operation without one", async () => {
    const before = stateNow();
    const content = removeAt(ROUTE_SOURCE, AT.note);
    const base = {
      storefrontId: STORE,
      themeId: THEME,
      path: ROUTE_PATH,
      content,
      expectedFileId: ROUTE_ID,
      expectedVersion: 1,
      expectedSourceGeneration: 1,
    };
    const noOperation = await callSave({
      ...base,
      designElement: { kind: "remove-element", targetKey: AT.note },
    });
    const noDesignElement = await callSave({
      ...base,
      operation: "design-element",
    });

    expect(noOperation.success).toBe(false);
    expect(noDesignElement.success).toBe(false);
    expect(stateNow()).toEqual(before);
  });
});

describe("storefrontThemeFileDal.getSourceSnapshot", () => {
  beforeEach(() => seedTheme());

  it("reads the generation and the source files in one D1 batch", async () => {
    const { env } = await import("cloudflare:workers");
    const batch = vi.spyOn(env.DATABASE, "batch");
    const snapshot = await themeSourceStore.getSourceSnapshot(STORE, THEME);

    expect(batch).toHaveBeenCalledTimes(1);
    expect(snapshot?.sourceGeneration).toBe(1);
    expect(
      snapshot?.files.find((file) => file.path === ROUTE_PATH),
    ).toMatchObject({
      id: ROUTE_ID,
      content: ROUTE_SOURCE,
      version: 1,
    });
  });

  it("is null for a Theme of another storefront or a deleted one", async () => {
    expect(
      await themeSourceStore.getSourceSnapshot("other-store", THEME),
    ).toBeNull();
    sqlite
      .prepare(`UPDATE storefront_themes SET deleted_at = 'now' WHERE id = ?`)
      .run(THEME);
    expect(await themeSourceStore.getSourceSnapshot(STORE, THEME)).toBeNull();
  });
});

function readFileId(path: string) {
  return (
    sqlite
      .prepare(
        `SELECT id FROM storefront_theme_files WHERE theme_id = ? AND path = ? AND deleted_at IS NULL`,
      )
      .get(THEME, path) as { id: string }
  ).id;
}
