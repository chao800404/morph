// @vitest-environment node
/**
 * "Show again" (M3 stage 1) on the real D1 engine (Miniflare) with every
 * migration applied: one hidden section of one draft back to shown, for a
 * CMS Page (`storefrontPageDal.showSectionAgain`) and for a Theme template
 * or the shared layout (`showTemplateSectionAgain`).
 *
 * Every outcome is read back from the database: what changed, and on every
 * refusal that nothing did. Nothing here publishes; the release and content
 * publication tables are checked to stay as they were.
 */
import { randomUUID } from "node:crypto";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { openMigratedD1 } from "@/lib/test-utils/real-d1";
import {
  SECTION_SOURCE_UNCONFIRMED,
  SHOW_AGAIN_DOCUMENT_INVALID,
  SHOW_AGAIN_VALUE_NOT_PRESERVED,
  TEMPLATE_DRAFT_GENERATION_MISMATCH,
} from "../theme-write-errors";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import { PAGE_DRAFT_VERSION_MISMATCH } from "../page-write-errors";
import { storefrontPageDal } from "./storefront-page.dal";
import { storefrontThemeDal } from "./storefront-theme.dal";
import { showTemplateSectionAgain } from "./storefront-template-show-again.dal";

let harness: Awaited<ReturnType<typeof openMigratedD1>>;
const NOW = "2026-11-26T00:00:00.000Z";

beforeAll(async () => {
  harness = await openMigratedD1("section-show-again");
}, 240_000);

afterAll(async () => {
  await harness?.dispose();
});

const run = (sql: string, ...args: unknown[]) =>
  harness.d1.prepare(sql).bind(...args).run();
const first = <T>(sql: string, ...args: unknown[]) =>
  harness.d1.prepare(sql).bind(...args).first<T>();

/** A hidden newsletter between two shown sections, with content in each. */
function legacyDocument() {
  return {
    version: 1,
    handle: "about",
    sections: [
      {
        id: "hero",
        type: "hero",
        componentRef: "hero.default",
        enabled: true,
        props: { title: "About us", items: [{ id: "a", label: "One" }] },
      },
      {
        id: "newsletter",
        type: "newsletter",
        componentRef: "newsletter.default",
        name: "Spring signup",
        enabled: false,
        props: {
          heading: "Join the list",
          body: "Monthly, never more.",
          rows: [{ label: "Email" }],
        },
      },
      {
        id: "footer-note",
        type: "rich-text",
        enabled: false,
        props: { text: "Still hidden" },
      },
    ],
  };
}

/** The legacy document with only the newsletter shown. */
function expectedShown(document = legacyDocument()) {
  const next = structuredClone(document);
  next.sections[1]!.enabled = true;
  return next;
}

async function storefront() {
  const id = randomUUID();
  await run(
    `INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
     VALUES (?1, ?2, 'Store', 'active', ?3, ?3)`,
    id,
    `channel-${id}`,
    NOW,
  );
  return id;
}

/** Everything a publish would touch; Show again must leave all of it. */
async function publishState(storefrontId: string) {
  return {
    storefront: await first(
      "SELECT active_release_id, active_theme_id FROM storefronts WHERE id = ?1",
      storefrontId,
    ),
    releases: await first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM storefront_releases",
    ),
    publications: await first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM storefront_content_publications",
    ),
    items: await first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM storefront_content_publication_items",
    ),
    builds: await first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM storefront_theme_builds",
    ),
  };
}

