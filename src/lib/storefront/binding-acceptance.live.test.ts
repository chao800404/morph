/**
 * Binding acceptance suite, live layer (ROADMAP 1.2 "綁定驗收規範", draft
 * rule in PR #284). The cases and their targets are in
 * `src/lib/test-utils/binding-acceptance-cases.ts`; the E2E layer is
 * `e2e/binding-acceptance.spec.ts`.
 *
 * Every case walks the five steps, each its own test so each is recorded on
 * its own:
 *
 *   S1 the stored Document, read the way the editor reads it, renders
 *   S2 a click on the element locates the target (section, field path)
 *   S3 the target's edit goes through the DAL write with its OCC guards
 *   S4 the stored Document, read raw from storage, changed only there
 *   S5 a fresh read: the canvas, the selection and storage agree
 *
 * What is real here: the DAL (`findEditorContext`, `updateSectionProps`, its
 * source confirmation, capability check and compare-and-set) over SQLite, the
 * preview's own source pass (`prepareSourcesForLivePreview`, the injector),
 * real React and a real router, and the editor's DOM resolution
 * (`resolveSelectable`). What stands in: the request-level authorization of
 * the server function (the E2E layer covers it), and, for the loader
 * spelling, the in-process server function of `live-preview-render.ts`. The
 * stored content is seeded through `updateSectionProps` itself, on a route
 * shape the product binds, before the case's route replaces it.
 *
 * Failures are the measurement. The targets are the rule's; nothing here is
 * marked to fail, skip or only run.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { B1_INTEGRATION_CASES } from "@/lib/test-utils/binding-acceptance-b1-cases";
import { storefrontThemeDal } from "@/lib/storefront/dal/storefront-theme.dal";
import { resolveSelectable } from "@/lib/storefront/editor/preview-dom";
import {
  BAS_HERO_PATH,
  BAS_HERO_SOURCE,
  basCaseRootId,
  basRouteSource,
  storedSectionsOf,
  unexpectedDocumentChanges,
  type BasCase,
  type BasElement,
  type BasSpelling,
  type StoredDocument,
} from "@/lib/test-utils/binding-acceptance-cases";
import {
  livePreviewPlatformFiles,
  mountLivePreview,
  renderLivePreviewRoute,
} from "@/lib/test-utils/live-preview-render";

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

const STOREFRONT = "storefront-a";
const THEME = "theme-a";
const TEMPLATE = "template-home";
const ROUTE_FILE = "src/routes/index.tsx";

beforeEach(() => {
  sqlite = new Database(":memory:");
  // The tables the DAL reads and writes, as storefront-theme.dal.test.ts
  // declares them.
  sqlite.exec(`
    CREATE TABLE storefronts (
      id text PRIMARY KEY NOT NULL, sales_channel_id text NOT NULL,
      name text NOT NULL, domain text, status text NOT NULL,
      active_theme_id text, active_release_id text, metadata text,
      created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
    );
    CREATE TABLE storefront_themes (
      id text PRIMARY KEY NOT NULL, storefront_id text NOT NULL,
      name text NOT NULL, status text NOT NULL,
      published_source_revision_id text,
      source_generation integer DEFAULT 1 NOT NULL,
      release_generation integer DEFAULT 1 NOT NULL,
      framework text, preview_runtime text, metadata text,
      created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
    );
    CREATE TABLE storefront_theme_files (
      id text PRIMARY KEY NOT NULL, storefront_id text NOT NULL,
      theme_id text NOT NULL, path text NOT NULL, content text NOT NULL,
      mime_type text, is_entry integer DEFAULT 0, version integer DEFAULT 1,
      created_at text NOT NULL, updated_at text NOT NULL, deleted_at text,
      encoding text DEFAULT 'utf8' NOT NULL, blob_digest text, size_bytes integer
    );
    CREATE TABLE storefront_theme_revisions (
      id text PRIMARY KEY NOT NULL, storefront_id text NOT NULL,
      theme_id text NOT NULL, revision_number integer NOT NULL,
      source_generation integer, message text, source text, snapshot text,
      source_manifest text, created_by text,
      created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
    );
    CREATE TABLE storefront_theme_templates (
      id text PRIMARY KEY NOT NULL, theme_id text NOT NULL, type text NOT NULL,
      name text NOT NULL, route_path text, document text NOT NULL,
      draft_revision_id text, published_revision_id text,
      draft_generation integer DEFAULT 1 NOT NULL,
      created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
    );
    CREATE UNIQUE INDEX storefront_theme_templates_active_route_unique
      ON storefront_theme_templates (theme_id, route_path)
      WHERE route_path IS NOT NULL AND deleted_at IS NULL;
    CREATE TABLE storefront_theme_template_revisions (
      id text PRIMARY KEY NOT NULL, template_id text NOT NULL,
      version integer NOT NULL, document text NOT NULL, created_by text,
      created_at text NOT NULL, published_at text
    );
    CREATE TABLE storefront_theme_builds (
      id text PRIMARY KEY NOT NULL, storefront_id text NOT NULL,
      theme_id text NOT NULL, source_revision_id text NOT NULL,
      status text NOT NULL, artifact_prefix text, manifest_json text,
      content_publication_id text, content_dependency text, created_by text,
      created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
    );
    CREATE TABLE storefront_releases (
      id text PRIMARY KEY NOT NULL, storefront_id text NOT NULL,
      theme_id text NOT NULL, source_revision_id text NOT NULL,
      theme_build_id text NOT NULL, content_publication_id text,
      status text NOT NULL, metadata text, created_by text,
      created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
    );
    CREATE TABLE storefront_pages (
      id text PRIMARY KEY NOT NULL, storefront_id text NOT NULL,
      title text NOT NULL, handle text NOT NULL, status text NOT NULL,
      draft_revision_id text, published_revision_id text,
      created_by text NOT NULL, metadata text,
      created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
    );
    CREATE TABLE storefront_page_revisions (id text, page_id text, document text);
    CREATE TABLE storefront_content_publications (
      id text PRIMARY KEY NOT NULL, storefront_id text NOT NULL,
      created_by text, metadata text,
      created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
    );
    CREATE TABLE storefront_content_publication_items (
      id text PRIMARY KEY NOT NULL, publication_id text NOT NULL,
      item_type text NOT NULL, content_id text NOT NULL,
      revision_id text NOT NULL, metadata text,
      created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
    );
  `);
  vi.mocked(getDb).mockResolvedValue(
    drizzle(sqlite, { schema: storefrontSchema }) as never,
  );
  sqlite.exec(`
    INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
    VALUES ('${STOREFRONT}', 'channel-a', 'Store A', 'active', 'now', 'now');
    INSERT INTO storefront_themes (id, storefront_id, name, status, source_generation, release_generation, created_at, updated_at)
    VALUES ('${THEME}', '${STOREFRONT}', 'Binding acceptance', 'draft', 1, 1, 'now', 'now');
    INSERT INTO storefront_theme_templates (id, theme_id, type, name, document, created_at, updated_at)
    VALUES ('${TEMPLATE}', '${THEME}', 'index', 'Home', '{"version":1,"sections":[]}', 'now', 'now');
  `);
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixture: the Theme, the seed and the reads

/** The Theme's files with the route at `/` in the given shape. */
function themeFiles(routeSource: string) {
  return [
    ...livePreviewPlatformFiles(),
    { path: BAS_HERO_PATH, content: BAS_HERO_SOURCE },
    { path: ROUTE_FILE, content: routeSource },
  ];
}

