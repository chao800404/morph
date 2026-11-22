/**
 * Category card destinations through a real Starter upgrade.
 *
 * Every Starter up to v30 seeded the home's category cards with a bare `href`
 * on each row. Since links were unified the Starter's `CategoryShowcase`
 * declares and renders only `link`, so after an upgrade a stored `href` is
 * neither shown nor kept: the card renders without the author's destination,
 * and the first list write (which sends every row back) dropped the `href`
 * from every row while reporting nothing dropped (1b harness, v20).
 *
 * The upgrade, the template writes and the section write all run against one
 * in-memory SQLite database: the Theme, its templates and revisions, and its
 * workspace files. The source store is a thin stand-in over the same
 * `storefront_theme_files` table with its generation OCC; the page is then
 * rendered in real React from what the database holds.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { renderLivePreviewRoute } from "@/lib/test-utils/live-preview-render";
import {
  createDefaultStorefrontHomeDocument,
  createDefaultStorefrontLayoutDocument,
  STOREFRONT_STARTER_TEMPLATE_VERSION,
} from "../default-storefront-document";
import { starterThemeWorkspaceFiles } from "../starter-theme-files";

vi.mock("cloudflare:workers", () => ({
  env: {
    DATABASE: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => {
          const hasNumbered = /\?\d+/.test(sql);
          const params = hasNumbered
            ? Object.fromEntries(args.map((val, idx) => [String(idx + 1), val]))
            : args;
          const statement = () => sqlite.prepare(sql);
          const bound = hasNumbered ? [params] : args;
          const all = () => ({ results: statement().all(...bound) });
          return {
            run: () => {
              const stmt = statement();
              if (stmt.reader) return { results: stmt.all(...bound) };
              return { meta: { changes: stmt.run(...bound).changes } };
            },
            all,
            first: () => statement().get(...bound) ?? null,
          };
        },
      }),
      batch: async (statements: Array<{ run: () => unknown }>) =>
        sqlite.transaction(() => statements.map((s) => s.run()))(),
    },
  },
}));
vi.mock("@/db", () => ({ getDb: vi.fn() }));
vi.mock("./store-context.dal", () => ({
  storeContextDal: {
    resolveForTheme: vi.fn(async () => ({ salesChannelId: "channel-a" })),
  },
}));
vi.mock("./store-catalog.dal", () => ({
  storeCatalogDal: { hasChannelProducts: vi.fn(async () => false) },
}));
// The source store over the same table, with its OCC: a stale generation or
// file version is refused and nothing is written.
vi.mock("../storage/theme-storage.server", () => ({
  themeSourceStore: {
    listFiles: async (storefrontId: string, themeId: string) =>
      sqlite
        .prepare(
          `SELECT id, path, content, version, mime_type AS mimeType
           FROM storefront_theme_files
           WHERE storefront_id = ? AND theme_id = ? AND deleted_at IS NULL
           ORDER BY path`,
        )
        .all(storefrontId, themeId),
    getSourceGeneration: async (storefrontId: string, themeId: string) =>
      (
        sqlite
          .prepare(
            "SELECT source_generation AS g FROM storefront_themes WHERE id = ? AND storefront_id = ?",
          )
          .get(themeId, storefrontId) as { g: number } | undefined
      )?.g ?? null,
    saveFilesBatch: async (
      storefrontId: string,
      themeId: string,
      writes: Array<{
        path: string;
        content: string;
        mimeType?: string;
        expectMissing?: boolean;
        expectedFileId?: string;
        expectedVersion?: number;
      }>,
      options: {
        expectedSourceGeneration: number;
        deletions?: Array<{
          path: string;
          expectedFileId: string;
          expectedVersion: number;
        }>;
      },
    ) =>
      sqlite.transaction(() => {
        const { g } = sqlite
          .prepare(
            "SELECT source_generation AS g FROM storefront_themes WHERE id = ?",
          )
          .get(themeId) as { g: number };
        if (g !== options.expectedSourceGeneration) {
          throw new Error("CONFLICT_SOURCE_GENERATION_MISMATCH");
        }
        for (const deletion of options.deletions ?? []) {
          const result = sqlite
            .prepare(
              `UPDATE storefront_theme_files SET deleted_at = 'now'
               WHERE id = ? AND version = ? AND deleted_at IS NULL`,
            )
            .run(deletion.expectedFileId, deletion.expectedVersion);
          if (result.changes !== 1)
            throw new Error("CONFLICT_VERSION_MISMATCH");
        }
        for (const write of writes) {
          if (write.expectMissing) {
            sqlite
              .prepare(
                `INSERT INTO storefront_theme_files
                   (id, storefront_id, theme_id, path, content, mime_type, version, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, 1, 'now', 'now')`,
              )
              .run(
                `new:${write.path}`,
                storefrontId,
                themeId,
                write.path,
                write.content,
                write.mimeType ?? "text/plain",
              );
          } else {
            const result = sqlite
              .prepare(
                `UPDATE storefront_theme_files
                 SET content = ?, version = version + 1
                 WHERE id = ? AND version = ? AND deleted_at IS NULL`,
              )
              .run(write.content, write.expectedFileId, write.expectedVersion);
            if (result.changes !== 1)
              throw new Error("CONFLICT_VERSION_MISMATCH");
          }
        }
        sqlite
          .prepare(
            "UPDATE storefront_themes SET source_generation = source_generation + 1 WHERE id = ?",
          )
          .run(themeId);
        return { sourceGeneration: g + 1 };
      })(),
  },
}));

import { storefrontDal } from "./storefront.dal";
import { storefrontThemeDal } from "./storefront-theme.dal";

let sqlite: Database.Database;

const STOREFRONT_ID = "storefront-a";
const THEME_ID = "theme-a";
const HOME_ID = "11111111-1111-4111-8111-111111111111";
const HOME_REVISION_ID = "22222222-2222-4222-8222-222222222222";
const LAYOUT_ID = "33333333-3333-4333-8333-333333333333";
const SECTION_ID = "starter-categories";
const FIXTURE_DIR = join(__dirname, "..", "__fixtures__", "starter-history");

// None is a Starter default, so finding one on the page proves the author's
// value reached it.
const AUTHORED_URLS = [
  "/collections/authored-morning",
  "/collections/authored-corners",
  "https://example.com/soft",
];

type Row = Record<string, unknown>;

/**
 * The categories section as every Starter through v30 seeded it, with the
 * destinations an author has since changed. v11, v15 and v20 all store the
 * row's destination as a bare `href`.
 */