describe("CMS Page: Show again", () => {
  let storefrontId = "";
  let pageId = "";

  async function seedPage(
    document: unknown = legacyDocument(),
    options: { published?: boolean } = {},
  ) {
    pageId = randomUUID();
    const revisionId = randomUUID();
    await run(
      `INSERT INTO storefront_pages (id, storefront_id, title, handle, status,
         draft_revision_id, published_revision_id, created_by, created_at, updated_at)
       VALUES (?1, ?2, 'About', ?3, ?4, ?5, ?6, 'author', ?7, ?7)`,
      pageId,
      storefrontId,
      `about-${pageId.slice(0, 8)}`,
      options.published ? "published" : "draft",
      revisionId,
      options.published ? revisionId : null,
      NOW,
    );
    await run(
      `INSERT INTO storefront_page_revisions (id, page_id, version, document, created_by, created_at, published_at)
       VALUES (?1, ?2, 3, ?3, 'author', ?4, ?5)`,
      revisionId,
      pageId,
      typeof document === "string" ? document : JSON.stringify(document),
      NOW,
      options.published ? NOW : null,
    );
    return revisionId;
  }

  async function pageState() {
    const page = await first<Record<string, unknown>>(
      `SELECT title, handle, status, draft_revision_id, published_revision_id, metadata
         FROM storefront_pages WHERE id = ?1`,
      pageId,
    );
    const draft = await first<{ version: number; document: string; published_at: string | null }>(
      `SELECT r.version, r.document, r.published_at FROM storefront_page_revisions r
         INNER JOIN storefront_pages p ON p.draft_revision_id = r.id WHERE p.id = ?1`,
      pageId,
    );
    const revisions = await harness.d1
      .prepare(
        "SELECT id, version, document FROM storefront_page_revisions WHERE page_id = ?1 ORDER BY version",
      )
      .bind(pageId)
      .all<{ id: string; version: number; document: string }>();
    return {
      page,
      draftVersion: draft?.version,
      draftDocument: draft ? JSON.parse(draft.document) : null,
      draftPublishedAt: draft?.published_at,
      revisions: revisions.results,
    };
  }

  const show = (overrides: Partial<Parameters<typeof storefrontPageDal.showSectionAgain>[0]> = {}) =>
    storefrontPageDal.showSectionAgain({
      id: pageId,
      storefrontId,
      sectionId: "newsletter",
      expectedDraftVersion: 3,
      createdBy: "merchant",
      ...overrides,
    });

  beforeEach(async () => {
    storefrontId = await storefront();
  });

  it("shows the hidden section again and keeps its content and every other byte", async () => {
    const legacyRevision = await seedPage(legacyDocument(), { published: true });
    const before = await pageState();
    const published = await publishState(storefrontId);

    const result = await show();

    expect(result).toEqual({ kind: "shown", version: 4 });
    const after = await pageState();
    // Deep equality on the whole document: the newsletter's `enabled` and
    // nothing else — its props, ref, name and place, the other sections,
    // their order, and the still-hidden footer note.
    expect(after.draftDocument).toEqual(expectedShown());
    // A new draft revision, as every Page draft write makes; the published
    // revision, status, title and handle are the page's as they were.
    expect(after.draftVersion).toBe(4);
    expect(after.draftPublishedAt).toBeNull();
    expect(after.page).toEqual({
      ...before.page,
      draft_revision_id: expect.not.stringMatching(legacyRevision),
    });
    expect(after.page!.published_revision_id).toBe(legacyRevision);
    // The revision history keeps the hidden draft, content intact.
    expect(after.revisions).toHaveLength(2);
    expect(JSON.parse(after.revisions[0]!.document)).toEqual(legacyDocument());
    // Never publishes.
    expect(await publishState(storefrontId)).toEqual(published);
  });

  it("bumps the draft revision the way a Page draft save does", async () => {
    await seedPage();
    await show();
    const saved = await pageState();
    // A general draft save afterwards continues from the version Show again
    // made, so the two writes share one revision sequence.
    await storefrontPageDal.update({
      id: pageId,
      title: "About",
      handle: saved.page!.handle as string,
      document: saved.draftDocument,
      publish: false,
      hasPublishedVersion: false,
      expectedDraftVersion: 4,
      createdBy: "merchant",
      storefrontId,
    });
    expect((await pageState()).revisions.map((r) => r.version)).toEqual([3, 4, 5]);
  });

  it("refuses a stale expected draft version with the draft conflict, and writes nothing", async () => {
    await seedPage();
    const before = await pageState();
    await expect(show({ expectedDraftVersion: 2 })).rejects.toThrow(
      PAGE_DRAFT_VERSION_MISMATCH,
    );
    expect(await pageState()).toEqual(before);
  });

  it("refuses when the draft moves between its read and its write, and writes nothing of its own", async () => {
    await seedPage();
    const database = env.DATABASE;
    let raced = "";
    // Another save lands after Show again read the draft, before its batch.
    (env as unknown as { DATABASE: D1Database }).DATABASE = new Proxy(database, {
      get(target, key, receiver) {
        if (key !== "batch") return Reflect.get(target, key, receiver);
        return async (statements: D1PreparedStatement[]) => {
          raced = randomUUID();
          await target.batch([
            target
              .prepare(
                `INSERT INTO storefront_page_revisions (id, page_id, version, document, created_by, created_at)
                 VALUES (?1, ?2, 4, ?3, 'other-tab', ?4)`,
              )
              .bind(raced, pageId, JSON.stringify(legacyDocument()), NOW),
            target
              .prepare("UPDATE storefront_pages SET draft_revision_id = ?1 WHERE id = ?2")
              .bind(raced, pageId),
          ]);
          return target.batch(statements);
        };
      },
    });
    try {
      await expect(show()).rejects.toThrow(PAGE_DRAFT_VERSION_MISMATCH);
    } finally {
      (env as unknown as { DATABASE: D1Database }).DATABASE = database;
    }
    const after = await pageState();
    expect(after.page!.draft_revision_id).toBe(raced);
    expect(after.revisions.map((r) => r.version)).toEqual([3, 4]);
    expect(after.draftDocument).toEqual(legacyDocument());
  });

  it("answers null for a page of another storefront, or a deleted one, and writes nothing", async () => {
    await seedPage();
    const before = await pageState();
    expect(await show({ storefrontId: await storefront() })).toBeNull();
    expect(await show({ id: randomUUID() })).toBeNull();
    await run("UPDATE storefront_pages SET deleted_at = ?1 WHERE id = ?2", NOW, pageId);
    expect(await show()).toBeNull();
    expect(await pageState()).toEqual(before);
  });

  it("refuses a section the draft does not hold exactly once, and writes nothing", async () => {
    const document = legacyDocument();
    (document.sections as unknown[]).push({
      ...document.sections[2]!,
      props: { text: "Twin" },
    });
    await seedPage(document);
    const before = await pageState();
    expect(await show({ sectionId: "missing" })).toEqual({
      kind: "section-not-found",
      reason: "missing",
    });
    expect(await show({ sectionId: "footer-note" })).toEqual({
      kind: "section-not-found",
      reason: "ambiguous",
    });
    expect(await pageState()).toEqual(before);
  });

  it("is a no-op on a section already shown, and writes nothing", async () => {
    await seedPage();
    const before = await pageState();
    expect(await show({ sectionId: "hero" })).toEqual({ kind: "unchanged", version: 3 });
    expect(await pageState()).toEqual(before);
  });

  it("refuses a draft whose values would not survive the write, and writes nothing", async () => {
    // 9007199254740993 is not a double: re-serialised it would become …992.
    const text = JSON.stringify(legacyDocument()).replace(
      '"title":"About us"',
      '"title":"About us","count":9007199254740993',
    );
    await seedPage(text);
    const before = await pageState();
    expect(await show()).toEqual({
      kind: "document-refused",
      code: SHOW_AGAIN_VALUE_NOT_PRESERVED,
    });
    expect(await pageState()).toEqual(before);
    const raw = await first<{ document: string }>(
      "SELECT document FROM storefront_page_revisions WHERE page_id = ?1",
      pageId,
    );
    expect(raw!.document).toBe(text);
  });

  it("refuses `enabled: null` as an invalid draft rather than answering it shown", async () => {
    const document = legacyDocument() as { sections: Record<string, unknown>[] };
    document.sections[1]!.enabled = null;
    await seedPage(document);
    const before = await pageState();
    expect(await show()).toEqual({
      kind: "document-refused",
      code: SHOW_AGAIN_DOCUMENT_INVALID,
    });
    expect(await pageState()).toEqual(before);
  });

  it("keeps a batch failure it does not own a failure, not a draft conflict", async () => {
    await seedPage();
    const database = env.DATABASE;
    const holder = env as unknown as { DATABASE: D1Database };
    holder.DATABASE = new Proxy(database, {
      get(target, key, receiver) {
        if (key !== "batch") return Reflect.get(target, key, receiver);
        return async () => {
          throw new Error("D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT");
        };
      },
    });
    try {
      const error = await show().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("FOREIGN KEY constraint failed");
      expect((error as Error).message).not.toContain(PAGE_DRAFT_VERSION_MISMATCH);
    } finally {
      holder.DATABASE = database;
    }
  });
});

