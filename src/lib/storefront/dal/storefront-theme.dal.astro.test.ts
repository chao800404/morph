// @vitest-environment node
/**
 * The DAL of an Astro Theme against a real SQLite database and the real
 * `.astro` parser Worker (local workerd, through the same service binding
 * name Core uses): the read-only binding view (M2 PR-D, C3) and the editor
 * context's explicit Astro state.
 *
 * Every refusal here is read back from the database: a read must leave the
 * stored Theme exactly as it was.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import {
  startLocalAstroParser,
  type LocalAstroParser,
} from "@morph/astro-parser-worker/testing";
import {
  ASTRO_B1_SAMPLES,
  ASTRO_FIXTURE,
  astroPage,
} from "@/lib/test-utils/astro-b1-samples";
import { astroSourceDigest } from "../source-language/astro-instance-identity";
import { SOURCE_ANALYSIS_ROUTE_STRUCTURE } from "../dto/storefront-theme.dto";

import { storefrontThemeDal } from "./storefront-theme.dal";

const mock = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
}));
vi.mock("cloudflare:workers", () => ({ env: mock.env }));
vi.mock("@/db", () => ({ getDb: vi.fn() }));

let sqlite: Database.Database;

/** D1's `prepare().bind()` over better-sqlite3, as the other DAL tests do. */
const database = {
  prepare: (sql: string) => ({
    bind: (...args: unknown[]) => {
      const numbered = /\?\d+/.test(sql);
      const params = numbered
        ? Object.fromEntries(
            args.map((value, index) => [String(index + 1), value]),
          )
        : args;
      const call = <T>(fn: (stmt: Database.Statement) => T) =>
        fn(sqlite.prepare(sql));
      return {
        run: () =>
          call((stmt) => {
            if (sql.trim().toUpperCase().startsWith("SELECT")) {
              return {
                results: numbered ? stmt.all(params) : stmt.all(...args),
              };
            }
            const result = numbered ? stmt.run(params) : stmt.run(...args);
            return { meta: { changes: result.changes } };
          }),
        all: () =>
          call((stmt) => ({
            results: numbered ? stmt.all(params) : stmt.all(...args),
          })),
        first: () =>
          call((stmt) => (numbered ? stmt.get(params) : stmt.get(...args))),
      };
    },
  }),
  batch: async (
    statements: Array<{ run?: () => unknown; all?: () => unknown }>,
  ) =>
    sqlite.transaction(() =>
      statements.map((statement) =>
        typeof statement.run === "function"
          ? statement.run()
          : typeof statement.all === "function"
            ? statement.all()
            : {},
      ),
    )(),
};

let parser: LocalAstroParser;
beforeAll(async () => {
  parser = await startLocalAstroParser();
}, 60_000);
afterAll(() => parser?.dispose());

const STOREFRONT = "storefront-a";
const THEME = "theme-a";
const INDEX = "src/pages/index.astro";
const ABOUT = "src/pages/about.astro";
const HOME =
  'const home = await morph.pages.get("/");\nconst { hero, card } = home;\n';
const HOME_SOURCE = astroPage(HOME, "<Hero {...hero} />\n<Card {...card} />");
const ABOUT_SOURCE = ASTRO_B1_SAMPLES.find(
  (sample) => sample.id === "A3",
)!.source;