function hrefCategorySection(
  componentRef = "category-showcase.default",
): StorefrontPageDocument["sections"][number] {
  return {
    id: SECTION_ID,
    type: "category-showcase",
    componentRef,
    enabled: true,
    props: {
      heading: "Shop by ritual",
      items: [
        {
          title: "The morning table",
          caption: "Cups, carafes, and objects for an unhurried start.",
          href: AUTHORED_URLS[0],
          image: { src: "/static/a.png", alt: "Ceramic vessels" },
          imagePosition: "30% center",
        },
        {
          title: "Quiet corners",
          caption: "Sculptural forms that give a room its rhythm.",
          href: AUTHORED_URLS[1],
          image: { src: "/static/b.png", alt: "A sculptural vase" },
          imagePosition: "72% center",
        },
        {
          title: "Soft essentials",
          caption: "Natural textures made for slower evenings.",
          href: AUTHORED_URLS[2],
          image: { src: "/static/c.png", alt: "Folded fabric" },
          imagePosition: "95% center",
        },
      ],
    },
  };
}

function homeDocumentWith(
  section: StorefrontPageDocument["sections"][number],
): StorefrontPageDocument {
  const home = createDefaultStorefrontHomeDocument();
  return {
    ...home,
    sections: home.sections.map((candidate) =>
      candidate.id === SECTION_ID ? section : candidate,
    ),
  };
}

function fixtureFiles(version: number) {
  const fixture = JSON.parse(
    readFileSync(join(FIXTURE_DIR, `v${version}.json`), "utf8"),
  ) as { files: { path: string; mimeType: string; content: string }[] };
  return fixture.files;
}