describe("Theme template and layout: Show again", () => {
  let storefrontId = "";
  let themeId = "";
  let templateId = "";

  async function seedTemplate(options: {
    framework?: string | null;
    type?: "index" | "layout";
    publishedDraft?: boolean;
    document?: unknown;
  } = {}) {
    storefrontId = await storefront();
    themeId = randomUUID();
    templateId = randomUUID();
    const revisionId = randomUUID();
    await run(
      `INSERT INTO storefront_themes (id, storefront_id, name, status, source_generation, framework, created_at, updated_at)
       VALUES (?1, ?2, 'Theme', 'draft', 5, ?3, ?4, ?4)`,
      themeId,
      storefrontId,
      options.framework ?? null,
      NOW,
    );
    await run(
      `INSERT INTO storefront_theme_templates (id, theme_id, type, name, route_path, document,
         draft_revision_id, published_revision_id, draft_generation, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'Home', NULL, ?4, ?5, ?6, 7, ?7, ?7)`,
      templateId,
      themeId,
      options.type ?? "index",
      JSON.stringify({ version: 1, sections: [] }),
      revisionId,
      options.publishedDraft ? revisionId : null,
      NOW,
    );
    await run(
      `INSERT INTO storefront_theme_template_revisions (id, template_id, version, document, created_by, created_at, published_at)
       VALUES (?1, ?2, 2, ?3, 'author', ?4, ?5)`,
      revisionId,
      templateId,
      JSON.stringify(options.document ?? legacyDocument()),
      NOW,
      options.publishedDraft ? NOW : null,
    );
    return revisionId;
  }

  async function templateState() {
    const template = await first<Record<string, unknown>>(
      `SELECT draft_revision_id, published_revision_id, draft_generation, document
         FROM storefront_theme_templates WHERE id = ?1`,
      templateId,
    );
    const revisions = await harness.d1
      .prepare(
        "SELECT id, version, document, published_at FROM storefront_theme_template_revisions WHERE template_id = ?1 ORDER BY version",
      )
      .bind(templateId)
      .all<{ id: string; version: number; document: string; published_at: string | null }>();
    const draft = revisions.results.find((r) => r.id === template?.draft_revision_id);
    return {
      template,
      draftDocument: draft ? JSON.parse(draft.document) : null,
      revisions: revisions.results,
      source: await first("SELECT source_generation FROM storefront_themes WHERE id = ?1", themeId),
    };
  }

  const show = (overrides: Partial<Parameters<typeof showTemplateSectionAgain>[0]> = {}) =>
    showTemplateSectionAgain({
      storefrontId,
      themeId,
      templateId,
      sectionId: "newsletter",
      expectedDraftGeneration: 7,
      createdBy: "merchant",
      ...overrides,
    });

  it.each([
    ["a Start template", { type: "index" as const }],
    ["the shared layout", { type: "layout" as const }],
  ])("shows the hidden section of %s again, content kept, generation bumped", async (_name, options) => {
    const revisionId = await seedTemplate(options);
    const published = await publishState(storefrontId);

    const result = await show();

    // An unpublished, unreferenced draft is updated in place with the next
    // generation, exactly as every other template write does.
    expect(result).toEqual({ kind: "shown", draftGeneration: 8, draftRevisionId: revisionId });
    const after = await templateState();
    expect(after.template!.draft_generation).toBe(8);
    expect(after.draftDocument).toEqual(expectedShown());
    expect(after.source).toEqual({ source_generation: 5 });
    expect(await publishState(storefrontId)).toEqual(published);
  });

  it("branches a new draft revision when the draft is the published one, and leaves it", async () => {
    const revisionId = await seedTemplate({ publishedDraft: true });
    const published = await publishState(storefrontId);

    const result = await show();

    expect(result).toMatchObject({ kind: "shown", draftGeneration: 8 });
    const after = await templateState();
    expect(after.template!.published_revision_id).toBe(revisionId);
    expect(after.template!.draft_revision_id).not.toBe(revisionId);
    expect(after.revisions).toHaveLength(2);
    expect(JSON.parse(after.revisions[0]!.document)).toEqual(legacyDocument());
    expect(after.revisions[0]!.published_at).toBe(NOW);
    expect(after.draftDocument).toEqual(expectedShown());
    expect(await publishState(storefrontId)).toEqual(published);
  });

  it("refuses a stale expected generation with the draft conflict, and writes nothing", async () => {
    await seedTemplate();
    const before = await templateState();
    await expect(show({ expectedDraftGeneration: 6 })).rejects.toThrow(
      TEMPLATE_DRAFT_GENERATION_MISMATCH,
    );
    expect(await templateState()).toEqual(before);
  });

  it("refuses when the generation moves between its read and its write, and writes nothing of its own", async () => {
    await seedTemplate();
    const database = env.DATABASE;
    (env as unknown as { DATABASE: D1Database }).DATABASE = new Proxy(database, {
      get(target, key, receiver) {
        if (key !== "batch") return Reflect.get(target, key, receiver);
        return async (statements: D1PreparedStatement[]) => {
          await target
            .prepare("UPDATE storefront_theme_templates SET draft_generation = 8 WHERE id = ?1")
            .bind(templateId)
            .run();
          return target.batch(statements);
        };
      },
    });
    try {
      await expect(show()).rejects.toThrow(TEMPLATE_DRAFT_GENERATION_MISMATCH);
    } finally {
      (env as unknown as { DATABASE: D1Database }).DATABASE = database;
    }
    const after = await templateState();
    expect(after.template!.draft_generation).toBe(8);
    expect(after.draftDocument).toEqual(legacyDocument());
  });

  it("answers null for another storefront's Theme, another Theme, or a deleted template, and writes nothing", async () => {
    await seedTemplate();
    const before = await templateState();
    expect(await show({ storefrontId: await storefront() })).toBeNull();
    expect(await show({ themeId: randomUUID() })).toBeNull();
    expect(await show({ templateId: randomUUID() })).toBeNull();
    await run("UPDATE storefront_theme_templates SET deleted_at = ?1 WHERE id = ?2", NOW, templateId);
    expect(await show()).toBeNull();
    const after = await templateState();
    expect(after.revisions).toEqual(before.revisions);
    expect(after.template!.draft_generation).toBe(7);
  });

  it("refuses a section the draft does not hold, and is a no-op on one already shown", async () => {
    await seedTemplate();
    const before = await templateState();
    expect(await show({ sectionId: "missing" })).toEqual({
      kind: "section-not-found",
      reason: "missing",
    });
    expect(await show({ sectionId: "hero" })).toMatchObject({
      kind: "unchanged",
      draftGeneration: 7,
    });
    expect(await templateState()).toEqual(before);
  });

  it("on an Astro Theme, shows the section again while the field write still refuses `enabled`", async () => {
    await seedTemplate({ framework: "astro" });
    const before = await templateState();

    // The general section write keeps refusing every visibility change on
    // an Astro page, shown included.
    await expect(
      storefrontThemeDal.updateSectionProps({
        storefrontId,
        themeId,
        templateId,
        sectionId: "newsletter",
        props: { enabled: true },
        expectedDraftGeneration: 7,
        expectedSourceGeneration: 5,
        createdBy: "merchant",
      }),
    ).rejects.toThrow("section-visibility-unsupported");
    expect(await templateState()).toEqual(before);

    // Show again is the one visibility change it takes.
    expect(await show()).toMatchObject({ kind: "shown", draftGeneration: 8 });
    expect((await templateState()).draftDocument).toEqual(expectedShown());
  });

  describe("on a Start Theme whose route renders the slot", () => {
    /** The home route renders `newsletter` with `Newsletter.tsx`. */
    async function seedRouteFiles() {
      const files = [
        ...livePreviewPlatformFiles(),
        {
          path: "src/components/Newsletter.tsx",
          content:
            'export const contentFields = { heading: { type: "text", label: "Heading" } } as const;\nexport default function Newsletter({ heading = "DEFAULT" }) { return <h2>{heading}</h2>; }\n',
        },
        {
          path: "src/routes/index.tsx",
          content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Newsletter from "../components/Newsletter";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return <main><Newsletter {...content("newsletter")} /></main>;
}
`,
        },
      ];
      for (const file of files) {
        await run(
          `INSERT INTO storefront_theme_files (id, storefront_id, theme_id, path, content, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
          randomUUID(),
          storefrontId,
          themeId,
          file.path,
          file.content,
          NOW,
        );
      }
    }

    const withNewsletterRef = (componentRef: string) => {
      const document = legacyDocument();
      document.sections[1]!.componentRef = componentRef;
      return document;
    };

    it("refuses a section stored for another component than the one rendering it, and writes nothing", async () => {
      await seedTemplate({ document: withNewsletterRef("src/components/OldPromo.tsx") });
      await seedRouteFiles();
      const before = await templateState();
      await expect(show()).rejects.toThrow(
        `${SECTION_SOURCE_UNCONFIRMED}: section-row-mismatch:`,
      );
      expect(await templateState()).toEqual(before);
    });

    it("shows a section stored for the component that renders it", async () => {
      await seedTemplate({ document: withNewsletterRef("src/components/Newsletter.tsx") });
      await seedRouteFiles();
      expect(await show()).toMatchObject({ kind: "shown", draftGeneration: 8 });
    });

    it("shows a section the route does not render, as a plain Document section", async () => {
      const document = withNewsletterRef("src/components/OldPromo.tsx");
      document.sections[1]!.id = "promo";
      await seedTemplate({ document });
      await seedRouteFiles();
      expect(await show({ sectionId: "promo" })).toMatchObject({ kind: "shown" });
    });
  });
});
