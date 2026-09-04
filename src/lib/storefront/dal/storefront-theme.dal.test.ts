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
        return statements.map((s) => {
          if (typeof s.run === "function") return s.run();
          if (typeof s.all === "function") return s.all();
          return {};
        });
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
      document text NOT NULL,
      draft_revision_id text,
      published_revision_id text,
      draft_generation integer DEFAULT 1 NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
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

  it("strictly rejects unrecognized componentRef on known section type (does not fall back to sectionType default)", async () => {
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
    // Unregistered componentRef strictly returns {} (no fallback to hero.default)
    expect(Object.keys(props)).toHaveLength(0);
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
  const seedSection = (props: string) => {
    const doc = `{"version":1,"sections":[{"id":"promo-1","type":"promo","componentRef":"promo.default","enabled":true,"props":${props}}]}`;
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
    seedSection('{"headline":"Original","subtitle":"far too long for the limit"}');

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
