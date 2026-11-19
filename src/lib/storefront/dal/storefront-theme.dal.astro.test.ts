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

describe("an Astro page's own Document (D7 create, C5) and the home template (N1)", () => {
  const ensure = (
    routePath: string,
    overrides: Partial<{ storefrontId: string; themeId: string }> = {},
  ) =>
    storefrontThemeDal.ensureRouteTemplate({
      storefrontId: STOREFRONT,
      themeId: THEME,
      routePath,
      ...overrides,
    });
  const templates = () =>
    sqlite
      .prepare(
        "SELECT theme_id, type, name, route_path, document, draft_revision_id, draft_generation FROM storefront_theme_templates ORDER BY type, name",
      )
      .all();

  it("creates /about's Document empty, without asking the parser", async () => {
    delete mock.env.ASTRO_PARSER;
    const result = await ensure("/about");
    expect(result).toMatchObject({
      ok: true,
      createdByThisCall: true,
      template: {
        routePath: "/about",
        draftGeneration: 1,
        draftRevisionId: null,
      },
    });
    expect(templates()).toEqual([
      {
        theme_id: THEME,
        type: "page",
        name: "/about",
        route_path: "/about",
        document: '{"version":1,"sections":[]}',
        draft_revision_id: null,
        draft_generation: 1,
      },
    ]);
    // Idempotent: the second call finds it.
    const again = await ensure("/about/");
    expect(again).toMatchObject({
      ok: true,
      createdByThisCall: false,
      template: { id: result.ok ? result.template.id : "" },
    });
    expect(templates()).toHaveLength(1);
  });

  it("refuses a dynamic page, an endpoint and a path with no page, and creates nothing", async () => {
    await expect(ensure("/blog/[slug]")).resolves.toEqual({
      ok: false,
      reason: expect.stringMatching(/route parameters/),
    });
    await expect(ensure("/api")).resolves.toEqual({
      ok: false,
      reason: "/api is not a page in the saved Theme source.",
    });
    await expect(ensure("/nowhere")).resolves.toEqual({
      ok: false,
      reason: "/nowhere is not a page in the saved Theme source.",
    });
    expect(templates()).toEqual([]);
  });

  it("refuses another storefront's Theme and a deleted one, and creates nothing", async () => {
    await expect(ensure("/about", { themeId: "theme-b" })).resolves.toEqual({
      ok: false,
      reason: "Theme not found.",
    });
    await expect(ensure("/", { themeId: "theme-b" })).resolves.toMatchObject({
      ok: false,
    });
    sqlite.exec(
      "UPDATE storefront_themes SET deleted_at = 'then' WHERE id = 'theme-a'",
    );
    await expect(ensure("/about")).resolves.toEqual({
      ok: false,
      reason: "Theme not found.",
    });
    await expect(ensure("/")).resolves.toMatchObject({ ok: false });
    expect(templates()).toEqual([]);
  });

  it("creates the home page's index template once, empty, and returns it after (N1)", async () => {
    delete mock.env.ASTRO_PARSER;
    const first = await ensure("/");
    expect(first).toMatchObject({
      ok: true,
      createdByThisCall: true,
      template: { routePath: "/", draftGeneration: 1, draftRevisionId: null },
    });
    const second = await ensure("/");
    expect(second).toMatchObject({
      ok: true,
      createdByThisCall: false,
      template: { id: first.ok ? first.template.id : "" },
    });
    expect(templates()).toEqual([
      {
        theme_id: THEME,
        type: "index",
        name: "Default",
        route_path: null,
        document: '{"version":1,"sections":[]}',
        draft_revision_id: null,
        draft_generation: 1,
      },
    ]);
  });

  it("returns an index template the Theme already has, whatever its name", async () => {
    sqlite.exec(`
      INSERT INTO storefront_theme_templates (id, theme_id, type, name, document, draft_generation, created_at, updated_at)
      VALUES ('tpl-home', 'theme-a', 'index', 'Home', '{"version":1,"sections":[]}', 4, 'now', 'now');
    `);
    await expect(ensure("/")).resolves.toMatchObject({
      ok: true,
      createdByThisCall: false,
      template: { id: "tpl-home", draftGeneration: 4 },
    });
    expect(templates()).toHaveLength(1);
  });

  it("creates no home template for an Astro Theme without a home page", async () => {
    sqlite.exec(
      `DELETE FROM storefront_theme_files WHERE id = 'theme-a:${INDEX}'`,
    );
    await expect(ensure("/")).resolves.toEqual({
      ok: false,
      reason: "/ is not a page in the saved Theme source.",
    });
    expect(templates()).toEqual([]);
  });

  it("still refuses / for a Start Theme: its home Document comes from the Starter", async () => {
    sqlite.exec(
      "UPDATE storefront_themes SET framework = 'tanstack-start' WHERE id = 'theme-a'",
    );
    await expect(ensure("/")).resolves.toEqual({
      ok: false,
      reason: "/ stores its content in the index template.",
    });
    expect(templates()).toEqual([]);
  });
});

