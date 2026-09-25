// @vitest-environment node
import Database from "better-sqlite3";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storefrontThemeDal } from "../dal/storefront-theme.dal";
import {
  commitTextPromotion,
  TextPromotionConflictError,
} from "../dal/storefront-text-promotion.dal";
import { promoteTextToField } from "./text-promotion-write";

// Revisions and the source index are the storage layer's, decided as for any
// save; what is under test here is that the two halves land together.
vi.mock("../storage/d1-theme-storage", () => ({
  recordsForWorkspaceSave: async () => ({
    createRevision: false,
    sourceManifest: undefined,
    sourceIndex: undefined,
  }),
}));

vi.mock("cloudflare:workers", () => ({
  env: {
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
              if (sql.trim().toUpperCase().startsWith("SELECT")) {
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
      batch: async (statements: Array<any>) => {
        return sqlite.transaction(() =>
          statements.map((s) => {
            if (typeof s.run === "function") return s.run();
            if (typeof s.all === "function") return s.all();
            return {};
          }),
        )();
      },
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
      release_generation integer DEFAULT 1 NOT NULL,
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
      document text NOT NULL,
      draft_revision_id text,
      published_revision_id text,
      draft_generation integer DEFAULT 1 NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE UNIQUE INDEX storefront_theme_templates_active_route_unique
      ON storefront_theme_templates (theme_id, route_path)
      WHERE route_path IS NOT NULL AND deleted_at IS NULL;
    CREATE TABLE storefront_theme_template_revisions (
      id text PRIMARY KEY NOT NULL,
      template_id text NOT NULL,
      version integer NOT NULL,
      document text NOT NULL,
      created_by text,
      created_at text NOT NULL,
      published_at text
    );
    CREATE TABLE storefront_theme_builds (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      theme_id text NOT NULL,
      source_revision_id text NOT NULL,
      status text NOT NULL,
      artifact_prefix text,
      manifest_json text,
      created_by text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_releases (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      theme_id text NOT NULL,
      source_revision_id text NOT NULL,
      theme_build_id text NOT NULL,
      content_publication_id text,
      status text NOT NULL,
      metadata text,
      created_by text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_pages (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      title text NOT NULL,
      handle text NOT NULL,
      status text NOT NULL,
      draft_revision_id text,
      published_revision_id text,
      created_by text NOT NULL,
      metadata text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_page_revisions (id text, page_id text, document text);
    CREATE TABLE storefront_content_publications (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      created_by text,
      metadata text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_content_publication_items (
      id text PRIMARY KEY NOT NULL,
      publication_id text NOT NULL,
      item_type text NOT NULL,
      content_id text NOT NULL,
      revision_id text NOT NULL,
      metadata text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
  `);

  drizzle(sqlite, { schema: storefrontSchema });
  vi.mocked(getDb).mockResolvedValue(
    drizzle(sqlite, { schema: storefrontSchema }) as never,
  );

  sqlite.exec(`
    INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
    VALUES ('storefront-a', 'channel-a', 'Store A', 'active', 'now', 'now');
    INSERT INTO storefront_themes (id, storefront_id, name, status, source_generation, release_generation, created_at, updated_at)
    VALUES ('theme-a', 'storefront-a', 'Default Theme', 'draft', 1, 1, 'now', 'now');
    INSERT INTO storefront_theme_builds (id, storefront_id, theme_id, source_revision_id, status, artifact_prefix, manifest_json, created_at, updated_at)
    VALUES ('33333333-3333-4333-8333-333333333333', 'storefront-a', 'theme-a', '22222222-2222-4222-8222-222222222222', 'succeeded', 'themes/theme-a/builds/build-a', '{}', 'now', 'now');
  `);
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

const ROOT = `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: Root });
function Root() { return <Outlet />; }`;
const COPY = "src/components/page-sections/index/promo/index.tsx";
const LIBRARY = "src/components/sections/Promo.tsx";
const PROMO = `export default function Promo({ eyebrow = "New" }) {
  return (
    <p className="lead">hello world</p>
  );
}
`;

function route(importPath: string) {
  return `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Promo from "${importPath}";
export const Route = createFileRoute("/")({ component: Home });
function Home() { return <main><Promo {...content("promo")} /></main>; }`;
}

function insertFile(id: string, path: string, content: string) {
  sqlite
    .prepare(
      `INSERT INTO storefront_theme_files
        (id, storefront_id, theme_id, path, content, created_at, updated_at)
      VALUES (?, 'storefront-a', 'theme-a', ?, ?, 'now', 'now')`,
    )
    .run(id, path, content);
}

function insertTemplate(
  id: string,
  type: string,
  name: string,
  sections: unknown[] = [],
) {
  sqlite
    .prepare(
      `INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, created_at, updated_at)
      VALUES (?, 'theme-a', ?, ?, ?, 'now', 'now')`,
    )
    .run(id, type, name, JSON.stringify({ version: 1, sections }));
}

function seed(componentPath = COPY) {
  insertFile(
    "file-content",
    "src/morph/content.ts",
    "export function content(slot: string) { return {}; }\n",
  );
  insertFile("file-root", "src/routes/__root.tsx", ROOT);
  insertFile(
    "file-route",
    "src/routes/index.tsx",
    route(
      componentPath === COPY
        ? "../components/page-sections/index/promo/index"
        : "../components/sections/Promo",
    ),
  );
  insertFile("file-promo", componentPath, PROMO);
  insertTemplate("template-home", "index", "Home");
}

const promote = (
  overrides: Partial<Parameters<typeof promoteTextToField>[0]> = {},
) =>
  promoteTextToField({
    storefrontId: "storefront-a",
    themeId: "theme-a",
    templateId: "template-home",
    sectionId: "promo",
    routePath: "/",
    componentSourcePath: COPY,
    targetKey: "3:5",
    fieldName: "text",
    value: "Hello there",
    expectedSourceGeneration: 1,
    expectedFileVersion: 1,
    expectedDraftGeneration: 1,
    createdBy: "user-1",
    ...overrides,
  });

const fileRow = (path = COPY) =>
  sqlite
    .prepare(
      "SELECT content, version FROM storefront_theme_files WHERE path = ?",
    )
    .get(path) as { content: string; version: number };
const sourceGeneration = () =>
  (
    sqlite
      .prepare("SELECT source_generation AS g FROM storefront_themes")
      .get() as { g: number }
  ).g;
const template = () =>
  sqlite
    .prepare(
      "SELECT draft_generation AS generation, draft_revision_id AS revision FROM storefront_theme_templates",
    )
    .get() as { generation: number; revision: string | null };
const revisionCount = () =>
  sqlite
    .prepare("SELECT COUNT(*) AS n FROM storefront_theme_template_revisions")
    .get();
const storedProps = async () => {
  const context = await storefrontThemeDal.findEditorContext(
    "storefront-a",
    "theme-a",
  );
  return context?.templates[0]?.document.sections[0]?.props;
};

describe("promoteTextToField", () => {
  it("writes the field into the source and the value into this page together", async () => {
    seed();
    const result = await promote();

    expect(result).toMatchObject({
      ok: true,
      fieldName: "text",
      sourceGeneration: 2,
      draftGeneration: 2,
      file: { path: COPY, version: 2 },
    });
    expect(fileRow()).toEqual({
      version: 2,
      content: `export default function Promo({ eyebrow = "New", text = "hello world" }) {
  return (
    <p className="lead">{text}</p>
  );
}
`,
    });
    expect(sourceGeneration()).toBe(2);
    expect(template().generation).toBe(2);
    expect(await storedProps()).toEqual({ text: "Hello there" });
  });

  it("leaves the source alone for every later edit of the field", async () => {
    seed();
    await promote();
    const promoted = fileRow();

    const edited = await storefrontThemeDal.updateSectionProps({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-home",
      sectionId: "promo",
      routePath: "/",
      props: { text: "Edited again" },
      expectedDraftGeneration: 2,
      createdBy: "user-1",
    });

    expect(edited?.document.sections[0]?.props).toEqual({
      text: "Edited again",
    });
    expect(fileRow()).toEqual(promoted);
    expect(sourceGeneration()).toBe(2);
  });

  it("refuses a stale view before writing anything", async () => {
    seed();
    expect(await promote({ expectedFileVersion: 0 })).toMatchObject({
      ok: false,
      error: "CONFLICT",
      conflict: "file-version",
    });
    expect(await promote({ expectedSourceGeneration: 0 })).toMatchObject({
      ok: false,
      conflict: "source-generation",
    });
    expect(await promote({ expectedDraftGeneration: 0 })).toMatchObject({
      ok: false,
      conflict: "draft-generation",
    });
    expect(fileRow()).toEqual({ version: 1, content: PROMO });
    expect(sourceGeneration()).toBe(1);
    expect(template()).toEqual({ generation: 1, revision: null });
  });

  it("refuses shared source until the author confirms what it reaches", async () => {
    seed(LIBRARY);
    const refused = await promote({ componentSourcePath: LIBRARY });
    const impact = [
      "Section library: every section added from src/components/sections/Promo.tsx from now on",
    ];
    expect(refused).toMatchObject({
      ok: false,
      error: "SHARED_IMPACT_UNCONFIRMED",
      impact,
    });
    expect(fileRow(LIBRARY)).toEqual({ version: 1, content: PROMO });
    expect(
      await promote({ componentSourcePath: LIBRARY, confirmedImpact: [] }),
    ).toMatchObject({ ok: false, error: "SHARED_IMPACT_UNCONFIRMED" });

    expect(
      await promote({ componentSourcePath: LIBRARY, confirmedImpact: impact }),
    ).toMatchObject({ ok: true });
    expect(fileRow(LIBRARY).version).toBe(2);
  });

  it("refuses a name the component already uses", async () => {
    seed();
    expect(await promote({ fieldName: "eyebrow" })).toMatchObject({
      ok: false,
      error: "NOT_PROMOTABLE",
      reason: "name-taken",
    });
    expect(fileRow().version).toBe(1);
  });

  it("writes a layout section's value into the layout document", async () => {
    insertFile(
      "file-content",
      "src/morph/content.ts",
      "export function content(slot: string) { return {}; }\n",
    );
    insertFile(
      "file-root",
      "src/routes/__root.tsx",
      `import { Outlet, createRootRoute } from "@tanstack/react-router";
import Shell from "../layouts/Shell";
export const Route = createRootRoute({ component: Root });
function Root() { return <Shell><Outlet /></Shell>; }`,
    );
    insertFile(
      "file-shell",
      "src/layouts/Shell.tsx",
      `import { content } from "../morph/content";
import Header from "../components/Header";
export default function Shell({ children }) {
  return <><Header {...content("header")} />{children}</>;
}`,
    );
    insertFile(
      "file-header",
      "src/components/Header.tsx",
      `export const contentFields = {} as const;
export default function Header({}) {
  return <span>Free shipping</span>;
}
`,
    );
    // A layout's sections are stored, not derived from its source.
    insertTemplate("template-layout", "layout", "Layout", [
      {
        id: "header",
        type: "header",
        componentRef: "src/components/Header.tsx",
        enabled: true,
        props: {},
      },
    ]);

    const result = await promote({
      templateId: "template-layout",
      sectionId: "header",
      routePath: undefined,
      componentSourcePath: "src/components/Header.tsx",
      targetKey: "3:10",
      fieldName: "notice",
      value: "Free shipping over $50",
    });

    expect(result).toMatchObject({ ok: true, fieldName: "notice" });
    expect(fileRow("src/components/Header.tsx").content).toBe(
      `export const contentFields = { notice: { type: "text", label: "Notice" } } as const;
export default function Header({ notice = "Free shipping" }) {
  return <span>{notice}</span>;
}
`,
    );
    expect(await storedProps()).toEqual({ notice: "Free shipping over $50" });
  });
});

describe("resetting a promoted field", () => {
  const reset = (resetProps: string[], props: Record<string, unknown> = {}) =>
    storefrontThemeDal.updateSectionProps({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-home",
      sectionId: "promo",
      routePath: "/",
      props,
      resetProps,
      expectedDraftGeneration: 2,
      createdBy: "user-1",
    });

  it("removes this page's value, so the code default renders again", async () => {
    seed();
    await promote();
    const promoted = fileRow();

    const result = await reset(["text"]);

    expect(result?.document.sections[0]?.props).toEqual({});
    expect(await storedProps()).toEqual({});
    // The default is still the text the page showed before any edit.
    expect(fileRow()).toEqual(promoted);
    expect(fileRow().content).toContain('text = "hello world"');
  });

  it("refuses to remove anything that is not a declared field", async () => {
    seed();
    await promote();
    await expect(reset(["unknownKey"])).rejects.toThrow(
      "INVALID_THEME_CONTENT_FIELD_VALUE:unknownKey:not-resettable",
    );
    expect(await storedProps()).toEqual({ text: "Hello there" });
  });

  it("refuses a field sent both to set and to remove", async () => {
    seed();
    await promote();
    await expect(reset(["text"], { text: "again" })).rejects.toThrow(
      "INVALID_THEME_CONTENT_FIELD_VALUE:text:not-resettable",
    );
    expect(await storedProps()).toEqual({ text: "Hello there" });
  });
});

describe("commitTextPromotion", () => {
  const commit = (
    overrides: {
      expectedVersion?: number;
      expectedDraftGeneration?: number;
    } = {},
  ) =>
    commitTextPromotion({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      expectedSourceGeneration: 1,
      file: {
        path: COPY,
        fileId: "file-promo",
        expectedVersion: overrides.expectedVersion ?? 1,
        content: "rewritten",
      },
      template: {
        templateId: "template-home",
        document: {
          version: 1,
          sections: [
            { id: "promo", type: "promo", enabled: true, props: { text: "x" } },
          ],
        } as never,
        draftRevisionId: null,
        publishedRevisionId: null,
        expectedDraftGeneration: overrides.expectedDraftGeneration ?? 1,
      },
      createdBy: "user-1",
    });

  it("writes neither half when the page changed underneath it", async () => {
    seed();
    await expect(commit({ expectedDraftGeneration: 7 })).rejects.toEqual(
      new TextPromotionConflictError("draft-generation"),
    );
    expect(fileRow()).toEqual({ version: 1, content: PROMO });
    expect(sourceGeneration()).toBe(1);
  });

  it("writes neither half when the file changed underneath it", async () => {
    seed();
    await expect(commit({ expectedVersion: 7 })).rejects.toEqual(
      new TextPromotionConflictError("file-version"),
    );
    expect(template()).toEqual({ generation: 1, revision: null });
    expect(revisionCount()).toEqual({ n: 0 });
  });

  it("rolls the source back when the document write fails after it", async () => {
    seed();
    // Fails the batch after the file has already been rewritten.
    sqlite.exec(`CREATE TRIGGER fail_document BEFORE UPDATE ON storefront_theme_templates
      BEGIN SELECT RAISE(ABORT, 'injected'); END;`);
    await expect(commit()).rejects.toThrow("injected");
    expect(fileRow()).toEqual({ version: 1, content: PROMO });
    expect(sourceGeneration()).toBe(1);
    expect(revisionCount()).toEqual({ n: 0 });
  });
});
