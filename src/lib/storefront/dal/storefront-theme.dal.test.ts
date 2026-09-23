import { createElement } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EditorStyleInspector } from "@/routes/_editor/-components/editor-style-inspector";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import Database from "better-sqlite3";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storefrontThemeDal } from "./storefront-theme.dal";
import { storefrontContentPublicationDal } from "./storefront-content-publication.dal";

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

describe("storefront theme DAL", () => {
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
  it("does not return a theme owned by another storefront", async () => {
    await expect(
      storefrontThemeDal.findEditorContext("storefront-a", "theme-b"),
    ).resolves.toBeNull();
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
    expect(context?.templates[0]?.document.sections).toEqual([
      {
        id: "promo",
        type: "promo",
        componentRef: "promo.default",
        enabled: true,
        props: {},
      },
    ]);

    const result = await storefrontThemeDal.updateSectionProps({
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
      // The content contract has to exist for the import to count as the
      // route adopting route-owned structure, as it does in every real Theme.
      sqlite
        .prepare(
          `INSERT INTO storefront_theme_files
            (id, storefront_id, theme_id, path, content, created_at, updated_at)
          VALUES ('f-content', 'storefront-a', 'theme-a', 'src/morph/content.ts', 'export const content = () => ({});', 'now', 'now')`,
        )
        .run();
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
      expect(aboutDoc?.document.sections.map((section) => section.id)).toEqual([
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
      ).toEqual({ routePath: "/aboutus" });

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

  it("checks a layout write against the component the layout renders", async () => {
    const root = `import { Outlet, createRootRoute } from "@tanstack/react-router";
import StorefrontLayout from "../layouts/StorefrontLayout";
export const Route = createRootRoute({ component: Root });
function Root() { return <StorefrontLayout><Outlet /></StorefrontLayout>; }`;
    const layout = `import { Outlet } from "@tanstack/react-router";
import { content } from "../morph/content";
import Header from "../components/SiteHeader";
export default function StorefrontLayout() {
  return <div><Header {...content("header")} /><Outlet /></div>;
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

    await expect(
      storefrontThemeDal.publishTemplate({
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
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "template-a",
        expectedDraftRevisionId: "11111111-1111-4111-8111-111111111111",
        expectedDraftGeneration: 4,
        expectedReleaseGeneration: 3,
      }),
    ).rejects.toThrow("PUBLISH_BUILD_NOT_READY");
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
      storefrontId: "storefront-a",
      themeId: "theme-a",
      templateId: "template-a",
      expectedDraftRevisionId: "11111111-1111-4111-8111-111111111111",
      expectedDraftGeneration: 1,
      expectedReleaseGeneration: 1,
    });

  it("resolves the build for the current source when the caller names none", async () => {
    // The editor only knows a Build Preview while it is showing one, so a
    // reload must not make an existing valid build unpublishable.
    seedTemplateAndRevision();

    const result = await publish();

    expect(result).toMatchObject({
      themeBuildId: "33333333-3333-4333-8333-333333333333",
      sourceRevisionId: "22222222-2222-4222-8222-222222222222",
      releaseCreated: true,
    });
  });

  it("prefers the newest succeeded build for the current source generation", async () => {
    seedTemplateAndRevision(`
      INSERT INTO storefront_theme_builds
        (id, storefront_id, theme_id, source_revision_id, status, artifact_prefix, manifest_json, created_at, updated_at)
      VALUES
        ('44444444-4444-4444-8444-444444444444', 'storefront-a', 'theme-a',
         '22222222-2222-4222-8222-222222222222', 'succeeded',
         'themes/theme-a/builds/build-b', '{}', 'zzz-later', 'zzz-later');
    `);

    const result = await publish();
    expect(result!.themeBuildId).toBe("44444444-4444-4444-8444-444444444444");
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