beforeEach(() => {
  sqlite = new Database(":memory:");
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
      last_write_attempt_id text, created_at text NOT NULL,
      updated_at text NOT NULL, deleted_at text,
      encoding text DEFAULT 'utf8' NOT NULL, blob_digest text,
      size_bytes integer
    );
    CREATE TABLE storefront_theme_revisions (
      id text PRIMARY KEY NOT NULL, storefront_id text NOT NULL,
      theme_id text NOT NULL, revision_number integer NOT NULL,
      source_generation integer, message text, source text, snapshot text,
      source_manifest text, created_by text, created_at text NOT NULL,
      updated_at text NOT NULL, deleted_at text
    );
    CREATE TABLE storefront_theme_templates (
      id text PRIMARY KEY NOT NULL, theme_id text NOT NULL,
      type text NOT NULL, name text NOT NULL, route_path text,
      document text NOT NULL, draft_revision_id text,
      published_revision_id text,
      draft_generation integer DEFAULT 1 NOT NULL,
      created_at text NOT NULL, updated_at text NOT NULL, deleted_at text
    );
    CREATE UNIQUE INDEX storefront_theme_templates_active_name_unique
      ON storefront_theme_templates (theme_id, type, name)
      WHERE deleted_at IS NULL;
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
    CREATE TABLE storefront_content_publication_items (
      id text PRIMARY KEY NOT NULL, publication_id text NOT NULL,
      item_type text NOT NULL, content_id text NOT NULL,
      revision_id text NOT NULL, metadata text, created_at text NOT NULL,
      updated_at text NOT NULL, deleted_at text
    );
    INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
    VALUES ('storefront-a', 'channel-a', 'Store A', 'active', 'now', 'now'),
           ('storefront-b', 'channel-b', 'Store B', 'active', 'now', 'now');
    INSERT INTO storefront_themes (id, storefront_id, name, status, source_generation, framework, created_at, updated_at)
    VALUES ('theme-a', 'storefront-a', 'Astro Theme', 'draft', 3, 'astro', 'now', 'now'),
           ('theme-b', 'storefront-b', 'Other Theme', 'draft', 3, 'astro', 'now', 'now');
  `);
  vi.mocked(getDb).mockResolvedValue(
    drizzle(sqlite, { schema: storefrontSchema }) as never,
  );
  mock.env.DATABASE = database;
  mock.env.ASTRO_PARSER = parser.binding;
  seedFiles(THEME, STOREFRONT, [
    ...ASTRO_FIXTURE,
    { path: INDEX, content: HOME_SOURCE },
    { path: ABOUT, content: ABOUT_SOURCE },
    {
      path: "src/pages/api.ts",
      content: "export const GET = () => new Response('x');\n",
    },
    { path: "src/pages/blog/[slug].astro", content: "<p>post</p>\n" },
  ]);
  seedFiles("theme-b", "storefront-b", [
    ...ASTRO_FIXTURE,
    { path: INDEX, content: HOME_SOURCE },
  ]);
});

afterEach(() => {
  sqlite.close();
  for (const key of Object.keys(mock.env)) delete mock.env[key];
  vi.clearAllMocks();
});

function seedFiles(
  themeId: string,
  storefrontId: string,
  files: readonly { path: string; content: string }[],
) {
  const insert = sqlite.prepare(
    `INSERT INTO storefront_theme_files (id, storefront_id, theme_id, path, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'now', 'now')`,
  );
  for (const file of files) {
    insert.run(
      `${themeId}:${file.path}`,
      storefrontId,
      themeId,
      file.path,
      file.content,
    );
  }
}

/** Everything a read could have changed, for an exact before/after. */
function databaseState() {
  const rows = (sql: string) => sqlite.prepare(sql).all();
  return {
    themes: rows("SELECT * FROM storefront_themes ORDER BY id"),
    files: rows("SELECT * FROM storefront_theme_files ORDER BY id"),
    templates: rows("SELECT * FROM storefront_theme_templates ORDER BY id"),
    revisions: rows(
      "SELECT * FROM storefront_theme_template_revisions ORDER BY id",
    ),
  };
}

/** Puts a counting wrapper around the parser binding. */
function countParserCalls() {
  const binding = parser.binding;
  const counter = { calls: 0 };
  mock.env.ASTRO_PARSER = {
    fetch: (input: string, init: RequestInit) => {
      counter.calls += 1;
      return binding.fetch(input, init);
    },
  };
  return counter;
}

const read = (
  overrides: Partial<
    Parameters<typeof storefrontThemeDal.readRouteBindings>[0]
  > = {},
) =>
  storefrontThemeDal.readRouteBindings({
    storefrontId: STOREFRONT,
    themeId: THEME,
    routePath: "/",
    expectedSourceGeneration: 3,
    ...overrides,
  });

describe("the binding view of an Astro page (readRouteBindings)", () => {
  it("returns the instances Core confirms, with their identity, section and claims", async () => {
    const before = databaseState();
    const result = await read();
    expect(result.status).toBe("view");
    if (result.status !== "view") return;
    const { view } = result;
    const src = await astroSourceDigest(HOME_SOURCE);
    expect(view).toMatchObject({
      routePath: "/",
      routeFile: INDEX,
      sourceGeneration: 3,
      routeSourceDigest: src,
      boundaryRule: 2,
      status: { kind: "confirmed" },
    });
    const heroStart = HOME_SOURCE.indexOf("<Hero");
    const cardStart = HOME_SOURCE.indexOf("<Card");
    expect(view.instances).toEqual([
      {
        identity: {
          rule: 2,
          src,
          start: heroStart,
          end: HOME_SOURCE.indexOf("/>", heroStart) + 2,
        },
        componentDigest: await astroSourceDigest(
          ASTRO_FIXTURE.find(
            (file) => file.path === "src/components/Hero.astro",
          )!.content,
        ),
        componentPath: "src/components/Hero.astro",
        componentName: "Hero",
        section: "hero",
        componentRef: "hero",
        sectionType: "hero",
        declaredFields: ["title", "desc"],
        claims: [
          { slot: "hero", field: "desc" },
          { slot: "hero", field: "title" },
        ],
      },
      {
        identity: {
          rule: 2,
          src,
          start: cardStart,
          end: HOME_SOURCE.indexOf("/>", cardStart) + 2,
        },
        componentDigest: await astroSourceDigest(
          ASTRO_FIXTURE.find(
            (file) => file.path === "src/components/Card.astro",
          )!.content,
        ),
        componentPath: "src/components/Card.astro",
        componentName: "Card",
        section: "card",
        componentRef: "card",
        sectionType: "card",
        declaredFields: ["title"],
        claims: [{ slot: "card", field: "title" }],
      },
    ]);
    expect(databaseState()).toEqual(before);
  });

  it("reads a route page's instances apart, two of one component included", async () => {
    const result = await read({ routePath: "/about/" });
    expect(result.status).toBe("view");
    if (result.status !== "view") return;
    expect(result.view.routePath).toBe("/about");
    expect(
      result.view.instances.map((instance) => [
        instance.section,
        instance.claims.map((claim) => claim.field),
      ]),
    ).toEqual([
      ["intro", ["desc", "title"]],
      ["team", ["desc", "title"]],
    ]);
  });

  it("answers not-found for another storefront's Theme, and reads nothing of it", async () => {
    const before = databaseState();
    await expect(read({ themeId: "theme-b" })).resolves.toEqual({
      status: "not-found",
    });
    await expect(
      read({ storefrontId: "storefront-b", themeId: THEME }),
    ).resolves.toEqual({ status: "not-found" });
    expect(databaseState()).toEqual(before);
  });

  it("answers not-found for a deleted Theme and for a deleted storefront", async () => {
    sqlite.exec(
      "UPDATE storefront_themes SET deleted_at = 'then' WHERE id = 'theme-a'",
    );
    await expect(read()).resolves.toEqual({ status: "not-found" });
    sqlite.exec(
      "UPDATE storefront_themes SET deleted_at = NULL WHERE id = 'theme-a'; UPDATE storefronts SET deleted_at = 'then' WHERE id = 'storefront-a'",
    );
    await expect(read()).resolves.toEqual({ status: "not-found" });
  });

  it("refuses a stale generation without parsing, and names the stored one", async () => {
    const fetch = countParserCalls();
    const result = await read({ expectedSourceGeneration: 2 });
    expect(result).toMatchObject({
      status: "view",
      view: {
        sourceGeneration: 3,
        status: {
          kind: "refused",
          class: "temporarily-unconfirmable",
          reason: "source-stale",
        },
        instances: [],
      },
    });
    expect(fetch.calls).toBe(0);
  });

  it("refuses a view whose source changed while it was read, never a half-old one", async () => {
    // A source save lands while the parser is answering.
    const binding = parser.binding;
    mock.env.ASTRO_PARSER = {
      fetch: async (input: string, init: RequestInit) => {
        sqlite.exec(
          "UPDATE storefront_themes SET source_generation = 4 WHERE id = 'theme-a'",
        );
        return binding.fetch(input, init);
      },
    };
    const result = await read();
    expect(result).toMatchObject({
      status: "view",
      view: {
        sourceGeneration: 4,
        status: { kind: "refused", reason: "source-stale" },
        instances: [],
      },
    });
  });

  it("refuses with the parser's class when the environment has no parser", async () => {
    delete mock.env.ASTRO_PARSER;
    const result = await read();
    expect(result).toMatchObject({
      status: "view",
      view: {
        routeFile: INDEX,
        sourceGeneration: 3,
        status: {
          kind: "refused",
          class: "temporarily-unconfirmable",
          reason: "parser-binding-missing",
        },
        instances: [],
      },
    });
  });

  it("refuses an author syntax error as the author's, not as code control", async () => {
    sqlite.exec(
      `UPDATE storefront_theme_files SET content = '---\nconst a = ;\n---\n<p>x</p>\n' WHERE id = 'theme-a:${INDEX}'`,
    );
    const result = await read();
    expect(result).toMatchObject({
      status: "view",
      view: {
        status: {
          kind: "refused",
          class: "author-syntax",
          reason: "author-syntax",
        },
      },
    });
  });

  it("claims no field of a slot the page rewrites (D, per field), and still names the instance", async () => {
    sqlite
      .prepare("UPDATE storefront_theme_files SET content = ? WHERE id = ?")
      .run(
        astroPage(
          'const home = await morph.pages.get("/");\nconst { hero } = home;\nhero.title = "x";\n',
          "<Hero {...hero} />",
        ),
        `theme-a:${INDEX}`,
      );
    const result = await read();
    expect(result).toMatchObject({
      status: "view",
      view: {
        status: { kind: "confirmed" },
        instances: [{ section: "hero", claims: [] }],
      },
    });
  });

  it("refuses a dynamic page as a capability limit, before the parser is asked", async () => {
    const fetch = countParserCalls();
    const result = await read({ routePath: "/blog/[slug]" });
    expect(result).toMatchObject({
      status: "view",
      view: {
        status: {
          kind: "refused",
          class: "capability-limit",
          reason: "dynamic-route",
        },
      },
    });
    expect(fetch.calls).toBe(0);
  });

  it("answers unsupported for an endpoint, a missing page and a Start Theme", async () => {
    await expect(read({ routePath: "/api" })).resolves.toMatchObject({
      status: "unsupported",
    });
    await expect(read({ routePath: "/nowhere" })).resolves.toMatchObject({
      status: "unsupported",
    });
    sqlite.exec(
      "UPDATE storefront_themes SET framework = 'tanstack-start' WHERE id = 'theme-a'",
    );
    await expect(read()).resolves.toMatchObject({ status: "unsupported" });
    sqlite.exec(
      "UPDATE storefront_themes SET framework = NULL WHERE id = 'theme-a'",
    );
    await expect(read()).resolves.toMatchObject({ status: "unsupported" });
  });
});

describe("the editor context of an Astro Theme", () => {
  beforeEach(() => {
    sqlite.exec(`
      INSERT INTO storefront_theme_templates (id, theme_id, type, name, route_path, document, created_at, updated_at)
      VALUES ('tpl-index', 'theme-a', 'index', 'Default', NULL, '{"version":1,"sections":[]}', 'now', 'now'),
             ('tpl-about', 'theme-a', 'page', '/about', '/about', '{"version":1,"sections":[]}', 'now', 'now');
    `);
  });

  it("gives every template the explicit source-analysis state, never null, and never calls the parser", async () => {
    const fetch = countParserCalls();
    const context = await storefrontThemeDal.findEditorContext(
      STOREFRONT,
      THEME,
    );
    expect(
      context?.templates.map((template) => template.routeStructure),
    ).toEqual([
      SOURCE_ANALYSIS_ROUTE_STRUCTURE,
      SOURCE_ANALYSIS_ROUTE_STRUCTURE,
    ]);
    expect(fetch.calls).toBe(0);
  });

  it("leaves a Start Theme's route structure derived as before", async () => {
    sqlite.exec(
      "UPDATE storefront_themes SET framework = 'tanstack-start' WHERE id = 'theme-a'",
    );
    const context = await storefrontThemeDal.findEditorContext(
      STOREFRONT,
      THEME,
    );
    for (const template of context?.templates ?? []) {
      expect(template.routeStructure).not.toEqual(
        SOURCE_ANALYSIS_ROUTE_STRUCTURE,
      );
    }
  });
});