function seed(options: {
  starterVersion: number;
  files: readonly { path: string; mimeType?: string; content: string }[];
  home: StorefrontPageDocument;
}) {
  const insertFile = sqlite.prepare(
    `INSERT INTO storefront_theme_files
       (id, storefront_id, theme_id, path, content, mime_type, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'now', 'now')`,
  );
  options.files.forEach((file, index) =>
    insertFile.run(
      `file-${index}`,
      STOREFRONT_ID,
      THEME_ID,
      file.path,
      file.content,
      file.mimeType ?? "text/plain",
    ),
  );
  sqlite
    .prepare("UPDATE storefront_themes SET metadata = ? WHERE id = ?")
    .run(
      JSON.stringify({ starterTemplateVersion: options.starterVersion }),
      THEME_ID,
    );
  // A published home: its Document lives in a revision the draft shares.
  sqlite
    .prepare(
      `INSERT INTO storefront_theme_templates
         (id, theme_id, type, name, document, draft_revision_id, published_revision_id, created_at, updated_at)
       VALUES (?, ?, 'index', 'Default', ?, ?, ?, 'now', 'now')`,
    )
    .run(
      HOME_ID,
      THEME_ID,
      JSON.stringify(options.home),
      HOME_REVISION_ID,
      HOME_REVISION_ID,
    );
  sqlite
    .prepare(
      `INSERT INTO storefront_theme_template_revisions
         (id, template_id, version, document, created_at)
       VALUES (?, ?, 1, ?, 'now')`,
    )
    .run(HOME_REVISION_ID, HOME_ID, JSON.stringify(options.home));
  sqlite
    .prepare(
      `INSERT INTO storefront_theme_templates
         (id, theme_id, type, name, document, created_at, updated_at)
       VALUES (?, ?, 'layout', 'Shell', ?, 'now', 'now')`,
    )
    .run(
      LAYOUT_ID,
      THEME_ID,
      JSON.stringify(createDefaultStorefrontLayoutDocument()),
    );
  sqlite
    .prepare(
      `INSERT INTO storefront_theme_templates
         (id, theme_id, type, name, document, created_at, updated_at)
       VALUES ('product', ?, 'product', 'Default product', '{"version":1,"sections":[]}', 'now', 'now')`,
    )
    .run(THEME_ID);
}

/** The author reviews the upgrade and applies exactly what was reviewed. */
async function applyReviewedUpgrade() {
  const reviewed = await storefrontDal.reviewStarterUpgrade({
    storefrontId: STOREFRONT_ID,
    themeId: THEME_ID,
  });
  if (!reviewed) throw new Error("no review");
  if (!reviewed.review.applies || reviewed.review.changes.length === 0) {
    return { reviewed, applied: null };
  }
  const applied = await storefrontDal.applyReviewedStarterUpgrade({
    storefrontId: STOREFRONT_ID,
    themeId: THEME_ID,
    createdBy: "user-a",
    expectedSourceGeneration: reviewed.sourceGeneration,
    starterDigest: reviewed.review.digest,
  });
  expect(applied.status).toBe("applied");
  return { reviewed, applied };
}

/** Applies reviewed upgrades until one offers nothing more. */
async function upgradeToSettled() {
  const passes = [];
  for (let pass = 0; pass < 4; pass += 1) {
    const step = await applyReviewedUpgrade();
    if (!step.applied) return passes;
    passes.push(step);
  }
  throw new Error("The upgrade did not settle.");
}

async function editorContext() {
  const context = await storefrontThemeDal.findEditorContext(
    STOREFRONT_ID,
    THEME_ID,
  );
  if (!context) throw new Error("no editor context");
  return context;
}

function sourceGeneration() {
  return (
    sqlite
      .prepare(
        "SELECT source_generation AS g FROM storefront_themes WHERE id = ?",
      )
      .get(THEME_ID) as { g: number }
  ).g;
}

function workspaceFiles() {
  return sqlite
    .prepare(
      "SELECT path, content FROM storefront_theme_files WHERE deleted_at IS NULL",
    )
    .all() as { path: string; content: string }[];
}

/** The category rows as the editor reads them: the draft, normalized. */
async function storedRows(): Promise<Row[]> {
  const context = await editorContext();
  const home = context.templates.find((template) => template.id === HOME_ID)!;
  const section = home.document.sections.find(
    (candidate) => candidate.id === SECTION_ID,
  )!;
  return section.props.items as Row[];
}

