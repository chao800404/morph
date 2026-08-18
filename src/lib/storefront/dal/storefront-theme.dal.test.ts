import Database from "better-sqlite3";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storefrontThemeDal } from "./storefront-theme.dal";

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
      message text,
      source text,
      snapshot text,
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
      status text NOT NULL,
      metadata text,
      created_by text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
  `);

  drizzle(sqlite, { schema: storefrontSchema });
  // @ts-expect-error test mock
  vi.mocked(getDb).mockResolvedValue(drizzle(sqlite, { schema: storefrontSchema }));

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
        expectedDraftRevisionId: "11111111-1111-4111-8111-111111111111",
        expectedDraftGeneration: 1,
        expectedReleaseGeneration: 1,
      }),
    ).resolves.toEqual({
      revisionId: "11111111-1111-4111-8111-111111111111",
      sourceRevisionId: "22222222-2222-4222-8222-222222222222",
      draftGeneration: 2,
      releaseGeneration: 2,
      templateUnchanged: false,
      sourceUnchanged: false,
      unchanged: false,
    });

    const storefront = sqlite
      .prepare("SELECT active_release_id FROM storefronts WHERE id = ?")
      .get("storefront-a") as { active_release_id: string | null };
    expect(storefront.active_release_id).toBeTruthy();
    const release = sqlite
      .prepare(
        "SELECT storefront_id, theme_id, source_revision_id, theme_build_id, status FROM storefront_releases WHERE id = ?",
      )
      .get(storefront.active_release_id) as {
      storefront_id: string;
      theme_id: string;
      source_revision_id: string;
      theme_build_id: string;
      status: string;
    };
    expect(release).toEqual({
      storefront_id: "storefront-a",
      theme_id: "theme-a",
      source_revision_id: "22222222-2222-4222-8222-222222222222",
      theme_build_id: "33333333-3333-4333-8333-333333333333",
      status: "active",
    });
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

    expect(res).toEqual({
      revisionId: "11111111-1111-4111-8111-111111111111",
      sourceRevisionId: "22222222-2222-4222-8222-222222222222",
      draftGeneration: 2,
      releaseGeneration: 2,
      templateUnchanged: false,
      sourceUnchanged: false,
      unchanged: false,
    });

    const theme = sqlite
      .prepare(
        "SELECT published_source_revision_id, release_generation FROM storefront_themes WHERE id = ?",
      )
      .get("theme-a") as { published_source_revision_id: string | null; release_generation: number };
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
    const heroProps = heroResult?.document.sections.find((s) => s.id === "hero-1")?.props as any;
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
    const introProps = introResult?.document.sections.find((s) => s.id === "intro-1")?.props as any;
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
    const catProps = catResult?.document.sections.find((s) => s.id === "cat-1")?.props as any;
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
    const storyProps = storyResult?.document.sections.find((s) => s.id === "story-1")?.props as any;
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
    const newsProps = newsResult?.document.sections.find((s) => s.id === "news-1")?.props as any;
    expect(newsProps.eyebrow).toBe("Notes from the studio");
    expect(newsProps.heading).toBe("A quieter inbox.");
    expect(newsProps.body).toBe("New objects.");
    expect(newsProps.placeholder).toBe("Your email here...");
    expect(newsProps.actionLabel).toBe("Subscribe");
  });
});