function writeThemeFiles(files: ReadonlyArray<{ path: string; content: string }>) {
  const upsert = sqlite.prepare(`
    INSERT INTO storefront_theme_files
      (id, storefront_id, theme_id, path, content, created_at, updated_at)
    VALUES (?, '${STOREFRONT}', '${THEME}', ?, ?, 'now', 'now')
  `);
  sqlite.prepare("DELETE FROM storefront_theme_files").run();
  files.forEach((file, index) => upsert.run(`file-${index}`, file.path, file.content));
}

/** A Theme source save: new content, and the source generation moves on. */
function saveRouteSource(routeSource: string) {
  sqlite
    .prepare("UPDATE storefront_theme_files SET content = ? WHERE path = ?")
    .run(routeSource, ROUTE_FILE);
  sqlite
    .prepare(
      "UPDATE storefront_themes SET source_generation = source_generation + 1 WHERE id = ?",
    )
    .run(THEME);
}

function sourceGeneration(): number {
  return (
    sqlite
      .prepare("SELECT source_generation AS g FROM storefront_themes WHERE id = ?")
      .get(THEME) as { g: number }
  ).g;
}

function draftGeneration(): number {
  return (
    sqlite
      .prepare("SELECT draft_generation AS g FROM storefront_theme_templates WHERE id = ?")
      .get(TEMPLATE) as { g: number }
  ).g;
}