/**
 * The Astro section write (M2 C5, PR-I design v2 section 8): parse, the Astro
 * B1 profile, the instance identity with its component digest, the field
 * allowlist and the same Document CAS as Start. Every refusal is read back:
 * the template's document, draft revision, draft generation, its revisions
 * and the Theme's source generation are exactly as before.
 */
describe("an Astro section write checks instance identity (design v2 section 8)", () => {
  const NONCE = "0123456789abcdef";
  const ABOUT_DOC = {
    version: 1,
    sections: [
      {
        id: "intro",
        type: "hero",
        componentRef: "hero",
        enabled: true,
        props: { title: "Intro", desc: "Intro desc" },
      },
      {
        id: "team",
        type: "hero",
        componentRef: "hero",
        enabled: true,
        props: { title: "Team", desc: "Team desc", extra: { keep: true } },
      },
    ],
  };
  const REVISION = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates (id, theme_id, type, name, route_path, document, draft_revision_id, published_revision_id, draft_generation, created_at, updated_at)
         VALUES ('tpl-about', 'theme-a', 'page', '/about', '/about', ?, ?, NULL, 2, 'now', 'now')`,
      )
      .run(JSON.stringify(ABOUT_DOC), REVISION);
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_template_revisions (id, template_id, version, document, created_at)
         VALUES (?, 'tpl-about', 1, ?, 'now')`,
      )
      .run(REVISION, JSON.stringify(ABOUT_DOC));
  });

  /** Everything a refused write must leave as it was. */
  const stored = (templateId: string) => {
    const template = sqlite
      .prepare(
        "SELECT document, draft_revision_id, draft_generation FROM storefront_theme_templates WHERE id = ?",
      )
      .get(templateId) as {
      document: string;
      draft_revision_id: string | null;
      draft_generation: number;
    };
    const revisions = sqlite
      .prepare(
        "SELECT id, version, document FROM storefront_theme_template_revisions WHERE template_id = ? ORDER BY version",
      )
      .all(templateId);
    const theme = sqlite
      .prepare(
        "SELECT source_generation FROM storefront_themes WHERE id = 'theme-a'",
      )
      .get();
    return { template, revisions, theme };
  };

  /** The identity the editor would send for the instance rendering `section`. */
  async function identityOf(routePath: string, section: string) {
    const result = await storefrontThemeDal.readRouteBindings({
      storefrontId: STOREFRONT,
      themeId: THEME,
      routePath,
      expectedSourceGeneration: 3,
    });
    if (result.status !== "view") throw new Error(`no view: ${result.status}`);
    const instance = result.view.instances.find(
      (entry) => entry.section === section,
    );
    if (!instance) throw new Error(`no instance renders ${section}`);
    const { rule, src, start, end } = instance.identity;
    return {
      identity: `${NONCE}:${rule}:${src}:${start}:${end}`,
      componentDigest: instance.componentDigest,
    };
  }

  const write = (overrides: Record<string, unknown>) =>
    storefrontThemeDal.updateSectionProps({
      storefrontId: STOREFRONT,
      themeId: THEME,
      templateId: "tpl-about",
      sectionId: "intro",
      props: { title: "Edited intro" },
      expectedDraftGeneration: 2,
      expectedSourceGeneration: 3,
      createdBy: "user-1",
      routePath: "/about",
      ...overrides,
    });

  it("case 5: writes only the named section's field, and every other byte stays", async () => {
    const before = stored("tpl-about");
    const result = await write(await identityOf("/about", "intro"));
    expect(result).toMatchObject({ draftGeneration: 3, droppedProps: [] });
    const after = stored("tpl-about");
    expect(after.template.draft_generation).toBe(3);
    expect(after.template.draft_revision_id).toBe(REVISION);
    const document = JSON.parse(
      (after.revisions[0] as { document: string }).document,
    );
    expect(document.sections[0]).toEqual({
      ...ABOUT_DOC.sections[0],
      props: { title: "Edited intro", desc: "Intro desc" },
    });
    // The other instance's section, byte for byte.
    expect(JSON.stringify(document.sections[1])).toBe(
      JSON.stringify(ABOUT_DOC.sections[1]),
    );
    expect(after.theme).toEqual(before.theme);
    expect(after.revisions).toHaveLength(1);
  });

  it("case 1: refuses a v1 boundary id (old format), and writes nothing", async () => {
    const before = stored("tpl-about");
    const { componentDigest } = await identityOf("/about", "intro");
    await expect(
      write({ identity: `${NONCE}:0a1b2c3d:0`, componentDigest }),
    ).rejects.toThrow(
      /^SECTION_SOURCE_UNCONFIRMABLE: preview-identity-legacy: /,
    );
    expect(stored("tpl-about")).toEqual(before);
  });

  it("case 2: refuses another instance's identity with this section (swapped), and writes nothing", async () => {
    const before = stored("tpl-about");
    await expect(write(await identityOf("/about", "team"))).rejects.toThrow(
      /^SECTION_SOURCE_UNCONFIRMABLE: preview-identity-mismatch: /,
    );
    expect(stored("tpl-about")).toEqual(before);
  });

  it("case 3: refuses a component digest of another version of the component, and writes nothing", async () => {
    const before = stored("tpl-about");
    const { identity } = await identityOf("/about", "intro");
    await expect(
      write({
        identity,
        componentDigest: await astroSourceDigest("<p>older Hero</p>\n"),
      }),
    ).rejects.toThrow(/^SECTION_SOURCE_UNCONFIRMABLE: source-stale: /);
    await expect(write({ identity })).rejects.toThrow(
      /^SECTION_SOURCE_UNCONFIRMABLE: source-stale: /,
    );
    expect(stored("tpl-about")).toEqual(before);
  });

  it("case 4: refuses a write with no identity (an older editor) before reading source, and writes nothing", async () => {
    const before = stored("tpl-about");
    const fetch = countParserCalls();
    await expect(write({})).rejects.toThrow(
      /^SECTION_SOURCE_UNCONFIRMABLE: preview-identity-legacy: /,
    );
    expect(fetch.calls).toBe(0);
    expect(stored("tpl-about")).toEqual(before);
  });

  it("case 6: the identity does not skip the Document CAS: a stale draft generation is refused", async () => {
    const before = stored("tpl-about");
    await expect(
      write({
        ...(await identityOf("/about", "intro")),
        expectedDraftGeneration: 1,
      }),
    ).rejects.toThrow(/CONFLICT_DRAFT_GENERATION_MISMATCH/);
    expect(stored("tpl-about")).toEqual(before);
  });

  it("case 7: a Start Theme's write needs no identity and ignores one", async () => {
    sqlite.exec(
      "UPDATE storefront_themes SET framework = 'tanstack-start' WHERE id = 'theme-a'",
    );
    sqlite
      .prepare(
        `INSERT INTO storefront_theme_templates (id, theme_id, type, name, document, created_at, updated_at)
         VALUES ('tpl-start', 'theme-a', 'index', 'Default', ?, 'now', 'now')`,
      )
      .run(
        JSON.stringify({
          version: 1,
          sections: [
            {
              id: "hero",
              type: "hero",
              enabled: true,
              props: { title: "Old" },
            },
          ],
        }),
      );
    const fetch = countParserCalls();
    const base = {
      storefrontId: STOREFRONT,
      themeId: THEME,
      templateId: "tpl-start",
      sectionId: "hero",
      expectedSourceGeneration: 3,
      createdBy: "user-1",
    };
    // No Start route files: the stored Document stands in for the source
    // (legacy), exactly as before this change.
    const plain = await storefrontThemeDal.updateSectionProps({
      ...base,
      props: { title: "New" },
      expectedDraftGeneration: 1,
    });
    expect(plain?.document.sections[0]?.props).toMatchObject({ title: "New" });
    const withIdentity = await storefrontThemeDal.updateSectionProps({
      ...base,
      props: { title: "Newer" },
      expectedDraftGeneration: 2,
      identity: `${NONCE}:2:${"0".repeat(64)}:0:1`,
      componentDigest: "0".repeat(64),
    });
    expect(withIdentity?.document.sections[0]?.props).toMatchObject({
      title: "Newer",
    });
    expect(fetch.calls).toBe(0);
  });

  it("refuses when the source is saved while the write proves it (TOCTOU), and writes nothing", async () => {
    const before = stored("tpl-about");
    const request = await identityOf("/about", "intro");
    const binding = parser.binding;
    mock.env.ASTRO_PARSER = {
      fetch: async (input: string, init: RequestInit) => {
        sqlite.exec(
          "UPDATE storefront_themes SET source_generation = 4 WHERE id = 'theme-a'",
        );
        return binding.fetch(input, init);
      },
    };
    await expect(write(request)).rejects.toThrow(/SELECTION_SOURCE_CONFLICT/);
    expect(stored("tpl-about")).toEqual({
      ...before,
      theme: { source_generation: 4 },
    });
  });

  it("refuses as temporarily unconfirmable where the parser is missing, and writes nothing", async () => {
    const request = await identityOf("/about", "intro");
    const before = stored("tpl-about");
    delete mock.env.ASTRO_PARSER;
    await expect(write(request)).rejects.toThrow(
      /^SECTION_SOURCE_UNCONFIRMABLE: parser-binding-missing: /,
    );
    expect(stored("tpl-about")).toEqual(before);
  });

  it("refuses a field the page's code decides (D), and writes nothing", async () => {
    sqlite
      .prepare("UPDATE storefront_theme_files SET content = ? WHERE id = ?")
      .run(
        astroPage(
          'const about = await morph.pages.get("/about");\nconst { intro } = about;\nintro.title = "fixed";\n',
          "<Hero {...intro} />",
        ),
        `theme-a:${ABOUT}`,
      );
    const request = await identityOf("/about", "intro");
    const before = stored("tpl-about");
    await expect(write(request)).rejects.toThrow(
      /INVALID_THEME_CONTENT_FIELD_VALUE:title:unproven-source/,
    );
    expect(stored("tpl-about")).toEqual(before);
  });

  it("refuses a write naming another page than the document's, and writes nothing", async () => {
    const before = stored("tpl-about");
    await expect(
      write({ ...(await identityOf("/about", "intro")), routePath: "/" }),
    ).rejects.toThrow(/^SECTION_SOURCE_UNCONFIRMABLE: route-mismatch: /);
    expect(stored("tpl-about")).toEqual(before);
  });

  it("refuses a template kind Astro writes do not reach yet, and writes nothing", async () => {
    sqlite.exec(`
      INSERT INTO storefront_theme_templates (id, theme_id, type, name, document, created_at, updated_at)
      VALUES ('tpl-product', 'theme-a', 'product', 'Default product', '{"version":1,"sections":[]}', 'now', 'now');
    `);
    await expect(
      write({
        ...(await identityOf("/about", "intro")),
        templateId: "tpl-product",
        routePath: undefined,
      }),
    ).rejects.toThrow(
      /^SECTION_SOURCE_UNCONFIRMED: template-kind-unsupported: /,
    );
    expect(stored("tpl-product").template.draft_generation).toBe(1);
  });

  it("still refuses a reorder and a rename on an Astro Theme, and writes nothing", async () => {
    const before = stored("tpl-about");
    await expect(
      storefrontThemeDal.reorderSections({
        storefrontId: STOREFRONT,
        themeId: THEME,
        templateId: "tpl-about",
        sectionIds: ["team", "intro"],
        expectedDraftGeneration: 2,
        createdBy: "user-1",
      }),
    ).resolves.toBeNull();
    await expect(
      storefrontThemeDal.renameSection({
        storefrontId: STOREFRONT,
        themeId: THEME,
        templateId: "tpl-about",
        sectionId: "intro",
        name: "Story",
        expectedDraftGeneration: 2,
        createdBy: "user-1",
      }),
    ).resolves.toBeNull();
    expect(stored("tpl-about")).toEqual(before);
  });

  it("refuses showing or hiding an Astro section (not a section prop), and writes nothing", async () => {
    const request = await identityOf("/about", "intro");
    const before = stored("tpl-about");
    const fetch = countParserCalls();
    await expect(
      write({ ...request, props: { enabled: false } }),
    ).rejects.toThrow(
      /^SECTION_SOURCE_UNCONFIRMED: section-visibility-unsupported: /,
    );
    expect(fetch.calls).toBe(0);
    expect(stored("tpl-about")).toEqual(before);
  });

  it("refuses another storefront's Theme as not found, and writes nothing", async () => {
    const request = await identityOf("/about", "intro");
    const before = stored("tpl-about");
    await expect(
      write({ ...request, storefrontId: "storefront-b" }),
    ).resolves.toBeNull();
    expect(stored("tpl-about")).toEqual(before);
  });

  /**
   * Replaces tpl-about's `intro` row, as another writer could have left it:
   * in the template row and in its draft revision, which is the Document
   * the editor context reads.
   */
  const storeIntroRow = (row: Record<string, unknown>) => {
    const document = JSON.stringify({
      ...ABOUT_DOC,
      sections: [row, ABOUT_DOC.sections[1]],
    });
    sqlite
      .prepare(
        "UPDATE storefront_theme_templates SET document = ? WHERE id = ?",
      )
      .run(document, "tpl-about");
    sqlite
      .prepare(
        "UPDATE storefront_theme_template_revisions SET document = ? WHERE id = ?",
      )
      .run(document, REVISION);
  };

  it("refuses a stored row of another component under the section's id (M1), and writes nothing", async () => {
    const request = await identityOf("/about", "intro");
    // A Start Starter row: its type, ref and props are not this instance's.
    storeIntroRow({
      id: "intro",
      type: "hero",
      componentRef: "starter-hero",
      enabled: true,
      props: { heading: "Start heading", ctaHref: "/shop" },
    });
    const before = stored("tpl-about");
    await expect(write(request)).rejects.toThrow(
      /^SECTION_SOURCE_UNCONFIRMED: section-row-mismatch: /,
    );
    expect(stored("tpl-about")).toEqual(before);
  });

  it("refuses a stored row with no component ref under the section's id (M1), and writes nothing", async () => {
    const request = await identityOf("/about", "intro");
    storeIntroRow({
      id: "intro",
      type: "hero",
      enabled: true,
      props: { title: "Intro" },
    });
    const before = stored("tpl-about");
    await expect(write(request)).rejects.toThrow(
      /^SECTION_SOURCE_UNCONFIRMED: section-row-mismatch: /,
    );
    expect(stored("tpl-about")).toEqual(before);
  });

  it("refuses a Markdown or HTML page as a capability limit before the parser is asked (L1), and writes nothing", async () => {
    const request = await identityOf("/about", "intro");
    seedFiles(THEME, STOREFRONT, [
      { path: "src/pages/notes.md", content: "# Notes\n" },
    ]);
    sqlite.exec(`
      INSERT INTO storefront_theme_templates (id, theme_id, type, name, route_path, document, created_at, updated_at)
      VALUES ('tpl-notes', 'theme-a', 'page', '/notes', '/notes', '{"version":1,"sections":[]}', 'now', 'now');
    `);
    const before = stored("tpl-notes");
    const fetch = countParserCalls();
    await expect(
      write({ ...request, templateId: "tpl-notes", routePath: "/notes" }),
    ).rejects.toThrow(
      /^SECTION_SOURCE_UNCONFIRMED: page-language-unsupported: /,
    );
    await expect(read({ routePath: "/notes" })).resolves.toMatchObject({
      status: "view",
      view: {
        status: {
          kind: "refused",
          class: "capability-limit",
          reason: "page-language-unsupported",
        },
        instances: [],
      },
    });
    expect(fetch.calls).toBe(0);
    expect(stored("tpl-notes")).toEqual(before);
  });

  it("answers a parser binding failure with its reason code, never the binding's own message (L6)", async () => {
    const request = await identityOf("/about", "intro");
    const before = stored("tpl-about");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mock.env.ASTRO_PARSER = {
      fetch: async () => {
        throw new Error(
          "connect ECONNREFUSED 10.9.8.7:4431 parser-internal-host",
        );
      },
    };
    const refusal = await write(request).then(
      () => null,
      (error: Error) => error.message,
    );
    expect(refusal).toMatch(
      /^SECTION_SOURCE_UNCONFIRMABLE: parser-binding-failed: /,
    );
    expect(refusal).not.toMatch(
      /ECONNREFUSED|10\.9\.8\.7|parser-internal-host/,
    );
    const view = await read({ routePath: "/about" });
    expect(view).toMatchObject({
      status: "view",
      view: { status: { kind: "refused", reason: "parser-binding-failed" } },
    });
    expect(JSON.stringify(view)).not.toMatch(
      /ECONNREFUSED|10\.9\.8\.7|parser-internal-host/,
    );
    expect(stored("tpl-about")).toEqual(before);
    warn.mockRestore();
  });
});

