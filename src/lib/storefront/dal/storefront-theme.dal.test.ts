import { createElement } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EditorStyleInspector } from "@/routes/_editor/-components/editor-style-inspector";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import Database from "better-sqlite3";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PUBLISH_SCOPE_CHANGED,
  storefrontThemeDal,
  prepareTemplateDocumentWrite,
} from "./storefront-theme.dal";
import { storefrontContentPublicationDal } from "./storefront-content-publication.dal";
import { storefrontReleaseDal } from "./storefront-release.dal";
import { storefrontPageDal } from "./storefront-page.dal";
import { storefrontThemeFileDal } from "./storefront-theme-file.dal";
import { describeContentChanges } from "../editor/unpublished-changes";
import {
  applyThemeManifestMigration,
  readThemeManifestMigrationSnapshot,
} from "./storefront-theme-manifest-migration.dal";
import { buildThemeManifestMigrationPlan } from "../theme-manifest-migration";
import {
  THEME_START_BUILD_DEPENDENCIES,
  THEME_START_RUNTIME_DEPENDENCIES,
} from "../compiler/theme-start-toolchain";
import { TEMPLATE_DRAFT_GENERATION_MISMATCH } from "../theme-write-errors";
import { env as workerEnv } from "cloudflare:workers";
import { createThemePreviewContentSnapshot } from "../compiler/theme-preview-content";
import { resolveStorefrontContent } from "../service/storefront-content-runtime";
import {
  deriveThemeLayoutSections,
  mergeDocumentWithRouteSections,
  type ThemeRouteSectionResult,
} from "../compiler/theme-route-sections";
import {
  isSourceAnalysisRouteStructure,
  type StorefrontThemeEditorDTO,
} from "../dto/storefront-theme.dto";
import { analyzeB1Route } from "../ast/theme-content-provenance";
import { starterThemeWorkspaceFiles } from "../starter-theme-files";
import {
  LEGACY_STARTER_THEME_LAYOUT_ALWAYS_VISIBLE_SOURCE,
  LEGACY_STARTER_THEME_LAYOUT_MARKED_SOURCE,
  LEGACY_STARTER_THEME_LAYOUT_PROPLESS_SOURCE,
  STARTER_THEME_CONTENT_MODULE_SOURCE,
  STARTER_THEME_INDEX_SOURCE,
  STARTER_THEME_ROOT_ROUTE_SOURCE,
} from "../starter-theme-v3-files";
import { reviewStarterThemeUpgrade } from "../starter-theme-upgrade-review";
import {
  createDefaultStorefrontHomeDocument,
  createDefaultStorefrontLayoutDocument,
  STOREFRONT_LAYOUT_HEADER_SLOT_ID,
  STOREFRONT_STARTER_TEMPLATE_VERSION,
} from "../default-storefront-document";
import {
  livePreviewPlatformFiles,
  renderLivePreviewRoute,
} from "@/lib/test-utils/live-preview-render";
import {
  analyzeSourceDefaultFields,
  proveAndPatchSourceDefault,
} from "../editor/source-default-control";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  withThemeMorphSdkIdentity,
  withThemeStartBuildIdentity,
} from "../compiler/theme-morph-sdk";
import {
  chainLayoutPreparation,
  publishScopeAfterPreparation,
  publishScopeExpectation,
  publishScopeState,
} from "@/routes/_editor/-components/editor-publish-scope";

// The editor's publish scope mapping (#436) is imported so the scope it sends
// is checked against what `publishTemplate` accepts; its server function is
// never called from these tests.
vi.mock("@/server/storefront/storefront-publish-check.serverFn", () => ({
  checkStorefrontPublishScope: vi.fn(),
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
              const upper = sql.trim().toUpperCase();
              // A statement that returns rows (a SELECT, or a write with
              // RETURNING, as the file DAL's inserts are) answers its rows, as
              // D1 does; better-sqlite3's run() refuses those.
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
      framework text,
      preview_runtime text,
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
      last_write_attempt_id text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text,
      encoding text DEFAULT 'utf8' NOT NULL,
      blob_digest text,
      size_bytes integer
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
      compiler_id text,
      compiler_version text,
      artifact_prefix text,
      manifest_json text,
      content_publication_id text,
      content_dependency text,
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

/**
 * A Start template's derived route structure. The editor context leaves an
 * Astro template's to its binding view; these tests are all of Start Themes.
 */
function startStructure(
  structure: StorefrontThemeEditorDTO["templates"][number]["routeStructure"],
): ThemeRouteSectionResult {
  if (!structure || isSourceAnalysisRouteStructure(structure)) {
    throw new Error("expected a derived Start route structure");
  }
  return structure;
}

/** The source revision check `publishTemplate` requires, accepting. */
const acceptRevision = async () => {};
/**
 * The source revision's files `publishTemplate` requires. These tests build
 * from the workspace they seed, so the revision holds the same files.
 */
const workspaceRevisionFiles = async () =>
  sqlite
    .prepare(
      "SELECT path, content FROM storefront_theme_files WHERE deleted_at IS NULL",
    )
    .all() as Array<{ path: string; content: string }>;

describe("stored content survives unproven route bindings", () => {
  const revisionId = "abaaaaaa-1111-4111-8111-111111111111";
  const document: StorefrontPageDocument = {
    version: 1,
    sections: [
      { id: "a", type: "a", componentRef: "src/components/A.tsx", enabled: true, props: { title: "A stored", retained: "not editable" } },
      { id: "b", type: "b", componentRef: "src/components/B.tsx", enabled: true, props: { title: "B stored", extra: { nested: "keep" } } },
      { id: "c", type: "c", enabled: true, props: { title: "C not rendered" } },
      { id: "h", type: "b", enabled: false, props: { title: "H hidden" } },
    ],
  };
  function seed(mode: "new" | "in-place" | "fork" = "new") {
    const files = {
      "src/routes/__root.tsx": `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: () => <Outlet /> });`,
      "src/morph/content.ts": `export const morph = {}; export function content(slot: string) { return {}; }`,
      "src/routes/index.tsx": `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import A from "../components/A";
import B from "../components/B";
const getPage = createServerFn().handler(() => morph.pages.get("/"));
export const Route = createFileRoute("/")({ loader: () => getPage(), component: Home });
function Home() { const { a, b } = Route.useLoaderData(); return <main><A {...a} /><B title={b.title} /></main>; }`,
      "src/components/A.tsx": `export const contentFields = { title: { type: "text", label: "Title" } } as const;
export default function A({ title = "default" }) { return <h2>{title}</h2>; }`,
      "src/components/B.tsx": `export default function B({ title }) { return <h2>{title}</h2>; }`,
    };
    for (const [path, content] of Object.entries(files)) {
      sqlite.prepare(`INSERT INTO storefront_theme_files
        (id, storefront_id, theme_id, path, content, created_at, updated_at)
        VALUES (?, 'storefront-a', 'theme-a', ?, ?, 'now', 'now')`).run(path, path, content);
    }
    sqlite.prepare(`INSERT INTO storefront_theme_templates
      (id, theme_id, type, name, document, draft_revision_id, published_revision_id, created_at, updated_at)
      VALUES ('unbound-template', 'theme-a', 'index', 'Home', ?, ?, ?, 'now', 'now')`)
      .run(JSON.stringify(document), mode === "new" ? null : revisionId, mode === "fork" ? revisionId : null);
    if (mode !== "new") {
      sqlite.prepare(`INSERT INTO storefront_theme_template_revisions (id, template_id, version, document, created_at)
        VALUES (?, 'unbound-template', 1, ?, 'now')`).run(revisionId, JSON.stringify(document));
    }
  }
  function stored() {
    const row = sqlite.prepare(`SELECT r.id, r.document FROM storefront_theme_templates t
      JOIN storefront_theme_template_revisions r ON r.id = t.draft_revision_id
      WHERE t.id = 'unbound-template' AND r.template_id = t.id`).get() as { id: string; document: string };
    return { id: row.id, document: JSON.parse(row.document) as StorefrontPageDocument };
  }
  const target = { storefrontId: "storefront-a", themeId: "theme-a", templateId: "unbound-template", expectedDraftGeneration: 1, createdBy: "user-1" };

  it("returns every stored slot and hidden flag to Live Preview, like the published resolver", async () => {
    seed();
    const before = sqlite.prepare("SELECT document FROM storefront_theme_templates").get();
    const context = await storefrontThemeDal.findEditorContext("storefront-a", "theme-a");
    expect(context?.templates[0]?.document).toEqual(document);
    const live = await createThemePreviewContentSnapshot({ templates: context!.templates, pages: [] });
    const published = await resolveStorefrontContent({ ports: { getPublishedDocument: async ({ templateType }) => templateType === "index" ? document : null }, publicationId: "publication", pathname: "/" });
    expect(live.templates.index).toEqual(published);
    expect(live.templates.index?.slots).toMatchObject({ b: document.sections[1]!.props, c: document.sections[2]!.props });
    expect(live.templates.index?.hiddenSlots).toEqual(["h"]);
    expect(sqlite.prepare("SELECT document FROM storefront_theme_templates").get()).toEqual(before);
  });

  for (const mode of ["new", "in-place", "fork"] as const) {
    for (const operation of ["props", "rename", "policy", "prepare"] as const) {
      it(`${operation} preserves all unrelated stored sections and prop keys (${mode})`, async () => {
        seed(mode);
        const result = operation === "props"
          ? await storefrontThemeDal.updateSectionProps({ ...target, expectedSourceGeneration: 1, sectionId: "a", props: { title: "A edited" }, routePath: "/" })
          : operation === "rename"
            ? await storefrontThemeDal.renameSection({ ...target, sectionId: "a", name: "Renamed" })
            : operation === "policy"
              ? await storefrontThemeDal.updateRenderPolicy({ ...target, expectedSourceGeneration: 1, setting: { scope: "page", policy: { mode: "ssr" } } })
              : await storefrontThemeDal.prepareInitialTemplateDraft({ ...target, expectedSourceGeneration: 1, ...(mode === "new" ? {} : { expectedDraftRevisionId: revisionId }) });
        expect(result).not.toBeNull();
        const saved = stored();
        expect(JSON.stringify(saved.document.sections.slice(1))).toBe(JSON.stringify(document.sections.slice(1)));
        expect(saved.document.sections.map((section) => section.id)).toEqual(["a", "b", "c", "h"]);
        expect(saved.document.sections[0]!.props.retained).toBe("not editable");
        if (operation === "props") expect(saved.document.sections[0]!.props.title).toBe("A edited");
        if (mode === "in-place") expect(saved.id).toBe(revisionId);
        if (mode === "fork") {
          expect(saved.id).not.toBe(revisionId);
          expect(sqlite.prepare("SELECT document FROM storefront_theme_template_revisions WHERE id = ?").get(revisionId)).toEqual({ document: JSON.stringify(document) });
        }
      });
    }
  }

  it("refuses reordering stored-but-unbound sections without any database write", async () => {
    seed("in-place");
    const before = stored();
    const templateBefore = sqlite.prepare("SELECT * FROM storefront_theme_templates").all();
    // This is the dangerous real request: the editor sends only the slot it
    // can bind. Accepting it would silently omit all the other stored slots.
    expect(await storefrontThemeDal.reorderSections({ ...target, sectionIds: ["a"] })).toBeNull();
    expect(stored()).toEqual(before);
    expect(sqlite.prepare("SELECT * FROM storefront_theme_templates").all()).toEqual(templateBefore);
  });

  it("still refuses an unproven field write and preserves the entire draft", async () => {
    seed("in-place");
    const before = stored();
    await expect(storefrontThemeDal.updateSectionProps({ ...target, expectedSourceGeneration: 1, sectionId: "b", props: { title: "Not proven" }, routePath: "/" })).rejects.toThrow("SECTION_SOURCE_UNCONFIRMED");
    expect(stored()).toEqual(before);
  });

  it("re-derives the exact section field at write time and rejects a forged overridden field", async () => {
    seed("in-place");
    const documentWithDesc: StorefrontPageDocument = {
      ...document,
      sections: document.sections.map((section) =>
        section.id === "a"
          ? { ...section, props: { ...section.props, desc: "A description" } }
          : section,
      ),
    };
    const revision = stored();
    sqlite.prepare("UPDATE storefront_theme_templates SET document = ? WHERE id = 'unbound-template'")
      .run(JSON.stringify(documentWithDesc));
    sqlite.prepare("UPDATE storefront_theme_template_revisions SET document = ? WHERE id = ?")
      .run(JSON.stringify(documentWithDesc), revision.id);
    sqlite.prepare("UPDATE storefront_theme_files SET content = ? WHERE path = 'src/components/A.tsx'")
      .run(`export const contentFields = {
  title: { type: "text", label: "Title" },
  desc: { type: "text", label: "Description" },
} as const;
export default function A({ title = "default", desc = "" }) {
  return <section><h2>{title}</h2><p>{desc}</p></section>;
}`);
    sqlite.prepare("UPDATE storefront_theme_files SET content = ? WHERE path = 'src/routes/index.tsx'")
      .run(`import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import A from "../components/A";
const getPage = createServerFn().handler(() => morph.pages.get("/"));
export const Route = createFileRoute("/")({ loader: () => getPage(), component: Home });
function Home() { const { a, b } = Route.useLoaderData(); return <main><A {...a} title={b.title} /></main>; }`);

    const before = stored();
    await expect(
      storefrontThemeDal.updateSectionProps({
        ...target,
        expectedSourceGeneration: 1,
        sectionId: "a",
        props: { title: "Forged title" },
        routePath: "/",
      }),
    ).rejects.toThrow("INVALID_THEME_CONTENT_FIELD_VALUE:title:unproven-source");
    expect(stored()).toEqual(before);

    const result = await storefrontThemeDal.updateSectionProps({
      ...target,
      expectedSourceGeneration: 1,
      sectionId: "a",
      props: { desc: "Updated description" },
      routePath: "/",
    });
    expect(
      result?.document.sections.find((section) => section.id === "a")?.props,
    ).toMatchObject({
      title: "A stored",
      desc: "Updated description",
      retained: "not editable",
    });
  });

  it("still reorders a fully bound document without changing any section", async () => {
    seed("in-place");
    sqlite.prepare("UPDATE storefront_theme_files SET content = ? WHERE path = 'src/routes/index.tsx'").run(`import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import A from "../components/A";
export const Route = createFileRoute("/")({ component: Home });
function Home() { return <main><A {...content("a")} /><A {...content("b")} /><A {...content("c")} /><A {...content("h")} /></main>; }`);
    const result = await storefrontThemeDal.reorderSections({ ...target, sectionIds: ["h", "c", "b", "a"] });
    expect(result).not.toBeNull();
    expect(stored().document.sections).toEqual([...document.sections].reverse());
  });

  it("orders proven virtual slots without materializing their defaults or losing stored slots", async () => {
    seed();
    sqlite.prepare("UPDATE storefront_theme_templates SET document = ?").run(JSON.stringify({ version: 1, sections: [] }));
    // a is proven by source but has never been edited; b is not proven and
    // has no stored content to protect. A valid reorder must still succeed.
    const result = await storefrontThemeDal.reorderSections({ ...target, sectionIds: ["a"] });
    expect(result).not.toBeNull();
    expect(stored().document.sections).toEqual([]);
  });

  for (const conflict of ["draft", "source"] as const) {
    it(`preserves the complete stored revision on a ${conflict} generation conflict`, async () => {
      seed("in-place");
      const before = stored();
      await expect(storefrontThemeDal.updateSectionProps({
        ...target, expectedDraftGeneration: conflict === "draft" ? 0 : 1,
        expectedSourceGeneration: conflict === "source" ? 0 : 1,
        sectionId: "a", props: { title: "Must not land" }, routePath: "/",
      })).rejects.toThrow(conflict === "draft" ? "CONFLICT_DRAFT_GENERATION_MISMATCH" : "SELECTION_SOURCE_CONFLICT");
      expect(stored()).toEqual(before);
    });
  }
});

describe("storefront theme DAL", () => {
  it("refuses to seal content that the publish step would still normalize", async () => {
    insertPolicyTemplate();
    const saved = await storefrontThemeDal.updateRenderPolicy({
      ...policyWrite(),
      setting: { scope: "page", policy: { mode: "ssg" } },
    });
    sqlite.exec(
      `INSERT INTO storefront_theme_revisions (id, storefront_id, theme_id, revision_number, source_generation, snapshot, created_at, updated_at) VALUES ('freeze-source', 'storefront-a', 'theme-a', 1, 1, '[]', 'now', 'now');`,
    );
    sqlite
      .prepare(
        "UPDATE storefront_theme_template_revisions SET document = ? WHERE id = ?",
      )
      .run(
        JSON.stringify({
          version: 1,
          renderPolicy: { mode: "ssg" },
          sections: [
            {
              id: "hero",
              type: "hero",
              enabled: true,
              props: { rows: [{ title: "Unprepared" }] },
            },
          ],
        }),
        saved!.draftRevisionId,
      );
    await expect(
      storefrontContentPublicationDal.sealForThemeBuild({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "policy-template",
        sourceRevisionId: "freeze-source",
        expectedDraftRevisionId: saved!.draftRevisionId,
        expectedDraftGeneration: 2,
        expectedSourceGeneration: 1,
        expectedReleaseGeneration: 1,
      }),
    ).rejects.toThrow("CONTENT_BUILD_DRAFT_NOT_NORMALIZED");
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM storefront_content_publications",
        )
        .get(),
    ).toEqual({ count: 0 });
    const prepared = await storefrontThemeDal.prepareInitialTemplateDraft({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "policy-template",
      expectedDraftRevisionId: saved!.draftRevisionId,
      expectedDraftGeneration: 2,
      expectedSourceGeneration: 1,
      createdBy: "user-1",
    });
    expect(prepared?.document.sections[0]?.props).toMatchObject({
      rows: [{ title: "Unprepared" }],
    });
    const sealed = await storefrontContentPublicationDal.sealForThemeBuild({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "policy-template",
      sourceRevisionId: "freeze-source",
      expectedDraftRevisionId: prepared!.draftRevisionId,
      expectedDraftGeneration: prepared!.draftGeneration,
      expectedSourceGeneration: 1,
      expectedReleaseGeneration: 1,
    });
    expect(
      sealed.items.some(
        (item) => item.revisionId === prepared!.draftRevisionId,
      ),
    ).toBe(true);
  });
  it("prepares a referenced draft by forking without modifying the frozen revision", async () => {
    insertPolicyTemplate();
    const saved = await storefrontThemeDal.updateRenderPolicy({
      ...policyWrite(),
      setting: { scope: "page", policy: { mode: "ssg" } },
    });
    sqlite.exec(`INSERT INTO storefront_theme_revisions
      (id, storefront_id, theme_id, revision_number, source_generation, snapshot, created_at, updated_at)
      VALUES ('freeze-source', 'storefront-a', 'theme-a', 1, 1, '[]', 'now', 'now');`);
    await storefrontContentPublicationDal.sealForThemeBuild({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "policy-template",
      sourceRevisionId: "freeze-source",
      expectedDraftRevisionId: saved!.draftRevisionId,
      expectedDraftGeneration: 2,
      expectedSourceGeneration: 1,
      expectedReleaseGeneration: 1,
    });
    const readFrozen = () =>
      sqlite
        .prepare(
          "SELECT document FROM storefront_theme_template_revisions WHERE id = ?",
        )
        .get(saved!.draftRevisionId);
    const before = readFrozen();
    const prepared = await storefrontThemeDal.prepareInitialTemplateDraft({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "policy-template",
      expectedDraftRevisionId: saved!.draftRevisionId,
      expectedDraftGeneration: 2,
      expectedSourceGeneration: 1,
      createdBy: "user-1",
    });
    expect(prepared?.draftRevisionId).not.toBe(saved!.draftRevisionId);
    expect(prepared?.draftGeneration).toBe(3);
    expect(readFrozen()).toEqual(before);
  });

  it.each(["identity", "source", "draft", "ownership"] as const)(
    "refuses existing draft preparation with stale or foreign %s",
    async (target) => {
      insertPolicyTemplate();
      const saved = await storefrontThemeDal.updateRenderPolicy({
        ...policyWrite(),
        setting: { scope: "page", policy: { mode: "ssg" } },
      });
      const before = sqlite
        .prepare(
          "SELECT document FROM storefront_theme_template_revisions WHERE id = ?",
        )
        .get(saved!.draftRevisionId);
      const request = storefrontThemeDal.prepareInitialTemplateDraft({
        storefrontId: target === "ownership" ? "other-store" : "storefront-a",
        themeId: "theme-a",
        templateId: "policy-template",
        expectedDraftRevisionId:
          target === "identity" ? crypto.randomUUID() : saved!.draftRevisionId,
        expectedDraftGeneration: target === "draft" ? 1 : 2,
        expectedSourceGeneration: target === "source" ? 2 : 1,
        createdBy: "user-1",
      });
      if (target === "ownership") expect(await request).toBeNull();
      else
        await expect(request).rejects.toThrow(
          TEMPLATE_DRAFT_GENERATION_MISMATCH,
        );
      expect(
        sqlite
          .prepare(
            "SELECT document FROM storefront_theme_template_revisions WHERE id = ?",
          )
          .get(saved!.draftRevisionId),
      ).toEqual(before);
    },
  );

  it.each(["source", "draft", "revision"] as const)(
    "rolls back existing draft preparation when %s changes after reading",
    async (target) => {
      insertPolicyTemplate();
      const saved = await storefrontThemeDal.updateRenderPolicy({
        ...policyWrite(),
        setting: { scope: "page", policy: { mode: "ssg" } },
      });
      const before = sqlite
        .prepare(
          "SELECT document FROM storefront_theme_template_revisions WHERE id = ?",
        )
        .get(saved!.draftRevisionId);
      const originalBatch = workerEnv.DATABASE.batch.bind(workerEnv.DATABASE);
      const race = vi
        .spyOn(workerEnv.DATABASE, "batch")
        .mockImplementationOnce(async (statements) => {
          sqlite.exec(
            target === "source"
              ? "UPDATE storefront_themes SET source_generation = 2 WHERE id = 'theme-a'"
              : target === "draft"
                ? "UPDATE storefront_theme_templates SET draft_generation = 3 WHERE id = 'policy-template'"
                : "UPDATE storefront_theme_templates SET draft_revision_id = 'changed' WHERE id = 'policy-template'",
          );
          return originalBatch(statements);
        });
      try {
        await expect(
          storefrontThemeDal.prepareInitialTemplateDraft({
            storefrontId: "storefront-a",
            themeId: "theme-a",
            templateId: "policy-template",
            expectedDraftRevisionId: saved!.draftRevisionId,
            expectedDraftGeneration: 2,
            expectedSourceGeneration: 1,
            createdBy: "user-1",
          }),
        ).rejects.toThrow(TEMPLATE_DRAFT_GENERATION_MISMATCH);
        expect(
          sqlite
            .prepare(
              "SELECT document FROM storefront_theme_template_revisions WHERE id = ?",
            )
            .get(saved!.draftRevisionId),
        ).toEqual(before);
        expect(
          sqlite
            .prepare(
              "SELECT COUNT(*) AS n FROM storefront_theme_template_revisions",
            )
            .get(),
        ).toEqual({ n: 1 });
      } finally {
        race.mockRestore();
      }
    },
  );

  it("rolls back sealing when the pending layout changes after it was read", async () => {
    insertPolicyTemplate();
    const saved = await storefrontThemeDal.updateRenderPolicy({
      ...policyWrite(),
      setting: { scope: "page", policy: { mode: "ssg" } },
    });
    sqlite.exec(
      `INSERT INTO storefront_theme_revisions (id, storefront_id, theme_id, revision_number, source_generation, snapshot, created_at, updated_at) VALUES ('freeze-source', 'storefront-a', 'theme-a', 1, 1, '[]', 'now', 'now'); INSERT INTO storefront_theme_templates (id, theme_id, type, name, document, draft_revision_id, created_at, updated_at) VALUES ('freeze-layout', 'theme-a', 'layout', 'Layout', '{}', 'layout-rev', 'now', 'now'); INSERT INTO storefront_theme_template_revisions (id, template_id, version, document, created_at) VALUES ('layout-rev', 'freeze-layout', 1, '{"version":1,"sections":[]}', 'now');`,
    );
    const batch = workerEnv.DATABASE.batch.bind(workerEnv.DATABASE);
    const race = vi
      .spyOn(workerEnv.DATABASE, "batch")
      .mockImplementationOnce(async (statements) => {
        sqlite.exec(
          "UPDATE storefront_theme_templates SET draft_generation = draft_generation + 1 WHERE id = 'freeze-layout'",
        );
        return batch(statements);
      });
    try {
      await expect(
        storefrontContentPublicationDal.sealForThemeBuild({
          storefrontId: "storefront-a",
          themeId: "theme-a",
          templateId: "policy-template",
          sourceRevisionId: "freeze-source",
          expectedDraftRevisionId: saved!.draftRevisionId,
          expectedDraftGeneration: 2,
          expectedSourceGeneration: 1,
          expectedReleaseGeneration: 1,
        }),
      ).rejects.toThrow("CONTENT_BUILD_PRECONDITION_FAILED");
      expect(
        sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM storefront_content_publications",
          )
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      race.mockRestore();
    }
  });
  it("rejects an in-place write prepared before a concurrent seal, retaining the sealed values", async () => {
    insertPolicyTemplate();
    const saved = await storefrontThemeDal.updateRenderPolicy({
      ...policyWrite(),
      setting: { scope: "page", policy: { mode: "ssg" } },
    });
    sqlite.exec(
      `INSERT INTO storefront_theme_revisions (id, storefront_id, theme_id, revision_number, source_generation, snapshot, created_at, updated_at) VALUES ('freeze-source', 'storefront-a', 'theme-a', 1, 1, '[]', 'now', 'now');`,
    );
    const pending = await prepareTemplateDocumentWrite({
      createdBy: "author",
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "policy-template",
      document: { version: 1, sections: [], renderPolicy: { mode: "ssr" } },
      sourceGeneration: 1,
      draftRevisionId: saved!.draftRevisionId,
      publishedRevisionId: null,
      expectedDraftGeneration: 2,
    });
    const publication = await storefrontContentPublicationDal.sealForThemeBuild(
      {
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "policy-template",
        sourceRevisionId: "freeze-source",
        expectedDraftRevisionId: saved!.draftRevisionId,
        expectedDraftGeneration: 2,
        expectedSourceGeneration: 1,
        expectedReleaseGeneration: 1,
      },
    );
    await expect(
      workerEnv.DATABASE.batch([pending.guard, ...pending.mutations]),
    ).rejects.toThrow();
    expect(
      (
        await storefrontContentPublicationDal.readDocumentsForDraft({
          themeId: "theme-a",
          publication,
        })
      )[0]?.document.renderPolicy,
    ).toEqual({ mode: "ssg" });
  });
  it.each(["success", "draft", "source", "release", "ownership"])(
    "seals build content without activation (%s)",
    async (condition) => {
      insertPolicyTemplate();
      const saved = await storefrontThemeDal.updateRenderPolicy({
        ...policyWrite(),
        setting: { scope: "page", policy: { mode: "ssg" } },
      });
      sqlite.exec(
        `INSERT INTO storefront_theme_revisions (id, storefront_id, theme_id, revision_number, source_generation, snapshot, created_at, updated_at) VALUES ('freeze-source', 'storefront-a', 'theme-a', 1, 1, '[]', 'now', 'now');`,
      );
      const request = {
        storefrontId:
          condition === "ownership" ? "other-store" : "storefront-a",
        themeId: "theme-a",
        templateId: "policy-template",
        sourceRevisionId: "freeze-source",
        expectedDraftRevisionId: saved!.draftRevisionId,
        expectedDraftGeneration: condition === "draft" ? 1 : 2,
        expectedSourceGeneration: condition === "source" ? 2 : 1,
        expectedReleaseGeneration: condition === "release" ? 2 : 1,
        createdBy: "author",
      };
      if (condition === "success") {
        const publication =
          await storefrontContentPublicationDal.sealForThemeBuild(request);
        expect(publication.items[0]?.revisionId).toBe(saved!.draftRevisionId);
        expect(publication.items[0]?.metadata?.templateType).toBe("index");
        expect(
          await storefrontContentPublicationDal.isRevisionReferenced(
            saved!.draftRevisionId,
          ),
        ).toBe(true);
        const edited = await storefrontThemeDal.updateRenderPolicy({
          ...policyWrite(),
          expectedDraftGeneration: 2,
          setting: { scope: "page", policy: { mode: "ssr" } },
        });
        expect(edited!.draftRevisionId).not.toBe(saved!.draftRevisionId);
        const frozen =
          await storefrontContentPublicationDal.readDocumentsForDraft({
            themeId: "theme-a",
            publication,
          });
        expect(frozen[0]?.document.renderPolicy).toEqual({ mode: "ssg" });
      } else {
        await expect(
          storefrontContentPublicationDal.sealForThemeBuild(request),
        ).rejects.toThrow("CONTENT_");
        expect(
          sqlite
            .prepare(
              "SELECT COUNT(*) AS count FROM storefront_content_publications",
            )
            .get(),
        ).toEqual({ count: 0 });
      }
      expect(
        sqlite
          .prepare("SELECT COUNT(*) AS count FROM storefront_releases")
          .get(),
      ).toEqual({ count: 0 });
      expect(
        sqlite
          .prepare(
            "SELECT active_release_id AS id FROM storefronts WHERE id = 'storefront-a'",
          )
          .get(),
      ).toEqual({ id: null });
    },
  );
  function insertPolicyTemplate(type = "index") {
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates
      (id, theme_id, type, name, document, created_at, updated_at)
      VALUES ('policy-template', 'theme-a', ?, 'Policy', ?, 'now', 'now')`,
      )
      .run(
        type,
        JSON.stringify({
          version: 1,
          sections: [
            {
              id: "hero",
              type: "hero",
              enabled: true,
              props: { heading: "Keep me" },
            },
          ],
        }),
      );
  }

  const policyWrite = () => ({
    storefrontId: "storefront-a",
    themeId: "theme-a",
    templateId: "policy-template",
    expectedDraftGeneration: 1,
    expectedSourceGeneration: 1,
    createdBy: "user-1",
    setting: { scope: "page" as const, policy: { mode: "ssg" as const } },
  });

  it("saves a rendering draft through the existing revision writer without publishing", async () => {
    insertPolicyTemplate();
    const result = await storefrontThemeDal.updateRenderPolicy(policyWrite());
    expect(result?.document.renderPolicy).toEqual({ mode: "ssg" });
    expect(result?.document.sections[0]?.props).toEqual({ heading: "Keep me" });
    expect(result?.draftGeneration).toBe(2);
    expect(
      sqlite
        .prepare(
          "SELECT published_revision_id FROM storefront_theme_templates WHERE id = 'policy-template'",
        )
        .get(),
    ).toEqual({ published_revision_id: null });
    expect(
      sqlite
        .prepare(
          "SELECT active_release_id FROM storefronts WHERE id = 'storefront-a'",
        )
        .get(),
    ).toEqual({ active_release_id: null });
  });

  it.each(["ssg", "isr", "csr"] as const)(
    "refuses publication of unconnected %s without moving the release",
    async (mode) => {
      insertPolicyTemplate();
      const saved = await storefrontThemeDal.updateRenderPolicy({
        ...policyWrite(),
        setting: {
          scope: "page",
          policy: mode === "isr" ? { mode, revalidateSeconds: 60 } : { mode },
        },
      });
      expect(saved).not.toBeNull();
      await expect(
        storefrontThemeDal.publishTemplate({
          storefrontId: "storefront-a",
          themeId: "theme-a",
          templateId: "policy-template",
          sourceRevisionId: "22222222-2222-4222-8222-222222222222",
          themeBuildId: "33333333-3333-4333-8333-333333333333",
          expectedDraftRevisionId: saved!.draftRevisionId,
          expectedDraftGeneration: 2,
          expectedReleaseGeneration: 1,
          readSourceRevisionFiles: workspaceRevisionFiles,
          verifySourceRevision: acceptRevision,
        }),
      ).rejects.toThrow("PUBLISH_RENDER_POLICY_NOT_READY");
      expect(
        sqlite
          .prepare("SELECT COUNT(*) AS count FROM storefront_releases")
          .get(),
      ).toEqual({ count: 0 });
      expect(
        sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM storefront_content_publications",
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        sqlite
          .prepare(
            "SELECT published_revision_id, draft_generation FROM storefront_theme_templates WHERE id = 'policy-template'",
          )
          .get(),
      ).toEqual({ published_revision_id: null, draft_generation: 2 });
    },
  );

  it.each([
    { mode: "ssg", owner: "template" },
    { mode: "isr", owner: "template" },
    { mode: "csr", owner: "template" },
    { mode: "ssg", owner: "layout" },
    { mode: "isr", owner: "layout" },
    { mode: "csr", owner: "layout" },
    { mode: "ssg", owner: "page" },
    { mode: "isr", owner: "page" },
    { mode: "csr", owner: "page" },
  ] as const)(
    "refuses a published $owner's $mode policy even when publishing an SSR page",
    async ({ mode, owner }) => {
      insertPolicyTemplate();
      const saved = await storefrontThemeDal.updateRenderPolicy({
        ...policyWrite(),
        setting: { scope: "page", policy: { mode: "ssr" } },
      });
      const document = JSON.stringify({
        version: 1,
        sections: [],
        ...(owner === "page" ? { handle: "sibling" } : {}),
        [owner === "layout" ? "websiteRenderPolicy" : "renderPolicy"]:
          mode === "isr" ? { mode, revalidateSeconds: 60 } : { mode },
      });
      if (owner === "page") {
        sqlite
          .prepare(
            `INSERT INTO storefront_pages
          (id, storefront_id, title, handle, status, published_revision_id, created_by, created_at, updated_at)
          VALUES ('sibling', 'storefront-a', 'Sibling', 'sibling', 'published', 'sibling-live', 'user-1', 'now', 'now')`,
          )
          .run();
        sqlite
          .prepare(
            "INSERT INTO storefront_page_revisions VALUES ('sibling-live', 'sibling', ?)",
          )
          .run(document);
      } else {
        sqlite
          .prepare(
            `INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, route_path, document, draft_revision_id, published_revision_id, created_at, updated_at)
        VALUES ('sibling', 'theme-a', ?, 'Sibling', NULL, ?, 'sibling-live', 'sibling-live', 'now', 'now')`,
          )
          .run(owner === "layout" ? "layout" : "page", document);
        sqlite
          .prepare(
            `INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
        VALUES ('sibling-live', 'sibling', 1, ?, 'now')`,
          )
          .run(document);
      }
      await expect(
        storefrontThemeDal.publishTemplate({
          storefrontId: "storefront-a",
          themeId: "theme-a",
          templateId: "policy-template",
          sourceRevisionId: "22222222-2222-4222-8222-222222222222",
          themeBuildId: "33333333-3333-4333-8333-333333333333",
          expectedDraftRevisionId: saved!.draftRevisionId,
          expectedDraftGeneration: 2,
          expectedReleaseGeneration: 1,
          readSourceRevisionFiles: workspaceRevisionFiles,
          verifySourceRevision: acceptRevision,
        }),
      ).rejects.toThrow("PUBLISH_RENDER_POLICY_NOT_READY");
      expect(
        sqlite
          .prepare("SELECT COUNT(*) AS count FROM storefront_releases")
          .get(),
      ).toEqual({ count: 0 });
      expect(
        sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM storefront_content_publications",
          )
          .get(),
      ).toEqual({ count: 0 });
    },
  );

  it.each([false, true])(
    "checks a content-bound build before activation (mismatch: %s)",
    async (mismatch) => {
      insertPolicyTemplate();
      const saved = await storefrontThemeDal.updateRenderPolicy({
        ...policyWrite(),
        setting: { scope: "page", policy: { mode: "ssr" } },
      });
      const oldRevisionId = mismatch
        ? "old-policy-revision"
        : saved!.draftRevisionId;
      if (mismatch) {
        sqlite
          .prepare(
            `INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
        VALUES ('old-policy-revision', 'policy-template', 0, ?, 'now')`,
          )
          .run(JSON.stringify({ version: 1, sections: [] }));
      }
      sqlite.exec(
        "INSERT INTO storefront_content_publications (id, storefront_id, created_at, updated_at) VALUES ('build-content', 'storefront-a', 'now', 'now')",
      );
      sqlite
        .prepare(
          `INSERT INTO storefront_content_publication_items
      (id, publication_id, item_type, content_id, revision_id, metadata, created_at, updated_at)
      VALUES ('build-item', 'build-content', 'template', 'policy-template', ?, '{"templateType":"index"}', 'now', 'now')`,
        )
        .run(oldRevisionId);
      sqlite.exec(
        "UPDATE storefront_theme_builds SET content_publication_id = 'build-content'",
      );
      sqlite.exec(`INSERT INTO storefront_theme_revisions
      (id, storefront_id, theme_id, revision_number, source_generation, snapshot, created_at, updated_at)
      VALUES ('22222222-2222-4222-8222-222222222222', 'storefront-a', 'theme-a', 1, 1, '[]', 'now', 'now');`);
      const publish = storefrontThemeDal.publishTemplate({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "policy-template",
        sourceRevisionId: "22222222-2222-4222-8222-222222222222",
        themeBuildId: "33333333-3333-4333-8333-333333333333",
        expectedDraftRevisionId: saved!.draftRevisionId,
        expectedDraftGeneration: 2,
        expectedReleaseGeneration: 1,
        readSourceRevisionFiles: workspaceRevisionFiles,
        verifySourceRevision: acceptRevision,
      });
      if (mismatch) {
        await expect(publish).rejects.toThrow("PUBLISH_BUILD_CONTENT_MISMATCH");
        expect(
          sqlite
            .prepare("SELECT COUNT(*) AS count FROM storefront_releases")
            .get(),
        ).toEqual({ count: 0 });
        expect(
          sqlite
            .prepare(
              "SELECT COUNT(*) AS count FROM storefront_content_publications",
            )
            .get(),
        ).toEqual({ count: 1 });
        expect(
          sqlite
            .prepare(
              "SELECT active_release_id FROM storefronts WHERE id = 'storefront-a'",
            )
            .get(),
        ).toEqual({ active_release_id: null });
      } else {
        const result = await publish;
        expect(result?.releaseId).toBeTruthy();
      }
    },
  );

  it.each([
    [null, "refused"],
    ["dependent", "refused"],
    ["independent", "published"],
  ] as const)(
    "holds a build sealed with other content to its seal unless it proved itself independent (%s)",
    async (dependency, outcome) => {
      // The build was sealed with an older draft; the draft being published
      // is a newer one. Only an artifact proven to hold no content may go out
      // with content other than its seal; unknown counts as dependent.
      insertPolicyTemplate();
      const saved = await storefrontThemeDal.updateRenderPolicy({
        ...policyWrite(),
        setting: { scope: "page", policy: { mode: "ssr" } },
      });
      sqlite
        .prepare(
          `INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
        VALUES ('old-policy-revision', 'policy-template', 0, ?, 'now')`,
        )
        .run(JSON.stringify({ version: 1, sections: [] }));
      sqlite.exec(
        "INSERT INTO storefront_content_publications (id, storefront_id, created_at, updated_at) VALUES ('build-content', 'storefront-a', 'now', 'now')",
      );
      sqlite.exec(`INSERT INTO storefront_content_publication_items
        (id, publication_id, item_type, content_id, revision_id, metadata, created_at, updated_at)
        VALUES ('build-item', 'build-content', 'template', 'policy-template', 'old-policy-revision', '{"templateType":"index"}', 'now', 'now')`);
      sqlite
        .prepare(
          "UPDATE storefront_theme_builds SET content_publication_id = 'build-content', content_dependency = ?",
        )
        .run(dependency);
      sqlite.exec(`INSERT INTO storefront_theme_revisions
        (id, storefront_id, theme_id, revision_number, source_generation, snapshot, created_at, updated_at)
        VALUES ('22222222-2222-4222-8222-222222222222', 'storefront-a', 'theme-a', 1, 1, '[]', 'now', 'now');`);

      const publish = storefrontThemeDal.publishTemplate({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "policy-template",
        sourceRevisionId: "22222222-2222-4222-8222-222222222222",
        themeBuildId: "33333333-3333-4333-8333-333333333333",
        expectedDraftRevisionId: saved!.draftRevisionId,
        expectedDraftGeneration: 2,
        expectedReleaseGeneration: 1,
        readSourceRevisionFiles: workspaceRevisionFiles,
        verifySourceRevision: acceptRevision,
      });

      if (outcome === "refused") {
        await expect(publish).rejects.toThrow("PUBLISH_BUILD_CONTENT_MISMATCH");
        expect(
          sqlite
            .prepare("SELECT COUNT(*) AS count FROM storefront_releases")
            .get(),
        ).toEqual({ count: 0 });
        expect(
          sqlite
            .prepare(
              "SELECT active_release_id FROM storefronts WHERE id = 'storefront-a'",
            )
            .get(),
        ).toEqual({ active_release_id: null });
        return;
      }
      const result = await publish;
      expect(result?.releaseCreated).toBe(true);
      // The release carries the content being published, not the build's
      // seal: that is what its runtime reads.
      const release = sqlite
        .prepare(
          "SELECT theme_build_id, content_publication_id FROM storefront_releases",
        )
        .get() as { theme_build_id: string; content_publication_id: string };
      expect(release.theme_build_id).toBe(
        "33333333-3333-4333-8333-333333333333",
      );
      expect(release.content_publication_id).not.toBe("build-content");
      expect(
        sqlite
          .prepare(
            "SELECT revision_id FROM storefront_content_publication_items WHERE publication_id = ? AND content_id = 'policy-template'",
          )
          .get(release.content_publication_id),
      ).toEqual({ revision_id: saved!.draftRevisionId });
    },
  );

  it("refuses a publish whose draft changed after it was read, at the final draft check", async () => {
    // The build is sealed with the draft the request names, so the content
    // check passes; the draft then changes while the publish is in progress
    // (here, from inside the publish, after it has read the revision and
    // before it writes). Only the batch's own draft guard can stop it.
    insertPolicyTemplate();
    const saved = await storefrontThemeDal.updateRenderPolicy({
      ...policyWrite(),
      setting: { scope: "page", policy: { mode: "ssr" } },
    });
    sqlite.exec(
      "INSERT INTO storefront_content_publications (id, storefront_id, created_at, updated_at) VALUES ('build-content', 'storefront-a', 'now', 'now')",
    );
    sqlite
      .prepare(
        `INSERT INTO storefront_content_publication_items
      (id, publication_id, item_type, content_id, revision_id, metadata, created_at, updated_at)
      VALUES ('build-item', 'build-content', 'template', 'policy-template', ?, '{"templateType":"index"}', 'now', 'now')`,
      )
      .run(saved!.draftRevisionId);
    sqlite.exec(
      "UPDATE storefront_theme_builds SET content_publication_id = 'build-content'",
    );
    sqlite.exec(`INSERT INTO storefront_theme_revisions
      (id, storefront_id, theme_id, revision_number, source_generation, snapshot, created_at, updated_at)
      VALUES ('22222222-2222-4222-8222-222222222222', 'storefront-a', 'theme-a', 1, 1, '[]', 'now', 'now');`);
    let changedDraftRevisionId: string | undefined;

    await expect(
      storefrontThemeDal.publishTemplate({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "policy-template",
        sourceRevisionId: "22222222-2222-4222-8222-222222222222",
        themeBuildId: "33333333-3333-4333-8333-333333333333",
        expectedDraftRevisionId: saved!.draftRevisionId,
        expectedDraftGeneration: 2,
        expectedReleaseGeneration: 1,
        readSourceRevisionFiles: workspaceRevisionFiles,
        verifySourceRevision: async () => {
          const changed = await storefrontThemeDal.updateRenderPolicy({
            ...policyWrite(),
            expectedDraftGeneration: 2,
            setting: { scope: "page", policy: { mode: "inherit" } },
          });
          changedDraftRevisionId = changed!.draftRevisionId;
        },
      }),
    ).rejects.toThrow("TEMPLATE_DRAFT_CONFLICT");

    expect(changedDraftRevisionId).toBeTruthy();
    expect(changedDraftRevisionId).not.toBe(saved!.draftRevisionId);
    // Nothing of the publish was written: no release, no pointer move, no
    // content publication besides the build's, and the newer draft stands.
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM storefront_releases").get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM storefront_content_publications",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .prepare(
          "SELECT active_release_id FROM storefronts WHERE id = 'storefront-a'",
        )
        .get(),
    ).toEqual({ active_release_id: null });
    expect(
      sqlite
        .prepare(
          "SELECT draft_revision_id, published_revision_id FROM storefront_theme_templates WHERE id = 'policy-template'",
        )
        .get(),
    ).toEqual({
      draft_revision_id: changedDraftRevisionId,
      published_revision_id: null,
    });
  });

  it("preserves policy through section renaming and reordering", async () => {
    insertPolicyTemplate();
    await storefrontThemeDal.updateRenderPolicy(policyWrite());
    const renamed = await storefrontThemeDal.renameSection({
      ...policyWrite(),
      sectionId: "hero",
      name: "Renamed",
      expectedDraftGeneration: 2,
    });
    expect(renamed?.document.renderPolicy).toEqual({ mode: "ssg" });
    const reordered = await storefrontThemeDal.reorderSections({
      ...policyWrite(),
      sectionIds: ["hero"],
      expectedDraftGeneration: 3,
    });
    expect(reordered?.document.renderPolicy).toEqual({ mode: "ssg" });
  });

  it("also refuses an unconnected website default sealed by a page publish", async () => {
    insertPolicyTemplate("layout");
    await storefrontThemeDal.updateRenderPolicy({
      ...policyWrite(),
      setting: {
        scope: "website",
        policy: { mode: "isr", revalidateSeconds: 60 },
      },
    });
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates
      (id, theme_id, type, name, document, draft_revision_id, created_at, updated_at)
      VALUES ('home', 'theme-a', 'index', 'Home', ?, 'home-revision', 'now', 'now')`,
      )
      .run(JSON.stringify({ version: 1, sections: [] }));
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_template_revisions
      (id, template_id, version, document, created_at)
      VALUES ('home-revision', 'home', 1, ?, 'now')`,
      )
      .run(JSON.stringify({ version: 1, sections: [] }));
    await expect(
      storefrontThemeDal.publishTemplate({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "home",
        sourceRevisionId: "22222222-2222-4222-8222-222222222222",
        themeBuildId: "33333333-3333-4333-8333-333333333333",
        expectedDraftRevisionId: "home-revision",
        expectedDraftGeneration: 1,
        expectedReleaseGeneration: 1,
        readSourceRevisionFiles: workspaceRevisionFiles,
        verifySourceRevision: acceptRevision,
      }),
    ).rejects.toThrow("PUBLISH_RENDER_POLICY_NOT_READY");
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM storefront_releases").get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM storefront_content_publications",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .prepare(
          "SELECT published_revision_id FROM storefront_theme_templates WHERE id = 'policy-template'",
        )
        .get(),
    ).toEqual({ published_revision_id: null });
  });

  it.each(["draft", "source"])(
    "rejects a stale %s generation without writing",
    async (kind) => {
      insertPolicyTemplate();
      await storefrontThemeDal.updateRenderPolicy(policyWrite());
      if (kind === "source")
        sqlite.exec("UPDATE storefront_themes SET source_generation = 2");
      await expect(
        storefrontThemeDal.updateRenderPolicy({
          ...policyWrite(),
          expectedDraftGeneration: kind === "source" ? 2 : 1,
        }),
      ).rejects.toThrow(TEMPLATE_DRAFT_GENERATION_MISMATCH);
      expect(
        sqlite
          .prepare(
            "SELECT draft_generation FROM storefront_theme_templates WHERE id = 'policy-template'",
          )
          .get(),
      ).toEqual({ draft_generation: 2 });
    },
  );

  it("requires storefront and Theme ownership", async () => {
    insertPolicyTemplate();
    expect(
      await storefrontThemeDal.updateRenderPolicy({
        ...policyWrite(),
        storefrontId: "other-store",
      }),
    ).toBeNull();
    expect(
      await storefrontThemeDal.updateRenderPolicy({
        ...policyWrite(),
        themeId: "other-theme",
      }),
    ).toBeNull();
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM storefront_theme_template_revisions",
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it("only writes website defaults to layout and page overrides to a page", async () => {
    insertPolicyTemplate("layout");
    await expect(
      storefrontThemeDal.updateRenderPolicy(policyWrite()),
    ).rejects.toThrow("RENDER_POLICY_SCOPE_MISMATCH");
    const result = await storefrontThemeDal.updateRenderPolicy({
      ...policyWrite(),
      setting: {
        scope: "website",
        policy: { mode: "isr", revalidateSeconds: 120 },
      },
    });
    expect(result?.document.websiteRenderPolicy).toEqual({
      mode: "isr",
      revalidateSeconds: 120,
    });
    expect(result?.document.renderPolicy).toBeUndefined();
  });

  it("keeps a published policy snapshot unchanged after a new policy draft", async () => {
    insertPolicyTemplate();
    const saved = await storefrontThemeDal.updateRenderPolicy(policyWrite());
    expect(saved).not.toBeNull();
    sqlite
      .prepare(
        "UPDATE storefront_theme_templates SET published_revision_id = ? WHERE id = 'policy-template'",
      )
      .run(saved!.draftRevisionId);
    const publication = await storefrontContentPublicationDal.createForTheme({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "policy-template",
      templateRevisionId: saved!.draftRevisionId,
    });
    const changed = await storefrontThemeDal.updateRenderPolicy({
      ...policyWrite(),
      expectedDraftGeneration: 2,
      setting: { scope: "page", policy: { mode: "csr" } },
    });
    expect(changed?.draftRevisionId).not.toBe(saved!.draftRevisionId);
    const published =
      await storefrontContentPublicationDal.getPublishedTemplateDocument({
        publicationId: publication.id,
        templateType: "index",
      });
    expect(published).toMatchObject({ renderPolicy: { mode: "ssg" } });
    expect(
      (await storefrontThemeDal.findEditorContext("storefront-a", "theme-a"))
        ?.templates[0]?.document.renderPolicy,
    ).toEqual({ mode: "csr" });
  });

  it("persists a Page handle snapshot and preserves it after a draft rename", async () => {
    sqlite.exec(`
      INSERT INTO storefront_theme_templates (id,theme_id,type,name,document,created_at,updated_at)
        VALUES ('t','theme-a','index','Home','{"version":1,"sections":[]}','now','now');
      INSERT INTO storefront_theme_template_revisions (id,template_id,version,document,created_at)
        VALUES ('tr','t',1,'{"version":1,"sections":[]}','now');
      INSERT INTO storefront_pages (id,storefront_id,title,handle,status,published_revision_id,created_by,created_at,updated_at)
        VALUES ('p','storefront-a','About','original','published','pr','u','now','now');
      INSERT INTO storefront_page_revisions VALUES ('pr','p','{"version":1,"handle":"original","sections":[]}');
    `);
    const publication = await storefrontContentPublicationDal.createForTheme({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "t",
      templateRevisionId: "tr",
    });
    const page = publication.items.find((item) => item.itemType === "page");
    expect(page?.metadata).toEqual({ handle: "original" });
    sqlite.exec("UPDATE storefront_pages SET handle = 'renamed'");
    const next = await storefrontContentPublicationDal.createForTheme({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "t",
      templateRevisionId: "tr",
    });
    expect(
      next.items.find((item) => item.itemType === "page")?.metadata,
    ).toEqual({ handle: "original" });
    sqlite.exec("UPDATE storefront_pages SET deleted_at = 'later'");
    expect(
      await storefrontContentPublicationDal.getPublishedPageDocument({
        publicationId: publication.id,
        handle: "original",
      }),
    ).not.toBeNull();
    expect(
      await storefrontContentPublicationDal.getPublishedPageDocument({
        publicationId: publication.id,
        handle: "renamed",
      }),
    ).toBeNull();

    // An old revision without a route may reuse a real publication snapshot,
    // but may never infer it from an intervening draft's mutable handle.
    sqlite.exec(`
      UPDATE storefront_pages SET deleted_at = NULL, draft_revision_id = 'new-draft';
      UPDATE storefront_page_revisions SET document = '{"version":1,"sections":[]}';
    `);
    const legacy = await storefrontContentPublicationDal.createForTheme({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "t",
      templateRevisionId: "tr",
    });
    expect(
      legacy.items.find((item) => item.itemType === "page")?.metadata,
    ).toEqual({ handle: "original" });
    sqlite.exec(
      "UPDATE storefront_content_publication_items SET metadata = '{}' WHERE item_type = 'page'",
    );
    await expect(
      storefrontContentPublicationDal.createForTheme({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "t",
        templateRevisionId: "tr",
      }),
    ).rejects.toThrow("CONTENT_PUBLICATION_PAGE_ROUTE_UNAVAILABLE");
    expect(
      await storefrontContentPublicationDal.getPublishedPageDocument({
        publicationId: legacy.id,
        handle: "renamed",
      }),
    ).toBeNull();
  });

  it("restores only its own failed publish, including first-publication null state", async () => {
    sqlite.exec(`INSERT INTO storefront_theme_templates (id,theme_id,type,name,document,created_at,updated_at)
      VALUES ('t','theme-a','index','Home','{}','now','now');
      UPDATE storefronts SET active_release_id = 'failed';`);
    const args = {
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "t",
      releaseId: "failed",
      releaseGeneration: 1,
      previousActiveReleaseId: null,
      previousPublishedRevisionId: null,
      previousPublishedSourceRevisionId: null,
    };
    await storefrontThemeDal.restoreFailedPublish(args);
    expect(
      (
        sqlite
          .prepare("SELECT active_release_id id FROM storefronts")
          .get() as { id: null }
      ).id,
    ).toBeNull();
    sqlite.exec("UPDATE storefronts SET active_release_id = 'winner'");
    await expect(
      storefrontThemeDal.restoreFailedPublish(args),
    ).rejects.toThrow();
    expect(
      (
        sqlite
          .prepare("SELECT active_release_id id FROM storefronts")
          .get() as { id: string }
      ).id,
    ).toBe("winner");
  });
  it("reports the framework the site records, as stored", async () => {
    expect(
      (await storefrontThemeDal.findEditorContext("storefront-a", "theme-a"))
        ?.theme.framework,
    ).toBeNull();
    sqlite
      .prepare("UPDATE storefront_themes SET framework = 'astro' WHERE id = 'theme-a'")
      .run();
    expect(
      (await storefrontThemeDal.findEditorContext("storefront-a", "theme-a"))
        ?.theme.framework,
    ).toBe("astro");
  });

  it("does not return a theme owned by another storefront", async () => {
    await expect(
      storefrontThemeDal.findEditorContext("storefront-a", "theme-b"),
    ).resolves.toBeNull();
  });

  describe("the Live Preview runtime a Theme records", () => {
    const recorded = () =>
      sqlite
        .prepare("SELECT id, preview_runtime FROM storefront_themes ORDER BY id")
        .all();
    const addOtherStorefront = () =>
      sqlite.exec(`
        INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
        VALUES ('storefront-b', 'channel-b', 'Store B', 'active', 'now', 'now');
        INSERT INTO storefront_themes (id, storefront_id, name, status, source_generation, release_generation, created_at, updated_at)
        VALUES ('theme-b', 'storefront-b', 'Other Theme', 'draft', 1, 1, 'now', 'now');
      `);

    it("reads none recorded as null, and a stored one as stored", async () => {
      expect(
        (await storefrontThemeDal.findEditorContext("storefront-a", "theme-a"))
          ?.theme.previewRuntime,
      ).toBeNull();
      sqlite
        .prepare(
          "UPDATE storefront_themes SET preview_runtime = 'start' WHERE id = 'theme-a'",
        )
        .run();
      expect(
        (await storefrontThemeDal.findEditorContext("storefront-a", "theme-a"))
          ?.theme.previewRuntime,
      ).toBe("start");
      // Only by hand; read as none, never as a guess.
      sqlite
        .prepare(
          "UPDATE storefront_themes SET preview_runtime = 'server' WHERE id = 'theme-a'",
        )
        .run();
      expect(
        (await storefrontThemeDal.findEditorContext("storefront-a", "theme-a"))
          ?.theme.previewRuntime,
      ).toBeNull();
    });

    it("records the runtime asked for, and nothing else", async () => {
      const before = sqlite
        .prepare("SELECT * FROM storefront_themes WHERE id = 'theme-a'")
        .get() as Record<string, unknown>;
      await expect(
        storefrontThemeDal.setPreviewRuntime({
          storefrontId: "storefront-a",
          themeId: "theme-a",
          previewRuntime: "start",
          expectedPreviewRuntime: null,
        }),
      ).resolves.toEqual({ ok: true, previewRuntime: "start" });
      const after = sqlite
        .prepare("SELECT * FROM storefront_themes WHERE id = 'theme-a'")
        .get() as Record<string, unknown>;
      expect(after).toEqual({
        ...before,
        preview_runtime: "start",
        updated_at: after.updated_at,
      });
      // Not Theme source: the generation does not move.
      expect(after.source_generation).toBe(before.source_generation);

      await expect(
        storefrontThemeDal.setPreviewRuntime({
          storefrontId: "storefront-a",
          themeId: "theme-a",
          previewRuntime: "client",
          expectedPreviewRuntime: "start",
        }),
      ).resolves.toEqual({ ok: true, previewRuntime: "client" });
      expect(recorded()).toEqual([
        { id: "theme-a", preview_runtime: "client" },
      ]);
    });

    it("writes nothing for a Theme of another storefront", async () => {
      addOtherStorefront();
      await expect(
        storefrontThemeDal.setPreviewRuntime({
          storefrontId: "storefront-a",
          themeId: "theme-b",
          previewRuntime: "start",
          expectedPreviewRuntime: null,
        }),
      ).resolves.toBeNull();
      await expect(
        storefrontThemeDal.setPreviewRuntime({
          storefrontId: "storefront-b",
          themeId: "theme-a",
          previewRuntime: "start",
          expectedPreviewRuntime: null,
        }),
      ).resolves.toBeNull();
      expect(recorded()).toEqual([
        { id: "theme-a", preview_runtime: null },
        { id: "theme-b", preview_runtime: null },
      ]);
    });

    it("writes nothing for a deleted Theme", async () => {
      sqlite
        .prepare(
          "UPDATE storefront_themes SET deleted_at = 'now' WHERE id = 'theme-a'",
        )
        .run();
      await expect(
        storefrontThemeDal.setPreviewRuntime({
          storefrontId: "storefront-a",
          themeId: "theme-a",
          previewRuntime: "start",
          expectedPreviewRuntime: null,
        }),
      ).resolves.toBeNull();
      expect(recorded()).toEqual([{ id: "theme-a", preview_runtime: null }]);
    });

    it("refuses start for an Astro Theme and writes nothing; client is allowed", async () => {
      sqlite
        .prepare(
          "UPDATE storefront_themes SET framework = 'astro' WHERE id = 'theme-a'",
        )
        .run();
      await expect(
        storefrontThemeDal.setPreviewRuntime({
          storefrontId: "storefront-a",
          themeId: "theme-a",
          previewRuntime: "start",
          expectedPreviewRuntime: null,
        }),
      ).resolves.toEqual({ ok: false, error: "PREVIEW_RUNTIME_UNSUPPORTED" });
      expect(recorded()).toEqual([{ id: "theme-a", preview_runtime: null }]);

      await expect(
        storefrontThemeDal.setPreviewRuntime({
          storefrontId: "storefront-a",
          themeId: "theme-a",
          previewRuntime: "client",
          expectedPreviewRuntime: null,
        }),
      ).resolves.toEqual({ ok: true, previewRuntime: "client" });
    });

    describe("compare-and-set on what the author saw", () => {
      const set = (
        previewRuntime: "client" | "start" | null,
        expectedPreviewRuntime: "client" | "start" | null,
      ) =>
        storefrontThemeDal.setPreviewRuntime({
          storefrontId: "storefront-a",
          themeId: "theme-a",
          previewRuntime,
          expectedPreviewRuntime,
        });
      const store = (value: string | null) =>
        sqlite
          .prepare(
            "UPDATE storefront_themes SET preview_runtime = ? WHERE id = 'theme-a'",
          )
          .run(value);
      const row = () =>
        sqlite
          .prepare("SELECT * FROM storefront_themes WHERE id = 'theme-a'")
          .get();

      it("refuses a stale recorded value, writes nothing, and returns the current one", async () => {
        store("client");
        const before = row();
        await expect(set("start", "start")).resolves.toEqual({
          ok: false,
          error: "PREVIEW_RUNTIME_CONFLICT",
          previewRuntime: "client",
        });
        expect(row()).toEqual(before);
      });

      it("refuses expecting none while the Theme records one", async () => {
        store("start");
        const before = row();
        await expect(set("client", null)).resolves.toEqual({
          ok: false,
          error: "PREVIEW_RUNTIME_CONFLICT",
          previewRuntime: "start",
        });
        expect(row()).toEqual(before);
      });

      it("refuses expecting one while the Theme records none", async () => {
        const before = row();
        await expect(set(null, "start")).resolves.toEqual({
          ok: false,
          error: "PREVIEW_RUNTIME_CONFLICT",
          previewRuntime: null,
        });
        expect(row()).toEqual(before);
      });

      it("clears a record back to inherited, matching it exactly", async () => {
        store("start");
        await expect(set(null, "start")).resolves.toEqual({
          ok: true,
          previewRuntime: null,
        });
        expect(recorded()).toEqual([{ id: "theme-a", preview_runtime: null }]);
        // Clearing is never refused for the framework: Astro may inherit.
        sqlite
          .prepare(
            "UPDATE storefront_themes SET framework = 'astro', preview_runtime = 'client' WHERE id = 'theme-a'",
          )
          .run();
        await expect(set(null, "client")).resolves.toEqual({
          ok: true,
          previewRuntime: null,
        });
      });

      it("takes none as matching a stored value that names no runtime, as reads do", async () => {
        store("server");
        await expect(set("start", null)).resolves.toEqual({
          ok: true,
          previewRuntime: "start",
        });
      });

      it("lets exactly one of two writers that saw the same value through", async () => {
        const first = await set("start", null);
        const second = await set("client", null);
        expect(first).toEqual({ ok: true, previewRuntime: "start" });
        expect(second).toEqual({
          ok: false,
          error: "PREVIEW_RUNTIME_CONFLICT",
          previewRuntime: "start",
        });
        expect(recorded()).toEqual([{ id: "theme-a", preview_runtime: "start" }]);
      });
    });
  });

  it("rejects an invalid persisted template document", async () => {
    sqlite
      .prepare(
        `
        INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, created_at, updated_at)
        VALUES
          ('template-a', 'theme-a', 'index', 'Home', ?, 'now', 'now')
      `,
      )
      .run('{"version":1,"sections":[{"id":"hero"}]}');

    await expect(
      storefrontThemeDal.findEditorContext("storefront-a", "theme-a"),
    ).rejects.toThrow();
  });

  it("derives a Promo Document section from the route and persists it on first edit", async () => {
    const manifest = JSON.stringify({
      components: {
        "promo.default": { source: "src/components/Promo.tsx" },
      },
      sections: {},
    });
    const root = `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: Root });
function Root() { return <Outlet />; }`;
    const route = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Promo from "../components/Promo";
export const Route = createFileRoute("/")({ component: Home });
function Home() { return <main><Promo {...content("promo")} /></main>; }`;
    const promo = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
} as const;
export default function Promo({ heading = "Promo" }) { return <h2>{heading}</h2>; }`;
    const insertFile = sqlite.prepare(`
      INSERT INTO storefront_theme_files
        (id, storefront_id, theme_id, path, content, created_at, updated_at)
      VALUES (?, 'storefront-a', 'theme-a', ?, ?, 'now', 'now')
    `);
    insertFile.run("file-manifest", "morph.theme.json", manifest);
    insertFile.run("file-root", "src/routes/__root.tsx", root);
    insertFile.run("file-route", "src/routes/index.tsx", route);
    insertFile.run("file-promo", "src/components/Promo.tsx", promo);
    insertFile.run(
      "file-content",
      "src/morph/content.ts",
      "export const content = () => ({});",
    );
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, created_at, updated_at)
        VALUES ('template-promo', 'theme-a', 'index', 'Home', ?, 'now', 'now')`,
      )
      .run(JSON.stringify({ version: 1, sections: [] }));

    const context = await storefrontThemeDal.findEditorContext(
      "storefront-a",
      "theme-a",
    );
    const template = context!.templates[0]!;
    // Source structure is still available to the editor, but it is no longer
    // fabricated stored content. The first edit below must create this slot.
    expect(template.document.sections).toEqual([]);
    expect(mergeDocumentWithRouteSections(template.document, startStructure(template.routeStructure).sections).sections).toEqual([
      {
        id: "promo",
        type: "promo",
        componentRef: "promo.default",
        enabled: true,
        props: {},
      },
    ]);

    const result = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-promo",
      sectionId: "promo",
      props: { heading: "Editable promo" },
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    expect(result?.document.sections[0]).toMatchObject({
      id: "promo",
      type: "promo",
      componentRef: "promo.default",
      props: { heading: "Editable promo" },
    });
  });

  it("validates a page-owned copy against its own fields, not the stored template ref", async () => {
    const root = `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: Root });
function Root() { return <Outlet />; }`;
    const route = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/page-sections/index/hero/index";
export const Route = createFileRoute("/")({ component: Home });
function Home() { return <main><Hero {...content("hero")} /></main>; }`;
    const template = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
} as const;
export default function Hero({ heading = "Hero" }) { return <h1>{heading}</h1>; }`;
    // The copy has grown a field its template never declared.
    const copy = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
  badge: { type: "text", label: "Badge" },
} as const;
export default function Hero({ heading = "Hero", badge = "" }) {
  return <h1>{heading}<small>{badge}</small></h1>;
}`;
    const insertFile = sqlite.prepare(`
      INSERT INTO storefront_theme_files
        (id, storefront_id, theme_id, path, content, created_at, updated_at)
      VALUES (?, 'storefront-a', 'theme-a', ?, ?, 'now', 'now')
    `);
    insertFile.run("file-root", "src/routes/__root.tsx", root);
    insertFile.run("file-route", "src/routes/index.tsx", route);
    insertFile.run(
      "file-content",
      "src/morph/content.ts",
      "export const content = () => ({});",
    );
    insertFile.run("file-template", "src/components/Hero.tsx", template);
    insertFile.run(
      "file-copy",
      "src/components/page-sections/index/hero/index.tsx",
      copy,
    );
    // Stored before the section moved onto its copy: it still names the template.
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, created_at, updated_at)
        VALUES ('template-home', 'theme-a', 'index', 'Home', ?, 'now', 'now')`,
      )
      .run(
        JSON.stringify({
          version: 1,
          sections: [
            {
              id: "hero",
              type: "hero",
              componentRef: "src/components/Hero.tsx",
              enabled: true,
              props: { heading: "Stored" },
            },
          ],
        }),
      );

    const result = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-home",
      sectionId: "hero",
      props: { badge: "New" },
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    expect(result?.document.sections[0]).toMatchObject({
      id: "hero",
      componentRef: "src/components/page-sections/index/hero/index.tsx",
      props: { heading: "Stored", badge: "New" },
    });
  });

  describe("checks a write against the route the editor names", () => {
    const root = `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: Root });
function Root() { return <Outlet />; }`;
    const routeRendering = (routeId: string, component: string) =>
      `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/${component}";
export const Route = createFileRoute("${routeId}")({ component: Page });
function Page() { return <main><Hero {...content("hero")} /></main>; }`;
    const component = (fields: string) => `export const contentFields = {
  ${fields}
} as const;
export default function Hero() { return <h1 />; }`;

    const seedProductRoutes = () => {
      const insertFile = sqlite.prepare(`
        INSERT INTO storefront_theme_files
          (id, storefront_id, theme_id, path, content, created_at, updated_at)
        VALUES (?, 'storefront-a', 'theme-a', ?, ?, 'now', 'now')
      `);
      insertFile.run("f-root", "src/routes/__root.tsx", root);
      insertFile.run(
        "f-content",
        "src/morph/content.ts",
        "export const content = () => ({});",
      );
      // One template, two routes, a different component behind the same slot.
      // Both under /products/, so both are routes of the product template.
      insertFile.run(
        "f-list",
        "src/routes/products.featured.tsx",
        routeRendering("/products/featured", "ListHero"),
      );
      insertFile.run(
        "f-detail",
        "src/routes/products.$slug.tsx",
        routeRendering("/products/$slug", "DetailHero"),
      );
      insertFile.run(
        "f-list-hero",
        "src/components/ListHero.tsx",
        component(`heading: { type: "text", label: "Heading" },`),
      );
      insertFile.run(
        "f-detail-hero",
        "src/components/DetailHero.tsx",
        component(`heading: { type: "text", label: "Heading" },
  badge: { type: "text", label: "Badge" },`),
      );
      sqlite
        .prepare(
          `INSERT INTO storefront_theme_templates
            (id, theme_id, type, name, document, created_at, updated_at)
          VALUES ('template-product', 'theme-a', 'product', 'Product', ?, 'now', 'now')`,
        )
        .run(
          JSON.stringify({
            version: 1,
            sections: [
              {
                id: "hero",
                type: "hero",
                componentRef: "src/components/DetailHero.tsx",
                enabled: true,
                props: {},
              },
            ],
          }),
        );
    };

    const write = (props: Record<string, unknown>, routePath?: string) =>
      storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-product",
        sectionId: "hero",
        props,
        expectedDraftGeneration: 1,
        createdBy: "user-1",
        ...(routePath ? { routePath } : {}),
      });

    it("uses the component the named route renders", async () => {
      seedProductRoutes();
      // The listing never declared `badge`, so it is not accepted there even
      // though the detail route's hero would take it.
      const result = await write(
        { heading: "All", badge: "x" },
        "/products/featured",
      );
      expect(result?.document.sections[0]).toMatchObject({
        componentRef: "src/components/ListHero.tsx",
        props: { heading: "All" },
      });
      expect(result?.document.sections[0]?.props).not.toHaveProperty("badge");
    });

    it("refuses a route that does not belong to the template", async () => {
      seedProductRoutes();
      await expect(write({ heading: "x" }, "/")).rejects.toThrow(
        "SECTION_SOURCE_UNCONFIRMED",
      );
      await expect(
        write({ heading: "x" }, "/products/$slug/missing"),
      ).rejects.toThrow("SECTION_SOURCE_UNCONFIRMED");
    });

    it("refuses a section the named route does not render", async () => {
      seedProductRoutes();
      // The detail route declares `hero`, so the template document has it;
      // the listing is rewritten here to render nothing, and a write made on
      // the listing must not borrow the detail route's component.
      sqlite.prepare(
        `UPDATE storefront_theme_files SET content = ? WHERE id = 'f-list'`,
      ).run(`import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
export const Route = createFileRoute("/products/featured")({ component: Page });
function Page() { return <main />; }`);
      await expect(
        write({ heading: "x" }, "/products/featured"),
      ).rejects.toThrow('does not render section "hero"');
    });
  });

  describe("fails closed when source owns structure but cannot confirm the section", () => {
    const root = `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: Root });
function Root() { return <Outlet />; }`;
    const hero = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
} as const;
export default function Hero() { return <h1 />; }`;

    const seed = (files: Record<string, string>) => {
      const insertFile = sqlite.prepare(`
        INSERT INTO storefront_theme_files
          (id, storefront_id, theme_id, path, content, created_at, updated_at)
        VALUES (?, 'storefront-a', 'theme-a', ?, ?, 'now', 'now')
      `);
      for (const [path, content] of Object.entries(files)) {
        insertFile.run(`f-${path}`, path, content);
      }
      sqlite
        .prepare(
          `INSERT INTO storefront_theme_templates
            (id, theme_id, type, name, document, created_at, updated_at)
          VALUES ('template-home', 'theme-a', 'index', 'Home', ?, 'now', 'now')`,
        )
        .run(
          JSON.stringify({
            version: 1,
            sections: [
              {
                id: "hero",
                type: "hero",
                componentRef: "src/components/Hero.tsx",
                enabled: true,
                props: { heading: "Stored" },
              },
            ],
          }),
        );
    };
    const write = () =>
      storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-home",
        sectionId: "hero",
        props: { heading: "New" },
        expectedDraftGeneration: 1,
        createdBy: "user-1",
      });

    it("refuses when the route has diagnostics", async () => {
      // A second `hero` slot: the route declares structure, but which of the
      // two the write is for cannot be told.
      seed({
        "src/routes/__root.tsx": root,
        "src/routes/index.tsx": `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: Home });
function Home() { return <main><Hero {...content("hero")} /><Hero {...content("hero")} /></main>; }`,
        "src/morph/content.ts": "export const content = () => ({});",
        "src/components/Hero.tsx": hero,
      });
      await expect(write()).rejects.toThrow("SECTION_SOURCE_UNCONFIRMED");
    });

    it("refuses when the route files do not form a valid route tree", async () => {
      seed({
        // No root route: the registry is invalid, so nothing can be confirmed.
        "src/routes/index.tsx": `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: Home });
function Home() { return <main><Hero {...content("hero")} /></main>; }`,
        "src/morph/content.ts": "export const content = () => ({});",
        "src/components/Hero.tsx": hero,
      });
      await expect(write()).rejects.toThrow("SECTION_SOURCE_UNCONFIRMED");
    });

    it("still accepts a route that never adopted content(...)", async () => {
      // A Theme from before route-owned structure: the source has no say, so
      // the stored ref is the only answer there is.
      seed({
        "src/routes/__root.tsx": root,
        "src/routes/index.tsx": `import { createFileRoute } from "@tanstack/react-router";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: Home });
function Home() { return <main><Hero /></main>; }`,
        "src/components/Hero.tsx": hero,
      });
      const result = await write();
      expect(result?.document.sections[0]).toMatchObject({
        componentRef: "src/components/Hero.tsx",
        props: { heading: "New" },
      });
    });
  });

  describe("a component that declares its fields in <Name>.fields.ts", () => {
    const root = `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: Root });
function Root() { return <Outlet />; }`;
    // The same component placed twice, each with its own content slot.
    const index = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: Home });
function Home() { return <main><Hero {...content("hero-a")} /><Hero {...content("hero-b")} /></main>; }`;
    const hero = `export default function Hero({ heading }: { heading?: string }) { return <h1>{heading}</h1>; }`;
    const sidecar = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
} as const;`;

    const seed = (files: Record<string, string>) => {
      const insertFile = sqlite.prepare(`
        INSERT INTO storefront_theme_files
          (id, storefront_id, theme_id, path, content, created_at, updated_at)
        VALUES (?, 'storefront-a', 'theme-a', ?, ?, 'now', 'now')
      `);
      for (const [path, content] of Object.entries({
        "src/routes/__root.tsx": root,
        "src/routes/index.tsx": index,
        "src/morph/content.ts": "export const content = () => ({});",
        ...files,
      })) {
        insertFile.run(`f-${path}`, path, content);
      }
      sqlite
        .prepare(
          `INSERT INTO storefront_theme_templates
            (id, theme_id, type, name, document, created_at, updated_at)
          VALUES ('template-home', 'theme-a', 'index', 'Home', ?, 'now', 'now')`,
        )
        .run(
          JSON.stringify({
            version: 1,
            sections: ["hero-a", "hero-b"].map((id) => ({
              id,
              type: "hero",
              componentRef: "src/components/Hero.tsx",
              enabled: true,
              props: { heading: `Stored ${id}` },
            })),
          }),
        );
    };
    const write = (
      sectionId: string,
      props: Record<string, unknown>,
      expectedDraftGeneration = 1,
    ) =>
      storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-home",
        sectionId,
        props,
        expectedDraftGeneration,
        createdBy: "user-1",
      });
    const draftGeneration = () =>
      (
        sqlite
          .prepare(
            "SELECT draft_generation FROM storefront_theme_templates WHERE id = 'template-home'",
          )
          .get() as { draft_generation: number }
      ).draft_generation;

    it("writes one instance's declared field and leaves the other instance alone", async () => {
      seed({
        "src/components/Hero.tsx": hero,
        "src/components/Hero.fields.ts": sidecar,
      });
      const saved = await write("hero-a", { heading: "New A" });
      expect(saved?.document.sections).toMatchObject([
        { id: "hero-a", props: { heading: "New A" } },
        { id: "hero-b", props: { heading: "Stored hero-b" } },
      ]);
    });

    // Undeclared incoming values are filtered out, as for any declaration
    // (filterSectionContentProps): the write goes through and stores nothing
    // the component did not offer.
    it("drops a field the sidecar does not declare", async () => {
      seed({
        "src/components/Hero.tsx": hero,
        "src/components/Hero.fields.ts": sidecar,
      });
      const saved = await write("hero-a", { subtitle: "Nope" });
      expect(saved?.document.sections[0]?.props).toEqual({
        heading: "Stored hero-a",
      });
    });

    it("refuses a write from a stale draft generation", async () => {
      seed({
        "src/components/Hero.tsx": hero,
        "src/components/Hero.fields.ts": sidecar,
      });
      await expect(write("hero-a", { heading: "Late" }, 2)).rejects.toThrow(
        TEMPLATE_DRAFT_GENERATION_MISMATCH,
      );
      expect(draftGeneration()).toBe(1);
    });

    it("stores no content while the component and its sidecar disagree", async () => {
      seed({
        "src/components/Hero.tsx": `export const contentFields = {
  heading: { type: "textarea", label: "Heading" },
} as const;
${hero}`,
        "src/components/Hero.fields.ts": sidecar,
      });
      const saved = await write("hero-a", { heading: "New A" });
      expect(saved?.document.sections[0]?.props).toEqual({
        heading: "Stored hero-a",
      });
    });

    it("uses the sidecar when the component repeats the same declaration", async () => {
      seed({
        "src/components/Hero.tsx": `${sidecar}\n${hero}`,
        "src/components/Hero.fields.ts": sidecar,
      });
      const saved = await write("hero-b", { heading: "New B" });
      expect(saved?.document.sections).toMatchObject([
        { id: "hero-a", props: { heading: "Stored hero-a" } },
        { id: "hero-b", props: { heading: "New B" } },
      ]);
    });

    it("control: without the sidecar the same component stores nothing", async () => {
      seed({ "src/components/Hero.tsx": hero });
      const saved = await write("hero-a", { heading: "New A" });
      expect(saved?.document.sections[0]?.props).toEqual({
        heading: "Stored hero-a",
      });
    });
  });

  describe("a static route's own document", () => {
    const root = `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: Root });
function Root() { return <Outlet />; }`;
    const route = (
      id: string,
      slot: string,
    ) => `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("${id}")({ component: Page });
function Page() { return <main><Hero {...content("${slot}")} /></main>; }`;
    const hero = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
} as const;
export default function Hero() { return <h1 />; }`;

    const seed = () => {
      const insertFile = sqlite.prepare(`
        INSERT INTO storefront_theme_files
          (id, storefront_id, theme_id, path, content, created_at, updated_at)
        VALUES (?, 'storefront-a', 'theme-a', ?, ?, 'now', 'now')
      `);
      insertFile.run("r-root", "src/routes/__root.tsx", root);
      insertFile.run(
        "r-index",
        "src/routes/index.tsx",
        route("/", "home-hero"),
      );
      insertFile.run(
        "r-about",
        "src/routes/aboutus.tsx",
        route("/aboutus", "about-hero"),
      );
      insertFile.run(
        "r-contact",
        "src/routes/contact.tsx",
        route("/contact", "contact-hero"),
      );
      insertFile.run(
        "r-journal",
        "src/routes/journal.$slug.tsx",
        route("/journal/$slug", "post"),
      );
      insertFile.run("r-hero", "src/components/Hero.tsx", hero);
      insertFile.run(
        "r-content",
        "src/morph/content.ts",
        "export const content = () => ({});",
      );
      sqlite
        .prepare(
          `INSERT INTO storefront_theme_templates
            (id, theme_id, type, name, document, created_at, updated_at)
          VALUES ('template-home', 'theme-a', 'index', 'Home', ?, 'now', 'now')`,
        )
        .run(JSON.stringify({ version: 1, sections: [] }));
    };
    const ensure = (routePath: string) =>
      storefrontThemeDal.ensureRouteTemplate({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        routePath,
      });
    const write = (
      templateId: string,
      sectionId: string,
      routePath: string,
      heading: string,
    ) =>
      storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId,
        sectionId,
        props: { heading },
        expectedDraftGeneration: 1,
        createdBy: "user-1",
        routePath,
      });

    it("creates one document per route, once", async () => {
      seed();
      const first = await ensure("/aboutus/");
      const again = await ensure("/aboutus");
      expect(first).toMatchObject({
        ok: true,
        template: { routePath: "/aboutus" },
      });
      expect(again.ok && first.ok && again.template.id).toBe(
        first.ok && first.template.id,
      );
      const contact = await ensure("/contact");
      expect(contact.ok && first.ok && contact.template.id).not.toBe(
        first.ok && first.template.id,
      );
    });

    /**
     * Stage 1 of "refuse a write with no version basis": the editor writes
     * with no copy of a route document only onto one it created itself, so
     * the ensure says whether this call created it. A row found existing,
     * and the row a lost unique-index race reads back, are not.
     */
    it("says the document was created by this call only on the insert", async () => {
      seed();
      const first = await ensure("/aboutus");
      const again = await ensure("/aboutus");
      expect(first).toMatchObject({ ok: true, createdByThisCall: true });
      expect(again).toMatchObject({ ok: true, createdByThisCall: false });
      expect(again.ok && again.template.draftGeneration).toBe(1);
    });

    it("does not count the row a lost unique race reads back as created by this call", async () => {
      seed();
      // Another editor's insert lands between this call's read and its own
      // insert, which the unique index then refuses.
      const db = await getDb();
      const insert = db.insert.bind(db);
      vi.spyOn(db, "insert").mockImplementationOnce(((table: never) => {
        sqlite
          .prepare(
            `INSERT INTO storefront_theme_templates
              (id, theme_id, type, name, route_path, document, created_at, updated_at)
            VALUES ('rival', 'theme-a', 'page', 'rival-contact', '/contact', ?, 'now', 'now')`,
          )
          .run(JSON.stringify({ version: 1, sections: [] }));
        return insert(table);
      }) as never);
      const raced = await ensure("/contact");
      expect(raced).toMatchObject({
        ok: true,
        createdByThisCall: false,
        template: { id: "rival", draftGeneration: 1 },
      });
    });

    it("prepares and publishes a new source route without a Design content write", async () => {
      seed();
      const ensured = await ensure("/aboutus");
      expect(ensured.ok).toBe(true);
      if (!ensured.ok) throw new Error(ensured.reason);
      const before = await storefrontThemeDal.findEditorContext(
        "storefront-a",
        "theme-a",
      );
      const untouched = before?.templates.find(
        (item) => item.id === ensured.template.id,
      )?.document;
      // The route still declares its Hero, but publish preparation must seal
      // stored content rather than turn the editor projection into content.
      const derived = before!.templates.find((item) => item.id === ensured.template.id)!.routeStructure;
      expect(untouched?.sections).toEqual([]);
      expect(mergeDocumentWithRouteSections(untouched!, startStructure(derived).sections).sections).toEqual([
        {
          id: "about-hero",
          type: "hero",
          componentRef: "src/components/Hero.tsx",
          enabled: true,
          props: {},
        },
      ]);
      const draft = await storefrontThemeDal.prepareInitialTemplateDraft({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: ensured.template.id,
        expectedDraftGeneration: ensured.template.draftGeneration,
        expectedSourceGeneration: 1,
        createdBy: "user-1",
      });
      expect(draft?.document).toEqual(untouched);
      expect(draft?.draftRevisionId).toEqual(expect.any(String));
      // Same immutable-source fixture as the existing initial-publish DAL
      // acceptance; full source/build/browser evidence is tested separately.
      sqlite.exec(`INSERT INTO storefront_theme_revisions
        (id, storefront_id, theme_id, revision_number, source_generation, snapshot, created_at, updated_at)
        VALUES ('22222222-2222-4222-8222-222222222222', 'storefront-a', 'theme-a', 1, 1, '[]', 'now', 'now');`);
      const published = await storefrontThemeDal.publishTemplate({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: ensured.template.id,
        // A first publish names the build it made, as the editor does.
        sourceRevisionId: "22222222-2222-4222-8222-222222222222",
        themeBuildId: "33333333-3333-4333-8333-333333333333",
        expectedDraftRevisionId: draft!.draftRevisionId,
        expectedDraftGeneration: draft!.draftGeneration,
        expectedReleaseGeneration: 1,
        readSourceRevisionFiles: workspaceRevisionFiles,
        verifySourceRevision: acceptRevision,
      });
      expect(published).toMatchObject({ releaseCreated: true });
      const after = await storefrontThemeDal.findEditorContext(
        "storefront-a",
        "theme-a",
      );
      expect(
        after?.templates.find((item) => item.id === ensured.template.id)
          ?.publishedRevisionId,
      ).toBe(draft!.draftRevisionId);
      expect(
        after?.templates.find((item) => item.id === "template-home")
          ?.draftRevisionId,
      ).toBeNull();
      expect(
        sqlite
          .prepare(
            "SELECT created_by FROM storefront_theme_template_revisions WHERE id = ?",
          )
          .get(draft!.draftRevisionId),
      ).toEqual({ created_by: "user-1" });
    });

    it("creates none where a type covers the route, or no route exists", async () => {
      seed();
      expect(await ensure("/")).toMatchObject({ ok: false });
      expect(await ensure("/journal/$slug")).toMatchObject({ ok: false });
      expect(await ensure("/missing")).toMatchObject({ ok: false });
    });

    it("reads its document through its own route, and stores writes there", async () => {
      seed();
      const about = await ensure("/aboutus");
      const contact = await ensure("/contact");
      if (!about.ok || !contact.ok) throw new Error("setup");

      const context = await storefrontThemeDal.findEditorContext(
        "storefront-a",
        "theme-a",
      );
      const aboutDoc = context?.templates.find(
        (t) => t.id === about.template.id,
      );
      expect(aboutDoc?.routePath).toBe("/aboutus");
      expect(aboutDoc?.document.sections).toEqual([]);
      expect(startStructure(aboutDoc?.routeStructure).sections.map((section) => section.slotId)).toEqual([
        "about-hero",
      ]);

      const saved = await write(
        about.template.id,
        "about-hero",
        "/aboutus",
        "About",
      );
      expect(saved?.document.sections[0]).toMatchObject({
        id: "about-hero",
        componentRef: "src/components/Hero.tsx",
        props: { heading: "About" },
      });
      // A second route's document is its own; writing one drops nothing from
      // the other, which a single shared `page` document would have done.
      const contactSaved = await write(
        contact.template.id,
        "contact-hero",
        "/contact",
        "Contact",
      );
      expect(contactSaved?.document.sections.map((s) => s.id)).toEqual([
        "contact-hero",
      ]);
    });

    it("refuses a write that names a different route", async () => {
      seed();
      const about = await ensure("/aboutus");
      if (!about.ok) throw new Error("setup");
      await expect(
        write(about.template.id, "about-hero", "/contact", "x"),
      ).rejects.toThrow("SECTION_SOURCE_UNCONFIRMED");
      // And the shared home document still refuses a route it does not serve:
      // it is read through `/`, which has no such section to write.
      await expect(
        write("template-home", "about-hero", "/aboutus", "x"),
      ).resolves.toBeNull();
    });

    it("is served by path, and never stands in for its type", async () => {
      seed();
      const about = await ensure("/aboutus");
      if (!about.ok) throw new Error("setup");
      const saved = await write(
        about.template.id,
        "about-hero",
        "/aboutus",
        "Published about",
      );
      if (!saved?.draftRevisionId) throw new Error("missing document revision");
      const publication = await storefrontContentPublicationDal.createForTheme({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: about.template.id,
        templateRevisionId: saved.draftRevisionId,
      });
      expect(
        publication.items.find((item) => item.contentId === about.template.id)
          ?.metadata,
      ).toEqual({ routePath: "/aboutus", templateType: "page" });

      const byRoute =
        (await storefrontContentPublicationDal.getPublishedRouteDocument({
          publicationId: publication.id,
          routePath: "/aboutus",
        })) as { sections: { props: { heading: string } }[] } | null;
      expect(byRoute?.sections[0]?.props.heading).toBe("Published about");

      sqlite
        .prepare(
          "UPDATE storefront_theme_templates SET route_path = '/company' WHERE id = ?",
        )
        .run(about.template.id);
      const historicalRoute =
        await storefrontContentPublicationDal.getPublishedRouteDocument({
          publicationId: publication.id,
          routePath: "/aboutus",
        });
      expect(historicalRoute).not.toBeNull();
      expect(
        await storefrontContentPublicationDal.getPublishedRouteDocument({
          publicationId: publication.id,
          routePath: "/company",
        }),
      ).toBeNull();
      expect(
        await storefrontContentPublicationDal.getPublishedTemplateDocument({
          publicationId: publication.id,
          templateType: "page",
        }),
      ).toBeNull();
    });
  });

  function seedLayoutTheme(layoutBody: string) {
    const root = `import { Outlet, createRootRoute } from "@tanstack/react-router";
import StorefrontLayout from "../layouts/StorefrontLayout";
export const Route = createRootRoute({ component: Root });
function Root() { return <StorefrontLayout><Outlet /></StorefrontLayout>; }`;
    const layout = `import { Outlet } from "@tanstack/react-router";
import { content } from "../morph/content";
import Header from "../components/SiteHeader";
export default function StorefrontLayout() {
${layoutBody}
}`;
    const header = `export const contentFields = {
  brand: { type: "text", label: "Brand" },
  tagline: { type: "text", label: "Tagline" },
} as const;
export default function SiteHeader() { return <header />; }`;
    const insertFile = sqlite.prepare(`
      INSERT INTO storefront_theme_files
        (id, storefront_id, theme_id, path, content, created_at, updated_at)
      VALUES (?, 'storefront-a', 'theme-a', ?, ?, 'now', 'now')
    `);
    insertFile.run("l-root", "src/routes/__root.tsx", root);
    insertFile.run("l-layout", "src/layouts/StorefrontLayout.tsx", layout);
    insertFile.run("l-header", "src/components/SiteHeader.tsx", header);
    insertFile.run(
      "l-content",
      "src/morph/content.ts",
      "export const content = () => ({});",
    );
  }

  const layoutWrite = (props: Record<string, unknown>) =>
    storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-layout",
      sectionId: "header",
      props,
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

  function insertLayoutDocument(props: Record<string, unknown>) {
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, created_at, updated_at)
        VALUES ('template-layout', 'theme-a', 'layout', 'Layout', ?, 'now', 'now')`,
      )
      .run(
        JSON.stringify({
          version: 1,
          sections: [
            {
              id: "header",
              type: "header",
              componentRef: "src/components/SiteHeader.tsx",
              enabled: true,
              props,
            },
          ],
        }),
      );
  }

  const layoutDocument = () =>
    sqlite
      .prepare(
        "SELECT document, draft_revision_id AS draftRevisionId FROM storefront_theme_templates WHERE id = 'template-layout'",
      )
      .get();

  it("refuses a layout write the layout source overrides after the spread", async () => {
    // The literal comes after the spread, so the stored tagline never shows.
    seedLayoutTheme(
      `  return <div><Header {...content("header")} tagline="Fixed in code" /><Outlet /></div>;`,
    );
    insertLayoutDocument({ brand: "Old", tagline: "Stored" });
    const before = layoutDocument();

    await expect(layoutWrite({ tagline: "Never shown" })).rejects.toThrow(
      "INVALID_THEME_CONTENT_FIELD_VALUE:tagline:unproven-source",
    );
    expect(layoutDocument()).toEqual(before);

    // The field the layout does pass through is still writable.
    const result = await layoutWrite({ brand: "New" });
    expect(result?.document.sections[0]?.props).toEqual({
      brand: "New",
      tagline: "Stored",
    });
  });

  it("refuses a layout write to a field the layout instance never takes", async () => {
    seedLayoutTheme(`  const header = content("header");
  return <div><Header brand={header.brand} /><Outlet /></div>;`);
    insertLayoutDocument({ brand: "Old" });
    const before = layoutDocument();

    await expect(layoutWrite({ tagline: "Never shown" })).rejects.toThrow(
      "INVALID_THEME_CONTENT_FIELD_VALUE:tagline:unproven-source",
    );
    expect(layoutDocument()).toEqual(before);

    const result = await layoutWrite({ brand: "New" });
    expect(result?.document.sections[0]?.props).toEqual({ brand: "New" });
  });

  it("checks a layout write against the component the layout renders", async () => {
    seedLayoutTheme(
      `  return <div><Header {...content("header")} /><Outlet /></div>;`,
    );
    // Stored while the layout still rendered a header this Theme has removed.
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, created_at, updated_at)
        VALUES ('template-layout', 'theme-a', 'layout', 'Layout', ?, 'now', 'now')`,
      )
      .run(
        JSON.stringify({
          version: 1,
          sections: [
            {
              id: "header",
              type: "header",
              componentRef: "src/components/Header.tsx",
              enabled: true,
              props: { brand: "Old" },
            },
          ],
        }),
      );

    const result = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-layout",
      sectionId: "header",
      props: { tagline: "New" },
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    expect(result?.document.sections[0]).toMatchObject({
      componentRef: "src/components/SiteHeader.tsx",
      props: { brand: "Old", tagline: "New" },
    });
  });

  it("publishes template document and updates publishedRevisionId", async () => {
    const draftDocument = JSON.stringify({
      version: 1,
      sections: [{ id: "hero", type: "hero", enabled: true, props: {} }],
    });
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, created_at, updated_at)
      VALUES
        ('template-a', 'theme-a', 'index', 'Home', '{"version":1,"sections":[]}',
         '11111111-1111-4111-8111-111111111111', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'template-a', 1,
         '${draftDocument.replaceAll("'", "''")}', 'now');
      INSERT INTO storefront_theme_revisions
        (id, storefront_id, theme_id, revision_number, source_generation, message, source, snapshot, created_at, updated_at)
      VALUES
        ('22222222-2222-4222-8222-222222222222', 'storefront-a', 'theme-a', 1, 1,
         'Frozen checkpoint', 'publish', '[]', 'now', 'now');
    `);

    await expect(
      storefrontThemeDal.publishTemplate({
        readSourceRevisionFiles: workspaceRevisionFiles,
        verifySourceRevision: acceptRevision,
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-a",
        sourceRevisionId: "22222222-2222-4222-8222-222222222222",
        themeBuildId: "33333333-3333-4333-8333-333333333333",
        expectedDraftRevisionId: "11111111-1111-4111-8111-111111111111",
        expectedDraftGeneration: 1,
        expectedReleaseGeneration: 1,
      }),
    ).resolves.toMatchObject({
      revisionId: "11111111-1111-4111-8111-111111111111",
      sourceRevisionId: "22222222-2222-4222-8222-222222222222",
      draftGeneration: 2,
      releaseGeneration: 2,
      templateUnchanged: false,
      sourceUnchanged: false,
      unchanged: false,
      // Surfaced so the publish caller can deploy the release it activated.
      releaseCreated: true,
      themeBuildId: "33333333-3333-4333-8333-333333333333",
    });

    const storefront = sqlite
      .prepare("SELECT active_release_id FROM storefronts WHERE id = ?")
      .get("storefront-a") as { active_release_id: string | null };
    expect(storefront.active_release_id).toBeTruthy();
    const release = sqlite
      .prepare(
        "SELECT storefront_id, theme_id, source_revision_id, theme_build_id, content_publication_id, status FROM storefront_releases WHERE id = ?",
      )
      .get(storefront.active_release_id) as {
      storefront_id: string;
      theme_id: string;
      source_revision_id: string;
      theme_build_id: string;
      content_publication_id: string;
      status: string;
    };
    expect(release).toEqual({
      storefront_id: "storefront-a",
      theme_id: "theme-a",
      source_revision_id: "22222222-2222-4222-8222-222222222222",
      theme_build_id: "33333333-3333-4333-8333-333333333333",
      content_publication_id: expect.any(String),
      status: "available",
    });

    // Content-only publish reuses the active succeeded build and creates a
    // new immutable publication without creating another source/build.
    const nextDraftRevisionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    sqlite.exec(`
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('${nextDraftRevisionId}', 'template-a', 2,
         '${draftDocument.replace("Original", "Updated").replaceAll("'", "''")}', 'now');
      UPDATE storefront_theme_templates
      SET draft_revision_id = '${nextDraftRevisionId}', draft_generation = 3
      WHERE id = 'template-a';
    `);

    const verified: string[] = [];
    await expect(
      storefrontThemeDal.publishTemplate({
        readSourceRevisionFiles: workspaceRevisionFiles,
        verifySourceRevision: async (revisionId) => {
          verified.push(revisionId);
        },
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-a",
        expectedDraftRevisionId: nextDraftRevisionId,
        expectedDraftGeneration: 3,
        expectedReleaseGeneration: 2,
      }),
    ).resolves.toMatchObject({
      sourceRevisionId: "22222222-2222-4222-8222-222222222222",
      unchanged: false,
    });
    // The caller named no revision; the check saw the one resolved here.
    expect(verified).toEqual(["22222222-2222-4222-8222-222222222222"]);

    const publicationCount = sqlite
      .prepare("SELECT COUNT(*) AS count FROM storefront_content_publications")
      .get() as { count: number };
    expect(publicationCount.count).toBe(2);
    await expect(
      storefrontContentPublicationDal.assertRevisionCanBeDeleted(
        nextDraftRevisionId,
      ),
    ).rejects.toThrow("REVISION_RETENTION_CONFLICT");
    await expect(
      storefrontContentPublicationDal.assertRevisionCanBeDeleted(
        "99999999-9999-4999-8999-999999999999",
      ),
    ).resolves.toBeUndefined();
    const buildCount = sqlite
      .prepare("SELECT COUNT(*) AS count FROM storefront_theme_builds")
      .get() as { count: number };
    expect(buildCount.count).toBe(1);

    // A losing OCC publish must not insert another publication.
    sqlite.exec(`
      UPDATE storefront_theme_templates
      SET draft_revision_id = '11111111-1111-4111-8111-111111111111', draft_generation = 4
      WHERE id = 'template-a';
    `);
    await expect(
      storefrontThemeDal.publishTemplate({
        readSourceRevisionFiles: workspaceRevisionFiles,
        verifySourceRevision: acceptRevision,
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-a",
        expectedDraftRevisionId: "11111111-1111-4111-8111-111111111111",
        expectedDraftGeneration: 4,
        expectedReleaseGeneration: 1,
      }),
    ).rejects.toThrow();
    const publicationCountAfterConflict = sqlite
      .prepare("SELECT COUNT(*) AS count FROM storefront_content_publications")
      .get() as { count: number };
    expect(publicationCountAfterConflict.count).toBe(2);

    // Legacy/changed source generations fail closed for content-only publish.
    sqlite.exec(
      "UPDATE storefront_themes SET source_generation = 2 WHERE id = 'theme-a'",
    );
    await expect(
      storefrontThemeDal.publishTemplate({
        readSourceRevisionFiles: workspaceRevisionFiles,
        verifySourceRevision: acceptRevision,
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-a",
        expectedDraftRevisionId: "11111111-1111-4111-8111-111111111111",
        expectedDraftGeneration: 4,
        expectedReleaseGeneration: 3,
      }),
    ).rejects.toThrow("PUBLISH_BUILD_NOT_READY");
  });

  it("refuses before activating anything when the source revision check throws", async () => {
    const draftDocument = JSON.stringify({
      version: 1,
      sections: [{ id: "hero", type: "hero", enabled: true, props: {} }],
    });
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, created_at, updated_at)
      VALUES
        ('template-a', 'theme-a', 'index', 'Home', '{"version":1,"sections":[]}',
         '11111111-1111-4111-8111-111111111111', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'template-a', 1,
         '${draftDocument.replaceAll("'", "''")}', 'now');
      INSERT INTO storefront_theme_revisions
        (id, storefront_id, theme_id, revision_number, source_generation, message, source, snapshot, created_at, updated_at)
      VALUES
        ('22222222-2222-4222-8222-222222222222', 'storefront-a', 'theme-a', 1, 1,
         'Frozen checkpoint', 'publish', '[]', 'now', 'now');
    `);
    const count = (table: string) =>
      (
        sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
          count: number;
        }
      ).count;
    const before = {
      releases: count("storefront_releases"),
      publications: count("storefront_content_publications"),
    };

    const verified: string[] = [];
    await expect(
      storefrontThemeDal.publishTemplate({
        readSourceRevisionFiles: workspaceRevisionFiles,
        verifySourceRevision: async (revisionId) => {
          verified.push(revisionId);
          throw new Error(
            "PUBLISH_PUBLIC_FILE_REFUSED: public/logo.svg: Event handler attributes are not allowed",
          );
        },
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-a",
        sourceRevisionId: "22222222-2222-4222-8222-222222222222",
        themeBuildId: "33333333-3333-4333-8333-333333333333",
        expectedDraftRevisionId: "11111111-1111-4111-8111-111111111111",
        expectedDraftGeneration: 1,
        expectedReleaseGeneration: 1,
      }),
    ).rejects.toThrow("PUBLISH_PUBLIC_FILE_REFUSED");

    expect(verified).toEqual(["22222222-2222-4222-8222-222222222222"]);
    expect(
      sqlite
        .prepare("SELECT active_release_id FROM storefronts WHERE id = ?")
        .get("storefront-a"),
    ).toEqual({ active_release_id: null });
    expect(
      sqlite
        .prepare(
          "SELECT published_revision_id, draft_generation FROM storefront_theme_templates WHERE id = ?",
        )
        .get("template-a"),
    ).toEqual({ published_revision_id: null, draft_generation: 1 });
    expect({
      releases: count("storefront_releases"),
      publications: count("storefront_content_publications"),
    }).toEqual(before);
  });

  describe("the publish scope the confirmation shows is the one sealed", () => {
    const PAGE_REVISION = "11111111-1111-4111-8111-111111111111";
    const SOURCE_REVISION = "22222222-2222-4222-8222-222222222222";
    const BUILD = "33333333-3333-4333-8333-333333333333";
    const LAYOUT_REVISION = "44444444-4444-4444-8444-444444444441";
    const NEWER_LAYOUT_REVISION = "44444444-4444-4444-8444-444444444442";
    const scopeIds = {
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-a",
    };
    const tableCount = (table: string) =>
      (
        sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
          count: number;
        }
      ).count;
    const layoutRow = () =>
      sqlite
        .prepare(
          "SELECT draft_revision_id AS draft, published_revision_id AS published FROM storefront_theme_templates WHERE id = 'layout-a'",
        )
        .get();

    function seedPage() {
      sqlite.exec(`
        INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, draft_revision_id, created_at, updated_at)
        VALUES
          ('template-a', 'theme-a', 'index', 'Home', '{"version":1,"sections":[]}',
           '${PAGE_REVISION}', 'now', 'now');
        INSERT INTO storefront_theme_template_revisions
          (id, template_id, version, document, created_at)
        VALUES
          ('${PAGE_REVISION}', 'template-a', 1, '{"version":1,"sections":[]}', 'now');
        INSERT INTO storefront_theme_revisions
          (id, storefront_id, theme_id, revision_number, source_generation, message, source, snapshot, created_at, updated_at)
        VALUES
          ('${SOURCE_REVISION}', 'storefront-a', 'theme-a', 1, 1,
           'Frozen checkpoint', 'publish', '[]', 'now', 'now');
      `);
    }
    /** A layout whose draft is `revisionId` and was never published. */
    function seedLayoutDraft(revisionId: string, version = 1) {
      sqlite.exec(`
        INSERT INTO storefront_theme_template_revisions
          (id, template_id, version, document, created_at)
        VALUES
          ('${revisionId}', 'layout-a', ${version}, '{"version":1,"sections":[]}', 'now');
      `);
      const existing = sqlite
        .prepare(
          "SELECT id FROM storefront_theme_templates WHERE id = 'layout-a'",
        )
        .get();
      if (existing) {
        sqlite.exec(
          `UPDATE storefront_theme_templates SET draft_revision_id = '${revisionId}', draft_generation = draft_generation + 1 WHERE id = 'layout-a'`,
        );
      } else {
        sqlite.exec(`
          INSERT INTO storefront_theme_templates
            (id, theme_id, type, name, document, draft_revision_id, created_at, updated_at)
          VALUES
            ('layout-a', 'theme-a', 'layout', 'Layout', '{"version":1,"sections":[]}',
             '${revisionId}', 'now', 'now');
        `);
      }
    }
    const publish = (expectedSharedLayoutRevisionId: string | null) =>
      storefrontThemeDal.publishTemplate({
        readSourceRevisionFiles: workspaceRevisionFiles,
        verifySourceRevision: acceptRevision,
        ...scopeIds,
        sourceRevisionId: SOURCE_REVISION,
        themeBuildId: BUILD,
        expectedDraftRevisionId: PAGE_REVISION,
        expectedDraftGeneration: 1,
        expectedReleaseGeneration: 1,
        expectedSharedLayoutRevisionId,
      });

    it("no layout pending: reads this page only, and publishes leaving no layout behind", async () => {
      seedPage();
      await expect(
        storefrontThemeDal.findPublishScope(scopeIds),
      ).resolves.toEqual({ sharedLayout: null, layout: null });
      await expect(publish(null)).resolves.toMatchObject({
        releaseCreated: true,
      });
    });

    it("a layout never published and with no draft yet: reads as going live with the page", async () => {
      seedPage();
      sqlite.exec(`
        INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, draft_revision_id, created_at, updated_at)
        VALUES
          ('layout-a', 'theme-a', 'layout', 'Layout', '{"version":1,"sections":[]}',
           NULL, 'now', 'now');
      `);
      // The editor's publish writes its first draft and the publish seals it.
      await expect(
        storefrontThemeDal.findPublishScope(scopeIds),
      ).resolves.toEqual({
        sharedLayout: null,
        layout: {
          templateId: "layout-a",
          draftRevisionId: null,
          firstPublish: true,
        },
      });
    });

    it("refuses to answer for a template another storefront owns", async () => {
      seedPage();
      seedLayoutDraft(LAYOUT_REVISION);
      await expect(
        storefrontThemeDal.findPublishScope({
          ...scopeIds,
          storefrontId: "other-store",
        }),
      ).resolves.toBeNull();
    });

    it("a layout pending: names its draft, and the confirmed publish seals it", async () => {
      seedPage();
      seedLayoutDraft(LAYOUT_REVISION);
      const scope = await storefrontThemeDal.findPublishScope(scopeIds);
      expect(scope).toEqual({
        sharedLayout: { templateId: "layout-a", revisionId: LAYOUT_REVISION },
        layout: {
          templateId: "layout-a",
          draftRevisionId: LAYOUT_REVISION,
          firstPublish: false,
        },
      });
      await expect(
        publish(scope!.sharedLayout!.revisionId),
      ).resolves.toMatchObject({ releaseCreated: true });
      expect(layoutRow()).toEqual({
        draft: LAYOUT_REVISION,
        published: LAYOUT_REVISION,
      });
      // Sealed, so the next confirmation is this page only again.
      await expect(
        storefrontThemeDal.findPublishScope(scopeIds),
      ).resolves.toEqual({
        sharedLayout: null,
        layout: {
          templateId: "layout-a",
          draftRevisionId: LAYOUT_REVISION,
          firstPublish: false,
        },
      });
    });

    it.each([
      {
        name: "a layout became pending after the confirmation showed this page only",
        arrange: () => seedLayoutDraft(LAYOUT_REVISION),
        shown: null,
      },
      {
        name: "the pending layout changed after the confirmation named it",
        arrange: () => {
          seedLayoutDraft(LAYOUT_REVISION);
          seedLayoutDraft(NEWER_LAYOUT_REVISION, 2);
        },
        shown: LAYOUT_REVISION,
      },
    ])(
      "scope changed before confirm ($name): refused, nothing written",
      async ({ arrange, shown }) => {
        seedPage();
        arrange();
        const before = {
          releases: tableCount("storefront_releases"),
          publications: tableCount("storefront_content_publications"),
          layout: layoutRow(),
        };
        await expect(publish(shown)).rejects.toThrow(PUBLISH_SCOPE_CHANGED);
        expect({
          releases: tableCount("storefront_releases"),
          publications: tableCount("storefront_content_publications"),
          layout: layoutRow(),
        }).toEqual(before);
        expect(
          sqlite
            .prepare(
              "SELECT active_release_id AS id FROM storefronts WHERE id = 'storefront-a'",
            )
            .get(),
        ).toEqual({ id: null });
      },
    );
  });

  it("reports what the Theme Worker already runs, read before this publish activates anything", async () => {
    // The decision to skip a redeploy depends on the release that was active
    // *before* this publish. Reading it afterwards would always find the new
    // release, whose deployment record is necessarily empty, so a content-only
    // publish would redeploy the build the Worker is already serving.
    const draftDocument = JSON.stringify({
      version: 1,
      sections: [{ id: "hero", type: "hero", enabled: true, props: {} }],
    });
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, created_at, updated_at)
      VALUES
        ('template-a', 'theme-a', 'index', 'Home', '{"version":1,"sections":[]}',
         '11111111-1111-4111-8111-111111111111', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'template-a', 1,
         '${draftDocument.replaceAll("'", "''")}', 'now');
      INSERT INTO storefront_theme_revisions
        (id, storefront_id, theme_id, revision_number, message, source, snapshot, created_at, updated_at)
      VALUES
        ('22222222-2222-4222-8222-222222222222', 'storefront-a', 'theme-a', 1,
         'Frozen checkpoint', 'publish', '[]', 'now', 'now');
      INSERT INTO storefront_releases
        (id, storefront_id, theme_id, source_revision_id, theme_build_id, status,
         metadata, created_at, updated_at)
      VALUES
        ('44444444-4444-4444-8444-444444444444', 'storefront-a', 'theme-a',
         '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333',
         'available', '{"deployedThemeBuildId":"33333333-3333-4333-8333-333333333333"}',
         'now', 'now');
      UPDATE storefronts SET active_release_id = '44444444-4444-4444-8444-444444444444'
        WHERE id = 'storefront-a';
    `);

    const res = await storefrontThemeDal.publishTemplate({
      readSourceRevisionFiles: workspaceRevisionFiles,
      verifySourceRevision: acceptRevision,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-a",
      sourceRevisionId: "22222222-2222-4222-8222-222222222222",
      themeBuildId: "33333333-3333-4333-8333-333333333333",
      expectedDraftRevisionId: "11111111-1111-4111-8111-111111111111",
      expectedDraftGeneration: 1,
      expectedReleaseGeneration: 1,
    });

    expect(res?.previousDeployedThemeBuildId).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(res?.themeBuildId).toBe("33333333-3333-4333-8333-333333333333");
  });

  it("reports no deployed build when the previously active release never recorded one", async () => {
    // A deployment can fail after its release is activated, so activation is
    // not evidence. Without a record the caller must deploy.
    const draftDocument = JSON.stringify({ version: 1, sections: [] });
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, created_at, updated_at)
      VALUES
        ('template-a', 'theme-a', 'index', 'Home', '{"version":1,"sections":[]}',
         '11111111-1111-4111-8111-111111111111', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'template-a', 1,
         '${draftDocument.replaceAll("'", "''")}', 'now');
      INSERT INTO storefront_theme_revisions
        (id, storefront_id, theme_id, revision_number, message, source, snapshot, created_at, updated_at)
      VALUES
        ('22222222-2222-4222-8222-222222222222', 'storefront-a', 'theme-a', 1,
         'Frozen checkpoint', 'publish', '[]', 'now', 'now');
      INSERT INTO storefront_releases
        (id, storefront_id, theme_id, source_revision_id, theme_build_id, status,
         created_at, updated_at)
      VALUES
        ('44444444-4444-4444-8444-444444444444', 'storefront-a', 'theme-a',
         '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333',
         'available', 'now', 'now');
      UPDATE storefronts SET active_release_id = '44444444-4444-4444-8444-444444444444'
        WHERE id = 'storefront-a';
    `);

    const res = await storefrontThemeDal.publishTemplate({
      readSourceRevisionFiles: workspaceRevisionFiles,
      verifySourceRevision: acceptRevision,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-a",
      sourceRevisionId: "22222222-2222-4222-8222-222222222222",
      themeBuildId: "33333333-3333-4333-8333-333333333333",
      expectedDraftRevisionId: "11111111-1111-4111-8111-111111111111",
      expectedDraftGeneration: 1,
      expectedReleaseGeneration: 1,
    });

    expect(res?.previousDeployedThemeBuildId).toBeNull();
  });

  it("publishes explicit source revision snapshot and binds it to published_source_revision_id", async () => {
    const draftDocument = JSON.stringify({
      version: 1,
      sections: [{ id: "hero", type: "hero", enabled: true, props: {} }],
    });
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, created_at, updated_at)
      VALUES
        ('template-a', 'theme-a', 'index', 'Home', '{"version":1,"sections":[]}',
         '11111111-1111-4111-8111-111111111111', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'template-a', 1,
         '${draftDocument.replaceAll("'", "''")}', 'now');
      INSERT INTO storefront_theme_revisions
        (id, storefront_id, theme_id, revision_number, message, source, snapshot, created_at, updated_at)
      VALUES
        ('22222222-2222-4222-8222-222222222222', 'storefront-a', 'theme-a', 1,
         'Frozen checkpoint', 'publish', '[]', 'now', 'now');
    `);

    const res = await storefrontThemeDal.publishTemplate({
      readSourceRevisionFiles: workspaceRevisionFiles,
      verifySourceRevision: acceptRevision,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-a",
      sourceRevisionId: "22222222-2222-4222-8222-222222222222",
      themeBuildId: "33333333-3333-4333-8333-333333333333",
      expectedDraftRevisionId: "11111111-1111-4111-8111-111111111111",
      expectedDraftGeneration: 1,
      expectedReleaseGeneration: 1,
    });

    expect(res).toMatchObject({
      revisionId: "11111111-1111-4111-8111-111111111111",
      sourceRevisionId: "22222222-2222-4222-8222-222222222222",
      draftGeneration: 2,
      releaseGeneration: 2,
      templateUnchanged: false,
      sourceUnchanged: false,
      unchanged: false,
      releaseCreated: true,
    });
    // The activated release id must reach the caller so the Theme Worker for it
    // can be deployed; without it publishing would silently skip deployment.
    expect(res!.releaseId).toEqual(expect.any(String));

    const theme = sqlite
      .prepare(
        "SELECT published_source_revision_id, release_generation FROM storefront_themes WHERE id = ?",
      )
      .get("theme-a") as {
      published_source_revision_id: string | null;
      release_generation: number;
    };
    expect(theme.published_source_revision_id).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(theme.release_generation).toBe(2);
  });

  it("aborts and throws when CAS guard fails on invalid source revision or mismatched expectedReleaseGeneration", async () => {
    const draftDocument = JSON.stringify({
      version: 1,
      sections: [{ id: "hero", type: "hero", enabled: true, props: {} }],
    });
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, created_at, updated_at)
      VALUES
        ('template-a', 'theme-a', 'index', 'Home', '{"version":1,"sections":[]}',
         '11111111-1111-4111-8111-111111111111', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'template-a', 1,
         '${draftDocument.replaceAll("'", "''")}', 'now');
      INSERT INTO storefront_theme_revisions
        (id, storefront_id, theme_id, revision_number, message, source, snapshot, created_at, updated_at)
      VALUES
        ('22222222-2222-4222-8222-222222222222', 'storefront-a', 'theme-a', 1,
         'Frozen checkpoint', 'publish', '[]', 'now', 'now');
    `);

    // Non-existent sourceRevisionId should fail the CAS guard
    await expect(
      storefrontThemeDal.publishTemplate({
        readSourceRevisionFiles: workspaceRevisionFiles,
        verifySourceRevision: acceptRevision,
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-a",
        sourceRevisionId: "99999999-9999-4999-8999-999999999999",
        themeBuildId: "33333333-3333-4333-8333-333333333333",
        expectedDraftRevisionId: "11111111-1111-4111-8111-111111111111",
        expectedDraftGeneration: 1,
        expectedReleaseGeneration: 1,
      }),
    ).rejects.toThrow();

    // Mismatched expectedReleaseGeneration should fail the CAS guard with RELEASE_GENERATION_CONFLICT
    await expect(
      storefrontThemeDal.publishTemplate({
        readSourceRevisionFiles: workspaceRevisionFiles,
        verifySourceRevision: acceptRevision,
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-a",
        sourceRevisionId: "22222222-2222-4222-8222-222222222222",
        themeBuildId: "33333333-3333-4333-8333-333333333333",
        expectedDraftRevisionId: "11111111-1111-4111-8111-111111111111",
        expectedDraftGeneration: 1,
        expectedReleaseGeneration: 99,
      }),
    ).rejects.toThrow("RELEASE_GENERATION_CONFLICT");
  });

  it("returns null when expectedDraftRevisionId does not match template", async () => {
    const draftDocument = JSON.stringify({
      version: 1,
      sections: [{ id: "hero", type: "hero", enabled: true, props: {} }],
    });
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, created_at, updated_at)
      VALUES
        ('template-a', 'theme-a', 'index', 'Home', '{"version":1,"sections":[]}',
         '11111111-1111-4111-8111-111111111111', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'template-a', 1,
         '${draftDocument.replaceAll("'", "''")}', 'now');
      INSERT INTO storefront_theme_revisions
        (id, storefront_id, theme_id, revision_number, message, source, snapshot, created_at, updated_at)
      VALUES
        ('22222222-2222-4222-8222-222222222222', 'storefront-a', 'theme-a', 1,
         'Frozen checkpoint', 'publish', '[]', 'now', 'now');
    `);

    await expect(
      storefrontThemeDal.publishTemplate({
        readSourceRevisionFiles: workspaceRevisionFiles,
        verifySourceRevision: acceptRevision,
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-a",
        sourceRevisionId: "22222222-2222-4222-8222-222222222222",
        themeBuildId: "33333333-3333-4333-8333-333333333333",
        expectedDraftRevisionId: "33333333-3333-4333-8333-333333333333",
        expectedDraftGeneration: 1,
        expectedReleaseGeneration: 1,
      }),
    ).resolves.toBeNull();
  });

  it.each(["unchanged", "before-read", "during-write"])("checks a preselected loader field source baseline: %s", async (mode) => {
    // The actual DAL and persisted draft, not a mocked successful response.
    const original = { version: 1, sections: [{
      id: "hero", type: "hero", componentRef: "src/components/Hero.tsx", enabled: true,
      props: { title: "Original title", subtitle: "Original subtitle" },
    }] };
    const component = `export const contentFields = {
      title: { type: "text", label: "Title" },
      subtitle: { type: "text", label: "Subtitle" },
    };
    export default function Hero({ title, subtitle }) { return <h1>{title}</h1>; }`;
    const route = `import { createFileRoute } from "@tanstack/react-router";
      import { createServerFn } from "@tanstack/react-start";
      import { morph } from "../morph/content";
      import Hero from "../components/Hero";
      const getHome = createServerFn().handler(() => morph.pages.get("/"));
      export const Route = createFileRoute("/")({ loader: () => getHome(), component: Home });
      function Home() { const { hero } = Route.useLoaderData(); return <main><Hero {...hero} /></main>; }`;
    const insert = sqlite.prepare(`INSERT INTO storefront_theme_files
      (id, storefront_id, theme_id, path, content, version, created_at, updated_at)
      VALUES (?, 'storefront-a', 'theme-a', ?, ?, 1, 'now', 'now')`);
    for (const [path, content] of [
      ["morph.theme.json", "{}"],
      ["src/routes/__root.tsx", 'import { Outlet, createRootRoute } from "@tanstack/react-router"; export const Route = createRootRoute({ component: Root }); function Root() { return <Outlet />; }'],
      ["src/routes/index.tsx", route],
      ["src/components/Hero.tsx", component],
      ["src/morph/content.ts", "export const morph = { pages: { get: async () => ({}) } };"],
    ]) insert.run(`diagnostic-${path}`, path, content);
    sqlite.prepare(`INSERT INTO storefront_theme_templates
      (id, theme_id, type, name, document, draft_revision_id, published_revision_id, created_at, updated_at)
      VALUES ('template-stale-source', 'theme-a', 'index', 'Home', ?,
        '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'now', 'now')`)
      .run(JSON.stringify(original));
    sqlite.prepare(`INSERT INTO storefront_theme_template_revisions
      (id, template_id, version, document, created_at)
      VALUES ('11111111-1111-4111-8111-111111111111', 'template-stale-source', 1, ?, 'now')`)
      .run(JSON.stringify(original));
    const staleRequest = {
      storefrontId: "storefront-a", themeId: "theme-a", templateId: "template-stale-source",
      sectionId: "hero", props: { title: "Typed from old selection" },
      expectedDraftGeneration: 1, expectedSourceGeneration: 1, createdBy: "user-1", routePath: "/",
    };
    const changeSource = () => {
      // Same declared fields and stored content; only the displayed source
      // changes from title to subtitle after the old title was selected.
      sqlite.prepare(`UPDATE storefront_theme_files SET content = ?, version = 2
        WHERE theme_id = 'theme-a' AND path = 'src/components/Hero.tsx'`)
        .run(component.replace("<h1>{title}</h1>", "<h1>{subtitle}</h1>"));
      sqlite.exec("UPDATE storefront_themes SET source_generation = 2 WHERE id = 'theme-a'");
    };
    if (mode === "before-read") changeSource();
    if (mode === "during-write") {
      const batch = workerEnv.DATABASE.batch.bind(workerEnv.DATABASE);
      vi.spyOn(workerEnv.DATABASE, "batch").mockImplementationOnce(async (statements) => {
        changeSource();
        return batch(statements);
      });
    }
    expect(sqlite.prepare("SELECT draft_generation AS generation FROM storefront_theme_templates WHERE id = 'template-stale-source'").get())
      .toEqual({ generation: 1 });
    if (mode !== "unchanged") {
      await expect(storefrontThemeDal.updateSectionProps(staleRequest)).rejects.toThrow("SELECTION_SOURCE_CONFLICT");
      const unchanged = sqlite.prepare(`SELECT r.document, t.draft_generation AS generation
        FROM storefront_theme_templates t JOIN storefront_theme_template_revisions r ON r.id = t.draft_revision_id
        WHERE t.id = 'template-stale-source'`).get() as { document: string; generation: number };
      expect(JSON.parse(unchanged.document)).toEqual(original);
      expect(unchanged.generation).toBe(1);
      expect(sqlite.prepare("SELECT COUNT(*) AS count FROM storefront_theme_template_revisions WHERE template_id = 'template-stale-source'").get()).toEqual({count: 1});
      return;
    }
    const result = await storefrontThemeDal.updateSectionProps(staleRequest);
    expect(result).not.toBeNull();
    expect(result?.droppedProps).toEqual([]);
    const row = sqlite.prepare(`SELECT r.document, t.draft_generation AS generation
      FROM storefront_theme_templates t JOIN storefront_theme_template_revisions r ON r.id = t.draft_revision_id
      WHERE t.id = 'template-stale-source'`).get() as { document: string; generation: number };
    expect(row.generation).toBe(2);
    expect(JSON.parse(row.document).sections[0].props).toEqual({ title: "Typed from old selection", subtitle: "Original subtitle" });
    expect(sqlite.prepare("SELECT source_generation AS generation FROM storefront_themes WHERE id = 'theme-a'").get())
      .toEqual({ generation: 1 });
    const next = await storefrontThemeDal.updateSectionProps({
      ...staleRequest, expectedDraftGeneration: 2, props: {title: "Second own save"} });
    expect(next?.draftGeneration).toBe(3);
    const latest = sqlite.prepare(`SELECT r.document FROM storefront_theme_templates t
      JOIN storefront_theme_template_revisions r ON r.id = t.draft_revision_id
      WHERE t.id = 'template-stale-source'`).get() as {document: string};
    expect(JSON.parse(latest.document).sections[0].props.title).toBe("Second own save");
  });

  it("updateSectionProps returns draftRevisionId along with version and document", async () => {
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, published_revision_id, created_at, updated_at)
      VALUES
        ('template-a', 'theme-a', 'index', 'Home', '{"version":1,"sections":[{"id":"hero","type":"hero","enabled":true,"props":{"title":"Original"}}]}',
         '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'template-a', 1,
         '{"version":1,"sections":[{"id":"hero","type":"hero","enabled":true,"props":{"title":"Original"}}]}', 'now');
    `);

    const result = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-a",
      sectionId: "hero",
      props: { title: "Updated Title" },
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    expect(result).not.toBeNull();
    expect(result?.draftRevisionId).toBeDefined();
    expect(typeof result?.draftRevisionId).toBe("string");
    expect(result?.version).toBe(2);
    expect(result?.document.sections[0].props.title).toBe("Updated Title");
  });

  /**
   * A click on content the editor cannot place in a Document section — for
   * one, a component handed `{...hero}` from a loader whose handler changes
   * what it read, so the slot is not proven — resolves to that component's own
   * root, identified by its source file (loader-data-binding.live.test.ts).
   * Sent here, that id must write nothing: not the Document's `hero`, and no
   * new revision.
   */
  it("updateSectionProps writes nothing for a section id the Document does not have", async () => {
    const document =
      '{"version":1,"sections":[{"id":"hero","type":"hero","enabled":true,"props":{"title":"Original"}}]}';
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, published_revision_id, created_at, updated_at)
      VALUES
        ('template-unknown', 'theme-a', 'index', 'Home', '${document}',
         '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'template-unknown', 1, '${document}', 'now');
    `);

    const result = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-unknown",
      sectionId: "src/components/Hero.tsx",
      props: { title: "Edited" },
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    expect(result).toBeNull();
    const stored = sqlite
      .prepare(
        "SELECT document, draft_revision_id AS draft FROM storefront_theme_templates WHERE id = 'template-unknown'",
      )
      .get() as { document: string; draft: string };
    expect(JSON.parse(stored.document)).toEqual(JSON.parse(document));
    expect(stored.draft).toBe("11111111-1111-4111-8111-111111111111");
    const revisions = sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM storefront_theme_template_revisions WHERE template_id = 'template-unknown'",
      )
      .get() as { count: number };
    expect(revisions.count).toBe(1);
  });

  /**
   * A name is the editor's label for one placement, not content. It is stored
   * beside `props` because `props` is spread into the component and travels to
   * every visitor — and a component may declare a content field of its own
   * called `name`.
   */
  it("renameSection stores the name beside props and leaves props alone", async () => {
    const document =
      '{"version":1,"sections":[{"id":"hero","type":"hero","enabled":true,"props":{"title":"Original"}}]}';
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, published_revision_id, created_at, updated_at)
      VALUES
        ('template-rn', 'theme-a', 'index', 'Home', '${document}',
         '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'template-rn', 1, '${document}', 'now');
    `);

    const renamed = await storefrontThemeDal.renameSection({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-rn",
      sectionId: "hero",
      name: "Brand story",
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    expect(renamed?.document.sections[0]?.name).toBe("Brand story");
    expect(renamed?.document.sections[0]?.props).toEqual({
      title: "Original",
    });
    // Never inside props, which is what reaches the component and the visitor.
    expect(renamed?.document.sections[0]?.props).not.toHaveProperty("name");

    // Clearing restores the derived name rather than storing an empty one.
    const cleared = await storefrontThemeDal.renameSection({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-rn",
      sectionId: "hero",
      name: null,
      expectedDraftGeneration: renamed!.draftGeneration,
      createdBy: "user-1",
    });
    expect(cleared?.document.sections[0]).not.toHaveProperty("name");
  });

  it("renameSection refuses a section the template does not have", async () => {
    const document = '{"version":1,"sections":[]}';
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, published_revision_id, created_at, updated_at)
      VALUES
        ('template-rn2', 'theme-a', 'index', 'Home', '${document}',
         '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'now', 'now');
    `);

    await expect(
      storefrontThemeDal.renameSection({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-rn2",
        sectionId: "nope",
        name: "Anything",
        expectedDraftGeneration: 1,
        createdBy: "user-1",
      }),
    ).resolves.toBeNull();
  });

  /**
   * Design judges every section write against Start source. A Theme of
   * another framework has none of it (an Astro Theme's pages are `.astro`),
   * so its writes would fall into the legacy path that lets the stored
   * Document stand in for the source. They are refused before the files are
   * read; a Theme recorded before frameworks were (NULL) is Start and keeps
   * the legacy path, as the tests above show.
   */
  describe("a Theme of a framework Design cannot judge yet", () => {
    const document =
      '{"version":1,"sections":[{"id":"hero","type":"hero","enabled":true,"props":{"title":"Original"}}]}';
    const seed = (templateId: string, framework: string) =>
      sqlite.exec(`
        UPDATE storefront_themes SET framework = '${framework}' WHERE id = 'theme-a';
        INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, draft_revision_id, published_revision_id, created_at, updated_at)
        VALUES
          ('${templateId}', 'theme-a', 'index', 'Home', '${document}',
           '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'now', 'now');
        INSERT INTO storefront_theme_template_revisions
          (id, template_id, version, document, created_at)
        VALUES
          ('11111111-1111-4111-8111-111111111111', '${templateId}', 1, '${document}', 'now');
      `);
    const stored = (templateId: string) => {
      const row = sqlite
        .prepare(
          `SELECT document, draft_revision_id AS draft FROM storefront_theme_templates WHERE id = '${templateId}'`,
        )
        .get() as { document: string; draft: string };
      const revisions = sqlite
        .prepare(
          `SELECT COUNT(*) AS count FROM storefront_theme_template_revisions WHERE template_id = '${templateId}'`,
        )
        .get() as { count: number };
      return {
        document: JSON.parse(row.document),
        draft: row.draft,
        revisions: revisions.count,
      };
    };
    const unchanged = (templateId: string) =>
      expect(stored(templateId)).toEqual({
        document: JSON.parse(document),
        draft: "11111111-1111-4111-8111-111111111111",
        revisions: 1,
      });

    // Since M2 C5 an Astro write is judged by Core's own proof
    // (storefront-theme.dal.astro.test.ts); one that carries no instance
    // identity, as every write before v2 did, is refused before any source
    // is read, and nothing is written.
    it("refuses an Astro section write without an instance identity, and writes nothing", async () => {
      seed("template-astro-props", "astro");
      await expect(
        storefrontThemeDal.updateSectionProps({
          expectedSourceGeneration: 1,
          storefrontId: "storefront-a",
          themeId: "theme-a",
          templateId: "template-astro-props",
          sectionId: "hero",
          props: { title: "Edited" },
          expectedDraftGeneration: 1,
          createdBy: "user-1",
        }),
      ).rejects.toThrow(/^SECTION_SOURCE_UNCONFIRMABLE: preview-identity-legacy: /);
      unchanged("template-astro-props");
    });

    it("refuses a reorder and a rename on an Astro Theme, and writes nothing", async () => {
      seed("template-astro-structure", "astro");
      await expect(
        storefrontThemeDal.reorderSections({
          storefrontId: "storefront-a",
          themeId: "theme-a",
          templateId: "template-astro-structure",
          sectionIds: ["hero"],
          expectedDraftGeneration: 1,
          createdBy: "user-1",
        }),
      ).resolves.toBeNull();
      await expect(
        storefrontThemeDal.renameSection({
          storefrontId: "storefront-a",
          themeId: "theme-a",
          templateId: "template-astro-structure",
          sectionId: "hero",
          name: "Brand story",
          expectedDraftGeneration: 1,
          createdBy: "user-1",
        }),
      ).resolves.toBeNull();
      unchanged("template-astro-structure");
    });

    // Since M2 C5 an Astro Theme's route documents are judged by its own
    // pages (storefront-theme.dal.astro.test.ts); one with no page at the
    // path is refused, and nothing is created.
    it("refuses a route document an Astro Theme has no page for, and creates nothing", async () => {
      sqlite.exec(
        "UPDATE storefront_themes SET framework = 'astro' WHERE id = 'theme-a'",
      );
      const result = await storefrontThemeDal.ensureRouteTemplate({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        routePath: "/about",
      });
      expect(result).toEqual({
        ok: false,
        reason: "/about is not a page in the saved Theme source.",
      });
      expect(
        sqlite
          .prepare("SELECT COUNT(*) AS count FROM storefront_theme_templates")
          .get(),
      ).toEqual({ count: 0 });
    });

    it("still refuses a route document on a Theme of a framework Morph does not know", async () => {
      sqlite.exec(
        "UPDATE storefront_themes SET framework = 'next' WHERE id = 'theme-a'",
      );
      const result = await storefrontThemeDal.ensureRouteTemplate({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        routePath: "/about",
      });
      expect(result).toEqual({
        ok: false,
        reason: expect.stringMatching(/Design cannot change next Themes yet/),
      });
    });

    it("still writes a Theme that records TanStack Start", async () => {
      seed("template-start-props", "tanstack-start");
      const result = await storefrontThemeDal.updateSectionProps({
        expectedSourceGeneration: 1,
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-start-props",
        sectionId: "hero",
        props: { title: "Updated Title" },
        expectedDraftGeneration: 1,
        createdBy: "user-1",
      });
      expect(result?.document.sections[0].props.title).toBe("Updated Title");
    });
  });

  it("strictly filters out presentation styling props and keeps only content fields", async () => {
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, published_revision_id, created_at, updated_at)
      VALUES
        ('template-c', 'theme-a', 'index', 'Home', '{"version":1,"sections":[{"id":"hero-1","type":"hero","enabled":true,"props":{"heading":"Welcome"}}]}',
         '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'template-c', 1,
         '{"version":1,"sections":[{"id":"hero-1","type":"hero","enabled":true,"props":{"heading":"Welcome"}}]}', 'now');
    `);

    const result = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-c",
      sectionId: "hero-1",
      props: {
        heading: "New Heading",
        description: "New Description",
        fontSize: 80,
        padding: 100,
        backgroundColor: "#ff0000",
        className: "custom-hero",
      },
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    expect(result).not.toBeNull();
    const heroProps = result?.document.sections[0].props as any;
    expect(heroProps.heading).toBe("New Heading");
    expect(heroProps.description).toBe("New Description");
    // Presentation styling props must be stripped
    expect(heroProps.fontSize).toBeUndefined();
    expect(heroProps.padding).toBeUndefined();
    expect(heroProps.backgroundColor).toBeUndefined();
    expect(heroProps.className).toBeUndefined();
    // And the caller is told which of its values went nowhere.
    expect(result?.droppedProps).toEqual([
      "fontSize",
      "padding",
      "backgroundColor",
      "className",
    ]);
  });

  it("reports a changed undeclared value as dropped, not one carried unchanged", async () => {
    // What a tab sends after another tab deleted the declaration it edits
    // from: the whole section, its runtime data unchanged, and a new value
    // for a field the source no longer declares.
    const stored =
      '{"version":1,"sections":[{"id":"hero-1","type":"hero","enabled":true,"props":{"heading":"Welcome","runtimeLinks":[{"id":"row-1","href":"/a"}],"retiredField":"Old"}}]}';
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, published_revision_id, created_at, updated_at)
      VALUES
        ('template-dropped', 'theme-a', 'index', 'Home', '${stored}',
         '55555555-5555-4555-8555-555555555555', '55555555-5555-4555-8555-555555555555', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('55555555-5555-4555-8555-555555555555', 'template-dropped', 1, '${stored}', 'now');
    `);

    const result = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-dropped",
      sectionId: "hero-1",
      props: {
        heading: "Welcome back",
        runtimeLinks: [{ id: "row-1", href: "/a" }],
        retiredField: "Stale edit",
      },
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    const props = result?.document.sections[0].props as Record<string, unknown>;
    expect(props.heading).toBe("Welcome back");
    expect(props.runtimeLinks).toEqual([{ id: "row-1", href: "/a" }]);
    expect(props.retiredField).toBe("Old");
    expect(result?.droppedProps).toEqual(["retiredField"]);
  });

  it("supports componentRef manifest (e.g. hero.video) and allows variant-specific content fields", async () => {
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, published_revision_id, created_at, updated_at)
      VALUES
        ('template-video', 'theme-a', 'index', 'Home', '{"version":1,"sections":[{"id":"hero-vid","type":"hero","componentRef":"hero.video","enabled":true,"props":{"heading":"Watch Video"}}]}',
         '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('22222222-2222-4222-8222-222222222222', 'template-video', 1,
         '{"version":1,"sections":[{"id":"hero-vid","type":"hero","componentRef":"hero.video","enabled":true,"props":{"heading":"Watch Video"}}]}', 'now');
    `);

    const result = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-video",
      sectionId: "hero-vid",
      props: {
        heading: "Hero Video Title",
        videoSrc: "https://example.com/video.mp4",
        posterSrc: "https://example.com/poster.jpg",
        autoplay: true,
        animation: "slide-up",
        fontSize: 48,
        width: 1200,
      },
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    expect(result).not.toBeNull();
    const props = result?.document.sections[0].props as any;
    // Allowed video content fields
    expect(props.heading).toBe("Hero Video Title");
    expect(props.videoSrc).toBe("https://example.com/video.mp4");
    expect(props.posterSrc).toBe("https://example.com/poster.jpg");
    expect(props.autoplay).toBe(true);
    // Presentation styling props must be stripped
    expect(props.animation).toBeUndefined();
    expect(props.fontSize).toBeUndefined();
    expect(props.width).toBeUndefined();
  });

  it("persists custom content when an older draft is missing componentRef", async () => {
    const themeManifest = JSON.stringify({
      components: {
        "promo.default": {
          source: "src/components/Promo.tsx",
          sectionType: "promo",
          contentFields: {
            heading: { type: "text", label: "Heading", maxLength: 80 },
            href: { type: "url", label: "Link" },
          },
        },
      },
      sections: {
        promo: {
          componentRef: "promo.default",
          source: "src/components/Promo.tsx",
        },
      },
    }).replaceAll("'", "''");
    sqlite.exec(`
      INSERT INTO storefront_theme_files
        (id, storefront_id, theme_id, path, content, mime_type, version, created_at, updated_at)
      VALUES
        ('manifest-custom', 'storefront-a', 'theme-a', 'morph.theme.json',
         '${themeManifest}', 'application/json', 1, 'now', 'now');
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, published_revision_id, created_at, updated_at)
      VALUES
        ('template-promo', 'theme-a', 'index', 'Home',
         '{"version":1,"sections":[{"id":"promo-1","type":"promo","enabled":true,"props":{"campaignId":"campaign-1"}}]}',
         '66666666-6666-4666-8666-666666666666', '66666666-6666-4666-8666-666666666666', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('66666666-6666-4666-8666-666666666666', 'template-promo', 1,
         '{"version":1,"sections":[{"id":"promo-1","type":"promo","enabled":true,"props":{"campaignId":"campaign-1"}}]}', 'now');
    `);

    const result = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-promo",
      sectionId: "promo-1",
      props: {
        heading: "A thoughtful default",
        href: "/collections/new",
        className: "fixed inset-0",
      },
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    expect(result).not.toBeNull();
    expect(result?.document.sections[0].componentRef).toBe("promo.default");
    expect(result?.document.sections[0].props).toEqual({
      campaignId: "campaign-1",
      heading: "A thoughtful default",
      href: "/collections/new",
    });

    const stored = sqlite
      .prepare(
        "SELECT document FROM storefront_theme_template_revisions WHERE id = ?",
      )
      .get(result?.draftRevisionId) as { document: string };
    expect(JSON.parse(stored.document).sections[0].props).toEqual({
      campaignId: "campaign-1",
      heading: "A thoughtful default",
      href: "/collections/new",
    });
  });

  it("fails closed when custom manifest content values violate their declaration", async () => {
    const themeManifest = JSON.stringify({
      components: {
        "promo.default": {
          source: "src/components/Promo.tsx",
          contentFields: {
            heading: { type: "text", maxLength: 20 },
          },
        },
      },
    }).replaceAll("'", "''");
    sqlite.exec(`
      INSERT INTO storefront_theme_files
        (id, storefront_id, theme_id, path, content, mime_type, version, created_at, updated_at)
      VALUES
        ('manifest-invalid-value', 'storefront-a', 'theme-a', 'morph.theme.json',
         '${themeManifest}', 'application/json', 1, 'now', 'now');
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, published_revision_id, created_at, updated_at)
      VALUES
        ('template-promo-invalid', 'theme-a', 'index', 'Home',
         '{"version":1,"sections":[{"id":"promo-invalid","type":"promo","componentRef":"promo.default","enabled":true,"props":{}}]}',
         '77777777-7777-4777-8777-777777777777', '77777777-7777-4777-8777-777777777777', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('77777777-7777-4777-8777-777777777777', 'template-promo-invalid', 1,
         '{"version":1,"sections":[{"id":"promo-invalid","type":"promo","componentRef":"promo.default","enabled":true,"props":{}}]}', 'now');
    `);

    await expect(
      storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-promo-invalid",
        sectionId: "promo-invalid",
        props: { heading: "This heading is longer than twenty characters" },
        expectedDraftGeneration: 1,
        createdBy: "user-1",
      }),
    ).rejects.toThrow("INVALID_THEME_CONTENT_FIELD_VALUE:heading");

    const template = sqlite
      .prepare(
        "SELECT draft_generation FROM storefront_theme_templates WHERE id = ?",
      )
      .get("template-promo-invalid") as { draft_generation: number };
    expect(template.draft_generation).toBe(1);
  });

  it("strictly rejects styling/presentation props on unknown componentRef", async () => {
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, published_revision_id, created_at, updated_at)
      VALUES
        ('template-unknown', 'theme-a', 'index', 'Home', '{"version":1,"sections":[{"id":"custom-1","type":"custom","componentRef":"custom.experimental","enabled":true,"props":{}}]}',
         '33333333-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('33333333-3333-4333-8333-333333333333', 'template-unknown', 1,
         '{"version":1,"sections":[{"id":"custom-1","type":"custom","componentRef":"custom.experimental","enabled":true,"props":{}}]}', 'now');
    `);

    const result = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-unknown",
      sectionId: "custom-1",
      props: {
        width: 1200,
        height: 800,
        position: "absolute",
        transform: "scale(1.2)",
        gridTemplateColumns: "1fr 1fr",
        animation: "fade-in",
      },
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    expect(result).not.toBeNull();
    const props = result?.document.sections[0].props as any;
    // Unknown componentRef must not accept arbitrary presentation props into D1
    expect(Object.keys(props)).toHaveLength(0);
  });

  /**
   * An unrecognised ref refuses the write without erasing what is stored.
   *
   * This used to assert that the section's props came back empty, which read
   * as one rule and was really two: refuse the incoming values, *and* drop the
   * ones already there. The first is the fail-closed boundary worth keeping —
   * a ref this Theme does not know cannot validate anything, so nothing the
   * client sent may be trusted. The second was an erasure: editing one word of
   * a section whose ref had drifted deleted everything else it held. Stored
   * content was validated when it was written and is not the client's claim to
   * re-check, so it stays.
   */
  it("refuses incoming props for an unrecognized componentRef without erasing stored ones", async () => {
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, published_revision_id, created_at, updated_at)
      VALUES
        ('template-unknown-hero', 'theme-a', 'index', 'Home', '{"version":1,"sections":[{"id":"hero-unregistered","type":"hero","componentRef":"hero.unregistered-custom","enabled":true,"props":{"heading":"Existing Heading"}}]}',
         '44444444-4444-4444-8444-444444444444', '44444444-4444-4444-8444-444444444444', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('44444444-4444-4444-8444-444444444444', 'template-unknown-hero', 1,
         '{"version":1,"sections":[{"id":"hero-unregistered","type":"hero","componentRef":"hero.unregistered-custom","enabled":true,"props":{"heading":"Existing Heading"}}]}', 'now');
    `);

    const result = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-unknown-hero",
      sectionId: "hero-unregistered",
      props: {
        heading: "Attempted New Heading",
        customProp: "not allowed",
      },
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    expect(result).not.toBeNull();
    const props = result?.document.sections[0].props as any;
    // Nothing the client sent got through: not the field the component would
    // have declared, and not the one it never would have.
    expect(props.heading).toBe("Existing Heading");
    expect(props.customProp).toBeUndefined();
    expect(Object.keys(props)).toEqual(["heading"]);
    // And the ref is still the one the document named — not resolved to
    // `hero.default` behind the author's back.
    expect(result?.document.sections[0].componentRef).toBe(
      "hero.unregistered-custom",
    );
  });

  it("preserves ALL starter template section content props across partial updates without data loss", async () => {
    // 1. Hero with eyebrow
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, published_revision_id, created_at, updated_at)
      VALUES
        ('template-starter', 'theme-a', 'index', 'Home',
         '{"version":1,"sections":[{"id":"hero-1","type":"hero","componentRef":"hero.default","enabled":true,"props":{"eyebrow":"New collection","heading":"Objects for everyday rituals.","description":"Quiet essentials.","actionLabel":"Explore","actionHref":"/collections/new","imageSrc":"/img.png","imageAlt":"Ceramics"}},{"id":"intro-1","type":"editorial-intro","enabled":true,"props":{"label":"Considered living","heading":"Fewer things. Better chosen.","body":"We bring together useful objects."}},{"id":"cat-1","type":"category-showcase","enabled":true,"props":{"heading":"Shop by ritual","items":[{"title":"Morning","caption":"Cups","href":"/morning","imageSrc":"/img.png","imageAlt":"Table","imagePosition":"30% center"}]}},{"id":"story-1","type":"image-with-text","enabled":true,"props":{"eyebrow":"Our point of view","heading":"Made to be kept.","body":"We look for objects that age gracefully.","actionLabel":"Read our story","actionHref":"/about","imageSrc":"/img.png","imageAlt":"Vase","imagePosition":"center center"}},{"id":"principles-1","type":"principles","enabled":true,"props":{"items":[{"number":"01","title":"Natural","body":"Tactile surfaces."}]}},{"id":"news-1","type":"newsletter","enabled":true,"props":{"eyebrow":"Notes from the studio","heading":"A quieter inbox.","body":"New objects.","placeholder":"Email address","actionLabel":"Subscribe"}}]}',
         '55555555-5555-4555-8555-555555555555', '55555555-5555-4555-8555-555555555555', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('55555555-5555-4555-8555-555555555555', 'template-starter', 1,
         '{"version":1,"sections":[{"id":"hero-1","type":"hero","componentRef":"hero.default","enabled":true,"props":{"eyebrow":"New collection","heading":"Objects for everyday rituals.","description":"Quiet essentials.","actionLabel":"Explore","actionHref":"/collections/new","imageSrc":"/img.png","imageAlt":"Ceramics"}},{"id":"intro-1","type":"editorial-intro","enabled":true,"props":{"label":"Considered living","heading":"Fewer things. Better chosen.","body":"We bring together useful objects."}},{"id":"cat-1","type":"category-showcase","enabled":true,"props":{"heading":"Shop by ritual","items":[{"title":"Morning","caption":"Cups","href":"/morning","imageSrc":"/img.png","imageAlt":"Table","imagePosition":"30% center"}]}},{"id":"story-1","type":"image-with-text","enabled":true,"props":{"eyebrow":"Our point of view","heading":"Made to be kept.","body":"We look for objects that age gracefully.","actionLabel":"Read our story","actionHref":"/about","imageSrc":"/img.png","imageAlt":"Vase","imagePosition":"center center"}},{"id":"principles-1","type":"principles","enabled":true,"props":{"items":[{"number":"01","title":"Natural","body":"Tactile surfaces."}]}},{"id":"news-1","type":"newsletter","enabled":true,"props":{"eyebrow":"Notes from the studio","heading":"A quieter inbox.","body":"New objects.","placeholder":"Email address","actionLabel":"Subscribe"}}]}', 'now');
    `);

    // Edit hero description -> eyebrow, heading, actionLabel, imageSrc MUST be preserved
    const heroResult = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-starter",
      sectionId: "hero-1",
      props: { description: "Updated hero description." },
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });
    const heroProps = heroResult?.document.sections.find(
      (s) => s.id === "hero-1",
    )?.props as any;
    expect(heroProps.eyebrow).toBe("New collection");
    expect(heroProps.heading).toBe("Objects for everyday rituals.");
    expect(heroProps.description).toBe("Updated hero description.");
    expect(heroProps.actionLabel).toBe("Explore");
    expect(heroProps.imageSrc).toBe("/img.png");

    // Edit editorial-intro heading -> label, body MUST be preserved
    const introResult = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-starter",
      sectionId: "intro-1",
      props: { heading: "New Intro Heading" },
      expectedDraftGeneration: 2,
      createdBy: "user-1",
    });
    const introProps = introResult?.document.sections.find(
      (s) => s.id === "intro-1",
    )?.props as any;
    expect(introProps.label).toBe("Considered living");
    expect(introProps.heading).toBe("New Intro Heading");
    expect(introProps.body).toBe("We bring together useful objects.");

    // Edit category-showcase heading -> items array MUST be preserved
    const catResult = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-starter",
      sectionId: "cat-1",
      props: { heading: "New Showcase Heading" },
      expectedDraftGeneration: 3,
      createdBy: "user-1",
    });
    const catProps = catResult?.document.sections.find((s) => s.id === "cat-1")
      ?.props as any;
    expect(catProps.heading).toBe("New Showcase Heading");
    expect(catProps.items).toHaveLength(1);
    expect(catProps.items[0].title).toBe("Morning");

    // Edit image-with-text actionLabel -> eyebrow, body, imagePosition MUST be preserved
    const storyResult = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-starter",
      sectionId: "story-1",
      props: { actionLabel: "Discover More" },
      expectedDraftGeneration: 4,
      createdBy: "user-1",
    });
    const storyProps = storyResult?.document.sections.find(
      (s) => s.id === "story-1",
    )?.props as any;
    expect(storyProps.eyebrow).toBe("Our point of view");
    expect(storyProps.heading).toBe("Made to be kept.");
    expect(storyProps.actionLabel).toBe("Discover More");
    expect(storyProps.imagePosition).toBe("center center");

    // Edit newsletter placeholder -> eyebrow, body, actionLabel MUST be preserved
    const newsResult = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-starter",
      sectionId: "news-1",
      props: { placeholder: "Your email here..." },
      expectedDraftGeneration: 5,
      createdBy: "user-1",
    });
    const newsProps = newsResult?.document.sections.find(
      (s) => s.id === "news-1",
    )?.props as any;
    expect(newsProps.eyebrow).toBe("Notes from the studio");
    expect(newsProps.heading).toBe("A quieter inbox.");
    expect(newsProps.body).toBe("New objects.");
    expect(newsProps.placeholder).toBe("Your email here...");
    expect(newsProps.actionLabel).toBe("Subscribe");
  });
});

describe("preparing an untouched template for its first publish", () => {
  const seedUntouched = () => {
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, created_at, updated_at)
      VALUES ('template-initial', 'theme-a', 'index', 'Home',
        '{"version":1,"sections":[{"id":"hero","type":"hero","enabled":true,"props":{"heading":"Existing default","navigation":[{"label":"Keep me"}]}}]}', 'now', 'now');
      INSERT INTO storefront_theme_revisions
        (id, storefront_id, theme_id, revision_number, source_generation, snapshot, created_at, updated_at)
      VALUES ('22222222-2222-4222-8222-222222222222', 'storefront-a', 'theme-a', 1, 1, '[]', 'now', 'now');
    `);
  };
  const prepare = (overrides = {}) =>
    storefrontThemeDal.prepareInitialTemplateDraft({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-initial",
      expectedDraftGeneration: 1,
      expectedSourceGeneration: 1,
      createdBy: "user-1",
      ...overrides,
    });

  it("publishes an untouched document through the existing revision and release path", async () => {
    seedUntouched();
    const before = await storefrontThemeDal.findEditorContext(
      "storefront-a",
      "theme-a",
    );
    expect(before?.templates[0]?.draftRevisionId).toBeNull();
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM storefront_theme_template_revisions",
        )
        .get(),
    ).toEqual({ n: 0 });
    const draft = await prepare();
    expect(draft).not.toBeNull();
    expect(draft?.document).toEqual(before?.templates[0]?.document);
    const result = await storefrontThemeDal.publishTemplate({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-initial",
      // A first publish names the build it made, as the editor does.
      sourceRevisionId: "22222222-2222-4222-8222-222222222222",
      themeBuildId: "33333333-3333-4333-8333-333333333333",
      expectedDraftRevisionId: draft!.draftRevisionId,
      expectedDraftGeneration: draft!.draftGeneration,
      expectedReleaseGeneration: 1,
      readSourceRevisionFiles: workspaceRevisionFiles,
      verifySourceRevision: acceptRevision,
    });
    expect(result).toMatchObject({
      releaseCreated: true,
      themeBuildId: "33333333-3333-4333-8333-333333333333",
    });
    expect(
      sqlite
        .prepare("SELECT created_by FROM storefront_theme_template_revisions")
        .get(),
    ).toEqual({ created_by: "user-1" });
  });
  it("a first publish with an untouched layout: the confirmed scope holds for the layout draft the publish's own preparation writes", async () => {
    seedUntouched();
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, created_at, updated_at)
      VALUES ('layout-initial', 'theme-a', 'layout', 'Layout',
        '{"version":1,"sections":[{"id":"header","type":"header","enabled":true,"props":{"storeName":"Shop"}}]}', 'now', 'now');
    `);
    // What the confirmation reads before the editor prepares anything (the
    // M1 lifecycle E2E's first publish): the layout goes live too.
    const scope = await storefrontThemeDal.findPublishScope({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-initial",
    });
    expect(scope).toEqual({
      sharedLayout: null,
      layout: {
        templateId: "layout-initial",
        draftRevisionId: null,
        firstPublish: true,
      },
    });
    // The editor's publish then prepares the page and the layout.
    const page = await prepare();
    const layout = await prepare({ templateId: "layout-initial" });
    const publishWith = (expectedSharedLayoutRevisionId: string | null) =>
      storefrontThemeDal.publishTemplate({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-initial",
        sourceRevisionId: "22222222-2222-4222-8222-222222222222",
        themeBuildId: "33333333-3333-4333-8333-333333333333",
        expectedDraftRevisionId: page!.draftRevisionId,
        expectedDraftGeneration: page!.draftGeneration,
        expectedReleaseGeneration: 1,
        expectedSharedLayoutRevisionId,
        readSourceRevisionFiles: workspaceRevisionFiles,
        verifySourceRevision: acceptRevision,
      });
    // Sent as read, the preparation's draft is a layout nobody confirmed.
    await expect(publishWith(null)).rejects.toThrow(PUBLISH_SCOPE_CHANGED);
    // Sent for the draft that preparation left, it seals that draft.
    await expect(publishWith(layout!.draftRevisionId)).resolves.toMatchObject({
      releaseCreated: true,
    });
    expect(
      sqlite
        .prepare(
          "SELECT published_revision_id AS published FROM storefront_theme_templates WHERE id = 'layout-initial'",
        )
        .get(),
    ).toEqual({ published: layout!.draftRevisionId });
  });
  it("refuses a stale source generation without creating a revision", async () => {
    seedUntouched();
    await expect(prepare({ expectedSourceGeneration: 2 })).rejects.toThrow(
      TEMPLATE_DRAFT_GENERATION_MISMATCH,
    );
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM storefront_theme_template_revisions",
        )
        .get(),
    ).toEqual({ n: 0 });
  });
  it("refuses a stale draft generation without creating a revision", async () => {
    seedUntouched();
    await expect(prepare({ expectedDraftGeneration: 2 })).rejects.toThrow(
      TEMPLATE_DRAFT_GENERATION_MISMATCH,
    );
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM storefront_theme_template_revisions",
        )
        .get(),
    ).toEqual({ n: 0 });
  });
  it("does not rebase an initial-preparation request onto an existing draft", async () => {
    seedUntouched();
    await prepare();
    await expect(prepare()).rejects.toThrow(TEMPLATE_DRAFT_GENERATION_MISMATCH);
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM storefront_theme_template_revisions",
        )
        .get(),
    ).toEqual({ n: 1 });
  });
  it("does not prepare a template belonging to another store", async () => {
    seedUntouched();
    expect(await prepare({ storefrontId: "other-store" })).toBeNull();
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM storefront_theme_template_revisions",
        )
        .get(),
    ).toEqual({ n: 0 });
  });
  it.each(["source", "draft"] as const)(
    "rolls back when %s changes after the context read",
    async (target) => {
      seedUntouched();
      const originalBatch = workerEnv.DATABASE.batch.bind(workerEnv.DATABASE);
      const batch = vi.spyOn(workerEnv.DATABASE, "batch");
      batch.mockImplementationOnce(async (statements) => {
        sqlite.exec(
          target === "source"
            ? "UPDATE storefront_themes SET source_generation = 2 WHERE id = 'theme-a'"
            : "UPDATE storefront_theme_templates SET draft_generation = 2 WHERE id = 'template-initial'",
        );
        return originalBatch(statements);
      });
      try {
        await expect(prepare()).rejects.toThrow(
          TEMPLATE_DRAFT_GENERATION_MISMATCH,
        );
        expect(
          sqlite
            .prepare(
              "SELECT COUNT(*) AS n FROM storefront_theme_template_revisions",
            )
            .get(),
        ).toEqual({ n: 0 });
      } finally {
        batch.mockRestore();
      }
    },
  );
});

describe("publish build resolution", () => {
  const seedTemplateAndRevision = (extra = "") => {
    const draftDocument = JSON.stringify({
      version: 1,
      sections: [{ id: "hero", type: "hero", enabled: true, props: {} }],
    });
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, created_at, updated_at)
      VALUES
        ('template-a', 'theme-a', 'index', 'Home', '{"version":1,"sections":[]}',
         '11111111-1111-4111-8111-111111111111', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'template-a', 1,
         '${draftDocument.replaceAll("'", "''")}', 'now');
      INSERT INTO storefront_theme_revisions
        (id, storefront_id, theme_id, revision_number, source_generation, message, source, snapshot, created_at, updated_at)
      VALUES
        ('22222222-2222-4222-8222-222222222222', 'storefront-a', 'theme-a', 1, 1,
         'Frozen checkpoint', 'publish', '[]', 'now', 'now');
      ${extra}
    `);
  };

  const publish = () =>
    storefrontThemeDal.publishTemplate({
      readSourceRevisionFiles: workspaceRevisionFiles,
      verifySourceRevision: acceptRevision,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-a",
      expectedDraftRevisionId: "11111111-1111-4111-8111-111111111111",
      expectedDraftGeneration: 1,
      expectedReleaseGeneration: 1,
    });

  it("does not pick a build for a caller that names none and has no release to republish", async () => {
    // A succeeded build for this very source exists; it is still not chosen
    // on the caller's behalf. Publishing without a release must build.
    seedTemplateAndRevision();

    await expect(publish()).rejects.toThrow(/PUBLISH_BUILD_NOT_READY/);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM storefront_releases").get(),
    ).toEqual({ count: 0 });
  });

  it("republishes the active release's own build, never a newer one for the same source", async () => {
    seedTemplateAndRevision(`
      INSERT INTO storefront_theme_builds
        (id, storefront_id, theme_id, source_revision_id, status, artifact_prefix, manifest_json, created_at, updated_at)
      VALUES
        ('44444444-4444-4444-8444-444444444444', 'storefront-a', 'theme-a',
         '22222222-2222-4222-8222-222222222222', 'succeeded',
         'themes/theme-a/builds/build-b', '{}', 'zzz-later', 'zzz-later');
      INSERT INTO storefront_releases
        (id, storefront_id, theme_id, source_revision_id, theme_build_id, status,
         metadata, created_at, updated_at)
      VALUES
        ('55555555-5555-4555-8555-555555555555', 'storefront-a', 'theme-a',
         '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333',
         'available', '{"deployedThemeBuildId":"33333333-3333-4333-8333-333333333333"}',
         'now', 'now');
      UPDATE storefronts SET active_release_id = '55555555-5555-4555-8555-555555555555'
        WHERE id = 'storefront-a';
    `);

    const result = await publish();
    expect(result).toMatchObject({
      themeBuildId: "33333333-3333-4333-8333-333333333333",
      sourceRevisionId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("never selects a build bound to a different source generation", async () => {
    // A build from an older revision would publish stale bytes under a newer
    // source, which is exactly what the guard exists to prevent.
    sqlite.exec(
      "UPDATE storefront_themes SET source_generation = 2 WHERE id = 'theme-a'",
    );
    seedTemplateAndRevision();

    await expect(publish()).rejects.toThrow(/PUBLISH_BUILD_NOT_READY/);
  });

  it("ignores builds that did not succeed", async () => {
    sqlite.exec(
      "UPDATE storefront_theme_builds SET status = 'failed' WHERE id = '33333333-3333-4333-8333-333333333333'",
    );
    seedTemplateAndRevision();

    await expect(publish()).rejects.toThrow(/PUBLISH_BUILD_NOT_READY/);
  });

  it("ignores succeeded builds with no immutable artifact", async () => {
    sqlite.exec(
      "UPDATE storefront_theme_builds SET artifact_prefix = NULL WHERE id = '33333333-3333-4333-8333-333333333333'",
    );
    seedTemplateAndRevision();

    await expect(publish()).rejects.toThrow(/PUBLISH_BUILD_NOT_READY/);
  });

  it("still honours a build the caller names explicitly", async () => {
    seedTemplateAndRevision(`
      INSERT INTO storefront_theme_builds
        (id, storefront_id, theme_id, source_revision_id, status, artifact_prefix, manifest_json, created_at, updated_at)
      VALUES
        ('44444444-4444-4444-8444-444444444444', 'storefront-a', 'theme-a',
         '22222222-2222-4222-8222-222222222222', 'succeeded',
         'themes/theme-a/builds/build-b', '{}', 'zzz-later', 'zzz-later');
    `);

    const result = await storefrontThemeDal.publishTemplate({
      readSourceRevisionFiles: workspaceRevisionFiles,
      verifySourceRevision: acceptRevision,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-a",
      sourceRevisionId: "22222222-2222-4222-8222-222222222222",
      themeBuildId: "33333333-3333-4333-8333-333333333333",
      expectedDraftRevisionId: "11111111-1111-4111-8111-111111111111",
      expectedDraftGeneration: 1,
      expectedReleaseGeneration: 1,
    });

    expect(result!.themeBuildId).toBe("33333333-3333-4333-8333-333333333333");
  });
});

describe("co-located content field declarations", () => {
  const seedSection = (props: string, componentRef = "promo.default") => {
    const doc = `{"version":1,"sections":[{"id":"promo-1","type":"promo","componentRef":"${componentRef}","enabled":true,"props":${props}}]}`;
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, published_revision_id, created_at, updated_at)
      VALUES
        ('template-p', 'theme-a', 'index', 'Home', '${doc}',
         '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'template-p', 1, '${doc}', 'now');
    `);
  };

  const seedThemeFiles = (componentSource: string, manifest: string) => {
    const insert = (path: string, content: string) =>
      sqlite
        .prepare(
          `INSERT INTO storefront_theme_files
             (id, storefront_id, theme_id, path, content, version, created_at, updated_at)
           VALUES (?, 'storefront-a', 'theme-a', ?, ?, 1, 'now', 'now')`,
        )
        .run(`file-${path}`, path, content);
    insert("morph.theme.json", manifest);
    insert("src/components/Promo.tsx", componentSource);
  };

  const MANIFEST_WITHOUT_FIELDS = JSON.stringify({
    components: { "promo.default": { source: "src/components/Promo.tsx" } },
  });

  it("saves an unregistered component through the Inspector and reloads its immutable draft", async () => {
    const source = `export const contentFields = {
      headline: { type: "text", label: "Headline" },
      cta: { type: "link", label: "Destination" },
    } as const;
    export default function Promo({ headline = "Original", cta = { href: "/" } }) {
      return <section className="p-4"><h2>{headline}</h2><a href={cta.href}>Go</a></section>;
    }`;
    seedThemeFiles(source, "{}");
    seedSection(
      '{"headline":"Original","cta":{"href":"https://old.example"},"retained":"assembly"}',
      "src/components/Promo.tsx",
    );
    const load = () => {
      const row = sqlite
        .prepare(
          `SELECT r.document, t.draft_generation AS generation
        FROM storefront_theme_templates t JOIN storefront_theme_template_revisions r
        ON r.id = t.draft_revision_id WHERE t.id = 'template-p'`,
        )
        .get() as { document: string; generation: number };
      return {
        document: JSON.parse(row.document) as StorefrontPageDocument,
        generation: row.generation,
      };
    };
    const original = load();
    let generation = original.generation;
    let pending: Promise<unknown> = Promise.resolve();
    const themeFiles = [
      {
        id: "promo-source",
        storefrontId: "storefront-a",
        themeId: "theme-a",
        path: "src/components/Promo.tsx",
        content: source,
        mimeType: "text/typescript",
        isEntry: false,
        version: 1,
        createdAt: "now",
        updatedAt: "now",
      },
    ];
    const mount = () =>
      render(
        createElement(EditorStyleInspector, {
          view: "content",
          section: load().document.sections[0],
          themeFiles,
          onPropsChange: (props) => {
            pending = storefrontThemeDal
              .updateSectionProps({
      expectedSourceGeneration: 1,
                storefrontId: "storefront-a",
                themeId: "theme-a",
                templateId: "template-p",
                sectionId: "promo-1",
                props,
                expectedDraftGeneration: generation,
                createdBy: "user-1",
              })
              .then((result) => {
                expect(result).not.toBeNull();
                generation = load().generation;
              });
          },
        }),
      );
    try {
      mount();
      fireEvent.input(screen.getByDisplayValue("Original"), {
        target: { value: "Saved title" },
      });
      await pending;
      fireEvent.blur(screen.getByLabelText("Destination path or URL"), {
        target: { value: "https://new.example" },
      });
      await pending;
      cleanup();
      mount();
      expect(screen.getByDisplayValue("Saved title")).toBeTruthy();
      expect(screen.getByDisplayValue("https://new.example")).toBeTruthy();
      expect(load().document.sections[0].props.retained).toBe("assembly");
      expect(load().generation).toBe(original.generation + 2);
      const old = sqlite
        .prepare(
          "SELECT document FROM storefront_theme_template_revisions WHERE version = 1 AND template_id = 'template-p'",
        )
        .get() as { document: string };
      expect(JSON.parse(old.document)).toEqual(original.document);
      await expect(
        storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
          storefrontId: "storefront-a",
          themeId: "theme-a",
          templateId: "template-p",
          sectionId: "promo-1",
          props: { headline: "stale" },
          expectedDraftGeneration: original.generation,
          createdBy: "user-1",
        }),
      ).rejects.toThrow();
      expect(load().document.sections[0].props.headline).toBe("Saved title");
    } finally {
      cleanup();
    }
  });

  it("accepts values for fields a component declares in its own source", async () => {
    // Nothing registers these fields in the manifest; the declaration lives
    // beside the component, and server validation must resolve the same way the
    // editor form does or saving would silently drop the value.
    seedThemeFiles(
      `export const contentFields = {
         headline: { type: "text", label: "Headline" },
       } as const;
       export default function Promo() { return <section />; }`,
      MANIFEST_WITHOUT_FIELDS,
    );
    seedSection('{"headline":"Original"}');

    const result = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-p",
      sectionId: "promo-1",
      props: { headline: "From the component declaration" },
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    expect(result?.document.sections[0].props.headline).toBe(
      "From the component declaration",
    );
  });

  // A declaration can change after content was written under an older one. If
  // the stored value is re-validated on every save, the section becomes
  // permanently uneditable — including the field that needs correcting.
  it("lets an edit through when other stored content predates the declaration", async () => {
    seedThemeFiles(
      `export const contentFields = {
         headline: { type: "text", label: "Headline" },
         subtitle: { type: "text", maxLength: 5 },
       } as const;
       export default function Promo() { return <section />; }`,
      MANIFEST_WITHOUT_FIELDS,
    );
    // `subtitle` was stored before the 5-character limit existed.
    seedSection(
      '{"headline":"Original","subtitle":"far too long for the limit"}',
    );

    const result = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-p",
      sectionId: "promo-1",
      props: { headline: "Edited despite the stale neighbour" },
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    expect(result?.document.sections[0].props.headline).toBe(
      "Edited despite the stale neighbour",
    );
    // The offending value is preserved, not silently erased or corrected.
    expect(result?.document.sections[0].props.subtitle).toBe(
      "far too long for the limit",
    );
  });

  it("still rejects the incoming value when it breaks the declaration", async () => {
    seedThemeFiles(
      `export const contentFields = {
         headline: { type: "text", maxLength: 5 },
       } as const;
       export default function Promo() { return <section />; }`,
      MANIFEST_WITHOUT_FIELDS,
    );
    seedSection('{"headline":"ok"}');

    await expect(
      storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-p",
        sectionId: "promo-1",
        props: { headline: "way past the declared limit" },
        expectedDraftGeneration: 1,
        createdBy: "user-1",
      }),
    ).rejects.toThrow("INVALID_THEME_CONTENT_FIELD_VALUE:headline");
  });

  it("still rejects a prop the component never declared", async () => {
    seedThemeFiles(
      `export const contentFields = { headline: { type: "text" } } as const;
       export default function Promo() { return <section />; }`,
      MANIFEST_WITHOUT_FIELDS,
    );
    seedSection('{"headline":"Original"}');

    const result = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-p",
      sectionId: "promo-1",
      props: { headline: "ok", fontSize: 80, injected: "nope" },
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    const saved = result!.document.sections[0].props;
    expect(saved.headline).toBe("ok");
    expect(saved.fontSize).toBeUndefined();
    expect(saved.injected).toBeUndefined();
  });

  it("lets the component's declaration override a stale manifest entry", async () => {
    seedThemeFiles(
      `export const contentFields = { headline: { type: "text" } } as const;
       export default function Promo() { return <section />; }`,
      JSON.stringify({
        components: {
          "promo.default": {
            source: "src/components/Promo.tsx",
            contentFields: { removedField: { type: "text" } },
          },
        },
      }),
    );
    seedSection('{"headline":"Original"}');

    const result = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-p",
      sectionId: "promo-1",
      props: { headline: "current", removedField: "stale" },
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    const saved = result!.document.sections[0].props;
    expect(saved.headline).toBe("current");
    expect(saved.removedField).toBeUndefined();
  });
});

describe("row identity is repaired with the first edit, not on read", () => {
  /** Two nav rows with no ids, the shape every Store predating row identity has. */
  const idlessDocument = JSON.stringify({
    version: 1,
    sections: [
      {
        id: "header",
        type: "header",
        enabled: true,
        props: {
          navItems: [{ label: "Shop" }, { label: "About" }],
        },
      },
    ],
  });

  function seedTemplate(templateId: string, draftRevisionId: string) {
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, published_revision_id, draft_generation, created_at, updated_at)
      VALUES
        ('${templateId}', 'theme-a', 'layout', 'Shell', '${idlessDocument}',
         '${draftRevisionId}', NULL, 1, 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('${draftRevisionId}', '${templateId}', 1, '${idlessDocument}', 'now');
    `);
  }

  function storedRows(templateId: string) {
    const row = sqlite
      .prepare(
        `SELECT r.document AS document, t.draft_generation AS generation
           FROM storefront_theme_templates t
           JOIN storefront_theme_template_revisions r ON r.id = t.draft_revision_id
          WHERE t.id = ?`,
      )
      .get(templateId) as { document: string; generation: number };
    return {
      generation: row.generation,
      rows: JSON.parse(row.document).sections[0].props.navItems as {
        id?: string;
      }[],
    };
  }

  /**
   * The author sees identified rows from the first frame, but nothing is
   * written — repairing data as a side effect of reading it would write on
   * every page load and race with whatever else is open.
   */
  it("hands the editor identified rows without touching the database", async () => {
    seedTemplate("template-rid1", "aaaaaaaa-1111-4111-8111-111111111111");

    const context = await storefrontThemeDal.findEditorContext(
      "storefront-a",
      "theme-a",
    );
    const template = context?.templates.find((t) => t.id === "template-rid1");
    const rows = template?.document.sections[0]?.props.navItems as {
      id?: string;
    }[];

    expect(rows.every((row) => typeof row.id === "string")).toBe(true);
    const stored = storedRows("template-rid1");
    expect(stored.rows.every((row) => row.id === undefined)).toBe(true);
    expect(stored.generation).toBe(1);
  });

  /**
   * The repair and the author's edit are one write. Two would mean two
   * generations, and an author holding the first would find their own edit
   * rejected by the repair that went before it.
   */
  it("saves the repair and the edit together, advancing the generation once", async () => {
    seedTemplate("template-rid2", "aaaaaaaa-2222-4222-8222-222222222222");

    const result = await storefrontThemeDal.renameSection({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-rid2",
      sectionId: "header",
      name: "Site header",
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    expect(result?.draftGeneration).toBe(2);
    const stored = storedRows("template-rid2");
    expect(stored.generation).toBe(2);
    expect(stored.rows.every((row) => /^morph-mig-/.test(row.id ?? ""))).toBe(
      true,
    );
  });

  /**
   * The ids the browser derived at load and the ids the server writes on save
   * have to be the same, or the response renumbers every row on screen and
   * React remounts all of them.
   */
  it("writes the same ids the editor was already showing", async () => {
    seedTemplate("template-rid3", "aaaaaaaa-3333-4333-8333-333333333333");

    const context = await storefrontThemeDal.findEditorContext(
      "storefront-a",
      "theme-a",
    );
    const shown = (
      context?.templates.find((t) => t.id === "template-rid3")?.document
        .sections[0]?.props.navItems as { id?: string }[]
    ).map((row) => row.id);

    await storefrontThemeDal.renameSection({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-rid3",
      sectionId: "header",
      name: "Site header",
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    expect(storedRows("template-rid3").rows.map((row) => row.id)).toEqual(
      shown,
    );
  });

  /** Half a repair is worse than none: the whole batch stands or falls. */
  it("writes neither the repair nor the edit when the generation moved", async () => {
    seedTemplate("template-rid4", "aaaaaaaa-4444-4444-8444-444444444444");

    await expect(
      storefrontThemeDal.renameSection({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-rid4",
        sectionId: "header",
        name: "Site header",
        expectedDraftGeneration: 99,
        createdBy: "user-1",
      }),
    ).rejects.toThrow(/CONFLICT_DRAFT_GENERATION_MISMATCH/);

    const stored = storedRows("template-rid4");
    expect(stored.generation).toBe(1);
    expect(stored.rows.every((row) => row.id === undefined)).toBe(true);
  });

  /**
   * `reorderSections` kept its own copy of the draft write until now, which is
   * how it came to be the one mutator without a source-generation guard.
   */
  it("repairs rows through reorderSections too", async () => {
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, published_revision_id, draft_generation, created_at, updated_at)
      VALUES
        ('template-rid5', 'theme-a', 'index', 'Home', '${JSON.stringify({
          version: 1,
          sections: [
            {
              id: "hero",
              type: "hero",
              enabled: true,
              props: { navItems: [{ label: "A" }] },
            },
            { id: "story", type: "story", enabled: true, props: {} },
          ],
        })}', 'aaaaaaaa-5555-4555-8555-555555555555', NULL, 1, 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('aaaaaaaa-5555-4555-8555-555555555555', 'template-rid5', 1, '${JSON.stringify(
          {
            version: 1,
            sections: [
              {
                id: "hero",
                type: "hero",
                enabled: true,
                props: { navItems: [{ label: "A" }] },
              },
              { id: "story", type: "story", enabled: true, props: {} },
            ],
          },
        )}', 'now');
    `);

    const result = await storefrontThemeDal.reorderSections({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-rid5",
      sectionIds: ["story", "hero"],
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });

    expect(result?.document.sections.map((s) => s.id)).toEqual([
      "story",
      "hero",
    ]);
    expect(result?.draftGeneration).toBe(2);
    const hero = result?.document.sections.find((s) => s.id === "hero");
    expect(
      ((hero?.props.navItems as { id?: string }[])[0]?.id ?? "").startsWith(
        "morph-mig-",
      ),
    ).toBe(true);
  });
});

describe("publishing seals a complete snapshot", () => {
  /**
   * A release is immutable: it pins a source revision, a build and a content
   * publication, and the runtime serves that publication's revisions. A Store
   * nobody has edited since row identity existed would otherwise seal rows with
   * no ids, and the only way to correct a release afterwards is another one.
   */
  it("gives every row an id in the revision the release will pin", async () => {
    const idless = JSON.stringify({
      version: 1,
      sections: [
        {
          id: "hero",
          type: "hero",
          enabled: true,
          props: { navItems: [{ label: "Shop" }, { label: "About" }] },
        },
      ],
    });
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, published_revision_id, draft_generation, created_at, updated_at)
      VALUES
        ('template-pub-rid', 'theme-a', 'index', 'Home', '${idless}',
         'bbbbbbbb-1111-4111-8111-111111111111', NULL, 1, 'now', 'now');
      INSERT INTO storefront_theme_template_revisions
        (id, template_id, version, document, created_at)
      VALUES
        ('bbbbbbbb-1111-4111-8111-111111111111', 'template-pub-rid', 1, '${idless}', 'now');
      INSERT INTO storefront_theme_revisions
        (id, storefront_id, theme_id, revision_number, message, source, snapshot, created_at, updated_at)
      VALUES
        ('22222222-2222-4222-8222-222222222222', 'storefront-a', 'theme-a', 1,
         'Checkpoint', 'publish', '[]', 'now', 'now');
    `);

    await storefrontThemeDal.publishTemplate({
      readSourceRevisionFiles: workspaceRevisionFiles,
      verifySourceRevision: acceptRevision,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-pub-rid",
      sourceRevisionId: "22222222-2222-4222-8222-222222222222",
      themeBuildId: "33333333-3333-4333-8333-333333333333",
      expectedDraftRevisionId: "bbbbbbbb-1111-4111-8111-111111111111",
      expectedDraftGeneration: 1,
      expectedReleaseGeneration: 1,
    });

    // The revision, because that is what the publication pins and the runtime
    // reads — repairing only the template's own copy would change nothing a
    // visitor ever sees.
    const revision = sqlite
      .prepare(
        "SELECT document FROM storefront_theme_template_revisions WHERE id = ?",
      )
      .get("bbbbbbbb-1111-4111-8111-111111111111") as { document: string };
    const rows = JSON.parse(revision.document).sections[0].props.navItems as {
      id?: string;
    }[];

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => /^morph-mig-/.test(row.id ?? ""))).toBe(true);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  });
});

describe("publishing after a rollback", () => {
  const BUILD = "33333333-3333-4333-8333-333333333333";
  const SOURCE = "22222222-2222-4222-8222-222222222222";
  const REV_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const REV_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const doc = (title: string) =>
    JSON.stringify({
      version: 1,
      sections: [{ id: "hero", type: "hero", enabled: true, props: { title } }],
    }).replaceAll("'", "''");

  /**
   * Release 1 served A and release 2 served B, both on one build; the store
   * was then rolled back to `active`. The template still records B as
   * published, because a rollback moves only the live pointer.
   */
  const seed = (active: "release-1" | "release-2") => {
    sqlite.exec(`
      INSERT INTO storefront_theme_revisions
        (id, storefront_id, theme_id, revision_number, source_generation, snapshot, created_at, updated_at)
        VALUES ('${SOURCE}', 'storefront-a', 'theme-a', 1, 1, '[]', 'now', 'now');
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, document, draft_revision_id, published_revision_id, draft_generation, created_at, updated_at)
        VALUES ('template-a', 'theme-a', 'index', 'Home', '${doc("B")}', '${REV_B}', '${REV_B}', 3, 'now', 'now');
      INSERT INTO storefront_theme_template_revisions (id, template_id, version, document, created_at)
        VALUES ('${REV_A}', 'template-a', 1, '${doc("A")}', 'now'),
               ('${REV_B}', 'template-a', 2, '${doc("B")}', 'now');
      INSERT INTO storefront_content_publications (id, storefront_id, created_at, updated_at)
        VALUES ('pub-a', 'storefront-a', 'now', 'now'), ('pub-b', 'storefront-a', 'now', 'now');
      INSERT INTO storefront_content_publication_items
        (id, publication_id, item_type, content_id, revision_id, metadata, created_at, updated_at)
        VALUES ('item-a', 'pub-a', 'template', 'template-a', '${REV_A}', '{"templateType":"index"}', 'now', 'now'),
               ('item-b', 'pub-b', 'template', 'template-a', '${REV_B}', '{"templateType":"index"}', 'now', 'now');
      INSERT INTO storefront_releases
        (id, storefront_id, theme_id, source_revision_id, theme_build_id, content_publication_id, status, metadata, created_at, updated_at)
        VALUES ('release-1', 'storefront-a', 'theme-a', '${SOURCE}', '${BUILD}', 'pub-a', 'available', '{"deployedThemeBuildId":"${BUILD}"}', 'now', 'now'),
               ('release-2', 'storefront-a', 'theme-a', '${SOURCE}', '${BUILD}', 'pub-b', 'available', '{"deployedThemeBuildId":"${BUILD}"}', 'now', 'now');
      UPDATE storefront_themes SET published_source_revision_id = '${SOURCE}', release_generation = 3
        WHERE id = 'theme-a';
      UPDATE storefronts SET active_release_id = '${active}' WHERE id = 'storefront-a';
    `);
  };

  const publishB = () =>
    storefrontThemeDal.publishTemplate({
      readSourceRevisionFiles: workspaceRevisionFiles,
      verifySourceRevision: acceptRevision,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-a",
      expectedDraftRevisionId: REV_B,
      expectedDraftGeneration: 3,
      expectedReleaseGeneration: 3,
    });

  it("publishes a draft the rollback took off the storefront, rather than calling it live", async () => {
    // Rolled back to A. Publishing B again must put B live, even though the
    // template row still says B was published.
    seed("release-1");

    const result = await publishB();

    expect(result).toMatchObject({ unchanged: false, releaseCreated: true });
    const live = sqlite
      .prepare(
        `SELECT r.id, i.revision_id AS revision
           FROM storefronts s
           JOIN storefront_releases r ON r.id = s.active_release_id
           JOIN storefront_content_publication_items i ON i.publication_id = r.content_publication_id
          WHERE s.id = 'storefront-a'`,
      )
      .get() as { id: string; revision: string };
    expect(live.id).not.toBe("release-1");
    expect(live.revision).toBe(REV_B);
    // The page row was not rewritten (its draft was already the published
    // one), so its generation stands; the editor sends that next.
    expect(result!.draftGeneration).toBe(3);
    expect(
      sqlite
        .prepare(
          "SELECT draft_generation FROM storefront_theme_templates WHERE id = 'template-a'",
        )
        .get(),
    ).toEqual({ draft_generation: 3 });
  });

  it("still calls a draft live when the live release serves it", async () => {
    seed("release-2");

    const result = await publishB();

    expect(result).toMatchObject({ unchanged: true, releaseCreated: false });
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM storefront_releases").get(),
    ).toEqual({ count: 2 });
  });
});

describe("the object position control's write, against the real Starter source", () => {
  it("stores one row's declared imagePosition and reads it back, leaving the other row alone", async () => {
    const { STARTER_THEME_V3_NEW_FILES } =
      await import("@/lib/storefront/starter-theme-v3-files");
    const showcase = STARTER_THEME_V3_NEW_FILES.find(
      (file) => file.path === "src/components/CategoryShowcase.tsx",
    )!;
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_files
          (id, storefront_id, theme_id, path, content, created_at, updated_at)
        VALUES ('file-showcase', 'storefront-a', 'theme-a', ?, ?, 'now', 'now')`,
      )
      .run(showcase.path, showcase.content);
    const rowA = {
      id: "row-a",
      title: "First",
      image: { src: "/a.png", alt: "A" },
      imagePosition: "30% center",
    };
    const rowB = {
      id: "row-b",
      title: "Second",
      image: { src: "/b.png", alt: "B" },
    };
    const stored = JSON.stringify({
      version: 1,
      sections: [
        {
          id: "collections",
          type: "category-showcase",
          componentRef: showcase.path,
          enabled: true,
          props: { heading: "Collections", items: [rowA, rowB] },
        },
      ],
    });
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, created_at, updated_at)
        VALUES ('template-showcase', 'theme-a', 'index', 'Home', ?, 'now', 'now')`,
      )
      .run(stored);

    // What the Inspector sends: the whole section, one row's position changed.
    const result = await storefrontThemeDal.updateSectionProps({
      expectedSourceGeneration: 1,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-showcase",
      sectionId: "collections",
      props: {
        heading: "Collections",
        items: [rowA, { ...rowB, imagePosition: "top" }],
      },
      expectedDraftGeneration: 1,
      createdBy: "user-1",
    });
    expect(result?.droppedProps).toEqual([]);

    // Read back the way the editor does, from the draft the write produced.
    const editor = await storefrontThemeDal.findEditorContext(
      "storefront-a",
      "theme-a",
    );
    const template = editor?.templates.find(
      (candidate) => candidate.id === "template-showcase",
    );
    const items = (
      template?.document.sections.find(
        (section) => section.id === "collections",
      )?.props as { items?: Array<Record<string, unknown>> } | undefined
    )?.items;
    expect(items?.map((item) => [item.id, item.imagePosition])).toEqual([
      ["row-a", "30% center"],
      ["row-b", "top"],
    ]);
  });
});

describe("a list nothing stores yet, first edited from the Inspector", () => {
  it("keeps the row ids the editor gave its default rows, through the next write", async () => {
    const { normalizeRowIds } =
      await import("@/lib/storefront/editor/normalize-row-ids");
    const path = "src/components/Entries.tsx";
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_files
          (id, storefront_id, theme_id, path, content, created_at, updated_at)
        VALUES ('file-entries', 'storefront-a', 'theme-a', ?, ?, 'now', 'now')`,
      )
      .run(
        path,
        `export const contentFields = {
  items: {
    type: "array",
    label: "Entries",
    fields: { title: { type: "text", label: "Title", maxLength: 150 } },
  },
} as const;
export default function Entries({ items = [{ title: "One" }, { title: "Two" }] }: { items?: { id?: string; title?: string }[] }) {
  return <section>{items.map((item, index) => <h3 key={item.id ?? index}>{item.title}</h3>)}</section>;
}`,
      );
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, created_at, updated_at)
        VALUES ('template-entries', 'theme-a', 'index', 'Home', ?, 'now', 'now')`,
      )
      .run(
        JSON.stringify({
          version: 1,
          sections: [
            {
              id: "entries",
              type: "entries",
              componentRef: path,
              enabled: true,
              props: {},
            },
          ],
        }),
      );
    // The ids the Inspector gives the component's defaults before the edit.
    const [one, two] = normalizeRowIds(
      { items: [{ title: "One" }, { title: "Two" }] },
      { templateId: "template-entries", sectionId: "entries" },
    ).value.items as Array<Record<string, unknown>>;
    const read = async () => {
      const editor = await storefrontThemeDal.findEditorContext(
        "storefront-a",
        "theme-a",
      );
      const template = editor?.templates.find(
        (candidate) => candidate.id === "template-entries",
      );
      return (
        template?.document.sections.find((section) => section.id === "entries")
          ?.props as { items?: Array<Record<string, unknown>> } | undefined
      )?.items?.map((item) => [item.id, item.title]);
    };
    const write = (items: unknown[], expectedDraftGeneration: number) =>
      storefrontThemeDal.updateSectionProps({
        expectedSourceGeneration: 1,
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-entries",
        sectionId: "entries",
        props: { items },
        expectedDraftGeneration,
        createdBy: "user-1",
      });

    const first = await write([one, { ...two, title: "Two edited" }], 1);
    expect(first?.droppedProps).toEqual([]);
    expect(await read()).toEqual([
      [one!.id, "One"],
      [two!.id, "Two edited"],
    ]);

    const second = await write(
      [
        { ...one, title: "One edited" },
        { ...two, title: "Two edited" },
      ],
      first!.draftGeneration,
    );
    expect(second?.droppedProps).toEqual([]);
    expect(await read()).toEqual([
      [one!.id, "One edited"],
      [two!.id, "Two edited"],
    ]);
  });
});

const LEGACY_LAYOUT_REASON =
  "This layout does not read Design content. Upgrade the Starter to edit it here, or edit it in Code mode.";

describe("Starter layout writes keep their source proof", () => {
  // Layout writes are checked against the layout source like route writes.
  // A shell that renders `content(...)` slots must keep every field it passes
  // through writable; a shell that never reads the layout Document must refuse
  // them, since nothing stored there would reach the page.
  const historyWorkspace = (version: number) =>
    (
      JSON.parse(
        readFileSync(
          join(__dirname, "..", "__fixtures__", "starter-history", `v${version}.json`),
          "utf8",
        ),
      ) as { files: { path: string; content: string }[] }
    ).files;
  const currentWorkspace = () =>
    starterThemeWorkspaceFiles().map(({ path, content }) => ({ path, content }));
  const withLayout = (content: string) => () =>
    currentWorkspace().map((file) =>
      file.path === "src/layouts/StorefrontLayout.tsx" ? { ...file, content } : file,
    );
  type Workspace = [string, () => readonly { path: string; content: string }[]];
  const confirmedWorkspaces: readonly Workspace[] = [
    ["current Starter", currentWorkspace],
    ...[20, 26, 28].map(
      (version): Workspace => [`Starter v${version}`, () => historyWorkspace(version)],
    ),
    [
      "current Starter with the always-visible slot shell",
      withLayout(LEGACY_STARTER_THEME_LAYOUT_ALWAYS_VISIBLE_SOURCE),
    ],
    // Judged by its source, not its version: a v15 Theme whose shell was
    // rewritten in Code mode to read `content(...)`, with no upgrade applied.
    [
      "Starter v15 with its shell rewritten to read content",
      () => {
        const current = new Map(currentWorkspace().map((file) => [file.path, file]));
        const swapped = [
          "src/layouts/StorefrontLayout.tsx",
          "src/components/Header.tsx",
          "src/components/Footer.tsx",
          ...[...current.keys()].filter((path) => path.startsWith("src/morph/")),
        ];
        const files = new Map(historyWorkspace(15).map((file) => [file.path, file]));
        for (const path of swapped) files.set(path, current.get(path)!);
        return [...files.values()];
      },
    ],
  ];
  // The shells that forward the layout's own default props, or none at all,
  // instead of rendering `content(...)` slots.
  const legacyWorkspaces: readonly Workspace[] = [
    ...[11, 15].map(
      (version): Workspace => [`Starter v${version}`, () => historyWorkspace(version)],
    ),
    ["current Starter with the marked shell", withLayout(LEGACY_STARTER_THEME_LAYOUT_MARKED_SOURCE)],
    ["current Starter with the index shell", withLayout(STARTER_THEME_INDEX_SOURCE)],
    ["current Starter with the propless shell", withLayout(LEGACY_STARTER_THEME_LAYOUT_PROPLESS_SOURCE)],
  ];

  function seedWorkspace(
    files: readonly { path: string; content: string }[],
    document: StorefrontPageDocument,
  ) {
    const insertFile = sqlite.prepare(`
      INSERT INTO storefront_theme_files
        (id, storefront_id, theme_id, path, content, created_at, updated_at)
      VALUES (?, 'storefront-a', 'theme-a', ?, ?, 'now', 'now')
    `);
    files.forEach((file, index) =>
      insertFile.run(`starter-${index}`, file.path, file.content),
    );
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, created_at, updated_at)
        VALUES ('template-layout', 'theme-a', 'layout', 'Layout', ?, 'now', 'now')`,
      )
      .run(JSON.stringify(document));
  }
  const storedLayout = () => ({
    template: sqlite
      .prepare(
        "SELECT document, draft_revision_id AS draftRevisionId, draft_generation AS draftGeneration FROM storefront_theme_templates WHERE id = 'template-layout'",
      )
      .get(),
    revisions: sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM storefront_theme_template_revisions WHERE template_id = 'template-layout'",
      )
      .get(),
  });
  const target = {
    storefrontId: "storefront-a",
    themeId: "theme-a",
    templateId: "template-layout",
    expectedDraftGeneration: 1,
    createdBy: "user-1",
  };

  for (const [name, filesFor] of confirmedWorkspaces) {
    it(`accepts every passed-through layout field of the ${name}`, async () => {
      const files = filesFor();
      seedWorkspace(files, { version: 1, sections: [] });

      const layout = deriveThemeLayoutSections(files);
      expect(layout.diagnostics).toEqual([]);
      expect(layout.hasContentImport).toBe(true);
      const writes: Array<[string, string]> = [];
      for (const section of layout.sections) {
        const [instance] = analyzeB1Route(files, section.routeSourcePath)
          .instances.filter((candidate) => candidate.section === section.slotId);
        expect(instance, section.slotId).toBeDefined();
        for (const field of instance!.declaredFields) {
          writes.push([section.slotId, field]);
        }
      }
      expect(writes.length).toBeGreaterThan(0);

      let draftGeneration = 1;
      const refused: string[] = [];
      for (const [sectionId, field] of writes) {
        try {
          const result = await storefrontThemeDal.updateSectionProps({
            storefrontId: "storefront-a",
            themeId: "theme-a",
            templateId: "template-layout",
            sectionId,
            props: {},
            resetProps: [field],
            expectedDraftGeneration: draftGeneration,
            expectedSourceGeneration: 1,
            createdBy: "user-1",
          });
          expect(result, `${sectionId}.${field}`).not.toBeNull();
          draftGeneration = result!.draftGeneration;
        } catch (error) {
          refused.push(`${sectionId}.${field}: ${(error as Error).message}`);
        }
      }
      expect(refused).toEqual([]);
    });
  }

  for (const [name, filesFor] of legacyWorkspaces) {
    it(`refuses layout writes to the ${name} and leaves the Document unchanged`, async () => {
      const files = filesFor();
      const layout = deriveThemeLayoutSections(files);
      expect(layout.sections).toEqual([]);
      expect(layout.hasContentImport).toBe(false);
      // The layout Document a Starter is seeded with: both sections exist, so
      // a write finds its target and only the source can refuse it.
      const document = createDefaultStorefrontLayoutDocument();
      seedWorkspace(files, document);
      const before = storedLayout();

      const writes = document.sections.flatMap((section) => [
        ...Object.keys(section.props ?? {}).map((field) => ({
          label: `${section.id} reset ${field}`,
          props: {},
          resetProps: [field],
          sectionId: section.id,
        })),
        {
          label: `${section.id} storeName`,
          props: { storeName: "Never shown" },
          sectionId: section.id,
        },
        {
          label: `${section.id} hide`,
          props: { enabled: false },
          sectionId: section.id,
        },
      ]);
      expect(writes.length).toBeGreaterThan(4);
      const outcomes: string[] = [];
      let draftGeneration = 1;
      for (const { label, ...write } of writes) {
        try {
          // Each write holds the generation the last one left, so one that is
          // wrongly accepted cannot hide the next behind a draft conflict.
          const result = await storefrontThemeDal.updateSectionProps({
            ...target,
            ...write,
            expectedDraftGeneration: draftGeneration,
            expectedSourceGeneration: 1,
          });
          draftGeneration = result?.draftGeneration ?? draftGeneration;
          outcomes.push(`${label}: accepted`);
        } catch (error) {
          outcomes.push(`${label}: ${(error as Error).message}`);
        }
      }
      expect(outcomes).toEqual(
        writes.map(
          ({ label }) =>
            `${label}: SECTION_SOURCE_UNCONFIRMED: ${LEGACY_LAYOUT_REASON}`,
        ),
      );

      // Moving or renaming the shell's sections would be as invisible.
      await expect(
        storefrontThemeDal.reorderSections({
          ...target,
          sectionIds: [...document.sections].reverse().map((s) => s.id),
        }),
      ).resolves.toBeNull();
      await expect(
        storefrontThemeDal.renameSection({
          ...target,
          sectionId: document.sections[0]!.id,
          name: "Never shown",
        }),
      ).resolves.toBeNull();

      expect(storedLayout()).toEqual(before);
    });
  }

  it("still accepts a website render policy on a legacy shell, which the runtime reads from the Document", async () => {
    // The policy is read from the layout Document by the content runtime and
    // the prerender planner, never through the shell's slots.
    seedWorkspace(historyWorkspace(11), createDefaultStorefrontLayoutDocument());
    const result = await storefrontThemeDal.updateRenderPolicy({
      ...target,
      expectedSourceGeneration: 1,
      setting: { scope: "website", policy: { mode: "ssr" } },
    });
    expect(result).not.toBeNull();
  });

  // The refusal above is for Document writes only. A source default the
  // canvas proves on a legacy shell is written into the component file and
  // renders, so that path stays open.
  for (const [name, filesFor] of [
    legacyWorkspaces[1]!,
    legacyWorkspaces.find(([label]) => label.includes("marked"))!,
  ]) {
    it(`still writes and renders a proven source default on the ${name}`, async () => {
      const files = filesFor();
      const fields = analyzeSourceDefaultFields({
        files,
        componentSourcePath: "src/components/Header.tsx",
        fieldKeys: ["cartLabel"],
      });
      expect(fields.cartLabel).toEqual({ status: "default" });
      const proof = proveAndPatchSourceDefault({
        files,
        componentSourcePath: "src/components/Header.tsx",
        fieldKey: "cartLabel",
        expectedCurrentDefault: "Cart (0)",
        value: "ZZCART",
      });
      expect(proof.status).toBe("ok");
      const patched = files.map((file) =>
        file.path === "src/components/Header.tsx" && proof.status === "ok"
          ? { ...file, content: proof.nextContent }
          : file,
      );

      // The same field written through the Document is still refused.
      seedWorkspace(patched, createDefaultStorefrontLayoutDocument());
      await expect(
        storefrontThemeDal.updateSectionProps({
          ...target,
          sectionId: STOREFRONT_LAYOUT_HEADER_SLOT_ID,
          props: { cartLabel: "Never shown" },
          expectedSourceGeneration: 1,
        }),
      ).rejects.toThrow(LEGACY_LAYOUT_REASON);

      const { html } = await renderLivePreviewRoute({
        files: patched,
        documents: {
          index: createDefaultStorefrontHomeDocument(),
          layout: createDefaultStorefrontLayoutDocument(),
        },
      });
      expect(html).toContain("ZZCART");
    });
  }

  type UpgradeFile ={ id: string; path: string; content: string; version: number };
  /** The reviewed upgrade, applied until it plans nothing, as the store does. */
  function upgradeStarter(version: number) {
    let files: UpgradeFile[] = historyWorkspace(version).map((file, index) => ({
      id: `file-${index}`,
      path: file.path,
      content: file.content,
      version: 1,
    }));
    let storedVersion = version;
    for (let pass = 0; pass < 5; pass += 1) {
      const { plan } = reviewStarterThemeUpgrade(files, { storedVersion });
      if (plan.files.length === 0 && plan.deletions.length === 0) break;
      const next = new Map(files.map((file) => [file.path, file]));
      for (const deletion of plan.deletions) next.delete(deletion.path);
      for (const write of plan.files) {
        const existing = next.get(write.path);
        next.set(write.path, {
          id: existing?.id ?? `new-${write.path}`,
          path: write.path,
          content: write.content,
          version: (existing?.version ?? 0) + 1,
        });
      }
      files = [...next.values()];
      storedVersion = STOREFRONT_STARTER_TEMPLATE_VERSION;
    }
    return files.map(({ path, content }) => ({ path, content }));
  }

  for (const version of [11, 15]) {
    it(`accepts and renders a layout write once Starter v${version} is upgraded`, async () => {
      const files = upgradeStarter(version);
      expect(deriveThemeLayoutSections(files).hasContentImport).toBe(true);
      seedWorkspace(files, createDefaultStorefrontLayoutDocument());

      const result = await storefrontThemeDal.updateSectionProps({
        ...target,
        sectionId: STOREFRONT_LAYOUT_HEADER_SLOT_ID,
        props: { storeName: "ZZBRAND" },
        expectedSourceGeneration: 1,
      });
      expect(result).not.toBeNull();

      const context = await storefrontThemeDal.findEditorContext(
        "storefront-a",
        "theme-a",
      );
      const layoutDocument = context!.templates.find(
        (template) => template.type === "layout",
      )!.document;
      const { html } = await renderLivePreviewRoute({
        files,
        documents: {
          index: createDefaultStorefrontHomeDocument(),
          layout: layoutDocument,
        },
      });
      expect(html).toContain("ZZBRAND");
    });
  }
});

/**
 * M3 Hide approach E: Morph's gate reads the hidden list from the Starter
 * root route's snapshot, so a hide is admitted only on the Starter's root.
 * The hide fixtures below carry it, with the two files it imports (a layout
 * that renders nothing of its own, and the stylesheet).
 */
const HIDE_STARTER_ROOT = STARTER_THEME_ROOT_ROUTE_SOURCE;
const HIDE_ROOT_IMPORTS = livePreviewPlatformFiles().filter(
  (file) =>
    file.path === "src/layouts/StorefrontLayout.tsx" ||
    file.path === "src/styles/global.css",
);

/**
 * M3 Hide P2: the write boundary refuses a hide the saved source cannot carry
 * out (`section-hide-check.ts`), judged on the same source snapshot the write
 * compares-and-sets on. Showing a section is never refused by it.
 */
describe("M3 Hide: the write boundary checks a hide against the source it writes on", () => {
  const root = HIDE_STARTER_ROOT;
  const hero = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
} as const;
export default function Hero({ heading = "HERO-DEFAULT" }) { return <h1>{heading}</h1>; }`;
  /** `hero` is a plain spread; `early` is read before the JSX. */
  const route = (
    earlySlot = "early",
  ) => `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  const early = String(content("${earlySlot}").heading ?? "").toUpperCase();
  return (
    <main>
      <Hero {...content("hero")} />
      <Hero {...content("early")} heading={early} />
    </main>
  );
}`;
  const sections = (enabled: { hero?: boolean; early?: boolean } = {}) => [
    {
      id: "hero",
      type: "hero",
      componentRef: "src/components/Hero.tsx",
      enabled: enabled.hero ?? true,
      props: { heading: "Stored hero" },
    },
    {
      id: "early",
      type: "hero",
      componentRef: "src/components/Hero.tsx",
      enabled: enabled.early ?? true,
      props: { heading: "Stored early" },
    },
  ];

  function seed(
    options: {
      enabled?: { hero?: boolean; early?: boolean };
      contentModule?: string;
      templateType?: "index" | "layout";
    } = {},
  ) {
    const insert = sqlite.prepare(`
      INSERT INTO storefront_theme_files
        (id, storefront_id, theme_id, path, content, created_at, updated_at)
      VALUES (?, 'storefront-a', 'theme-a', ?, ?, 'now', 'now')
    `);
    insert.run("f-root", "src/routes/__root.tsx", root);
    for (const file of HIDE_ROOT_IMPORTS) insert.run(`f-${file.path}`, file.path, file.content);
    insert.run(
      "f-content",
      "src/morph/content.ts",
      options.contentModule ?? STARTER_THEME_CONTENT_MODULE_SOURCE,
    );
    insert.run("f-hero", "src/components/Hero.tsx", hero);
    insert.run("f-route", "src/routes/index.tsx", route());
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, created_at, updated_at)
        VALUES ('template-hide', 'theme-a', ?, 'Home', ?, 'now', 'now')`,
      )
      .run(
        options.templateType ?? "index",
        JSON.stringify({ version: 1, sections: sections(options.enabled) }),
      );
  }

  const write = (
    sectionId: string,
    props: Record<string, unknown>,
    expectedSourceGeneration = 1,
  ) =>
    storefrontThemeDal.updateSectionProps({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-hide",
      sectionId,
      props,
      expectedDraftGeneration: 1,
      expectedSourceGeneration,
      createdBy: "user-1",
      routePath: "/",
    });

  /** Everything a refused write must leave as it was. */
  const storedState = () => ({
    templates: sqlite.prepare("SELECT * FROM storefront_theme_templates").all(),
    revisions: sqlite
      .prepare("SELECT * FROM storefront_theme_template_revisions")
      .all(),
    files: sqlite
      .prepare("SELECT path, content FROM storefront_theme_files ORDER BY path")
      .all(),
  });

  it("hides a section whose every read Morph can omit, and keeps its props", async () => {
    seed();
    const result = await write("hero", { enabled: false });
    const saved = result?.document.sections.find(
      (section) => section.id === "hero",
    );
    expect(saved).toMatchObject({
      enabled: false,
      props: { heading: "Stored hero" },
    });
  });

  it("refuses a hide when the value is computed before the page renders it, writing nothing", async () => {
    seed();
    const before = storedState();
    await expect(write("early", { enabled: false })).rejects.toThrow(
      /SECTION_HIDE_UNSUPPORTED: early-computation: Morph cannot hide this section yet/,
    );
    expect(storedState()).toEqual(before);
  });

  it("always allows Show, even for a section it could not hide", async () => {
    seed({ enabled: { early: false } });
    const result = await write("early", { enabled: true });
    expect(
      result?.document.sections.find((section) => section.id === "early"),
    ).toMatchObject({ enabled: true, props: { heading: "Stored early" } });
  });

  it("judges only the transition: a section already hidden stays writable as hidden", async () => {
    seed({ enabled: { early: false } });
    await expect(write("early", { enabled: false })).resolves.not.toBeNull();
  });

  it("refuses a hide on a stale source generation before judging it, writing nothing", async () => {
    seed();
    const before = storedState();
    await expect(write("hero", { enabled: false }, 0)).rejects.toThrow(
      "SELECTION_SOURCE_CONFLICT",
    );
    expect(storedState()).toEqual(before);
  });

  it("a source save that lands between the check and the write wins; the hide does not", async () => {
    seed();
    const batch = workerEnv.DATABASE.batch;
    // The source changes after this write judged it, before its batch runs:
    // `hero` is now read before the JSX, which this write never saw.
    workerEnv.DATABASE.batch = (async (statements: unknown[]) => {
      workerEnv.DATABASE.batch = batch;
      sqlite
        .prepare(
          "UPDATE storefront_theme_files SET content = ? WHERE path = 'src/routes/index.tsx'",
        )
        .run(route("hero"));
      sqlite
        .prepare(
          "UPDATE storefront_themes SET source_generation = 2 WHERE id = 'theme-a'",
        )
        .run();
      return batch(statements as never);
    }) as typeof batch;
    const templatesBefore = sqlite
      .prepare("SELECT * FROM storefront_theme_templates")
      .all();
    try {
      await expect(write("hero", { enabled: false })).rejects.toThrow(
        "SELECTION_SOURCE_CONFLICT",
      );
    } finally {
      workerEnv.DATABASE.batch = batch;
    }
    expect(
      sqlite.prepare("SELECT * FROM storefront_theme_templates").all(),
    ).toEqual(templatesBefore);
    // On the generation that was written, the same hide is judged again and
    // refused: the verdict belongs to that source, not the one first read.
    await expect(write("hero", { enabled: false }, 2)).rejects.toThrow(
      "SECTION_HIDE_UNSUPPORTED: early-computation",
    );
  });

  it("A6: refuses a content() hide when the content module cannot be confirmed", async () => {
    seed({
      contentModule: STARTER_THEME_CONTENT_MODULE_SOURCE.replace(
        "export function isSectionHidden(",
        "function isSectionHidden(",
      ),
    });
    const before = storedState();
    await expect(write("hero", { enabled: false })).rejects.toThrow(
      "SECTION_HIDE_UNSUPPORTED: content-module-unconfirmed",
    );
    expect(storedState()).toEqual(before);
  });

  it("refuses hiding a layout section the layout source never reads, writing nothing", async () => {
    // Since main's Starter-layout source proof, a layout that reads no Design
    // content refuses every write before the hide is judged (as
    // SECTION_SOURCE_UNCONFIRMED, not P2's `legacy-shell`): the hide is
    // still refused, and nothing is written.
    seed({ templateType: "layout" });
    const before = storedState();
    await expect(write("hero", { enabled: false })).rejects.toThrow(
      "SECTION_SOURCE_UNCONFIRMED: This layout does not read Design content.",
    );
    expect(storedState()).toEqual(before);
  });

  // The classifier reads Start source only: until M3 P5 a hide on a Theme
  // recorded as another framework is refused at the boundary, from the
  // framework the owned Theme records.
  for (const framework of ["astro", "next"]) {
    it(`refuses a hide on a Theme recorded as ${framework}, writing nothing`, async () => {
      seed();
      sqlite
        .prepare(
          `UPDATE storefront_themes SET framework = '${framework}' WHERE id = 'theme-a'`,
        )
        .run();
      const before = storedState();
      await expect(write("hero", { enabled: false })).rejects.toThrow(
        /^SECTION_HIDE_UNSUPPORTED: framework-not-supported: Morph cannot hide this section yet/,
      );
      expect(storedState()).toEqual(before);
    });
  }

  it("reverse: the same hide on the Theme recorded as Start (or before frameworks were) is written", async () => {
    seed();
    sqlite
      .prepare("UPDATE storefront_themes SET framework = NULL WHERE id = 'theme-a'")
      .run();
    const result = await write("hero", { enabled: false });
    expect(
      result?.document.sections.find((section) => section.id === "hero"),
    ).toMatchObject({ enabled: false });
  });
});

/**
 * M3 Hide: a template served by several routes is hidden only when every one
 * of them can omit the section, whichever route the editor shows.
 */
describe("M3 Hide: a hide is judged on every route that serves the template", () => {
  const root = HIDE_STARTER_ROOT;
  const hero = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
} as const;
export default function Hero({ heading = "HERO-DEFAULT" }) { return <h1>{heading}</h1>; }`;
  const productRoute = (routeId: string, early: boolean) =>
    `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("${routeId}")({ component: Page });
function Page() {
${early ? `  const t = String(content("hero").heading ?? "").toUpperCase();\n  return <main><Hero {...content("hero")} heading={t} /></main>;` : `  return <main><Hero {...content("hero")} /></main>;`}
}`;

  function seed(featuredEarly: boolean) {
    const insert = sqlite.prepare(`
      INSERT INTO storefront_theme_files
        (id, storefront_id, theme_id, path, content, created_at, updated_at)
      VALUES (?, 'storefront-a', 'theme-a', ?, ?, 'now', 'now')
    `);
    insert.run("f-root", "src/routes/__root.tsx", root);
    for (const file of HIDE_ROOT_IMPORTS) insert.run(`f-${file.path}`, file.path, file.content);
    insert.run(
      "f-content",
      "src/morph/content.ts",
      STARTER_THEME_CONTENT_MODULE_SOURCE,
    );
    insert.run("f-hero", "src/components/Hero.tsx", hero);
    insert.run(
      "f-detail",
      "src/routes/products.$slug.tsx",
      productRoute("/products/$slug", false),
    );
    insert.run(
      "f-list",
      "src/routes/products.featured.tsx",
      productRoute("/products/featured", featuredEarly),
    );
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, created_at, updated_at)
        VALUES ('template-product-hide', 'theme-a', 'product', 'Product', ?, 'now', 'now')`,
      )
      .run(
        JSON.stringify({
          version: 1,
          sections: [
            {
              id: "hero",
              type: "hero",
              componentRef: "src/components/Hero.tsx",
              enabled: true,
              props: { heading: "Stored" },
            },
          ],
        }),
      );
  }
  const hide = (routePath: string) =>
    storefrontThemeDal.updateSectionProps({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-product-hide",
      sectionId: "hero",
      props: { enabled: false },
      expectedDraftGeneration: 1,
      expectedSourceGeneration: 1,
      createdBy: "user-1",
      routePath,
    });
  const stored = () =>
    sqlite.prepare("SELECT * FROM storefront_theme_templates").all();

  it("refuses a hide asked on a supported route when another route of the template reads the section early", async () => {
    seed(true);
    const before = stored();
    await expect(hide("/products/$slug")).rejects.toThrow(
      /SECTION_HIDE_UNSUPPORTED: early-computation: .*products\.featured\.tsx/,
    );
    expect(stored()).toEqual(before);
  });

  it("reverse: with every route able to omit it, the same hide is written", async () => {
    seed(false);
    const result = await hide("/products/$slug");
    expect(result?.document.sections[0]).toMatchObject({ enabled: false });
  });
});

/**
 * M3 Hide P4: a publish judges every hidden section it seals against the
 * build's own source revision and the guard that build carries; a historical
 * release is never rebuilt or rewritten by it.
 */
describe("M3 Hide: publish judges hidden sections by the build's revision and guard", () => {
  const SOURCE = "22222222-2222-4222-8222-222222222222";
  const BUILD = "33333333-3333-4333-8333-333333333333";
  const DRAFT = "cccccccc-1111-4111-8111-111111111111";
  const root = HIDE_STARTER_ROOT;
  const hero = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
} as const;
export default function Hero({ heading = "HERO-DEFAULT" }) { return <h1>{heading}</h1>; }`;
  /** `hero` is a plain spread; `early` is read before the JSX. */
  const route = (
    options: { earlySlot?: string; starterGuard?: boolean } = {},
  ) =>
    `import { createFileRoute } from "@tanstack/react-router";
import { content, isSectionHidden } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  const early = String(content("${options.earlySlot ?? "early"}").heading ?? "").toUpperCase();
  return (
    <main>
      ${options.starterGuard ? `{!isSectionHidden("hero") && <Hero {...content("hero")} />}` : `<Hero {...content("hero")} />`}
      <Hero {...content("early")} heading={early} />
    </main>
  );
}`;
  const files = (routeSource: string) => [
    { path: "src/routes/__root.tsx", content: root },
    ...HIDE_ROOT_IMPORTS,
    {
      path: "src/morph/content.ts",
      content: STARTER_THEME_CONTENT_MODULE_SOURCE,
    },
    { path: "src/components/Hero.tsx", content: hero },
    { path: "src/routes/index.tsx", content: routeSource },
  ];

  function seed(options: {
    hidden: readonly string[];
    compilerVersion: string | null;
    workspaceRoute?: string;
  }) {
    const insert = sqlite.prepare(`
      INSERT INTO storefront_theme_files
        (id, storefront_id, theme_id, path, content, created_at, updated_at)
      VALUES (?, 'storefront-a', 'theme-a', ?, ?, 'now', 'now')
    `);
    for (const file of files(options.workspaceRoute ?? route())) {
      insert.run(`f-${file.path}`, file.path, file.content);
    }
    const document = JSON.stringify({
      version: 1,
      sections: ["hero", "early"].map((id) => ({
        id,
        type: "hero",
        componentRef: "src/components/Hero.tsx",
        enabled: !options.hidden.includes(id),
        props: { heading: `Stored ${id}` },
      })),
    });
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, draft_revision_id, published_revision_id, draft_generation, created_at, updated_at)
        VALUES ('template-hide-pub', 'theme-a', 'index', 'Home', ?, ?, NULL, 1, 'now', 'now')`,
      )
      .run(document, DRAFT);
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_template_revisions
          (id, template_id, version, document, created_at)
        VALUES (?, 'template-hide-pub', 1, ?, 'now')`,
      )
      .run(DRAFT, document);
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_revisions
          (id, storefront_id, theme_id, revision_number, message, source, snapshot, created_at, updated_at)
        VALUES (?, 'storefront-a', 'theme-a', 1, 'Checkpoint', 'publish', '[]', 'now', 'now')`,
      )
      .run(SOURCE);
    sqlite
      .prepare(
        "UPDATE storefront_theme_builds SET compiler_version = ? WHERE id = ?",
      )
      .run(options.compilerVersion, BUILD);
  }

  const publish = (
    readSourceRevisionFiles: (
      revisionId: string,
    ) => Promise<
      readonly { path: string; content: string | null }[]
    > = workspaceRevisionFiles,
  ) =>
    storefrontThemeDal.publishTemplate({
      readSourceRevisionFiles,
      verifySourceRevision: acceptRevision,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-hide-pub",
      sourceRevisionId: SOURCE,
      themeBuildId: BUILD,
      expectedDraftRevisionId: DRAFT,
      expectedDraftGeneration: 1,
      expectedReleaseGeneration: 1,
    });
  const released = () => ({
    releases: sqlite.prepare("SELECT id FROM storefront_releases").all(),
    active: sqlite
      .prepare(
        "SELECT active_release_id AS id FROM storefronts WHERE id = 'storefront-a'",
      )
      .get(),
    template: sqlite
      .prepare(
        "SELECT published_revision_id AS id FROM storefront_theme_templates WHERE id = 'template-hide-pub'",
      )
      .get(),
  });
  const guarded = withThemeStartBuildIdentity("1.168.32");
  const preGuard = withThemeMorphSdkIdentity("1.168.32");

  it("publishes a hidden section the revision can hide, with a build that carries the guard", async () => {
    seed({ hidden: ["hero"], compilerVersion: guarded });
    const result = await publish();
    expect(result?.releaseId).toBeTruthy();
    expect(released().releases).toHaveLength(1);
  });

  it("refuses a hidden section the revision cannot hide, naming it and why, and writes nothing", async () => {
    seed({ hidden: ["early"], compilerVersion: guarded });
    const before = released();
    await expect(publish()).rejects.toThrow(
      /^PUBLISH_HIDDEN_SECTION_UNSUPPORTED: .*"early" on the index page \(early-computation\)/,
    );
    expect(released()).toEqual(before);
  });

  it("asks for a rebuild when the build was made before the guard, and writes nothing", async () => {
    seed({ hidden: ["hero"], compilerVersion: preGuard });
    const before = released();
    await expect(publish()).rejects.toThrow(
      /^PUBLISH_HIDE_REBUILD_REQUIRED: .*"hero" on the index page/,
    );
    expect(released()).toEqual(before);
  });

  it("needs no rebuild for a section the Starter's own guard already hides", async () => {
    seed({
      hidden: ["hero"],
      compilerVersion: preGuard,
      workspaceRoute: route({ starterGuard: true }),
    });
    await expect(publish()).resolves.toMatchObject({
      releaseId: expect.any(String),
    });
  });

  it("does not judge a publish with nothing hidden, whatever its build", async () => {
    seed({ hidden: [], compilerVersion: preGuard });
    await expect(publish()).resolves.toMatchObject({
      releaseId: expect.any(String),
    });
  });

  it("judges the build's revision, never the workspace", async () => {
    // The workspace now reads `hero` before the JSX; the revision built and
    // published does not.
    seed({
      hidden: ["hero"],
      compilerVersion: guarded,
      workspaceRoute: route({ earlySlot: "hero" }),
    });
    await expect(publish(async () => files(route()))).resolves.toMatchObject({
      releaseId: expect.any(String),
    });
  });

  it("reverse: the same publish, its revision reading `hero` early, is refused", async () => {
    seed({ hidden: ["hero"], compilerVersion: guarded });
    await expect(
      publish(async () => files(route({ earlySlot: "hero" }))),
    ).rejects.toThrow("PUBLISH_HIDDEN_SECTION_UNSUPPORTED");
  });
});

/**
 * M3 Hide P4: a publish judges a hidden section on every route that serves
 * its template, as the write does. A template no route serves is refused
 * (M3 Hide step 1): that alone does not prove nothing renders it.
 */
describe("M3 Hide: publish judges every route of the template, and refuses one no route serves", () => {
  const SOURCE = "22222222-2222-4222-8222-222222222222";
  const BUILD = "33333333-3333-4333-8333-333333333333";
  const DRAFT = "dddddddd-1111-4111-8111-111111111111";
  const root = HIDE_STARTER_ROOT;
  const hero = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
} as const;
export default function Hero({ heading = "HERO-DEFAULT" }) { return <h1>{heading}</h1>; }`;
  const productRoute = (routeId: string, early: boolean) =>
    `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("${routeId}")({ component: Page });
function Page() {
${early ? `  const t = String(content("hero").heading ?? "").toUpperCase();\n  return <main><Hero {...content("hero")} heading={t} /></main>;` : `  return <main><Hero {...content("hero")} /></main>;`}
}`;
  const revision = (routes: ReadonlyArray<[string, string]>) => [
    { path: "src/routes/__root.tsx", content: root },
    ...HIDE_ROOT_IMPORTS,
    {
      path: "src/morph/content.ts",
      content: STARTER_THEME_CONTENT_MODULE_SOURCE,
    },
    { path: "src/components/Hero.tsx", content: hero },
    ...routes.map(([path, content]) => ({ path, content })),
  ];
  const twoRoutes = (featuredEarly: boolean) =>
    revision([
      ["src/routes/products.$slug.tsx", productRoute("/products/$slug", false)],
      [
        "src/routes/products.featured.tsx",
        productRoute("/products/featured", featuredEarly),
      ],
    ]);

  function seed(template: { type: string; routePath: string | null }) {
    const document = JSON.stringify({
      version: 1,
      sections: [
        {
          id: "hero",
          type: "hero",
          componentRef: "src/components/Hero.tsx",
          enabled: false,
          props: { heading: "Stored" },
        },
      ],
    });
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, route_path, document, draft_revision_id, published_revision_id, draft_generation, created_at, updated_at)
        VALUES ('template-multi', 'theme-a', ?, 'T', ?, ?, ?, NULL, 1, 'now', 'now')`,
      )
      .run(template.type, template.routePath, document, DRAFT);
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_template_revisions
          (id, template_id, version, document, created_at)
        VALUES (?, 'template-multi', 1, ?, 'now')`,
      )
      .run(DRAFT, document);
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_revisions
          (id, storefront_id, theme_id, revision_number, message, source, snapshot, created_at, updated_at)
        VALUES (?, 'storefront-a', 'theme-a', 1, 'Checkpoint', 'publish', '[]', 'now', 'now')`,
      )
      .run(SOURCE);
    sqlite
      .prepare(
        "UPDATE storefront_theme_builds SET compiler_version = ? WHERE id = ?",
      )
      .run(withThemeStartBuildIdentity("1.168.32"), BUILD);
  }
  const publish = (files: ReadonlyArray<{ path: string; content: string }>) =>
    storefrontThemeDal.publishTemplate({
      readSourceRevisionFiles: async () => files,
      verifySourceRevision: acceptRevision,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-multi",
      sourceRevisionId: SOURCE,
      themeBuildId: BUILD,
      expectedDraftRevisionId: DRAFT,
      expectedDraftGeneration: 1,
      expectedReleaseGeneration: 1,
    });
  const releases = () =>
    sqlite.prepare("SELECT id FROM storefront_releases").all();

  it("refuses when another route of the template reads the hidden section early", async () => {
    seed({ type: "product", routePath: null });
    await expect(publish(twoRoutes(true))).rejects.toThrow(
      /^PUBLISH_HIDDEN_SECTION_UNSUPPORTED: .*"hero" .*\(early-computation\)/,
    );
    expect(releases()).toEqual([]);
  });

  it("reverse: every route of the template can omit it, so it publishes", async () => {
    seed({ type: "product", routePath: null });
    await expect(publish(twoRoutes(false))).resolves.toMatchObject({
      releaseId: expect.any(String),
    });
  });

  // M3 Hide step 1 (review point 1): "no route serves it" is not proof that
  // nothing renders it, so until the whole-Theme proof lands such a hidden
  // section is refused. These two used to publish.
  it("refuses a template no route serves: Morph cannot confirm nothing renders its hidden section", async () => {
    seed({ type: "product", routePath: null });
    await expect(
      publish(
        revision([
          [
            "src/routes/index.tsx",
            // The index template's own `hero`, not the product template's.
            productRoute("/", true),
          ],
        ]),
      ),
    ).rejects.toThrow(
      /^PUBLISH_HIDDEN_SECTION_UNSUPPORTED: .*"hero" on the product page \(no-call-site\)/,
    );
    expect(releases()).toEqual([]);
  });

  it("refuses a route document whose route is no longer in the Theme", async () => {
    seed({ type: "page", routePath: "/aboutus" });
    await expect(publish(twoRoutes(false))).rejects.toThrow(
      /^PUBLISH_HIDDEN_SECTION_UNSUPPORTED: .*"hero" on the \/aboutus page \(no-call-site\)/,
    );
    expect(releases()).toEqual([]);
  });

  /**
   * Review point 4: a deleted CMS Page leaves the publication, and its URL
   * falls back to the generic Page template. That template's own hidden
   * sections are judged like any other template's.
   */
  describe("a deleted Page whose URL falls back to the Page template", () => {
    const pagesRoute = (early: boolean) =>
      revision([
        ["src/routes/pages.$handle.tsx", productRoute("/pages/$handle", early)],
      ]);
    const deletedPage = () => {
      sqlite
        .prepare(
          `INSERT INTO storefront_pages
            (id, storefront_id, title, handle, status, published_revision_id, created_by, created_at, updated_at, deleted_at)
          VALUES ('page-gone', 'storefront-a', 'Gone', 'gone', 'published', 'page-gone-rev', 'user-1', 'now', 'now', 'now')`,
        )
        .run();
      sqlite
        .prepare(
          "INSERT INTO storefront_page_revisions VALUES ('page-gone-rev', 'page-gone', ?)",
        )
        .run(
          JSON.stringify({
            version: 1,
            handle: "gone",
            sections: [{ id: "hero", type: "hero", enabled: false, props: {} }],
          }),
        );
    };
    const sealedItems = () =>
      sqlite
        .prepare(
          "SELECT item_type AS itemType, content_id AS contentId FROM storefront_content_publication_items",
        )
        .all();

    it("judges the fallback template's hidden section and refuses what its route cannot hide", async () => {
      seed({ type: "page", routePath: null });
      deletedPage();
      await expect(publish(pagesRoute(true))).rejects.toThrow(
        /^PUBLISH_HIDDEN_SECTION_UNSUPPORTED: .*"hero" on the page page \(early-computation\)/,
      );
      expect(releases()).toEqual([]);
    });

    it("reverse: publishes when the route can hide it, and the deleted Page is not sealed", async () => {
      seed({ type: "page", routePath: null });
      deletedPage();
      await expect(publish(pagesRoute(false))).resolves.toMatchObject({
        releaseId: expect.any(String),
      });
      expect(sealedItems()).toEqual([
        { itemType: "template", contentId: "template-multi" },
      ]);
    });
  });

  /**
   * Review point 3 (ported from 7782a73, PR-1 review item 5): publish judges
   * the binding the publication item captured, not the template row, which
   * a Code-mode rename can move while the publish runs. `/old` is a shell
   * that never reads the Document, so its hidden section cannot be hidden
   * there; `/new` renders it through a call site the guard omits.
   */
  describe("a route rename racing the publish", () => {
    const oldShell = `import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/old")({ component: Old });
function Old() { return <main>Old</main>; }`;
    const renameRevision = () =>
      revision([
        ["src/routes/old.tsx", oldShell],
        ["src/routes/new.tsx", productRoute("/new", false)],
      ]);
    const duringPublish = (change: () => void, strip = false) => {
      const original =
        storefrontContentPublicationDal.readDocumentsForDraft.bind(
          storefrontContentPublicationDal,
        );
      return vi
        .spyOn(storefrontContentPublicationDal, "readDocumentsForDraft")
        .mockImplementation(async (args) => {
          const documents = await original(args);
          // After the publication captured `/old`, before the hide check.
          change();
          return strip
            ? documents.map((entry) => ({
                ...entry,
                item: { ...entry.item, metadata: undefined },
              }))
            : documents;
        });
    };
    const rename = () =>
      sqlite
        .prepare(
          "UPDATE storefront_theme_templates SET route_path = '/new' WHERE id = 'template-multi'",
        )
        .run();

    it("judges the captured /old, and refuses, when the row is renamed to /new mid-publish", async () => {
      seed({ type: "page", routePath: "/old" });
      const spy = duringPublish(rename);
      try {
        await expect(publish(renameRevision())).rejects.toThrow(
          /^PUBLISH_HIDDEN_SECTION_UNSUPPORTED: .*"hero" on the \/old page \(legacy-shell\)/,
        );
        expect(spy).toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
      expect(releases()).toEqual([]);
    });

    it("control: a template bound to /new from the start publishes", async () => {
      seed({ type: "page", routePath: "/new" });
      await expect(publish(renameRevision())).resolves.toMatchObject({
        releaseId: expect.any(String),
      });
    });

    it("refuses an item that captured no binding instead of judging the row", async () => {
      seed({ type: "page", routePath: "/new" });
      const spy = duringPublish(() => {}, true);
      try {
        await expect(publish(renameRevision())).rejects.toThrow(
          /^PUBLISH_HIDDEN_SECTION_UNSUPPORTED: Morph cannot confirm which page a hidden section belongs to/,
        );
      } finally {
        spy.mockRestore();
      }
      expect(releases()).toEqual([]);
    });
  });
});

/**
 * M3 Hide step 1: every item in the sealed publication that carries a hidden
 * section is judged, not only Start templates. A CMS Page item (D4) and any
 * Theme whose framework is not Start (D3; Astro until M3b) are refused,
 * naming the item and section with the way out, and the active release,
 * its publication and every published pointer stay as they were.
 */
describe("M3 Hide: publish judges every hidden item it seals", () => {
  const SOURCE = "22222222-2222-4222-8222-222222222222";
  const BUILD = "33333333-3333-4333-8333-333333333333";
  const root = HIDE_STARTER_ROOT;
  const hero = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
} as const;
export default function Hero({ heading = "HERO-DEFAULT" }) { return <h1>{heading}</h1>; }`;
  const index = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: Home });
function Home() { return <main><Hero {...content("hero")} /></main>; }`;
  const revisionFiles = async () => [
    { path: "src/routes/__root.tsx", content: root },
    ...HIDE_ROOT_IMPORTS,
    {
      path: "src/morph/content.ts",
      content: STARTER_THEME_CONTENT_MODULE_SOURCE,
    },
    { path: "src/components/Hero.tsx", content: hero },
    { path: "src/routes/index.tsx", content: index },
  ];
  const documentOf = (heading: string, hidden: boolean, handle?: string) =>
    JSON.stringify({
      version: 1,
      ...(handle ? { handle } : {}),
      sections: [
        {
          id: "hero",
          type: "hero",
          componentRef: "src/components/Hero.tsx",
          enabled: !hidden,
          props: { heading },
        },
      ],
    });

  let draft = 0;
  /** A new template draft, so the next publish seals a new publication. */
  const saveTemplateDraft = (hidden: boolean) => {
    draft += 1;
    const id = `tpl-draft-${draft}`;
    const document = documentOf(`Home ${draft}`, hidden);
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_template_revisions
          (id, template_id, version, document, created_at)
        VALUES (?, 'template-gate', ?, ?, 'now')`,
      )
      .run(id, draft, document);
    sqlite
      .prepare(
        `UPDATE storefront_theme_templates
           SET draft_revision_id = ?, document = ?, draft_generation = ?
         WHERE id = 'template-gate'`,
      )
      .run(id, document, draft);
    return { id, generation: draft };
  };
  /** A Page whose published revision a Theme publish carries. */
  const publishedPage = (options: { hidden: boolean; revisionId: string }) => {
    sqlite
      .prepare(
        "INSERT INTO storefront_page_revisions VALUES (?, 'page-about', ?)",
      )
      .run(options.revisionId, documentOf("About us", options.hidden, "about"));
    const exists = sqlite
      .prepare("SELECT id FROM storefront_pages WHERE id = 'page-about'")
      .get();
    if (exists) {
      sqlite
        .prepare(
          "UPDATE storefront_pages SET published_revision_id = ? WHERE id = 'page-about'",
        )
        .run(options.revisionId);
    } else {
      sqlite
        .prepare(
          `INSERT INTO storefront_pages
            (id, storefront_id, title, handle, status, published_revision_id, created_by, created_at, updated_at)
          VALUES ('page-about', 'storefront-a', 'About', 'about', 'published', ?, 'user-1', 'now', 'now')`,
        )
        .run(options.revisionId);
    }
  };

  function seed(options: { framework?: string; templateHidden?: boolean }) {
    draft = 0;
    if (options.framework) {
      sqlite
        .prepare(
          "UPDATE storefront_themes SET framework = ? WHERE id = 'theme-a'",
        )
        .run(options.framework);
    }
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, draft_revision_id, published_revision_id, draft_generation, created_at, updated_at)
        VALUES ('template-gate', 'theme-a', 'index', 'Home', '{}', NULL, NULL, 0, 'now', 'now')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_revisions
          (id, storefront_id, theme_id, revision_number, message, source, snapshot, created_at, updated_at)
        VALUES (?, 'storefront-a', 'theme-a', 1, 'Checkpoint', 'publish', '[]', 'now', 'now')`,
      )
      .run(SOURCE);
    sqlite
      .prepare(
        "UPDATE storefront_theme_builds SET compiler_version = ? WHERE id = ?",
      )
      .run(withThemeStartBuildIdentity("1.168.32"), BUILD);
    return saveTemplateDraft(options.templateHidden ?? false);
  }

  const publish = (draftRevision: { id: string; generation: number }) => {
    const { generation } = sqlite
      .prepare(
        "SELECT release_generation AS generation FROM storefront_themes WHERE id = 'theme-a'",
      )
      .get() as { generation: number };
    return storefrontThemeDal.publishTemplate({
      readSourceRevisionFiles: revisionFiles,
      verifySourceRevision: acceptRevision,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-gate",
      sourceRevisionId: SOURCE,
      themeBuildId: BUILD,
      expectedDraftRevisionId: draftRevision.id,
      expectedDraftGeneration: draftRevision.generation,
      expectedReleaseGeneration: generation,
    });
  };
  /** Everything a publish writes: releases, pointers, publications. */
  const liveState = () => ({
    releases: sqlite.prepare("SELECT id FROM storefront_releases").all(),
    active: sqlite
      .prepare(
        "SELECT active_release_id AS id FROM storefronts WHERE id = 'storefront-a'",
      )
      .get() as { id: string | null },
    theme: sqlite
      .prepare(
        "SELECT release_generation, published_source_revision_id FROM storefront_themes WHERE id = 'theme-a'",
      )
      .get(),
    template: sqlite
      .prepare(
        "SELECT published_revision_id AS id, draft_generation FROM storefront_theme_templates WHERE id = 'template-gate'",
      )
      .get(),
    publications: sqlite
      .prepare("SELECT id FROM storefront_content_publications")
      .all(),
    items: sqlite
      .prepare("SELECT id FROM storefront_content_publication_items")
      .all(),
  });

  it("refuses a CMS Page item with a hidden section, naming the Page and section, and leaves the active release as it was", async () => {
    const first = seed({});
    publishedPage({ hidden: false, revisionId: "page-rev-shown" });
    const live = await publish(first);
    expect(live?.releaseId).toBeTruthy();

    // A Page section hidden before Pages refused new hides, published from
    // the Dashboard: it goes live with the next Theme publish.
    publishedPage({ hidden: true, revisionId: "page-rev-hidden" });
    const next = saveTemplateDraft(false);
    const before = liveState();
    await expect(publish(next)).rejects.toThrow(
      /^PUBLISH_HIDDEN_SECTION_UNSUPPORTED: .*"hero" on the Page "About" \(\/pages\/about\) \(no-call-site\).*restore that version as a draft from the Page's revisions, save the Page with Publish page on, then publish the Theme again; otherwise contact support/,
    );
    expect(liveState()).toEqual(before);
    expect(before.active.id).toBe(live?.releaseId);
  });

  it("reverse: the same publish with the Page's section shown goes ahead", async () => {
    const first = seed({});
    publishedPage({ hidden: false, revisionId: "page-rev-shown" });
    await expect(publish(first)).resolves.toMatchObject({
      releaseId: expect.any(String),
    });
    const next = saveTemplateDraft(false);
    await expect(publish(next)).resolves.toMatchObject({
      releaseId: expect.any(String),
    });
    expect(liveState().releases).toHaveLength(2);
  });

  it("still judges a Start template's hidden section by its source alongside a shown Page", async () => {
    const first = seed({ templateHidden: true });
    publishedPage({ hidden: false, revisionId: "page-rev-shown" });
    // `hero` is a plain spread the guard omits: supported, as before.
    await expect(publish(first)).resolves.toMatchObject({
      releaseId: expect.any(String),
    });
  });

  it("refuses an Astro Theme's hidden section until Morph can hide it there, and writes nothing", async () => {
    const first = seed({ framework: "astro", templateHidden: true });
    const before = liveState();
    await expect(publish(first)).rejects.toThrow(
      /^PUBLISH_HIDDEN_SECTION_UNSUPPORTED: Morph cannot hide sections on Astro Themes yet.*"hero" on the index page \(framework-not-supported\).*They cannot be shown again from the editor yet; contact support/,
    );
    expect(liveState()).toEqual(before);
  });

  it("refuses a hidden section on any other framework that is not Start, Pages included", async () => {
    const first = seed({ framework: "other-framework" });
    publishedPage({ hidden: true, revisionId: "page-rev-hidden" });
    const before = liveState();
    await expect(publish(first)).rejects.toThrow(
      /^PUBLISH_HIDDEN_SECTION_UNSUPPORTED: Morph cannot hide sections on other-framework Themes yet.*"hero" on the Page "About" \(\/pages\/about\) \(framework-not-supported\)/,
    );
    expect(liveState()).toEqual(before);
  });

  it("reverse: an Astro Theme with nothing hidden publishes as before", async () => {
    const first = seed({ framework: "astro" });
    publishedPage({ hidden: false, revisionId: "page-rev-shown" });
    await expect(publish(first)).resolves.toMatchObject({
      releaseId: expect.any(String),
    });
  });

  /**
   * Review point 6: a Page published from the Dashboard goes live with the
   * next Theme publish. With the page, layout and deployed build unchanged
   * that publish used to answer "already published" before reading the
   * carried Page revisions, so a corrected Page could never go live.
   */
  describe("a Page published after the live release, with nothing else changed", () => {
    /** The selected template's draft as it stands now. */
    const currentDraft = () => {
      const row = sqlite
        .prepare(
          "SELECT draft_revision_id AS id, draft_generation AS generation FROM storefront_theme_templates WHERE id = 'template-gate'",
        )
        .get() as { id: string; generation: number };
      return row;
    };
    const publishDeployed = async () => {
      const result = await publish(currentDraft());
      if (result?.releaseCreated && result.releaseId) {
        await storefrontReleaseDal.recordDeployedThemeBuild({
          storefrontId: "storefront-a",
          releaseId: result.releaseId,
          themeBuildId: BUILD,
        });
      }
      return result;
    };
    const livePageRevision = () =>
      (
        sqlite
          .prepare(
            `SELECT i.revision_id AS id
               FROM storefronts s
               JOIN storefront_releases r ON r.id = s.active_release_id
               JOIN storefront_content_publication_items i ON i.publication_id = r.content_publication_id
              WHERE s.id = 'storefront-a' AND i.item_type = 'page' AND i.content_id = 'page-about'`,
          )
          .get() as { id: string } | undefined
      )?.id;

    it("control: a republish with nothing new is already published", async () => {
      seed({});
      publishedPage({ hidden: false, revisionId: "page-rev-shown" });
      await publishDeployed();
      await expect(publishDeployed()).resolves.toMatchObject({
        releaseCreated: false,
      });
    });

    it("seals the newly published Page revision instead of answering already published", async () => {
      seed({});
      publishedPage({ hidden: false, revisionId: "page-rev-shown" });
      await publishDeployed();
      publishedPage({ hidden: false, revisionId: "page-rev-shown-2" });
      await expect(publishDeployed()).resolves.toMatchObject({
        releaseCreated: true,
      });
      expect(livePageRevision()).toBe("page-rev-shown-2");
    });

    it("judges that Page revision: a newly published hidden section is refused, not skipped", async () => {
      seed({});
      publishedPage({ hidden: false, revisionId: "page-rev-shown" });
      const live = await publishDeployed();
      publishedPage({ hidden: true, revisionId: "page-rev-hidden" });
      await expect(publishDeployed()).rejects.toThrow(
        /^PUBLISH_HIDDEN_SECTION_UNSUPPORTED: .*"hero" on the Page "About"/,
      );
      expect(livePageRevision()).toBe("page-rev-shown");
      expect(liveState().active.id).toBe(live?.releaseId);
    });
  });
});

/**
 * M3 Hide step 1, review point 1: until the step-2 proof lands, a hidden
 * section on a Start template publishes only when every route that serves
 * the template is positively judged a supported call site. "Not rendered"
 * by the route, and "no route serves it", are refused: a section moved into
 * an imported wrapper is not named by the route, yet the wrapper renders it.
 */
describe("M3 Hide: a hidden Start section must be positively judged to publish", () => {
  const SOURCE = "22222222-2222-4222-8222-222222222222";
  const BUILD = "33333333-3333-4333-8333-333333333333";
  const DRAFT = "eeeeeeee-1111-4111-8111-111111111111";
  const LAYOUT_DRAFT = "eeeeeeee-2222-4222-8222-222222222222";
  const root = HIDE_STARTER_ROOT;
  const hero = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
} as const;
export default function Hero({ heading = "HERO-DEFAULT" }) { return <h1>{heading}</h1>; }`;
  const wrapper = `import { content } from "../morph/content";
import Hero from "./Hero";
export default function HeroWrapper() { return <Hero {...content("hero")} />; }`;
  const wrappedRoute = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
import HeroWrapper from "../components/HeroWrapper";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return (
    <main>
      <HeroWrapper />
      <Hero {...content("other")} />
    </main>
  );
}`;
  const wrappedRevision = async () => [
    { path: "src/routes/__root.tsx", content: root },
    ...HIDE_ROOT_IMPORTS,
    {
      path: "src/morph/content.ts",
      content: STARTER_THEME_CONTENT_MODULE_SOURCE,
    },
    { path: "src/components/Hero.tsx", content: hero },
    { path: "src/components/HeroWrapper.tsx", content: wrapper },
    { path: "src/routes/index.tsx", content: wrappedRoute },
  ];
  const starterRevision = async () =>
    starterThemeWorkspaceFiles().map(({ path, content }) => ({
      path,
      content,
    }));

  function seed(options: {
    document: StorefrontPageDocument;
    layout?: StorefrontPageDocument;
    compilerVersion: string;
  }) {
    const document = JSON.stringify(options.document);
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, draft_revision_id, published_revision_id, draft_generation, created_at, updated_at)
        VALUES ('template-judged', 'theme-a', 'index', 'Home', ?, ?, NULL, 1, 'now', 'now')`,
      )
      .run(document, DRAFT);
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_template_revisions
          (id, template_id, version, document, created_at)
        VALUES (?, 'template-judged', 1, ?, 'now')`,
      )
      .run(DRAFT, document);
    if (options.layout) {
      const layout = JSON.stringify(options.layout);
      sqlite
        .prepare(
          `INSERT INTO storefront_theme_templates
            (id, theme_id, type, name, document, draft_revision_id, published_revision_id, draft_generation, created_at, updated_at)
          VALUES ('layout-judged', 'theme-a', 'layout', 'Layout', ?, ?, NULL, 1, 'now', 'now')`,
        )
        .run(layout, LAYOUT_DRAFT);
      sqlite
        .prepare(
          `INSERT INTO storefront_theme_template_revisions
            (id, template_id, version, document, created_at)
          VALUES (?, 'layout-judged', 1, ?, 'now')`,
        )
        .run(LAYOUT_DRAFT, layout);
    }
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_revisions
          (id, storefront_id, theme_id, revision_number, message, source, snapshot, created_at, updated_at)
        VALUES (?, 'storefront-a', 'theme-a', 1, 'Checkpoint', 'publish', '[]', 'now', 'now')`,
      )
      .run(SOURCE);
    sqlite
      .prepare(
        "UPDATE storefront_theme_builds SET compiler_version = ? WHERE id = ?",
      )
      .run(options.compilerVersion, BUILD);
  }
  const publish = (
    readSourceRevisionFiles: () => Promise<
      readonly { path: string; content: string }[]
    >,
  ) =>
    storefrontThemeDal.publishTemplate({
      readSourceRevisionFiles,
      verifySourceRevision: acceptRevision,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-judged",
      sourceRevisionId: SOURCE,
      themeBuildId: BUILD,
      expectedDraftRevisionId: DRAFT,
      expectedDraftGeneration: 1,
      expectedReleaseGeneration: 1,
    });
  const releases = () =>
    sqlite.prepare("SELECT id FROM storefront_releases").all();
  const section = (id: string, enabled: boolean) => ({
    id,
    type: "hero",
    componentRef: "src/components/Hero.tsx",
    enabled,
    props: { heading: `Stored ${id}` },
  });
  const allHidden = (document: StorefrontPageDocument) => ({
    ...document,
    sections: document.sections.map((entry) => ({
      ...entry,
      enabled: false,
    })),
  });

  it("refuses a hidden section the route renders only through an imported wrapper", async () => {
    seed({
      document: {
        version: 1,
        sections: [section("hero", false), section("other", true)],
      },
      compilerVersion: withThemeStartBuildIdentity("1.168.32"),
    });
    await expect(publish(wrappedRevision)).rejects.toThrow(
      /^PUBLISH_HIDDEN_SECTION_UNSUPPORTED: .*"hero" on the index page \(no-call-site\)/,
    );
    expect(releases()).toEqual([]);
  });

  it("reverse: the same Theme publishes while that section is shown", async () => {
    seed({
      document: {
        version: 1,
        sections: [section("hero", true), section("other", false)],
      },
      compilerVersion: withThemeStartBuildIdentity("1.168.32"),
    });
    await expect(publish(wrappedRevision)).resolves.toMatchObject({
      releaseId: expect.any(String),
    });
  });

  // The Starter's own home and layout hides must keep publishing: every
  // section is rendered by a call site the classifier judges supported.
  for (const [build, compilerVersion] of [
    ["a guarded build", withThemeStartBuildIdentity("1.168.32")],
    ["a build from before the guard", withThemeMorphSdkIdentity("1.168.32")],
  ] as const) {
    it(`still publishes the untouched Starter with every home and layout section hidden, on ${build}`, async () => {
      seed({
        document: allHidden(createDefaultStorefrontHomeDocument()),
        layout: allHidden(createDefaultStorefrontLayoutDocument()),
        compilerVersion,
      });
      await expect(publish(starterRevision)).resolves.toMatchObject({
        releaseId: expect.any(String),
      });
    });
  }
});

/**
 * M3 Hide step 1, review point 2: the hide check must judge the bytes the
 * publish seals. The pending layout is sealed from the copy the publish read
 * first, and its unpublished draft is edited in place, so an edit between
 * that read and the check's reread used to be checked while the first copy
 * was written back. The batch now repeats the layout's draft generation.
 */
describe("M3 Hide: a layout edit racing the publish", () => {
  const SOURCE = "22222222-2222-4222-8222-222222222222";
  const BUILD = "33333333-3333-4333-8333-333333333333";
  const DRAFT = "ffffffff-1111-4111-8111-111111111111";
  const LAYOUT_DRAFT = "ffffffff-2222-4222-8222-222222222222";
  const root = HIDE_STARTER_ROOT;
  const index = `import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/")({ component: Home });
function Home() { return <main>Home</main>; }`;
  const revisionFiles = async () => [
    { path: "src/routes/__root.tsx", content: root },
    ...HIDE_ROOT_IMPORTS,
    {
      path: "src/morph/content.ts",
      content: STARTER_THEME_CONTENT_MODULE_SOURCE,
    },
    { path: "src/routes/index.tsx", content: index },
  ];
  const layoutOf = (promoEnabled: boolean) =>
    JSON.stringify({
      version: 1,
      sections: [
        {
          id: "promo",
          type: "promo",
          enabled: promoEnabled,
          props: { title: "Stored promo" },
        },
      ],
    });

  function seed() {
    const document = JSON.stringify({ version: 1, sections: [] });
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, draft_revision_id, published_revision_id, draft_generation, created_at, updated_at)
        VALUES ('template-race', 'theme-a', 'index', 'Home', ?, ?, NULL, 1, 'now', 'now')`,
      )
      .run(document, DRAFT);
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_template_revisions
          (id, template_id, version, document, created_at)
        VALUES (?, 'template-race', 1, ?, 'now')`,
      )
      .run(DRAFT, document);
    // The layout's draft hides `promo`; nothing in this Theme can hide it.
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, document, draft_revision_id, published_revision_id, draft_generation, created_at, updated_at)
        VALUES ('layout-race', 'theme-a', 'layout', 'Layout', ?, ?, NULL, 1, 'now', 'now')`,
      )
      .run(layoutOf(false), LAYOUT_DRAFT);
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_template_revisions
          (id, template_id, version, document, created_at)
        VALUES (?, 'layout-race', 1, ?, 'now')`,
      )
      .run(LAYOUT_DRAFT, layoutOf(false));
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_revisions
          (id, storefront_id, theme_id, revision_number, message, source, snapshot, created_at, updated_at)
        VALUES (?, 'storefront-a', 'theme-a', 1, 'Checkpoint', 'publish', '[]', 'now', 'now')`,
      )
      .run(SOURCE);
    sqlite
      .prepare(
        "UPDATE storefront_theme_builds SET compiler_version = ? WHERE id = ?",
      )
      .run(withThemeStartBuildIdentity("1.168.32"), BUILD);
  }
  const publish = () =>
    storefrontThemeDal.publishTemplate({
      readSourceRevisionFiles: revisionFiles,
      verifySourceRevision: acceptRevision,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-race",
      sourceRevisionId: SOURCE,
      themeBuildId: BUILD,
      expectedDraftRevisionId: DRAFT,
      expectedDraftGeneration: 1,
      expectedReleaseGeneration: 1,
    });
  /** What another editor's in-place Show of `promo` leaves. */
  const showPromoInPlace = () => {
    sqlite
      .prepare(
        "UPDATE storefront_theme_template_revisions SET document = ? WHERE id = ?",
      )
      .run(layoutOf(true), LAYOUT_DRAFT);
    sqlite
      .prepare(
        "UPDATE storefront_theme_templates SET document = ?, draft_generation = draft_generation + 1 WHERE id = 'layout-race'",
      )
      .run(layoutOf(true));
  };
  const layoutState = () =>
    sqlite
      .prepare(
        `SELECT t.document AS row, t.draft_generation AS generation, t.published_revision_id AS published, r.document AS revision
           FROM storefront_theme_templates t
           JOIN storefront_theme_template_revisions r ON r.id = t.draft_revision_id
          WHERE t.id = 'layout-race'`,
      )
      .get();

  it("refuses when the layout draft is edited between the publish's reads, and keeps that edit", async () => {
    seed();
    const original = storefrontContentPublicationDal.readDocumentsForDraft.bind(
      storefrontContentPublicationDal,
    );
    const spy = vi
      .spyOn(storefrontContentPublicationDal, "readDocumentsForDraft")
      .mockImplementation(async (args) => {
        // After the publish read the hidden layout, before the check rereads it.
        showPromoInPlace();
        return original(args);
      });
    try {
      await expect(publish()).rejects.toThrow(/^PUBLISH_SCOPE_CHANGED:/);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(sqlite.prepare("SELECT id FROM storefront_releases").all()).toEqual(
      [],
    );
    expect(layoutState()).toEqual({
      row: layoutOf(true),
      generation: 2,
      published: null,
      revision: layoutOf(true),
    });
  });

  it("control: without the edit, the hidden layout section is refused by the check", async () => {
    seed();
    await expect(publish()).rejects.toThrow(
      /^PUBLISH_HIDDEN_SECTION_UNSUPPORTED: .*"promo" on the layout/,
    );
  });
});

/**
 * A rollback moves only the live pointer (`activateRelease`); template and
 * Page rows keep recording the revision their own last publish sealed. The
 * next publish must start from the release the rollback restored and replace
 * only what that publish ships, not quietly bring back every other page's
 * rolled-away content from those rows.
 *
 * Driven through the product's own publish (`publishTemplate`, the Dashboard
 * Page publish) and rollback (`activateRelease`); a draft save is seeded as
 * the row state a draft write leaves (new revision, draft pointer, generation).
 */
describe("publishing one page after a rollback", () => {
  const SOURCE = "22222222-2222-4222-8222-222222222222";
  const BUILD = "33333333-3333-4333-8333-333333333333";
  const PAGE = "page-faq";

  const documentOf = (title: string) => ({
    version: 1 as const,
    sections: [{ id: "hero", type: "hero", enabled: true, props: { title } }],
  });
  const titleOf = (document: unknown) => {
    const parsed =
      typeof document === "string" ? JSON.parse(document) : document;
    return (parsed as { sections?: { props?: { title?: string } }[] } | null)
      ?.sections?.[0]?.props?.title;
  };

  const insertTemplate = (
    id: string,
    type: string,
    routePath: string | null,
    title: string,
  ) => {
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates
          (id, theme_id, type, name, route_path, document, draft_revision_id, published_revision_id, draft_generation, created_at, updated_at)
         VALUES (?, 'theme-a', ?, ?, ?, ?, ?, NULL, 1, 'now', 'now')`,
      )
      .run(
        id,
        type,
        id,
        routePath,
        JSON.stringify(documentOf(title)),
        `rev-${title}`,
      );
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_template_revisions (id, template_id, version, document, created_at)
         VALUES (?, ?, 1, ?, 'now')`,
      )
      .run(`rev-${title}`, id, JSON.stringify(documentOf(title)));
  };

  /** The rows a draft write leaves: a new revision the draft points at. */
  const saveDraft = (templateId: string, title: string) => {
    const { version } = sqlite
      .prepare(
        "SELECT MAX(version) AS version FROM storefront_theme_template_revisions WHERE template_id = ?",
      )
      .get(templateId) as { version: number };
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_template_revisions (id, template_id, version, document, created_at)
         VALUES (?, ?, ?, ?, 'now')`,
      )
      .run(
        `rev-${title}`,
        templateId,
        version + 1,
        JSON.stringify(documentOf(title)),
      );
    sqlite
      .prepare(
        `UPDATE storefront_theme_templates
           SET draft_revision_id = ?, document = ?, draft_generation = draft_generation + 1
         WHERE id = ?`,
      )
      .run(`rev-${title}`, JSON.stringify(documentOf(title)), templateId);
  };

  const templateRow = (id: string) =>
    sqlite
      .prepare(
        "SELECT id, draft_revision_id AS draftRevisionId, published_revision_id AS publishedRevisionId, draft_generation AS draftGeneration FROM storefront_theme_templates WHERE id = ?",
      )
      .get(id) as {
      id: string;
      draftRevisionId: string;
      publishedRevisionId: string | null;
      draftGeneration: number;
    };

  /**
   * The Theme publish as the server function runs it: activate, then record
   * the deployment once the artifact reached the Worker. `deployed: false` is
   * a publish whose deploy failed and was restored.
   */
  const publish = async (
    templateId: string,
    {
      deployed = true,
      expectedSharedLayoutRevisionId,
    }: {
      deployed?: boolean;
      /** The scope a confirmation established; omitted, none is checked. */
      expectedSharedLayoutRevisionId?: string | null;
    } = {},
  ) => {
    const result = await publishOnly(templateId, expectedSharedLayoutRevisionId);
    if (!result?.releaseId || !result.releaseCreated) return result;
    if (deployed) {
      await storefrontReleaseDal.recordDeployedThemeBuild({
        storefrontId: "storefront-a",
        releaseId: result.releaseId,
        themeBuildId: result.themeBuildId,
      });
    } else {
      await storefrontThemeDal.restoreFailedPublish({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId,
        releaseId: result.releaseId,
        releaseGeneration: result.releaseGeneration,
        previousActiveReleaseId: result.previousActiveReleaseId,
        previousPublishedRevisionId: result.previousPublishedRevisionId,
        previousPublishedSourceRevisionId:
          result.previousPublishedSourceRevisionId,
        previousShell: result.previousShell,
      });
    }
    return result;
  };

  const publishOnly = (
    templateId: string,
    expectedSharedLayoutRevisionId?: string | null,
  ) => {
    const row = templateRow(templateId);
    const { releaseGeneration } = sqlite
      .prepare(
        "SELECT release_generation AS releaseGeneration FROM storefront_themes WHERE id = 'theme-a'",
      )
      .get() as { releaseGeneration: number };
    return storefrontThemeDal.publishTemplate({
      readSourceRevisionFiles: workspaceRevisionFiles,
      verifySourceRevision: acceptRevision,
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId,
      sourceRevisionId: SOURCE,
      themeBuildId: BUILD,
      expectedDraftRevisionId: row.draftRevisionId,
      expectedDraftGeneration: row.draftGeneration,
      expectedReleaseGeneration: releaseGeneration,
      expectedSharedLayoutRevisionId,
    });
  };

  /** The Dashboard's Page publish; returns the revision it published. */
  const publishPage = async (title: string) => {
    const exists = sqlite
      .prepare("SELECT id FROM storefront_pages WHERE id = ?")
      .get(PAGE);
    if (!exists) {
      await storefrontPageDal.create({
        id: PAGE,
        storefrontId: "storefront-a",
        title: "FAQ",
        handle: "faq",
        publish: true,
        createdBy: "user-a",
      });
    }
    await storefrontPageDal.update({
      id: PAGE,
      storefrontId: "storefront-a",
      title: "FAQ",
      handle: "faq",
      document: { ...documentOf(title), handle: "faq" },
      publish: true,
      hasPublishedVersion: true,
      createdBy: "user-a",
      expectedDraftVersion: (await storefrontPageDal.findDetail(
        PAGE,
        "storefront-a",
      ))!.version,
    });
    return (
      sqlite
        .prepare("SELECT published_revision_id AS id FROM storefront_pages")
        .get() as { id: string }
    ).id;
  };

  const active = () =>
    sqlite
      .prepare(
        `SELECT s.active_release_id AS releaseId, r.content_publication_id AS publicationId
           FROM storefronts s JOIN storefront_releases r ON r.id = s.active_release_id
          WHERE s.id = 'storefront-a'`,
      )
      .get() as { releaseId: string; publicationId: string };

  const pins = (publicationId: string) =>
    Object.fromEntries(
      (
        sqlite
          .prepare(
            "SELECT content_id AS contentId, revision_id AS revisionId FROM storefront_content_publication_items WHERE publication_id = ? AND deleted_at IS NULL",
          )
          .all(publicationId) as { contentId: string; revisionId: string }[]
      ).map((item) => [item.contentId, item.revisionId]),
    );

  const rollBackTo = (releaseId: string) =>
    storefrontReleaseDal.activateRelease({
      storefrontId: "storefront-a",
      releaseId,
      expectedActiveReleaseId: active().releaseId,
    });

  beforeEach(() => {
    // The Page DAL writes through Drizzle's batch, which the better-sqlite3
    // driver lacks; D1's is a transaction.
    const db = drizzle(sqlite, { schema: storefrontSchema });
    vi.mocked(getDb).mockResolvedValue(
      Object.assign(db, {
        batch: async (queries: Array<{ run: () => unknown }>) =>
          sqlite.transaction(() => queries.map((query) => query.run()))(),
      }) as never,
    );
    sqlite.exec(`
      INSERT INTO storefront_theme_revisions
        (id, storefront_id, theme_id, revision_number, source_generation, snapshot, created_at, updated_at)
        VALUES ('${SOURCE}', 'storefront-a', 'theme-a', 1, 1, '[]', 'now', 'now');
      DROP TABLE storefront_page_revisions;
      CREATE TABLE storefront_page_revisions (
        id text PRIMARY KEY NOT NULL,
        page_id text NOT NULL,
        version integer NOT NULL,
        document text NOT NULL,
        created_by text NOT NULL,
        created_at text NOT NULL,
        published_at text
      );
    `);
    insertTemplate("tpl-home", "index", null, "A0");
    insertTemplate("tpl-about", "page", "/about", "B1");
    insertTemplate("tpl-shell", "layout", null, "L1");
  });

  /**
   * Release 1: B1, L1, P1. Release 2: B2, L2, P2. Rolled back to release 1,
   * then only the home page (A1) is published.
   */
  const rollBackThenPublishHome = async (
    afterRollback?: () => Promise<void> | void,
  ) => {
    const p1 = await publishPage("P1");
    await publish("tpl-about");
    const release1 = active();

    saveDraft("tpl-about", "B2");
    saveDraft("tpl-shell", "L2");
    const p2 = await publishPage("P2");
    await publish("tpl-about");
    const release2 = active();
    expect(pins(release2.publicationId)).toEqual({
      "tpl-about": "rev-B2",
      "tpl-shell": "rev-L2",
      [PAGE]: p2,
    });

    await rollBackTo(release1.releaseId);
    expect(active().releaseId).toBe(release1.releaseId);
    await afterRollback?.();

    saveDraft("tpl-home", "A1");
    const result = await publish("tpl-home");
    return { p1, p2, release1, release2, result, release3: active() };
  };

  it("pins the other page at the revision the restored release served", async () => {
    const { release1, release2, result, release3 } =
      await rollBackThenPublishHome();

    expect(result).toMatchObject({ releaseCreated: true, unchanged: false });
    expect([release1.releaseId, release2.releaseId]).not.toContain(
      release3.releaseId,
    );
    // What the public route reads for the active release.
    expect(
      titleOf(
        await storefrontContentPublicationDal.getPublishedRouteDocument({
          publicationId: release3.publicationId,
          routePath: "/about",
        }),
      ),
    ).toBe("B1");
    expect(pins(release3.publicationId)["tpl-about"]).toBe("rev-B1");
    // The page this publish was for does go live.
    expect(pins(release3.publicationId)["tpl-home"]).toBe("rev-A1");
    expect(
      titleOf(
        await storefrontContentPublicationDal.getPublishedTemplateDocument({
          publicationId: release3.publicationId,
          templateType: "index",
        }),
      ),
    ).toBe("A1");
  });

  it("keeps the shared layout at the restored release when this publish has no layout change", async () => {
    const { release3 } = await rollBackThenPublishHome();

    expect(
      titleOf(
        await storefrontContentPublicationDal.getPublishedTemplateDocument({
          publicationId: release3.publicationId,
          templateType: "layout",
        }),
      ),
    ).toBe("L1");
    expect(pins(release3.publicationId)["tpl-shell"]).toBe("rev-L1");
  });

  it("keeps a storefront Page at the restored release", async () => {
    const { p1, release3 } = await rollBackThenPublishHome();

    expect(
      titleOf(
        await storefrontContentPublicationDal.getPublishedPageDocument({
          publicationId: release3.publicationId,
          handle: "faq",
        }),
      ),
    ).toBe("P1");
    expect(pins(release3.publicationId)[PAGE]).toBe(p1);
  });

  it("still ships a layout edited after the rollback, since that edit is pending", async () => {
    const { release3 } = await rollBackThenPublishHome(() =>
      saveDraft("tpl-shell", "L3"),
    );

    expect(pins(release3.publicationId)["tpl-shell"]).toBe("rev-L3");
    expect(templateRow("tpl-shell").publishedRevisionId).toBe("rev-L3");
  });

  it("still carries a Page published from the Dashboard after the rollback", async () => {
    let p3 = "";
    const { release3 } = await rollBackThenPublishHome(async () => {
      p3 = await publishPage("P3");
    });

    // A Page publish records the author's choice on the row and goes live
    // with the next release; no release has sealed it, so it is not one the
    // rollback took away.
    expect(pins(release3.publicationId)[PAGE]).toBe(p3);
  });

  it("keeps what a publish whose deploy failed sealed, since it never went live", async () => {
    await publishPage("P1");
    await publish("tpl-about");
    const release1 = active();
    const p2 = await publishPage("P2");
    saveDraft("tpl-about", "B2");
    saveDraft("tpl-shell", "L2");
    await publish("tpl-about", { deployed: false });
    expect(active().releaseId).toBe(release1.releaseId);

    saveDraft("tpl-home", "A1");
    await publish("tpl-home");

    // Restored to its previous publish, the page is carried at it; the Page
    // publish and the layout edit nobody saw live are still waiting, and go.
    expect(pins(active().publicationId)).toEqual({
      "tpl-home": "rev-A1",
      "tpl-about": "rev-B1",
      "tpl-shell": "rev-L2",
      [PAGE]: p2,
    });
  });

  /** `describeContentChanges` as the editor runs it, on its own context. */
  const editorDiff = async (pageId: string) => {
    const context = await storefrontThemeDal.findEditorContext(
      "storefront-a",
      "theme-a",
    );
    const byId = (id: string) =>
      context!.templates.find((template) => template.id === id);
    return describeContentChanges({
      page: byId(pageId),
      layout: byId("tpl-shell"),
    });
  };

  it("shows a page the rollback took off the storefront as unpublished, and publishing it puts it back", async () => {
    const { p1 } = await rollBackThenPublishHome();

    // B's draft is the one it last published, but the live release serves
    // B1: Publish is lit on B, as `publishTemplate` would publish it.
    expect(await editorDiff("tpl-about")).toEqual({
      changed: true,
      reason: "page",
    });
    // The page just published and the layout nobody edited are not pending.
    expect(await editorDiff("tpl-home")).toEqual({ changed: false });

    const result = await publish("tpl-about");
    expect(result).toMatchObject({ releaseCreated: true, unchanged: false });
    // B2 goes back; everything else is what the active release served.
    expect(pins(active().publicationId)).toEqual({
      "tpl-home": "rev-A1",
      "tpl-about": "rev-B2",
      "tpl-shell": "rev-L1",
      [PAGE]: p1,
    });
    expect(await editorDiff("tpl-about")).toEqual({ changed: false });
  });

  it("changes nothing in the editor's state without a rollback", async () => {
    await publish("tpl-about");
    saveDraft("tpl-about", "B2");
    expect(await editorDiff("tpl-about")).toEqual({
      changed: true,
      reason: "page",
    });
    await publish("tpl-about");
    expect(await editorDiff("tpl-about")).toEqual({ changed: false });
    // Never published: pending, as before.
    expect(await editorDiff("tpl-home")).toEqual({
      changed: true,
      reason: "page",
    });
    // An edit still reads as one.
    saveDraft("tpl-about", "B3");
    expect(await editorDiff("tpl-about")).toEqual({
      changed: true,
      reason: "page",
    });
  });

  /** A Document write through the shared draft writer every editor write uses. */
  const writeDocument = async (templateId: string, title: string) => {
    const row = templateRow(templateId);
    const write = await prepareTemplateDocumentWrite({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId,
      document: documentOf(title),
      sourceGeneration: 1,
      draftRevisionId: row.draftRevisionId,
      publishedRevisionId: row.publishedRevisionId,
      expectedDraftGeneration: row.draftGeneration,
      createdBy: "user-a",
    });
    await workerEnv.DATABASE.batch([write.guard, ...write.mutations]);
    return write.result;
  };
  const revisionTitle = (revisionId: string) =>
    titleOf(
      (
        sqlite
          .prepare(
            "SELECT document FROM storefront_theme_template_revisions WHERE id = ?",
          )
          .get(revisionId) as { document: string }
      ).document,
    );

  it("never edits a draft a publication pins in place, after a publish whose deploy failed", async () => {
    await publish("tpl-about");
    const release1 = active();
    saveDraft("tpl-about", "B2");
    const failed = await publish("tpl-about", { deployed: false });
    expect(active().releaseId).toBe(release1.releaseId);
    // Restored: the row says B1 again, while the failed release pins B2.
    expect(templateRow("tpl-about")).toMatchObject({
      draftRevisionId: "rev-B2",
      publishedRevisionId: "rev-B1",
    });
    const failedPublication = (
      sqlite
        .prepare(
          "SELECT content_publication_id AS id FROM storefront_releases WHERE id = ?",
        )
        .get(failed!.releaseId) as { id: string }
    ).id;
    expect(pins(failedPublication)["tpl-about"]).toBe("rev-B2");

    const written = await writeDocument("tpl-about", "B3");

    expect(written.draftRevisionId).not.toBe("rev-B2");
    expect(templateRow("tpl-about").draftRevisionId).toBe(
      written.draftRevisionId,
    );
    expect(revisionTitle("rev-B2")).toBe("B2");
    expect(
      titleOf(
        await storefrontContentPublicationDal.getPublishedRouteDocument({
          publicationId: failedPublication,
          routePath: "/about",
        }),
      ),
    ).toBe("B2");
  });

  it("never edits a draft a Build Preview sealed in place, and a rolled-back-to release still serves its own revision", async () => {
    await publish("tpl-about");
    const release1 = active();
    saveDraft("tpl-about", "B2");
    await publish("tpl-about");
    const release2 = active();
    await rollBackTo(release1.releaseId);

    // A draft the build sealed is pinned by the build's publication.
    saveDraft("tpl-home", "A1");
    const home = templateRow("tpl-home");
    const { releaseGeneration } = sqlite
      .prepare(
        "SELECT release_generation AS releaseGeneration FROM storefront_themes WHERE id = 'theme-a'",
      )
      .get() as { releaseGeneration: number };
    const sealed = await storefrontContentPublicationDal.sealForThemeBuild({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      sourceRevisionId: SOURCE,
      templateId: "tpl-home",
      expectedDraftRevisionId: home.draftRevisionId,
      expectedDraftGeneration: home.draftGeneration,
      expectedSourceGeneration: 1,
      expectedReleaseGeneration: releaseGeneration,
    });
    const writtenHome = await writeDocument("tpl-home", "A2");
    expect(writtenHome.draftRevisionId).not.toBe("rev-A1");
    expect(revisionTitle("rev-A1")).toBe("A1");
    expect(pins(sealed.id)["tpl-home"]).toBe("rev-A1");

    // B's draft B2 is what release 2 pinned.
    const writtenAbout = await writeDocument("tpl-about", "B3");
    expect(writtenAbout.draftRevisionId).not.toBe("rev-B2");
    expect(revisionTitle("rev-B2")).toBe("B2");
    await rollBackTo(release2.releaseId);
    expect(
      titleOf(
        await storefrontContentPublicationDal.getPublishedRouteDocument({
          publicationId: active().publicationId,
          routePath: "/about",
        }),
      ),
    ).toBe("B2");
  });

  it("restores the layout's row after a publish whose deploy failed, so its edit still reads as pending", async () => {
    await publish("tpl-home");
    await publish("tpl-about");
    expect(await editorDiff("tpl-home")).toEqual({ changed: false });
    saveDraft("tpl-shell", "L2");
    saveDraft("tpl-about", "B2");
    await publish("tpl-about", { deployed: false });

    // The layout row is back at what the live release serves.
    expect(templateRow("tpl-shell").publishedRevisionId).toBe("rev-L1");
    // So a page with nothing of its own offers to publish the layout edit
    // that never went live, rather than reading "Published".
    expect(await editorDiff("tpl-home")).toEqual({
      changed: true,
      reason: "layout",
    });
    await publish("tpl-home");
    expect(pins(active().publicationId)["tpl-shell"]).toBe("rev-L2");
    expect(await editorDiff("tpl-home")).toEqual({ changed: false });
  });

  /**
   * The Publish confirmation's answer (`findPublishScope`) against what the
   * publish then seals for the shared layout, across the release states the
   * carry (`resolveCarriedRevisions`) treats differently.
   */
  describe("the publish confirmation's layout scope", () => {
    const scopeOf = async (templateId: string) =>
      (
        await storefrontThemeDal.findPublishScope({
          storefrontId: "storefront-a",
          themeId: "theme-a",
          templateId,
        })
      )?.sharedLayout?.revisionId ?? null;

    it("reads this page only after a rollback with no layout edit, and the layout stays at the restored release", async () => {
      let shown: string | null | undefined;
      await rollBackThenPublishHome(async () => {
        // The row still names L2 as published while release 1 serves L1;
        // nothing pending, and the carry keeps L1, so "this page only" holds.
        shown = await scopeOf("tpl-home");
        expect(shown).toBeNull();
      });
      // The editor's own layout signal agrees: with home published, nothing
      // (layout included) reads as pending on it.
      expect(await editorDiff("tpl-home")).toEqual({ changed: false });
      expect(await scopeOf("tpl-home")).toBeNull();
      saveDraft("tpl-about", "B3");
      await publish("tpl-about", { expectedSharedLayoutRevisionId: shown });
      expect(pins(active().publicationId)["tpl-shell"]).toBe("rev-L1");
    });

    it("names a layout edited after a rollback, and the confirmed publish ships exactly that draft", async () => {
      await rollBackThenPublishHome(() => saveDraft("tpl-shell", "L3"));
      // The home publish above sealed L3 already; edit again and confirm.
      saveDraft("tpl-shell", "L4");
      saveDraft("tpl-about", "B3");
      const shown = await scopeOf("tpl-about");
      expect(shown).toBe("rev-L4");
      await publish("tpl-about", { expectedSharedLayoutRevisionId: shown });
      expect(pins(active().publicationId)["tpl-shell"]).toBe("rev-L4");
      expect(await scopeOf("tpl-about")).toBeNull();
    });

    it("names the layout again after a publish whose deploy failed, since it never went live", async () => {
      await publish("tpl-home");
      saveDraft("tpl-shell", "L2");
      saveDraft("tpl-about", "B2");
      const shown = await scopeOf("tpl-about");
      expect(shown).toBe("rev-L2");
      await publish("tpl-about", {
        deployed: false,
        expectedSharedLayoutRevisionId: shown,
      });

      expect(await scopeOf("tpl-home")).toBe("rev-L2");
      // The publish names it too: a "this page only" confirmation is refused.
      await expect(
        publishOnly("tpl-home", null),
      ).rejects.toThrow(PUBLISH_SCOPE_CHANGED);
      await publish("tpl-home", { expectedSharedLayoutRevisionId: "rev-L2" });
      expect(pins(active().publicationId)["tpl-shell"]).toBe("rev-L2");
      expect(await scopeOf("tpl-home")).toBeNull();
    });
  });

  it("does not let a release whose deploy failed be activated", async () => {
    await publish("tpl-about");
    const release1 = active();
    saveDraft("tpl-about", "B2");
    const failed = await publish("tpl-about", { deployed: false });
    expect(active().releaseId).toBe(release1.releaseId);

    await expect(rollBackTo(failed!.releaseId)).rejects.toThrow(
      "RELEASE_NOT_ACTIVATABLE",
    );
    expect(active().releaseId).toBe(release1.releaseId);
  });

  it("migrates the revision the live release serves, not one a rollback took away", async () => {
    const legacyFiles = [
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: THEME_START_RUNTIME_DEPENDENCIES,
          devDependencies: THEME_START_BUILD_DEPENDENCIES,
        }),
        mime: "application/json",
        entry: 0,
      },
      {
        path: "src/router.tsx",
        content: "export const router = {};",
        mime: "text/typescript",
        entry: 0,
      },
      {
        path: "src/routes/__root.tsx",
        content: `import { createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: () => <main /> });`,
        mime: "text/typescript",
        entry: 0,
      },
      {
        path: "src/routes/index.tsx",
        content: `import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/")({ component: () => <main /> });`,
        mime: "text/typescript",
        entry: 1,
      },
      {
        path: "src/components/sections/Hero.tsx",
        content: `export const contentFields = { title: { type: "text" } } as const;
export default function Hero() { return <section />; }`,
        mime: "text/typescript",
        entry: 0,
      },
      {
        path: "morph.theme.json",
        content: JSON.stringify({
          entry: "src/routes/index.tsx",
          router: {
            framework: "tanstack-start",
            previewAdapter: "tanstack-router-client",
            routesDirectory: "src/routes",
            rootRoute: "src/routes/__root.tsx",
            generatedRouteTree: "src/routeTree.gen.ts",
          },
          components: {
            "hero.default": {
              source: "src/components/sections/Hero.tsx",
              contentFields: { title: { type: "text" } },
            },
          },
        }),
        mime: "application/json",
        entry: 0,
      },
    ];
    sqlite.exec(`
      ALTER TABLE storefront_themes ADD COLUMN source_index_version integer;
      ALTER TABLE storefront_themes ADD COLUMN source_index_status text;
      ALTER TABLE storefront_themes ADD COLUMN source_index text;
      ALTER TABLE storefront_theme_revisions ADD COLUMN source_index text;
    `);
    for (const [index, file] of legacyFiles.entries()) {
      sqlite
        .prepare(
          `INSERT INTO storefront_theme_files
            (id, storefront_id, theme_id, path, content, mime_type, is_entry, version, created_at, updated_at)
           VALUES (?, 'storefront-a', 'theme-a', ?, ?, ?, ?, 1, 'now', 'now')`,
        )
        .run(`file-${index}`, file.path, file.content, file.mime, file.entry);
    }
    // B's documents name their component by the legacy manifest key.
    const legacyRefs = () =>
      sqlite.exec(`
        UPDATE storefront_theme_template_revisions
          SET document = json_set(document, '$.sections[0].componentRef', 'hero.default')
          WHERE template_id = 'tpl-about';
        UPDATE storefront_theme_templates
          SET document = json_set(document, '$.sections[0].componentRef', 'hero.default')
          WHERE id = 'tpl-about';
      `);

    legacyRefs();
    await publish("tpl-about");
    const release1 = active();
    saveDraft("tpl-about", "B2");
    legacyRefs();
    await publish("tpl-about");
    await rollBackTo(release1.releaseId);

    const snapshot = await readThemeManifestMigrationSnapshot(
      "storefront-a",
      "theme-a",
    );
    const plan = buildThemeManifestMigrationPlan(snapshot!);
    expect(plan.blockers).toEqual([]);
    expect(plan.status).toBe("ready");
    await applyThemeManifestMigration({
      plan: plan as typeof plan & { status: "ready" },
      sourceManifest: {} as never,
      sourceIndexBefore: {} as never,
      createdBy: "user-a",
    });

    // Release 1's own revision is history and stays as it was.
    expect(revisionTitle("rev-B1")).toBe("B1");
    saveDraft("tpl-home", "A1");
    await publish("tpl-home");
    expect(
      titleOf(
        await storefrontContentPublicationDal.getPublishedRouteDocument({
          publicationId: active().publicationId,
          routePath: "/about",
        }),
      ),
    ).toBe("B1");
    // B's draft was migrated too, and still reads as not live.
    expect(await editorDiff("tpl-about")).toEqual({
      changed: true,
      reason: "page",
    });
  });

  it("seals a content-bound build with the same set the publish then checks it against", async () => {
    const p1 = await publishPage("P1");
    await publish("tpl-about");
    const release1 = active();
    saveDraft("tpl-about", "B2");
    saveDraft("tpl-shell", "L2");
    await publishPage("P2");
    await publish("tpl-about");
    await rollBackTo(release1.releaseId);
    saveDraft("tpl-home", "A1");

    // Build Preview seals the content it builds with.
    const home = templateRow("tpl-home");
    const { releaseGeneration } = sqlite
      .prepare(
        "SELECT release_generation AS releaseGeneration FROM storefront_themes WHERE id = 'theme-a'",
      )
      .get() as { releaseGeneration: number };
    const sealed = await storefrontContentPublicationDal.sealForThemeBuild({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      sourceRevisionId: SOURCE,
      templateId: "tpl-home",
      expectedDraftRevisionId: home.draftRevisionId,
      expectedDraftGeneration: home.draftGeneration,
      expectedSourceGeneration: 1,
      expectedReleaseGeneration: releaseGeneration,
    });
    expect(pins(sealed.id)).toEqual({
      "tpl-home": "rev-A1",
      "tpl-about": "rev-B1",
      "tpl-shell": "rev-L1",
      [PAGE]: p1,
    });
    sqlite
      .prepare(
        "UPDATE storefront_theme_builds SET content_publication_id = ?, content_dependency = 'dependent' WHERE id = ?",
      )
      .run(sealed.id, BUILD);

    // The publish seals the same set, so the bound build is accepted.
    await expect(publish("tpl-home")).resolves.toMatchObject({
      releaseCreated: true,
    });
    expect(pins(active().publicationId)).toEqual(pins(sealed.id));
  });

  it("checks the same documents before confirming as it seals", async () => {
    const { release3 } = await rollBackThenPublishHome();
    saveDraft("tpl-home", "A2");

    const titles = (
      await storefrontContentPublicationDal.listDocumentsForPublish({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "tpl-home",
      })
    )
      .map(({ label, document }) => `${label}=${titleOf(document)}`)
      .sort();
    expect(pins(release3.publicationId)["tpl-about"]).toBe("rev-B1");
    expect(titles).toEqual([
      "/about=B1",
      "/pages/faq=P1",
      "tpl-home=A2",
      "tpl-shell=L1",
    ]);
  });

  /**
   * Release 1 pins L1, release 2 pins L2 (layout edited, then published with
   * /about), rolled back to release 1. Then the home page is published by a
   * publish that has to build, as the editor's `handlePublish` runs it:
   *
   *   1. `prepareContentDraftForBuild({ alwaysPrepare: true })`: for the page
   *      and then the layout, `prepareInitialStorefrontThemeTemplateDraft`
   *      with the row's current draft (`expectedDraftRevisionId`), so
   *      `prepareInitialTemplateDraft` rewrites the stored draft through the
   *      Document writer.
   *   2. `handleBuildPreview` -> `sealForThemeBuild` for the page, at the
   *      prepared draft; the build records the sealed publication.
   *   3. `publishMutation` -> `publishTemplate` with that build.
   *
   * The layout nobody touched after the rollback has draft == published ==
   * rev-L2. Step 1 forks it (rev-L2 is pinned by release 2) into a new
   * revision holding L2's document, so the layout row's draft no longer
   * equals its published revision. Steps 2 and 3 then treat it as a pending
   * shell (`pendingShell`, `alsoPublish`) and seal L2 back into the release,
   * which `resolveCarriedRevisions` would otherwise have kept at L1.
   */
  const rollBackThenBuildPublishHome = async (
    afterRollback?: () => void,
  ) => {
    await publish("tpl-about");
    const release1 = active();
    saveDraft("tpl-about", "B2");
    saveDraft("tpl-shell", "L2");
    await publish("tpl-about");
    const release2 = active();
    expect(pins(release2.publicationId)["tpl-shell"]).toBe("rev-L2");
    await rollBackTo(release1.releaseId);
    expect(active().releaseId).toBe(release1.releaseId);
    // A rollback moves the live pointer only.
    expect(templateRow("tpl-shell")).toMatchObject({
      draftRevisionId: "rev-L2",
      publishedRevisionId: "rev-L2",
    });
    afterRollback?.();

    // The merchant edits the home page; the layout stays untouched (unless
    // `afterRollback` edited it).
    saveDraft("tpl-home", "A1");

    // 1. The editor's pre-publish preparation, page then layout.
    for (const templateId of ["tpl-home", "tpl-shell"]) {
      const row = templateRow(templateId);
      await storefrontThemeDal.prepareInitialTemplateDraft({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId,
        expectedDraftGeneration: row.draftGeneration,
        expectedSourceGeneration: 1,
        expectedDraftRevisionId: row.draftRevisionId,
        createdBy: "user-a",
      });
    }
    const shellAfterPrepare = templateRow("tpl-shell");

    // 2. The build publishing makes, sealed with the prepared drafts.
    const home = templateRow("tpl-home");
    const { releaseGeneration } = sqlite
      .prepare(
        "SELECT release_generation AS releaseGeneration FROM storefront_themes WHERE id = 'theme-a'",
      )
      .get() as { releaseGeneration: number };
    const sealed = await storefrontContentPublicationDal.sealForThemeBuild({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      sourceRevisionId: SOURCE,
      templateId: "tpl-home",
      expectedDraftRevisionId: home.draftRevisionId,
      expectedDraftGeneration: home.draftGeneration,
      expectedSourceGeneration: 1,
      expectedReleaseGeneration: releaseGeneration,
    });
    sqlite
      .prepare(
        "UPDATE storefront_theme_builds SET content_publication_id = ?, content_dependency = 'independent' WHERE id = ?",
      )
      .run(sealed.id, BUILD);

    // 3. The publish, with that build.
    const result = await publish("tpl-home");
    return {
      release1,
      release2,
      shellAfterPrepare,
      sealedPins: pins(sealed.id),
      result,
      release3: active(),
    };
  };

  it("control: a publish that builds after a rollback runs the editor's whole sequence", async () => {
    const { release1, release2, result, release3, sealedPins } =
      await rollBackThenBuildPublishHome();

    expect(result).toMatchObject({ releaseCreated: true, unchanged: false });
    expect([release1.releaseId, release2.releaseId]).not.toContain(
      release3.releaseId,
    );
    expect(pins(release3.publicationId)["tpl-home"]).toBe(
      templateRow("tpl-home").draftRevisionId,
    );
    // The other page is kept at the restored release (#429).
    expect(pins(release3.publicationId)["tpl-about"]).toBe("rev-B1");
    expect(sealedPins["tpl-about"]).toBe("rev-B1");
    expect(pins(release3.publicationId)["tpl-shell"]).toBeTruthy();
  });

  // The editor's pre-publish preparation used to fork the untouched layout's
  // draft (rev-L2, the revision the rollback took off the storefront) into a
  // new revision with L2's document, so the build seal and the publish
  // treated it as a pending layout edit and release 3 served L2 again on
  // every page. Preparation now leaves an untouched layout as it is.
  it("keeps the shared layout at the restored release when the publish had to build", async () => {
    const { release3, sealedPins, shellAfterPrepare } =
      await rollBackThenBuildPublishHome();

    // Preparing the untouched layout must not make it a pending edit.
    expect(shellAfterPrepare).toMatchObject({
      draftRevisionId: "rev-L2",
      publishedRevisionId: "rev-L2",
    });
    // The build seals the layout the live release serves...
    expect(sealedPins["tpl-shell"]).toBe("rev-L1");
    // ...and so does the release.
    expect(pins(release3.publicationId)["tpl-shell"]).toBe("rev-L1");
    expect(
      titleOf(
        await storefrontContentPublicationDal.getPublishedTemplateDocument({
          publicationId: release3.publicationId,
          templateType: "layout",
        }),
      ),
    ).toBe("L1");
  });

  /**
   * The toolbar Build Preview after the same rollback, and then a publish
   * that does not build. Build Preview (`handleBuildPreview` from the
   * toolbar) runs `prepareContentDraftForBuild({ alwaysPrepare: true })` for
   * the page and the layout and seals the build for the page, as a publish
   * that builds does. The merchant then edits the home page and publishes it
   * with that build: drafts exist, so the publish prepares nothing
   * (`alwaysPrepare: false`), and nothing seals again.
   */
  const rollBackThenBuildPreviewThenPublishHome = async () => {
    await publish("tpl-about");
    const release1 = active();
    saveDraft("tpl-about", "B2");
    saveDraft("tpl-shell", "L2");
    await publish("tpl-about");
    expect(pins(active().publicationId)["tpl-shell"]).toBe("rev-L2");
    await rollBackTo(release1.releaseId);
    expect(active().releaseId).toBe(release1.releaseId);

    // Build Preview of the home page: prepare the page and then the layout.
    for (const templateId of ["tpl-home", "tpl-shell"]) {
      const row = templateRow(templateId);
      await storefrontThemeDal.prepareInitialTemplateDraft({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId,
        expectedDraftGeneration: row.draftGeneration,
        expectedSourceGeneration: 1,
        expectedDraftRevisionId: row.draftRevisionId,
        createdBy: "user-a",
      });
    }
    const shellAfterBuildPreview = templateRow("tpl-shell");
    const home = templateRow("tpl-home");
    const { releaseGeneration } = sqlite
      .prepare(
        "SELECT release_generation AS releaseGeneration FROM storefront_themes WHERE id = 'theme-a'",
      )
      .get() as { releaseGeneration: number };
    const sealed = await storefrontContentPublicationDal.sealForThemeBuild({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      sourceRevisionId: SOURCE,
      templateId: "tpl-home",
      expectedDraftRevisionId: home.draftRevisionId,
      expectedDraftGeneration: home.draftGeneration,
      expectedSourceGeneration: 1,
      expectedReleaseGeneration: releaseGeneration,
    });
    sqlite
      .prepare(
        "UPDATE storefront_theme_builds SET content_publication_id = ?, content_dependency = 'independent' WHERE id = ?",
      )
      .run(sealed.id, BUILD);

    // The merchant edits the home page and publishes it with that build.
    saveDraft("tpl-home", "A1");
    const result = await publish("tpl-home");
    return {
      release1,
      shellAfterBuildPreview,
      sealedPins: pins(sealed.id),
      result,
      release3: active(),
    };
  };

  // The toolbar Build Preview prepared the untouched layout the same way,
  // forking rev-L2, so the next publish found a pending layout even though it
  // did not build.
  it("keeps the shared layout at the restored release after a Build Preview and a publish that does not build", async () => {
    const { release1, result, release3, sealedPins, shellAfterBuildPreview } =
      await rollBackThenBuildPreviewThenPublishHome();

    expect(result).toMatchObject({ releaseCreated: true, unchanged: false });
    expect(release3.releaseId).not.toBe(release1.releaseId);
    expect(pins(release3.publicationId)["tpl-home"]).toBe("rev-A1");
    expect(pins(release3.publicationId)["tpl-about"]).toBe("rev-B1");
    // Build Preview must not make the untouched layout a pending edit.
    expect(shellAfterBuildPreview.draftRevisionId).toBe(
      shellAfterBuildPreview.publishedRevisionId,
    );
    expect(sealedPins["tpl-shell"]).toBe("rev-L1");
    expect(pins(release3.publicationId)["tpl-shell"]).toBe("rev-L1");
    expect(
      titleOf(
        await storefrontContentPublicationDal.getPublishedTemplateDocument({
          publicationId: release3.publicationId,
          templateType: "layout",
        }),
      ),
    ).toBe("L1");
  });

  it("still ships a layout edited after the rollback when the publish had to build", async () => {
    const { release3, sealedPins, shellAfterPrepare } =
      await rollBackThenBuildPublishHome(() => saveDraft("tpl-shell", "L3"));

    // An edited layout is still prepared (in place: rev-L3 is not pinned).
    expect(shellAfterPrepare.draftRevisionId).toBe("rev-L3");
    expect(shellAfterPrepare.publishedRevisionId).toBe("rev-L2");
    expect(sealedPins["tpl-shell"]).toBe("rev-L3");
    expect(pins(release3.publicationId)["tpl-shell"]).toBe("rev-L3");
    expect(templateRow("tpl-shell").publishedRevisionId).toBe("rev-L3");
    expect(
      titleOf(
        await storefrontContentPublicationDal.getPublishedTemplateDocument({
          publicationId: release3.publicationId,
          templateType: "layout",
        }),
      ),
    ).toBe("L3");
  });

  it("prepares an untouched layout without writing, under the same draft and source conditions", async () => {
    await publish("tpl-about");
    const before = templateRow("tpl-shell");
    expect(before).toMatchObject({
      draftRevisionId: "rev-L1",
      publishedRevisionId: "rev-L1",
    });
    const revisionCount = () =>
      (
        sqlite
          .prepare(
            "SELECT COUNT(*) AS n FROM storefront_theme_template_revisions WHERE template_id = 'tpl-shell'",
          )
          .get() as { n: number }
      ).n;
    const countBefore = revisionCount();
    const prepare = (overrides: {
      expectedDraftGeneration?: number;
      expectedSourceGeneration?: number;
      expectedDraftRevisionId?: string;
    }) =>
      storefrontThemeDal.prepareInitialTemplateDraft({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "tpl-shell",
        expectedDraftGeneration: before.draftGeneration,
        expectedSourceGeneration: 1,
        expectedDraftRevisionId: before.draftRevisionId,
        createdBy: "user-a",
        ...overrides,
      });

    await expect(prepare({ expectedSourceGeneration: 2 })).rejects.toThrow(
      TEMPLATE_DRAFT_GENERATION_MISMATCH,
    );
    await expect(
      prepare({ expectedDraftGeneration: before.draftGeneration + 1 }),
    ).rejects.toThrow(TEMPLATE_DRAFT_GENERATION_MISMATCH);
    await expect(
      prepare({ expectedDraftRevisionId: "rev-other" }),
    ).rejects.toThrow(TEMPLATE_DRAFT_GENERATION_MISMATCH);

    const prepared = await prepare({});
    expect(prepared).toMatchObject({
      draftRevisionId: "rev-L1",
      draftGeneration: before.draftGeneration,
    });
    expect(titleOf(prepared?.document)).toBe("L1");
    expect(templateRow("tpl-shell")).toEqual(before);
    expect(revisionCount()).toBe(countBefore);
  });

  /**
   * #436 acceptance: the scope the editor sends after its own layout
   * preparation, against what `publishTemplate` then accepts and seals.
   *
   * Each case runs the editor's sequence on the real DAL: the confirmation
   * read (`findPublishScope`), the preparation of the page and the layout
   * (`prepareInitialTemplateDraft`, as `prepareContentDraftForBuild` with
   * `alwaysPrepare` calls it), the build seal, and the publish. The scope sent
   * is computed by the editor's own functions (`publishScopeState`,
   * `publishScopeExpectation`, `chainLayoutPreparation`,
   * `publishScopeAfterPreparation`), so a change to that mapping that the
   * server would refuse, or that would seal another layout, fails here.
   */
  describe("#436: the confirmed scope across the publish's own layout preparation", () => {
    const confirm = async (templateId: string) => {
      const scope = await storefrontThemeDal.findPublishScope({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId,
      });
      expect(scope, "the confirmation reads a scope").not.toBeNull();
      return scope!;
    };
    /** What `confirmPublish` hands `handlePublish` for that answer. */
    const confirmedExpectation = (
      scope: Awaited<ReturnType<typeof confirm>>,
    ) =>
      publishScopeExpectation(
        publishScopeState({
          isPending: false,
          isError: false,
          data: { success: true, data: scope },
        }),
      )!;
    const layoutRevisionCount = () =>
      (
        sqlite
          .prepare(
            "SELECT COUNT(*) AS n FROM storefront_theme_template_revisions WHERE template_id = 'tpl-shell'",
          )
          .get() as { n: number }
      ).n;

    /**
     * The editor's pre-publish preparation (page, then layout) and the build
     * seal, as `rollBackThenBuildPublishHome` runs them. Returns the layout
     * draft the preparation started from and the one it left.
     */
    const prepareAndSeal = async (templateId: string) => {
      let preparation: ReturnType<typeof chainLayoutPreparation> | null = null;
      for (const id of [templateId, "tpl-shell"]) {
        const row = templateRow(id);
        const prepared = await storefrontThemeDal.prepareInitialTemplateDraft({
          storefrontId: "storefront-a",
          themeId: "theme-a",
          templateId: id,
          expectedDraftGeneration: row.draftGeneration,
          expectedSourceGeneration: 1,
          // As the shell sends it: no draft yet is the layout's first one.
          expectedDraftRevisionId:
            (row.draftRevisionId as string | null) ?? undefined,
          createdBy: "user-a",
        });
        expect(prepared, `${id} is prepared`).not.toBeNull();
        if (id === "tpl-shell") {
          preparation = chainLayoutPreparation(
            preparation,
            row.draftRevisionId,
            prepared!.draftRevisionId,
          );
        }
      }
      const page = templateRow(templateId);
      const { releaseGeneration } = sqlite
        .prepare(
          "SELECT release_generation AS releaseGeneration FROM storefront_themes WHERE id = 'theme-a'",
        )
        .get() as { releaseGeneration: number };
      const sealed = await storefrontContentPublicationDal.sealForThemeBuild({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        sourceRevisionId: SOURCE,
        templateId,
        expectedDraftRevisionId: page.draftRevisionId,
        expectedDraftGeneration: page.draftGeneration,
        expectedSourceGeneration: 1,
        expectedReleaseGeneration: releaseGeneration,
      });
      sqlite
        .prepare(
          "UPDATE storefront_theme_builds SET content_publication_id = ?, content_dependency = 'independent' WHERE id = ?",
        )
        .run(sealed.id, BUILD);
      return { preparation: preparation!, sealedPins: pins(sealed.id) };
    };
    const servedLayoutTitle = async () =>
      titleOf(
        await storefrontContentPublicationDal.getPublishedTemplateDocument({
          publicationId: active().publicationId,
          templateType: "layout",
        }),
      );
    /** Everything a publish writes, to prove a refused one wrote none of it. */
    const publishWrites = () => ({
      counts: Object.fromEntries(
        [
          "storefront_releases",
          "storefront_content_publications",
          "storefront_content_publication_items",
          "storefront_theme_template_revisions",
        ].map((table) => [
          table,
          (
            sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
              n: number;
            }
          ).n,
        ]),
      ),
      templates: sqlite
        .prepare(
          "SELECT id, document, draft_revision_id, published_revision_id, draft_generation FROM storefront_theme_templates ORDER BY id",
        )
        .all(),
      activeRelease: sqlite
        .prepare(
          "SELECT active_release_id AS id FROM storefronts WHERE id = 'storefront-a'",
        )
        .get(),
      releaseGeneration: sqlite
        .prepare(
          "SELECT release_generation AS g FROM storefront_themes WHERE id = 'theme-a'",
        )
        .get(),
    });

    // Scenario 1, and scenario 5's server half (the E2E is
    // b1-route-publish-rollback-acceptance.spec.ts R-c).
    it.each([
      {
        name: "after a publish",
        arrange: async () => {
          await publish("tpl-about");
        },
        draft: "rev-L1",
      },
      {
        name: "after a rollback, its row naming the rolled-away revision",
        arrange: async () => {
          await publish("tpl-about");
          const release1 = active();
          saveDraft("tpl-about", "B2");
          saveDraft("tpl-shell", "L2");
          await publish("tpl-about");
          await rollBackTo(release1.releaseId);
        },
        draft: "rev-L2",
      },
    ])(
      "scenario 1: an untouched layout the preparation wrote nothing for ($name): this page only (null) is sent and sealed, and L1 stays live",
      async ({ arrange, draft }) => {
        await arrange();
        saveDraft("tpl-home", "A1");
        const scope = await confirm("tpl-home");
        expect(scope).toEqual({
          sharedLayout: null,
          layout: {
            templateId: "tpl-shell",
            draftRevisionId: draft,
            firstPublish: false,
          },
        });
        const revisionsBefore = layoutRevisionCount();
        const { preparation, sealedPins } = await prepareAndSeal("tpl-home");
        // Nothing written for the layout: it left the draft it started from.
        expect(preparation).toEqual({
          fromRevisionId: draft,
          revisionId: draft,
        });
        expect(layoutRevisionCount()).toBe(revisionsBefore);
        const sent = publishScopeAfterPreparation(
          confirmedExpectation(scope),
          preparation,
        );
        expect(sent.expectedSharedLayoutRevisionId).toBeNull();
        // What the editor sent before e137115 (the layout's own revision) is
        // a layout nobody confirmed and is refused.
        await expect(publishOnly("tpl-home", draft)).rejects.toThrow(
          PUBLISH_SCOPE_CHANGED,
        );
        await expect(
          publish("tpl-home", {
            expectedSharedLayoutRevisionId: sent.expectedSharedLayoutRevisionId,
          }),
        ).resolves.toMatchObject({ releaseCreated: true });
        expect(sealedPins["tpl-shell"]).toBe("rev-L1");
        expect(pins(active().publicationId)["tpl-shell"]).toBe("rev-L1");
        expect(await servedLayoutTitle()).toBe("L1");
      },
    );

    it("scenario 2: a pending layout the preparation wrote no new revision for: the confirmed non-null revision is sent and sealed", async () => {
      await publish("tpl-about");
      saveDraft("tpl-shell", "L3");
      saveDraft("tpl-home", "A1");
      const scope = await confirm("tpl-home");
      expect(scope.sharedLayout).toEqual({
        templateId: "tpl-shell",
        revisionId: "rev-L3",
      });
      const revisionsBefore = layoutRevisionCount();
      const { preparation, sealedPins } = await prepareAndSeal("tpl-home");
      // rev-L3 is pinned by no publication: prepared in place.
      expect(preparation).toEqual({
        fromRevisionId: "rev-L3",
        revisionId: "rev-L3",
      });
      expect(layoutRevisionCount()).toBe(revisionsBefore);
      const sent = publishScopeAfterPreparation(
        confirmedExpectation(scope),
        preparation,
      );
      expect(sent.expectedSharedLayoutRevisionId).toBe("rev-L3");
      // "This page only" would leave out a layout that does go live.
      await expect(publishOnly("tpl-home", null)).rejects.toThrow(
        PUBLISH_SCOPE_CHANGED,
      );
      await expect(
        publish("tpl-home", {
          expectedSharedLayoutRevisionId: sent.expectedSharedLayoutRevisionId,
        }),
      ).resolves.toMatchObject({ releaseCreated: true });
      expect(sealedPins["tpl-shell"]).toBe("rev-L3");
      expect(pins(active().publicationId)["tpl-shell"]).toBe("rev-L3");
      expect(templateRow("tpl-shell").publishedRevisionId).toBe("rev-L3");
      expect(await servedLayoutTitle()).toBe("L3");
    });

    it("scenario 4: a preparation that branches the confirmed draft into a new revision: the scope is restated for that branch, which is sealed", async () => {
      await publish("tpl-about");
      saveDraft("tpl-shell", "L3");
      saveDraft("tpl-home", "A1");
      // A Build Preview seals rev-L3 into the build's publication, which pins
      // it, so the next preparation branches it instead of writing in place.
      await prepareAndSeal("tpl-home");
      const scope = await confirm("tpl-home");
      expect(scope.sharedLayout?.revisionId).toBe("rev-L3");
      const revisionsBefore = layoutRevisionCount();
      const { preparation, sealedPins } = await prepareAndSeal("tpl-home");
      expect(preparation.fromRevisionId).toBe("rev-L3");
      expect(preparation.revisionId).not.toBe("rev-L3");
      expect(layoutRevisionCount()).toBe(revisionsBefore + 1);
      expect(revisionTitle(preparation.revisionId)).toBe("L3");
      const sent = publishScopeAfterPreparation(
        confirmedExpectation(scope),
        preparation,
      );
      expect(sent).toEqual({
        expectedSharedLayoutRevisionId: preparation.revisionId,
        layoutDraftRevisionId: preparation.revisionId,
      });
      // The scope as read no longer names what the publish would seal.
      await expect(publishOnly("tpl-home", "rev-L3")).rejects.toThrow(
        PUBLISH_SCOPE_CHANGED,
      );
      await expect(
        publish("tpl-home", {
          expectedSharedLayoutRevisionId: sent.expectedSharedLayoutRevisionId,
        }),
      ).resolves.toMatchObject({ releaseCreated: true });
      expect(sealedPins["tpl-shell"]).toBe(preparation.revisionId);
      expect(pins(active().publicationId)["tpl-shell"]).toBe(
        preparation.revisionId,
      );
      expect(await servedLayoutTitle()).toBe("L3");
    });

    it("scenario 3: a first publish whose preparation writes the layout's first revision: the confirmation is restated for that revision, which is sealed", async () => {
      // A layout never published and with no draft yet: the confirmation
      // says it goes live, and the publish writes its first draft.
      sqlite
        .prepare(
          "UPDATE storefront_theme_templates SET draft_revision_id = NULL WHERE id = 'tpl-shell'",
        )
        .run();
      const scope = await confirm("tpl-home");
      expect(scope).toEqual({
        sharedLayout: null,
        layout: {
          templateId: "tpl-shell",
          draftRevisionId: null,
          firstPublish: true,
        },
      });
      expect(confirmedExpectation(scope)).toEqual({
        expectedSharedLayoutRevisionId: null,
        layoutDraftRevisionId: null,
      });
      const revisionsBefore = layoutRevisionCount();
      const { preparation, sealedPins } = await prepareAndSeal("tpl-home");
      expect(preparation.fromRevisionId).toBeNull();
      expect(layoutRevisionCount()).toBe(revisionsBefore + 1);
      expect(templateRow("tpl-shell").draftRevisionId).toBe(
        preparation.revisionId,
      );
      expect(revisionTitle(preparation.revisionId)).toBe("L1");
      const sent = publishScopeAfterPreparation(
        confirmedExpectation(scope),
        preparation,
      );
      expect(sent).toEqual({
        expectedSharedLayoutRevisionId: preparation.revisionId,
        layoutDraftRevisionId: preparation.revisionId,
      });
      // Sent as read, the first draft is a layout nobody named.
      await expect(publishOnly("tpl-home", null)).rejects.toThrow(
        PUBLISH_SCOPE_CHANGED,
      );
      await expect(
        publish("tpl-home", {
          expectedSharedLayoutRevisionId: sent.expectedSharedLayoutRevisionId,
        }),
      ).resolves.toMatchObject({ releaseCreated: true });
      expect(sealedPins["tpl-shell"]).toBe(preparation.revisionId);
      expect(pins(active().publicationId)["tpl-shell"]).toBe(
        preparation.revisionId,
      );
      expect(templateRow("tpl-shell").publishedRevisionId).toBe(
        preparation.revisionId,
      );
      expect(await servedLayoutTitle()).toBe("L1");
    });

    // Scenario 5 as the merchant runs it: the Build Preview comes between
    // the rollback and the publish (the E2E's R-c), and the publish either
    // reuses that build or builds again.
    it.each([
      { name: "the publish reuses the Build Preview's build", builds: false },
      { name: "the publish builds again", builds: true },
    ])(
      "scenario 5: rollback, Build Preview, then a page publish ($name): the rolled-away layout does not return",
      async ({ builds }) => {
        await publish("tpl-about");
        const release1 = active();
        saveDraft("tpl-about", "B2");
        saveDraft("tpl-shell", "L2");
        await publish("tpl-about");
        expect(pins(active().publicationId)["tpl-shell"]).toBe("rev-L2");
        await rollBackTo(release1.releaseId);
        expect(active().releaseId).toBe(release1.releaseId);
        const untouched = {
          draftRevisionId: "rev-L2",
          publishedRevisionId: "rev-L2",
        };
        expect(templateRow("tpl-shell")).toMatchObject(untouched);
        saveDraft("tpl-home", "A1");

        // The toolbar Build Preview on the page.
        const layoutRevisions = layoutRevisionCount();
        const buildPreview = await prepareAndSeal("tpl-home");
        expect(buildPreview.preparation).toEqual({
          fromRevisionId: "rev-L2",
          revisionId: "rev-L2",
        });
        expect(buildPreview.sealedPins["tpl-shell"]).toBe("rev-L1");
        expect(layoutRevisionCount()).toBe(layoutRevisions);
        expect(templateRow("tpl-shell")).toMatchObject(untouched);

        // Publish opens: the layout is not part of it.
        const scope = await confirm("tpl-home");
        expect(scope).toEqual({
          sharedLayout: null,
          layout: {
            templateId: "tpl-shell",
            draftRevisionId: "rev-L2",
            firstPublish: false,
          },
        });
        let preparation: ReturnType<typeof chainLayoutPreparation> | null =
          null;
        if (builds) {
          const again = await prepareAndSeal("tpl-home");
          expect(again.sealedPins["tpl-shell"]).toBe("rev-L1");
          preparation = again.preparation;
        }
        const sent = publishScopeAfterPreparation(
          confirmedExpectation(scope),
          preparation,
        );
        expect(sent.expectedSharedLayoutRevisionId).toBeNull();
        // The rolled-away revision is a layout nobody confirmed.
        await expect(publishOnly("tpl-home", "rev-L2")).rejects.toThrow(
          PUBLISH_SCOPE_CHANGED,
        );
        await expect(
          publish("tpl-home", {
            expectedSharedLayoutRevisionId: sent.expectedSharedLayoutRevisionId,
          }),
        ).resolves.toMatchObject({ releaseCreated: true });
        expect(active().releaseId).not.toBe(release1.releaseId);
        expect(pins(active().publicationId)["tpl-shell"]).toBe("rev-L1");
        expect(pins(active().publicationId)["tpl-about"]).toBe("rev-B1");
        expect(layoutRevisionCount()).toBe(layoutRevisions);
        expect(templateRow("tpl-shell")).toMatchObject(untouched);
        expect(await servedLayoutTitle()).toBe("L1");
      },
    );

    it.each([
      {
        name: "another draft write moved the layout on",
        afterConfirm: async () => saveDraft("tpl-shell", "L4"),
        prepare: false,
        reconfirmed: "rev-L4",
      },
      {
        name: "another draft write moved the layout on, then this publish prepared it from there",
        afterConfirm: async () => saveDraft("tpl-shell", "L4"),
        prepare: true,
        reconfirmed: "rev-L4",
      },
      {
        name: "another page's publish sealed the layout",
        afterConfirm: async () => {
          saveDraft("tpl-about", "B3");
          await publish("tpl-about");
        },
        prepare: false,
        reconfirmed: null,
      },
    ])(
      "scenario 6: the layout changed by another write after the confirmation ($name): PUBLISH_SCOPE_CHANGED, and nothing written",
      async ({ afterConfirm, prepare, reconfirmed }) => {
        await publish("tpl-about");
        saveDraft("tpl-shell", "L3");
        saveDraft("tpl-home", "A1");
        const scope = await confirm("tpl-home");
        expect(scope.sharedLayout?.revisionId).toBe("rev-L3");
        await afterConfirm();
        let sent = confirmedExpectation(scope);
        if (prepare) {
          const { preparation } = await prepareAndSeal("tpl-home");
          // Started from rev-L4, not the draft the author confirmed: the
          // scope stays as read.
          expect(preparation.fromRevisionId).toBe("rev-L4");
          sent = publishScopeAfterPreparation(sent, preparation);
        }
        expect(sent.expectedSharedLayoutRevisionId).toBe("rev-L3");

        const before = publishWrites();
        await expect(
          publishOnly("tpl-home", sent.expectedSharedLayoutRevisionId),
        ).rejects.toThrow(PUBLISH_SCOPE_CHANGED);
        // No release, publication, pin or revision; no template row, live
        // pointer or release generation moved.
        expect(publishWrites()).toEqual(before);

        // Confirmed again, the publish goes through with the layout as it is.
        const again = await confirm("tpl-home");
        const reconfirmedScope = again.sharedLayout?.revisionId ?? null;
        expect(reconfirmedScope).toBe(reconfirmed);
        await expect(
          publish("tpl-home", {
            expectedSharedLayoutRevisionId: reconfirmedScope,
          }),
        ).resolves.toMatchObject({ releaseCreated: true });
        expect(pins(active().publicationId)["tpl-shell"]).toBe(
          reconfirmed ?? "rev-L3",
        );
      },
    );

    // The case the cases above cannot reach: the other write came from
    // another session, so this editor still holds the layout draft it
    // confirmed and prepares from it (the shell's `currentDraftId`). The
    // restatement trusts that base; were the preparation accepted, the
    // revision it left (L4's content) would be sent as the confirmed scope
    // and go live unseen. The preparation's own draft CAS is what stops it.
    it("scenario 6: another session moved the layout on, and this editor prepares from the draft it confirmed: the preparation is refused, and so is the publish, with nothing written", async () => {
      await publish("tpl-about");
      saveDraft("tpl-shell", "L3");
      saveDraft("tpl-home", "A1");
      const scope = await confirm("tpl-home");
      expect(scope.sharedLayout?.revisionId).toBe("rev-L3");
      const held = templateRow("tpl-shell");
      saveDraft("tpl-shell", "L4");

      // The release list and the live pointer, named on their own: a
      // TEMPLATE_DRAFT_GENERATION_MISMATCH answer is acceptable here only
      // because no release was created or activated (2026-11-24 decision).
      const releaseIds = () =>
        (
          sqlite
            .prepare("SELECT id FROM storefront_releases ORDER BY id")
            .all() as { id: string }[]
        ).map((row) => row.id);
      const releasesBefore = releaseIds();
      const liveBefore = active();
      expect(releasesBefore, "the setup published one release").toContain(
        liveBefore.releaseId,
      );
      const before = publishWrites();
      await expect(
        storefrontThemeDal.prepareInitialTemplateDraft({
          storefrontId: "storefront-a",
          themeId: "theme-a",
          templateId: "tpl-shell",
          expectedDraftGeneration: held.draftGeneration,
          expectedSourceGeneration: 1,
          expectedDraftRevisionId: held.draftRevisionId,
          createdBy: "user-a",
        }),
      ).rejects.toThrow(TEMPLATE_DRAFT_GENERATION_MISMATCH);
      expect(publishWrites()).toEqual(before);
      expect(releaseIds(), "the refused preparation created no release").toEqual(
        releasesBefore,
      );
      expect(active(), "the refused preparation activated nothing").toEqual(
        liveBefore,
      );

      await expect(
        publishOnly(
          "tpl-home",
          confirmedExpectation(scope).expectedSharedLayoutRevisionId,
        ),
      ).rejects.toThrow(PUBLISH_SCOPE_CHANGED);
      expect(publishWrites()).toEqual(before);
      expect(releaseIds(), "the refused publish created no release").toEqual(
        releasesBefore,
      );
      expect(active(), "the refused publish activated nothing").toEqual(
        liveBefore,
      );
      expect(templateRow("tpl-shell")).toMatchObject({
        draftRevisionId: "rev-L4",
        publishedRevisionId: "rev-L1",
      });
    });
  });
});

describe("switching a Theme's preview away from start (option B)", () => {
  // The apply-then-switch order. A Theme that holds a module only the full
  // Start preview can run must not be switched to client, nor cleared to the
  // deployment's default (which is no confirmation of start). That is judged
  // on the stored files, not on the Starter version the Theme records: the
  // restore command puts a Start-only module back without moving it. The
  // check is bound to the source generation it read, so a file written after
  // it cannot slip past; the switch itself never takes or moves the
  // generation, so an author's save is never lost to it.
  //
  // Expected, read from the code (not run): RED for the refusals, the race
  // and the code-edit conflict (setPreviewRuntime reads no file today); the
  // other cases pass.
  const CONTENT = "src/morph/content.ts";
  const START_ONLY = `import { createServerFn } from "@tanstack/react-start";
export const readPage = createServerFn({ method: "GET" }).handler(async () => null);
`;
  const CLIENT_SAFE = `export const content = (slot: string) => ({ slot });
`;

  const setRuntime = (runtime: string | null) =>
    sqlite
      .prepare(
        "UPDATE storefront_themes SET preview_runtime = ? WHERE id = 'theme-a'",
      )
      .run(runtime);
  const setStarterVersion = (version: number) =>
    sqlite
      .prepare("UPDATE storefront_themes SET metadata = ? WHERE id = 'theme-a'")
      .run(JSON.stringify({ starterTemplateVersion: version }));
  const insertFile = (path: string, content: string) =>
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_files (id, storefront_id, theme_id, path, content, mime_type, version, created_at, updated_at)
         VALUES (?, 'storefront-a', 'theme-a', ?, ?, 'text/typescript', 1, 'now', 'now')`,
      )
      .run(crypto.randomUUID(), path, content);
  const themeRow = () =>
    sqlite
      .prepare(
        "SELECT preview_runtime, source_generation, metadata, updated_at FROM storefront_themes WHERE id = 'theme-a'",
      )
      .get() as {
      preview_runtime: string | null;
      source_generation: number;
      metadata: string | null;
      updated_at: string;
    };
  const files = () =>
    sqlite
      .prepare(
        "SELECT path, content, version FROM storefront_theme_files WHERE theme_id = 'theme-a' AND deleted_at IS NULL ORDER BY path",
      )
      .all();
  const switchTo = (
    previewRuntime: "client" | "start" | null,
    expectedPreviewRuntime: "client" | "start" | null,
  ) =>
    storefrontThemeDal.setPreviewRuntime({
      storefrontId: "storefront-a",
      themeId: "theme-a",
      previewRuntime,
      expectedPreviewRuntime,
    });
  /** A Starter write held to start, as the restore and the upgrade make it. */
  const starterWrite = (expectedSourceGeneration: number) =>
    storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [{ path: CONTENT, content: START_ONLY, expectMissing: true }],
      { expectedSourceGeneration, requirePreviewRuntime: "start" },
    );
  /**
   * Runs `inject` once, right after the switch's check has read the files
   * and their generation, and before it writes.
   */
  function afterSwitchReadsFiles(
    inject: (snapshot: { sourceGeneration: number }) => Promise<void>,
  ) {
    const read = storefrontThemeFileDal.getSourceSnapshot.bind(
      storefrontThemeFileDal,
    );
    const spy = vi
      .spyOn(storefrontThemeFileDal, "getSourceSnapshot")
      .mockImplementationOnce(async (...args) => {
        const snapshot = await read(...args);
        if (!snapshot) throw new Error("the switch read no snapshot");
        await inject(snapshot);
        return snapshot;
      });
    spies.push(spy);
    return spy;
  }
  /** A Start-only module on a Theme that does not record start. */
  const incompatible = () => {
    const runtime = themeRow().preview_runtime;
    const startOnly = (files() as Array<{ content: string }>).some(
      (file) => file.content === START_ONLY,
    );
    return startOnly && runtime !== "start";
  };

  const spies: Array<{ mockRestore(): void }> = [];
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it.each(["client", null] as const)(
    "refuses switching a start Theme to %s while it holds a Start-only module, and writes nothing",
    async (target) => {
      setRuntime("start");
      insertFile(CONTENT, START_ONLY);
      const before = themeRow();

      await expect(switchTo(target, "start")).resolves.toEqual({
        ok: false,
        error: "PREVIEW_RUNTIME_START_REQUIRED",
        paths: [CONTENT],
      });

      expect(themeRow()).toEqual(before);
    },
  );

  it("judges the stored files, not the Starter version the Theme records", async () => {
    // Below the first Starter that needs Start, with the module restored.
    setStarterVersion(31);
    setRuntime("start");
    insertFile(CONTENT, START_ONLY);
    await expect(switchTo("client", "start")).resolves.toMatchObject({
      ok: false,
      error: "PREVIEW_RUNTIME_START_REQUIRED",
    });

    // At or past it, with the author's own module that needs no Start.
    sqlite.exec("DELETE FROM storefront_theme_files");
    insertFile(CONTENT, CLIENT_SAFE);
    setStarterVersion(32);
    await expect(switchTo("client", "start")).resolves.toEqual({
      ok: true,
      previewRuntime: "client",
    });
    expect(themeRow().preview_runtime).toBe("client");
  });

  it("switches to client and leaves the source generation where it was when nothing needs Start", async () => {
    setRuntime("start");
    insertFile(CONTENT, CLIENT_SAFE);
    const before = themeRow();

    await expect(switchTo("client", "start")).resolves.toEqual({
      ok: true,
      previewRuntime: "client",
    });

    expect(themeRow().source_generation).toBe(before.source_generation);
  });

  it("never judges the files of a switch to start", async () => {
    setRuntime("client");
    insertFile(CONTENT, START_ONLY);
    const snapshot = vi.spyOn(storefrontThemeFileDal, "getSourceSnapshot");
    spies.push(snapshot);

    await expect(switchTo("start", "client")).resolves.toEqual({
      ok: true,
      previewRuntime: "start",
    });
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("refuses the switch when a Start-only file is written after its check read the files, and leaves both consistent", async () => {
    setRuntime("start");
    insertFile("src/routes/index.tsx", CLIENT_SAFE);
    const generationBefore = themeRow().source_generation;
    afterSwitchReadsFiles(async (snapshot) => {
      // The restore (or an upgrade) lands in that window, on a Theme that
      // still records start.
      await starterWrite(snapshot.sourceGeneration);
    });

    const result = await switchTo("client", "start");

    expect(result).toEqual({
      ok: false,
      error: "PREVIEW_RUNTIME_START_REQUIRED",
      paths: [CONTENT],
    });
    // The file write is whole and the switch left nothing: still start.
    expect(themeRow()).toMatchObject({
      preview_runtime: "start",
      source_generation: generationBefore + 1,
    });
    expect(files()).toContainEqual({
      path: CONTENT,
      content: START_ONLY,
      version: 1,
    });
    expect(incompatible()).toBe(false);
  });

  it("refuses the Starter write when the switch to client committed first, and writes nothing", async () => {
    setRuntime("start");
    const seenByWriter = themeRow().source_generation;
    await expect(switchTo("client", "start")).resolves.toEqual({
      ok: true,
      previewRuntime: "client",
    });
    const before = { theme: themeRow(), files: files() };

    await expect(starterWrite(seenByWriter)).rejects.toThrow(
      "PREVIEW_RUNTIME_START_REQUIRED",
    );

    expect({ theme: themeRow(), files: files() }).toEqual(before);
    expect(incompatible()).toBe(false);
  });

  it("reports an author's code save that lands during the switch as a conflict, and keeps the save", async () => {
    setRuntime("start");
    insertFile(CONTENT, CLIENT_SAFE);
    const [existing] = await storefrontThemeFileDal.listFiles(
      "storefront-a",
      "theme-a",
    );
    if (!existing) throw new Error("no file");
    const edited = `${CLIENT_SAFE}// the author's edit\n`;
    afterSwitchReadsFiles(async (snapshot) => {
      await storefrontThemeFileDal.saveFilesBatch(
        "storefront-a",
        "theme-a",
        [
          {
            path: CONTENT,
            content: edited,
            expectedFileId: existing.id,
            expectedVersion: existing.version,
          },
        ],
        { expectedSourceGeneration: snapshot.sourceGeneration },
      );
    });
    const generationBefore = themeRow().source_generation;

    const result = await switchTo("client", "start");

    // Not written over the files it judged, and not silently dropped either:
    // the author is told the source changed, with the generation it is at.
    expect(result).toEqual({
      ok: false,
      error: "PREVIEW_RUNTIME_SOURCE_CHANGED",
      sourceGeneration: generationBefore + 1,
    });
    expect(themeRow().preview_runtime).toBe("start");
    expect(files()).toEqual([{ path: CONTENT, content: edited, version: 2 }]);
  });

  it("takes an author's code save made at the generation read before a switch landed", async () => {
    setRuntime("start");
    insertFile(CONTENT, CLIENT_SAFE);
    const [existing] = await storefrontThemeFileDal.listFiles(
      "storefront-a",
      "theme-a",
    );
    if (!existing) throw new Error("no file");
    const seenByEditor = themeRow().source_generation;
    await expect(switchTo("client", "start")).resolves.toMatchObject({
      ok: true,
    });
    const edited = `${CLIENT_SAFE}// saved after the switch\n`;

    await expect(
      storefrontThemeFileDal.saveFilesBatch(
        "storefront-a",
        "theme-a",
        [
          {
            path: CONTENT,
            content: edited,
            expectedFileId: existing.id,
            expectedVersion: existing.version,
          },
        ],
        { expectedSourceGeneration: seenByEditor },
      ),
    ).resolves.toMatchObject({ sourceGeneration: seenByEditor + 1 });

    expect(files()).toEqual([{ path: CONTENT, content: edited, version: 2 }]);
    expect(themeRow().preview_runtime).toBe("client");
  });

  it("does not judge an Astro Theme's files: it is never previewed on start", async () => {
    sqlite
      .prepare(
        "UPDATE storefront_themes SET framework = 'astro' WHERE id = 'theme-a'",
      )
      .run();
    insertFile("src/lib/read.ts", START_ONLY);

    await expect(switchTo("client", null)).resolves.toEqual({
      ok: true,
      previewRuntime: "client",
    });
  });
});