/** The stored Document, straight from the draft revision row. */
function rawStoredDocument(): StoredDocument {
  const row = sqlite
    .prepare(
      `SELECT r.document AS document
       FROM storefront_theme_templates t
       JOIN storefront_theme_template_revisions r
         ON r.id = t.draft_revision_id AND r.template_id = t.id
       WHERE t.id = ?`,
    )
    .get(TEMPLATE) as { document: string } | undefined;
  if (!row) throw new Error("no draft revision is stored for the template");
  return JSON.parse(row.document) as StoredDocument;
}

/** The Document the editor and the Live Preview snapshot are given. */
async function editorDocument(): Promise<StorefrontPageDocument> {
  const context = await storefrontThemeDal.findEditorContext(STOREFRONT, THEME);
  const template = context?.templates.find((item) => item.id === TEMPLATE);
  if (!template) throw new Error("the editor context has no home template");
  return template.document;
}

/** One content write, exactly as the Inspector issues it. */
async function writeField(section: string, field: string, value: string) {
  return storefrontThemeDal.updateSectionProps({
    storefrontId: STOREFRONT,
    themeId: THEME,
    templateId: TEMPLATE,
    sectionId: section,
    props: { [field]: value },
    expectedDraftGeneration: draftGeneration(),
    expectedSourceGeneration: sourceGeneration(),
    createdBy: "user-1",
    routePath: "/",
  });
}

/**
 * Seeds the case's sections through the product write path on the route
 * shape it binds, then saves the case's own route over it.
 */
async function seed(testCase: BasCase, spelling: BasSpelling) {
  writeThemeFiles(
    themeFiles(basRouteSource(testCase, spelling, { routePath: "/", seed: true })),
  );
  for (const [section, props] of Object.entries(testCase.seed)) {
    for (const [field, value] of Object.entries(props)) {
      const written = await writeField(section, field, value);
      if (!written) throw new Error(`seed: ${section}.${field} was not written`);
    }
  }
  const stored = storedSectionsOf(rawStoredDocument());
  if (JSON.stringify(stored) !== JSON.stringify(testCase.seed)) {
    throw new Error(`seed: stored ${JSON.stringify(stored)}`);
  }
  saveRouteSource(basRouteSource(testCase, spelling, { routePath: "/" }));
}

/** Renders the route with the Document the editor gives the preview. */
async function renderCase(testCase: BasCase, spelling: BasSpelling) {
  const document = await editorDocument();
  const files = themeFiles(basRouteSource(testCase, spelling, { routePath: "/" }));
  const { html } = await renderLivePreviewRoute({
    files,
    documents: { index: document },
  });
  const root = mountLivePreview(html);
  const caseRoot = root.querySelector<HTMLElement>(
    `[data-bas-case="${basCaseRootId(testCase)}"]`,
  );
  return { root, caseRoot, html };
}

function elementOf(caseRoot: HTMLElement | null, element: BasElement) {
  return (
    (caseRoot?.querySelectorAll<HTMLElement>(element.tag)[element.nth] as
      | HTMLElement
      | undefined) ?? null
  );
}