/**
 * The M2 case as an author writes it (fixtures/morph/astro-m2-case on
 * test/m2-astro-case-refresh): no manifest, the fields in Hero.fields.ts,
 * the page inside html/body/main. Home through N1, then a write.
 */
describe("the M2 case's home page, from an empty Theme to a stored draft", () => {
  const HERO = [
    "---",
    "interface Props {",
    "  title?: string;",
    "  subtitle?: string;",
    "}",
    "",
    'const { title = "M2-CASE-DEFAULT-TITLE", subtitle = "M2-CASE-DEFAULT-SUBTITLE" } =',
    "  Astro.props;",
    "---",
    "<section data-m2-hero>",
    "  <h1>{title}</h1>",
    "  <p>{subtitle}</p>",
    "</section>",
    "",
  ].join("\n");
  const FIELDS = [
    "export const contentFields = {",
    '  title: { type: "text", label: "Title" },',
    '  subtitle: { type: "text", label: "Subtitle" },',
    "} as const;",
    "",
  ].join("\n");
  const page = (path: string, title: string, binding: string) =>
    [
      "---",
      'import { morph } from "@morph/sdk/astro";',
      'import Hero from "../components/Hero.astro";',
      "",
      `const ${binding} = await morph.pages.get("${path}");`,
      `const { hero } = ${binding};`,
      "---",
      '<html lang="en">',
      "  <head>",
      '    <meta charset="utf-8" />',
      `    <title>${title}</title>`,
      "  </head>",
      "  <body>",
      "    <main>",
      "      <Hero {...hero} />",
      "    </main>",
      "  </body>",
      "</html>",
      "",
    ].join("\n");

  beforeEach(() => {
    sqlite.exec(`
      INSERT INTO storefront_themes (id, storefront_id, name, status, source_generation, framework, created_at, updated_at)
      VALUES ('theme-m2', 'storefront-a', 'M2 case', 'draft', 5, 'astro', 'now', 'now');
    `);
    seedFiles("theme-m2", STOREFRONT, [
      {
        path: "astro.config.mjs",
        content: 'export default { output: "server" };\n',
      },
      { path: "src/components/Hero.astro", content: HERO },
      { path: "src/components/Hero.fields.ts", content: FIELDS },
      { path: "src/pages/index.astro", content: page("/", "Home", "home") },
      {
        path: "src/pages/about.astro",
        content: page("/about", "About", "about"),
      },
    ]);
  });

  it("creates the home template (N1) and stores the first draft through the proof", async () => {
    const home = await storefrontThemeDal.ensureRouteTemplate({
      storefrontId: STOREFRONT,
      themeId: "theme-m2",
      routePath: "/",
    });
    expect(home.ok).toBe(true);
    if (!home.ok) return;
    const view = await storefrontThemeDal.readRouteBindings({
      storefrontId: STOREFRONT,
      themeId: "theme-m2",
      routePath: "/",
      expectedSourceGeneration: 5,
    });
    expect(view).toMatchObject({
      status: "view",
      view: {
        status: { kind: "confirmed" },
        instances: [
          {
            section: "hero",
            componentRef: "src/components/Hero.astro",
            sectionType: "hero",
            claims: [
              { slot: "hero", field: "subtitle" },
              { slot: "hero", field: "title" },
            ],
          },
        ],
      },
    });
    if (view.status !== "view") return;
    const [instance] = view.view.instances;
    const { rule, src, start, end } = instance!.identity;
    const result = await storefrontThemeDal.updateSectionProps({
      storefrontId: STOREFRONT,
      themeId: "theme-m2",
      templateId: home.template.id,
      sectionId: "hero",
      // Equal text on purpose (plan section 7), and a field Hero does not declare.
      props: { title: "Same", subtitle: "Same", undeclared: "x" },
      expectedDraftGeneration: home.template.draftGeneration,
      expectedSourceGeneration: 5,
      createdBy: "user-1",
      routePath: "/",
      identity: `0123456789abcdef:${rule}:${src}:${start}:${end}`,
      componentDigest: instance!.componentDigest,
    });
    expect(result).toMatchObject({
      draftGeneration: 2,
      droppedProps: ["undeclared"],
      document: {
        sections: [
          {
            id: "hero",
            type: "hero",
            componentRef: "src/components/Hero.astro",
            enabled: true,
            props: { title: "Same", subtitle: "Same" },
          },
        ],
      },
    });
    const row = sqlite
      .prepare(
        "SELECT t.draft_generation AS generation, r.document AS document FROM storefront_theme_templates t JOIN storefront_theme_template_revisions r ON r.id = t.draft_revision_id WHERE t.id = ?",
      )
      .get(home.template.id) as { generation: number; document: string };
    expect(row.generation).toBe(2);
    expect(JSON.parse(row.document).sections[0].props).toEqual({
      title: "Same",
      subtitle: "Same",
    });
  });
});