/** The page, rendered in real React from the Documents the editor reads. */
async function renderHome() {
  const context = await editorContext();
  const documentOf = (type: string) =>
    context.templates.find((template) => template.type === type)!.document;
  const { html } = await renderLivePreviewRoute({
    files: workspaceFiles(),
    documents: { index: documentOf("index"), layout: documentOf("layout") },
  });
  const start = html.indexOf(`data-storefront-section-id="${SECTION_ID}"`);
  expect(start, "the category section renders").toBeGreaterThan(-1);
  const end = html.indexOf("data-storefront-section-id=", start + 30);
  return html.slice(start, end === -1 ? undefined : end);
}

/** The destinations the rendered category cards link to, in order. */
function cardHrefs(sectionHtml: string): string[] {
  return [...sectionHtml.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((match) =>
    match[1]!.replace(/&amp;/g, "&"),
  );
}

/** What the editor sends for a caption edit on one row of the list. */
async function editCaption(row: number, caption: string) {
  const context = await editorContext();
  const home = context.templates.find((template) => template.id === HOME_ID)!;
  const rows = (await storedRows()).map((item, index) =>
    index === row ? { ...item, caption } : item,
  );
  return storefrontThemeDal.updateSectionProps({
    storefrontId: STOREFRONT_ID,
    themeId: THEME_ID,
    templateId: HOME_ID,
    sectionId: SECTION_ID,
    props: { items: rows },
    expectedDraftGeneration: home.draftGeneration,
    expectedSourceGeneration: sourceGeneration(),
    createdBy: "user-a",
    routePath: "/",
  });
}

/** A row's destination, whichever shape stores it. */
function destinationOf(row: Row): string | undefined {
  const link = row.link;
  if (typeof link === "string") return link;
  if (link && typeof link === "object") {
    return (link as { href?: string }).href;
  }
  return undefined;
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE storefronts (
      id text PRIMARY KEY NOT NULL, sales_channel_id text NOT NULL, name text NOT NULL,
      domain text, status text NOT NULL, active_theme_id text, active_release_id text,
      deployment_lease_owner text, deployment_lease_expires_at integer,
      metadata text, created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
    );
    CREATE TABLE storefront_themes (
      id text PRIMARY KEY NOT NULL, storefront_id text NOT NULL, name text NOT NULL,
      status text NOT NULL, published_source_revision_id text,
      source_generation integer DEFAULT 1 NOT NULL, source_index_version integer,
      source_index_status text, source_index text,
      release_generation integer DEFAULT 1 NOT NULL, framework text, preview_runtime text,
      metadata text, created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
    );
    CREATE TABLE storefront_theme_files (
      id text PRIMARY KEY NOT NULL, storefront_id text NOT NULL, theme_id text NOT NULL,
      path text NOT NULL, content text NOT NULL, mime_type text, is_entry integer DEFAULT 0,
      version integer DEFAULT 1, last_write_attempt_id text, created_at text NOT NULL,
      updated_at text NOT NULL, deleted_at text, encoding text DEFAULT 'utf8' NOT NULL,
      blob_digest text, size_bytes integer
    );
    CREATE TABLE storefront_theme_revisions (
      id text PRIMARY KEY NOT NULL, storefront_id text NOT NULL, theme_id text NOT NULL,
      revision_number integer NOT NULL, source_generation integer, message text,
      source text, snapshot text, source_manifest text, created_by text,
      created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
    );
    CREATE TABLE storefront_theme_templates (
      id text PRIMARY KEY NOT NULL, theme_id text NOT NULL, type text NOT NULL,
      name text NOT NULL, route_path text, document text NOT NULL,
      draft_revision_id text, published_revision_id text,
      draft_generation integer DEFAULT 1 NOT NULL, created_at text NOT NULL,
      updated_at text NOT NULL, deleted_at text
    );
    CREATE TABLE storefront_theme_template_revisions (
      id text PRIMARY KEY NOT NULL, template_id text NOT NULL, version integer NOT NULL,
      document text NOT NULL, created_by text, created_at text NOT NULL, published_at text
    );
    CREATE TABLE storefront_theme_builds (
      id text PRIMARY KEY NOT NULL, storefront_id text NOT NULL, theme_id text NOT NULL,
      source_revision_id text NOT NULL, status text NOT NULL, compiler_id text,
      compiler_version text, artifact_prefix text, manifest_json text,
      content_publication_id text, content_dependency text, created_by text,
      created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
    );
    CREATE TABLE storefront_releases (
      id text PRIMARY KEY NOT NULL, storefront_id text NOT NULL, theme_id text NOT NULL,
      source_revision_id text NOT NULL, theme_build_id text NOT NULL,
      content_publication_id text, status text NOT NULL, metadata text, created_by text,
      created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
    );
    CREATE TABLE storefront_content_publications (
      id text PRIMARY KEY NOT NULL, storefront_id text NOT NULL, created_by text,
      metadata text, created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
    );
    CREATE TABLE storefront_content_publication_items (
      id text PRIMARY KEY NOT NULL, publication_id text NOT NULL, item_type text NOT NULL,
      content_id text NOT NULL, revision_id text NOT NULL, metadata text,
      created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
    );
    INSERT INTO storefronts (id, sales_channel_id, name, status, active_theme_id, created_at, updated_at)
    VALUES ('${STOREFRONT_ID}', 'channel-a', 'Store A', 'published', '${THEME_ID}', 'now', 'now');
    INSERT INTO storefront_themes (id, storefront_id, name, status, source_generation, release_generation, created_at, updated_at)
    VALUES ('${THEME_ID}', '${STOREFRONT_ID}', 'Default', 'published', 1, 1, 'now', 'now');
  `);
  vi.mocked(getDb).mockResolvedValue(
    drizzle(sqlite, { schema: storefrontSchema }) as never,
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

describe.each([11, 15, 20] as const)(
  "category card destinations through the upgrade from Starter v%i",
  (version) => {
    beforeEach(() => {
      seed({
        starterVersion: version,
        files: fixtureFiles(version),
        home: homeDocumentWith(hrefCategorySection()),
      });
    });

    it("(a) after the upgrade, before any edit, every card links to the author's URL", async () => {
      await upgradeToSettled();
      expect(
        (
          JSON.parse(
            (
              sqlite
                .prepare("SELECT metadata FROM storefront_themes WHERE id = ?")
                .get(THEME_ID) as { metadata: string }
            ).metadata,
          ) as { starterTemplateVersion: number }
        ).starterTemplateVersion,
      ).toBe(STOREFRONT_STARTER_TEMPLATE_VERSION);

      // Stored: each row's destination in the shape the component reads.
      const rows = await storedRows();
      expect(rows.map(destinationOf)).toEqual(AUTHORED_URLS);

      // Rendered: each card is an anchor to the author's URL.
      const section = await renderHome();
      expect(cardHrefs(section)).toEqual(AUTHORED_URLS);
    });

    it("(b) after a first edit that only changes a caption, the URLs stay in the Document and on the cards", async () => {
      await upgradeToSettled();
      const result = await editCaption(0, "A new caption");
      expect(result?.droppedProps).toEqual([]);

      const rows = await storedRows();
      expect(rows[0]!.caption).toBe("A new caption");
      expect(rows.map(destinationOf)).toEqual(AUTHORED_URLS);

      const section = await renderHome();
      expect(section).toContain("A new caption");
      expect(cardHrefs(section)).toEqual(AUTHORED_URLS);
    });
  },
);

describe("a store created today", () => {
  it("is born with category cards that link to their collections", async () => {
    const { html } = await renderLivePreviewRoute({
      files: starterThemeWorkspaceFiles(),
      documents: {
        index: createDefaultStorefrontHomeDocument(),
        layout: createDefaultStorefrontLayoutDocument(),
      },
    });
    const start = html.indexOf(`data-storefront-section-id="${SECTION_ID}"`);
    const end = html.indexOf("data-storefront-section-id=", start + 30);
    expect(cardHrefs(html.slice(start, end === -1 ? undefined : end))).toEqual([
      "/collections/morning-table",
      "/collections/quiet-corners",
      "/collections/soft-essentials",
    ]);
  });
});

describe("without the migration (reverse check)", () => {
  it("the upgraded cards render without the author's URL when the rows keep href", async () => {
    // If this stops holding, the tests above no longer prove that the
    // migration is what puts the author's URL on the cards.
    seed({
      starterVersion: 20,
      files: fixtureFiles(20),
      home: homeDocumentWith(hrefCategorySection()),
    });
    await upgradeToSettled();
    const { html } = await renderLivePreviewRoute({
      files: workspaceFiles(),
      documents: {
        index: homeDocumentWith(hrefCategorySection()),
        layout: createDefaultStorefrontLayoutDocument(),
      },
    });
    const start = html.indexOf(`data-storefront-section-id="${SECTION_ID}"`);
    const end = html.indexOf("data-storefront-section-id=", start + 30);
    const hrefs = cardHrefs(html.slice(start, end === -1 ? undefined : end));
    for (const url of AUTHORED_URLS) expect(hrefs).not.toContain(url);
  });
});

describe("the category link migration's limits", () => {
  function homeRevisionCount() {
    return (
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM storefront_theme_template_revisions WHERE template_id = ?",
        )
        .get(HOME_ID) as { n: number }
    ).n;
  }

  it("keeps row identity: a row's id is the one the editor showed before the upgrade", async () => {
    seed({
      starterVersion: 20,
      files: fixtureFiles(20),
      home: homeDocumentWith(hrefCategorySection()),
    });
    const before = (await storedRows()).map((row) => row.id);
    expect(before.every((id) => typeof id === "string")).toBe(true);
    await upgradeToSettled();
    expect((await storedRows()).map((row) => row.id)).toEqual(before);
  });

  it("never overwrites a link a row already has, and leaves an unknown shape as it is", async () => {
    const section = hrefCategorySection();
    const items = section.props.items as Row[];
    items[0] = { ...items[0]!, link: { href: "/collections/kept-link" } };
    items[1] = { ...items[1]!, href: 42 };
    seed({
      starterVersion: 20,
      files: fixtureFiles(20),
      home: homeDocumentWith(section),
    });
    const reviewed = await storefrontDal.reviewStarterUpgrade({
      storefrontId: STOREFRONT_ID,
      themeId: THEME_ID,
    });
    expect(reviewed?.contentMigration).toEqual({
      sections: [
        {
          templateId: HOME_ID,
          templateName: "Default",
          sectionId: SECTION_ID,
          field: "items",
          rows: 1,
        },
      ],
      kept: [
        {
          templateId: HOME_ID,
          sectionId: SECTION_ID,
          field: "items",
          row: 0,
          reason: "link-present",
        },
        {
          templateId: HOME_ID,
          sectionId: SECTION_ID,
          field: "items",
          row: 1,
          reason: "href-not-a-link",
        },
      ],
    });
    await upgradeToSettled();
    const rows = await storedRows();
    expect(rows[0]!.link).toEqual({ href: "/collections/kept-link" });
    expect(rows[1]!.href).toBe(42);
    expect(rows[1]!.link).toBeUndefined();
    expect(rows[2]!.link).toEqual({ href: AUTHORED_URLS[2] });
    expect(rows[2]!.href).toBeUndefined();
  });

  it("is idempotent: a second apply writes no Document", async () => {
    seed({
      starterVersion: 20,
      files: fixtureFiles(20),
      home: homeDocumentWith(hrefCategorySection()),
    });
    await upgradeToSettled();
    const generation = (await editorContext()).templates.find(
      (template) => template.id === HOME_ID,
    )!.draftGeneration;
    const revisions = homeRevisionCount();
    // The same workspace upgraded again from the old version: the record step,
    // and the migration in it, run a second time over migrated rows.
    sqlite
      .prepare("UPDATE storefront_themes SET metadata = ? WHERE id = ?")
      .run(JSON.stringify({ starterTemplateVersion: 20 }), THEME_ID);
    const reviewed = await storefrontDal.reviewStarterUpgrade({
      storefrontId: STOREFRONT_ID,
      themeId: THEME_ID,
    });
    expect(reviewed?.contentMigration).toEqual({ sections: [], kept: [] });
    const again = await storefrontDal.applyReviewedStarterUpgrade({
      storefrontId: STOREFRONT_ID,
      themeId: THEME_ID,
      createdBy: "user-a",
      expectedSourceGeneration: reviewed!.sourceGeneration,
      starterDigest: reviewed!.review.digest,
    });
    expect(again.status).toBe("applied");
    expect(
      (await editorContext()).templates.find(
        (template) => template.id === HOME_ID,
      )!.draftGeneration,
    ).toBe(generation);
    expect(homeRevisionCount()).toBe(revisions);
  });

  it("lists the Document change in the review before anything is written", async () => {
    seed({
      starterVersion: 20,
      files: fixtureFiles(20),
      home: homeDocumentWith(hrefCategorySection()),
    });
    const reviewed = await storefrontDal.reviewStarterUpgrade({
      storefrontId: STOREFRONT_ID,
      themeId: THEME_ID,
    });
    expect(reviewed?.contentMigration).toEqual({
      sections: [
        {
          templateId: HOME_ID,
          templateName: "Default",
          sectionId: SECTION_ID,
          field: "items",
          rows: 3,
        },
      ],
      kept: [],
    });
    // Reviewing wrote nothing.
    expect(homeRevisionCount()).toBe(1);
  });

  it("does not migrate a Theme whose recorded version it does not recognise", async () => {
    seed({
      starterVersion: 20,
      files: fixtureFiles(20),
      home: homeDocumentWith(hrefCategorySection()),
    });
    sqlite
      .prepare("UPDATE storefront_themes SET metadata = '{}' WHERE id = ?")
      .run(THEME_ID);
    await upgradeToSettled();
    expect((await storedRows()).map((row) => row.href)).toEqual(AUTHORED_URLS);
  });
});

describe("a list write keeps stored row values the source does not declare", () => {
  // A current Starter workspace: nothing is upgraded here, so whatever a row
  // stores beside its declared fields reaches the write as it is.
  beforeEach(() => {
    seed({
      starterVersion: STOREFRONT_STARTER_TEMPLATE_VERSION,
      files: starterThemeWorkspaceFiles(),
      home: homeDocumentWith(
        hrefCategorySection("src/components/CategoryShowcase.tsx"),
      ),
    });
  });

  it("keeps an undeclared value the write sent back unchanged", async () => {
    const result = await editCaption(1, "Edited caption");
    expect(result?.droppedProps).toEqual([]);
    const rows = await storedRows();
    expect(rows[1]!.caption).toBe("Edited caption");
    expect(rows.map((row) => row.href)).toEqual(AUTHORED_URLS);
  });

  it("keeps an undeclared value the write left out", async () => {
    const context = await editorContext();
    const home = context.templates.find((template) => template.id === HOME_ID)!;
    const rows = (await storedRows()).map(({ href: _href, ...rest }) => rest);
    const result = await storefrontThemeDal.updateSectionProps({
      storefrontId: STOREFRONT_ID,
      themeId: THEME_ID,
      templateId: HOME_ID,
      sectionId: SECTION_ID,
      props: { items: rows },
      expectedDraftGeneration: home.draftGeneration,
      expectedSourceGeneration: sourceGeneration(),
      createdBy: "user-a",
      routePath: "/",
    });
    expect(result?.droppedProps).toEqual([]);
    expect((await storedRows()).map((row) => row.href)).toEqual(AUTHORED_URLS);
  });

  it("reports a changed undeclared value as dropped and keeps the stored one", async () => {
    const context = await editorContext();
    const home = context.templates.find((template) => template.id === HOME_ID)!;
    const rows = (await storedRows()).map((row, index) =>
      index === 2 ? { ...row, href: "/collections/changed" } : row,
    );
    const result = await storefrontThemeDal.updateSectionProps({
      storefrontId: STOREFRONT_ID,
      themeId: THEME_ID,
      templateId: HOME_ID,
      sectionId: SECTION_ID,
      props: { items: rows },
      expectedDraftGeneration: home.draftGeneration,
      expectedSourceGeneration: sourceGeneration(),
      createdBy: "user-a",
      routePath: "/",
    });
    expect(result?.droppedProps).toEqual(["items.2.href"]);
    expect((await storedRows()).map((row) => row.href)).toEqual(AUTHORED_URLS);
  });

  it("removes a row the write removed, values and all", async () => {
    const context = await editorContext();
    const home = context.templates.find((template) => template.id === HOME_ID)!;
    const rows = (await storedRows()).slice(1);
    await storefrontThemeDal.updateSectionProps({
      storefrontId: STOREFRONT_ID,
      themeId: THEME_ID,
      templateId: HOME_ID,
      sectionId: SECTION_ID,
      props: { items: rows },
      expectedDraftGeneration: home.draftGeneration,
      expectedSourceGeneration: sourceGeneration(),
      createdBy: "user-a",
      routePath: "/",
    });
    expect((await storedRows()).map((row) => row.href)).toEqual(
      AUTHORED_URLS.slice(1),
    );
  });
});