const describeElement = (element: BasElement) =>
  `${element.tag}[${element.nth}] (${
    element.target.kind === "field"
      ? `${element.target.section}.${element.target.field}`
      : element.target.kind === "composed"
        ? `composed from ${element.target.section}.${element.target.rawFields.join("+")}`
        : "literal"
  })`;

/** What a click on the element resolves to, in the editor's terms. */
function selectionOf(caseRoot: HTMLElement | null, element: BasElement) {
  const node = elementOf(caseRoot, element);
  const selection = node ? resolveSelectable(node) : null;
  return {
    found: node !== null,
    sectionId: selection?.sectionId ?? null,
    fieldKey: selection?.fieldKey ?? null,
    fieldPath: selection?.fieldPath ?? null,
    contentUnavailable: selection?.contentUnavailable ?? null,
    bindingState: selection?.bindingState ?? null,
  };
}

/** The target's edit, the value it writes, and the change S4 expects. */
function editFor(testCase: BasCase, label: string) {
  const inspector = testCase.edit.inspector;
  const value = `BAS ${testCase.id} ${label}`;
  return {
    inspector,
    value,
    change: inspector
      ? { section: inspector.section, field: inspector.field, value }
      : null,
  };
}

/**
 * The write the editor would issue from this click: to the section the click
 * selected, on the field the author edits there (the target's field, as the
 * Inspector names it; for a literal, whatever field the click claims). No
 * stored section selected, nothing to write to.
 */
async function writeFromClick(
  testCase: BasCase,
  spelling: BasSpelling,
  value: string,
) {
  const { caseRoot } = await renderCase(testCase, spelling);
  const selection = selectionOf(caseRoot, testCase.elements[testCase.edit.element]!);
  const stored = new Set(Object.keys(testCase.seed));
  const field = testCase.edit.inspector?.field ?? selection.fieldKey;
  if (!selection.sectionId || !field || !stored.has(selection.sectionId)) {
    return { selection, wrote: null as null | { section: string; field: string } };
  }
  let error: string | null = null;
  await writeField(selection.sectionId, field, value).catch((caught) => {
    error = String(caught);
  });
  return {
    selection,
    wrote: { section: selection.sectionId, field },
    error,
  };
}

/** S3's action: the target's edit, or for a literal the click's own write. */
async function performEdit(testCase: BasCase, spelling: BasSpelling, label: string) {
  const edit = editFor(testCase, label);
  if (!edit.inspector) {
    const fromClick = await writeFromClick(testCase, spelling, edit.value);
    return { edit, result: null as unknown, error: null as unknown, fromClick };
  }
  try {
    const result = await writeField(
      edit.inspector.section,
      edit.inspector.field,
      edit.value,
    );
    return { edit, result, error: null as unknown, fromClick: null };
  } catch (error) {
    return { edit, result: null as unknown, error, fromClick: null };
  }
}

/**
 * What a step saw, one JSON line per step, for the acceptance matrix. A
 * record only: every claim is still an assertion below.
 */
function observe(
  spelling: BasSpelling,
  testCase: BasCase,
  step: string,
  data: unknown,
) {
  console.log(
    `BAS-OBS ${JSON.stringify({ layer: "live", spelling, case: testCase.id, step, data })}`,
  );
}

const SPELLINGS: ReadonlyArray<{ spelling: BasSpelling; runtime: string }> = [
  { spelling: "content", runtime: "client-only spelling (content())" },
  {
    spelling: "loader",
    runtime: "full Start spelling (server fn -> loader -> useLoaderData, in-process stand-in)",
  },
];

for (const { spelling, runtime } of SPELLINGS) {
  describe(`binding acceptance, ${runtime}`, () => {
    for (const testCase of B1_INTEGRATION_CASES) {
      describe(`${testCase.id}: ${testCase.verifies}`, () => {
        it("S1 the stored Document renders through the editor's read", async () => {
          await seed(testCase, spelling);
          const raw = rawStoredDocument();
          const stored = storedSectionsOf(raw);
          // Reading does not depend on binding (rule 1): the Document the
          // editor and the preview are given keeps every stored section.
          const editorSections = storedSectionsOf(
            (await editorDocument()) as unknown as StoredDocument,
          );
          expect
            .soft(editorSections, "the editor's Document keeps every stored section and value")
            .toEqual(stored);
          let rendered: Awaited<ReturnType<typeof renderCase>> | null = null;
          let renderError: unknown = null;
          try {
            rendered = await renderCase(testCase, spelling);
          } catch (error) {
            renderError = error;
          }
          expect(
            renderError === null ? null : String(renderError),
            "the page renders",
          ).toBeNull();
          const shown = testCase.elements.map((element) => ({
            element: describeElement(element),
            text: elementOf(rendered!.caseRoot, element)?.textContent ?? null,
          }));
          observe(spelling, testCase, "S1", {
            stored,
            editorSections,
            shown,
            caseRootFound: rendered?.caseRoot != null,
            bodyText: rendered?.root.textContent?.slice(0, 200) ?? null,
          });
          expect(shown).toEqual(
            testCase.elements.map((element) => ({
              element: describeElement(element),
              text: element.text(stored),
            })),
          );
        });

        it("S2 a click locates the target (section, field path)", async () => {
          await seed(testCase, spelling);
          const { caseRoot } = await renderCase(testCase, spelling);
          const storedIds = new Set(Object.keys(testCase.seed));
          // Each kind of target is compared on what it promises:
          // - a field: this section and this field path, offered for editing;
          // - composed: located to its section, never claimed as one direct
          //   field (its raw fields are offered by the Inspector: E2E layer);
          // - a literal: never claimed as a stored section's field.
          const project = (
            element: BasElement,
            selection: ReturnType<typeof selectionOf>,
          ) => {
            const target = element.target;
            if (target.kind === "field") {
              return {
                found: selection.found,
                sectionId: selection.sectionId,
                fieldPath: selection.fieldPath,
                contentUnavailable: selection.contentUnavailable,
              };
            }
            if (target.kind === "composed") {
              return {
                found: selection.found,
                sectionId: selection.sectionId,
                claimedDirectField: selection.fieldKey,
              };
            }
            return {
              found: selection.found,
              claimsStoredField:
                selection.sectionId !== null &&
                storedIds.has(selection.sectionId) &&
                selection.fieldKey !== null
                  ? `${selection.sectionId}.${selection.fieldPath}`
                  : null,
            };
          };
          const observed = testCase.elements.map((element) => ({
            element: describeElement(element),
            ...project(element, selectionOf(caseRoot, element)),
          }));
          observe(
            spelling,
            testCase,
            "S2",
            testCase.elements.map((element) => ({
              element: describeElement(element),
              ...selectionOf(caseRoot, element),
            })),
          );
          const expected = testCase.elements.map((element) => {
            const target = element.target;
            return {
              element: describeElement(element),
              ...(target.kind === "field"
                ? {
                    found: true,
                    sectionId: target.section,
                    fieldPath: target.field,
                    contentUnavailable: null,
                  }
                : target.kind === "composed"
                  ? { found: true, sectionId: target.section, claimedDirectField: null }
                  : { found: true, claimsStoredField: null }),
            };
          });
          expect(observed).toEqual(expected);
        });

        if (["p1", "c6a", "c6b", "p4a", "p6"].includes(testCase.id)) {
          it("reports provenance as descriptive selection metadata", async () => {
            await seed(testCase, spelling);
            const { caseRoot } = await renderCase(testCase, spelling);
            const observeState = (elementIndex: number) =>
              selectionOf(caseRoot, testCase.elements[elementIndex]!)
                .bindingState;

            if (testCase.id === "p1") {
              expect(observeState(0)).toBe("cms-field");
            } else if (testCase.id === "c6a") {
              expect(observeState(0)).toBe("not-cms");
            } else if (testCase.id === "p6") {
              expect(observeState(0)).toBe("untraced");
            } else if (testCase.id === "c6b") {
              expect(observeState(2)).toBe("derived");
            } else {
              expect(observeState(0)).toBe("not-cms");
            }
          });
        }

        it("S3 the edit goes through the DAL write and its OCC guards", async () => {
          await seed(testCase, spelling);
          const { edit, result, error, fromClick } = await performEdit(
            testCase,
            spelling,
            "S3",
          );
          observe(spelling, testCase, "S3", {
            target: edit.change,
            error: error === null ? null : String(error),
            returnedDocument: result !== null,
            fromClick,
          });
          if (!edit.inspector) {
            // A literal: the editor must issue no write for it at all.
            expect(
              fromClick!.wrote,
              "the click on a literal issues no content write",
            ).toBeNull();
            return;
          }
          expect(error === null ? null : String(error), "the write is accepted").toBeNull();
          expect(result, "the write returns the stored Document").not.toBeNull();
        });

        it("S4 the raw stored Document changed only at the target", async () => {
          await seed(testCase, spelling);
          const before = rawStoredDocument();
          const { edit } = await performEdit(testCase, spelling, "S4");
          const after = rawStoredDocument();
          const problems = unexpectedDocumentChanges(before, after, edit.change);
          observe(spelling, testCase, "S4", {
            target: edit.change,
            problems,
            before: storedSectionsOf(before),
            after: storedSectionsOf(after),
          });
          expect(problems).toEqual([]);
        });

        // S3/S4 above write the target directly, to measure the write path on
        // its own. This is the write the author actually causes: from the
        // click, to whatever section it selected.
        it("S4-click the editor's write from the click changes only the target", async () => {
          await seed(testCase, spelling);
          const before = rawStoredDocument();
          const { change, value } = editFor(testCase, "S4-click");
          const fromClick = await writeFromClick(testCase, spelling, value);
          const after = rawStoredDocument();
          const problems = unexpectedDocumentChanges(before, after, change);
          observe(spelling, testCase, "S4-click", {
            target: change,
            fromClick,
            problems,
            before: storedSectionsOf(before),
            after: storedSectionsOf(after),
          });
          expect(problems).toEqual([]);
        });

        it("S5 after a fresh read the canvas, the selection and storage agree", async () => {
          await seed(testCase, spelling);
          const before = rawStoredDocument();
          await performEdit(testCase, spelling, "S5");
          const stored = rawStoredDocument();
          const storedSections = storedSectionsOf(stored);
          const editorSections = storedSectionsOf(
            (await editorDocument()) as unknown as StoredDocument,
          );
          expect
            .soft(editorSections, "the editor's Document agrees with storage")
            .toEqual(storedSections);
          const expected = editFor(testCase, "S5");
          // What storage must hold: the seed with only the target changed.
          const target = storedSectionsOf(before);
          const wanted = expected.change
            ? {
                ...target,
                [expected.change.section]: {
                  ...target[expected.change.section],
                  [expected.change.field]: expected.change.value,
                },
              }
            : target;
          expect.soft(storedSections, "storage holds the edit and nothing else").toEqual(wanted);
          let rendered: Awaited<ReturnType<typeof renderCase>> | null = null;
          let renderError: unknown = null;
          try {
            rendered = await renderCase(testCase, spelling);
          } catch (error) {
            renderError = error;
          }
          expect(
            renderError === null ? null : String(renderError),
            "the page renders",
          ).toBeNull();
          const element = testCase.elements[testCase.edit.element]!;
          const selection = selectionOf(rendered!.caseRoot, element);
          observe(spelling, testCase, "S5", {
            storedSections,
            editorSections,
            wanted,
            shown: testCase.elements.map(
              (candidate) => elementOf(rendered!.caseRoot, candidate)?.textContent ?? null,
            ),
            selection,
          });
          expect({
            shown: testCase.elements.map(
              (candidate) => elementOf(rendered!.caseRoot, candidate)?.textContent ?? null,
            ),
            located:
              element.target.kind === "field"
                ? { sectionId: selection.sectionId, fieldPath: selection.fieldPath }
                : null,
          }).toEqual({
            shown: testCase.elements.map((candidate) => candidate.text(wanted)),
            located:
              element.target.kind === "field"
                ? { sectionId: element.target.section, fieldPath: element.target.field }
                : null,
          });
        });
      });
    }
  });
}
