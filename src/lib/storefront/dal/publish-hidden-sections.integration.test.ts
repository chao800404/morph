// @vitest-environment node
/**
 * A Theme publish refused for a hidden section names the document and the
 * section as data (M3 stage 1), on the real D1 engine (Miniflare) with every
 * migration applied, and `mustPublish` says what the author has to publish
 * once the section is shown again:
 *
 * - a CMS Page: "page". The Theme publish seals the Page's published
 *   revision, so a Show again on its draft is not enough; only after the
 *   Page itself is published does the Theme publish go through.
 * - a Theme template: "theme". The Theme publish seals the template's draft,
 *   so a Show again on it is all the next publish needs.
 *
 * Every refusal is read back: nothing published, the active release as it
 * was. Each success is read back from the sealed publication item, whose
 * section is shown with its content intact.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openMigratedD1 } from "@/lib/test-utils/real-d1";
import { PublishHiddenSectionsError } from "../content/section-hide-check";
import { withThemeStartBuildIdentity } from "../compiler/theme-morph-sdk";
import { STARTER_THEME_CONTENT_MODULE_SOURCE } from "../starter-theme-v3-files";
import { storefrontPageDal } from "./storefront-page.dal";
import { storefrontThemeDal } from "./storefront-theme.dal";
import { showTemplateSectionAgain } from "./storefront-template-show-again.dal";

let harness: Awaited<ReturnType<typeof openMigratedD1>>;
const NOW = "2026-11-26T00:00:00.000Z";

beforeAll(async () => {
  harness = await openMigratedD1("publish-hidden-sections");
}, 240_000);

afterAll(async () => {
  await harness?.dispose();
});

const run = (sql: string, ...args: unknown[]) =>
  harness.d1.prepare(sql).bind(...args).run();
const first = <T>(sql: string, ...args: unknown[]) =>
  harness.d1.prepare(sql).bind(...args).first<T>();

/** The build's source: the home route renders `hero` only. */
const sourceFiles = [
  {
    path: "src/routes/__root.tsx",
    content: `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: Root });
function Root() { return <Outlet />; }`,
  },
  { path: "src/morph/content.ts", content: STARTER_THEME_CONTENT_MODULE_SOURCE },
  {
    path: "src/components/Hero.tsx",
    content: `export const contentFields = {
  heading: { type: "text", label: "Heading" },
} as const;
export default function Hero({ heading = "HERO-DEFAULT" }) { return <h1>{heading}</h1>; }`,
  },
  {
    path: "src/routes/index.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: Home });
function Home() { return <main><Hero {...content("hero")} /></main>; }`,
  },
];

const NEWSLETTER_PROPS = {
  heading: "Join the list",
  body: "Monthly, never more.",
  rows: [{ id: "row-email", label: "Email" }],
};

/** A shown hero, and a newsletter with content, hidden or shown. */
function documentWith(newsletterShown: boolean, handle?: string) {
  return {
    version: 1,
    ...(handle ? { handle } : {}),
    sections: [
      {
        id: "hero",
        type: "hero",
        componentRef: "src/components/Hero.tsx",
        enabled: true,
        props: { heading: "Welcome" },
      },
      {
        id: "newsletter",
        type: "newsletter",
        componentRef: "src/components/Newsletter.tsx",
        name: "Spring signup",
        enabled: newsletterShown,
        props: structuredClone(NEWSLETTER_PROPS),
      },
    ],
  };
}

type Seeded = {
  storefrontId: string;
  themeId: string;
  templateId: string;
  sourceRevisionId: string;
  buildId: string;
};

async function seedTheme(options: { templateNewsletterShown: boolean }): Promise<Seeded> {
  const storefrontId = randomUUID();
  const themeId = randomUUID();
  const templateId = randomUUID();
  const templateRevisionId = randomUUID();
  const sourceRevisionId = randomUUID();
  const buildId = randomUUID();
  await run(
    `INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
     VALUES (?1, ?2, 'Store', 'active', ?3, ?3)`,
    storefrontId,
    `channel-${storefrontId}`,
    NOW,
  );
  await run(
    `INSERT INTO storefront_themes (id, storefront_id, name, status, source_generation, release_generation, created_at, updated_at)
     VALUES (?1, ?2, 'Theme', 'draft', 1, 1, ?3, ?3)`,
    themeId,
    storefrontId,
    NOW,
  );
  await run(
    `INSERT INTO storefront_theme_revisions (id, storefront_id, theme_id, revision_number, source_generation, message, source, snapshot, created_at, updated_at)
     VALUES (?1, ?2, ?3, 1, 1, 'Checkpoint', 'publish', '[]', ?4, ?4)`,
    sourceRevisionId,
    storefrontId,
    themeId,
    NOW,
  );
  await run(
    `INSERT INTO storefront_theme_builds (id, storefront_id, theme_id, source_revision_id, status, artifact_prefix, manifest_json, compiler_id, compiler_version, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'succeeded', ?5, '{}', 'tanstack-start-native', ?6, ?7, ?7)`,
    buildId,
    storefrontId,
    themeId,
    sourceRevisionId,
    `themes/${themeId}/builds/${buildId}`,
    withThemeStartBuildIdentity("1.168.32"),
    NOW,
  );
  const document = JSON.stringify(documentWith(options.templateNewsletterShown));
  await run(
    `INSERT INTO storefront_theme_templates (id, theme_id, type, name, route_path, document,
       draft_revision_id, published_revision_id, draft_generation, created_at, updated_at)
     VALUES (?1, ?2, 'index', 'Home', NULL, ?3, ?4, NULL, 1, ?5, ?5)`,
    templateId,
    themeId,
    document,
    templateRevisionId,
    NOW,
  );
  await run(
    `INSERT INTO storefront_theme_template_revisions (id, template_id, version, document, created_by, created_at, published_at)
     VALUES (?1, ?2, 1, ?3, 'author', ?4, NULL)`,
    templateRevisionId,
    templateId,
    document,
    NOW,
  );
  return { storefrontId, themeId, templateId, sourceRevisionId, buildId };
}

/** A published CMS Page whose published revision hides the newsletter. */
async function seedHiddenPublishedPage(storefrontId: string) {
  const pageId = randomUUID();
  const revisionId = randomUUID();
  await run(
    `INSERT INTO storefront_pages (id, storefront_id, title, handle, status,
       draft_revision_id, published_revision_id, created_by, created_at, updated_at)
     VALUES (?1, ?2, 'About', 'about', 'published', ?3, ?3, 'author', ?4, ?4)`,
    pageId,
    storefrontId,
    revisionId,
    NOW,
  );
  await run(
    `INSERT INTO storefront_page_revisions (id, page_id, version, document, created_by, created_at, published_at)
     VALUES (?1, ?2, 1, ?3, 'author', ?4, ?4)`,
    revisionId,
    pageId,
    JSON.stringify(documentWith(false, "about")),
    NOW,
  );
  return pageId;
}

async function templateDraft(templateId: string) {
  return (await first<{ id: string; generation: number }>(
    "SELECT draft_revision_id AS id, draft_generation AS generation FROM storefront_theme_templates WHERE id = ?1",
    templateId,
  ))!;
}

async function publish(seeded: Seeded) {
  const draft = await templateDraft(seeded.templateId);
  const { generation } = (await first<{ generation: number }>(
    "SELECT release_generation AS generation FROM storefront_themes WHERE id = ?1",
    seeded.themeId,
  ))!;
  return storefrontThemeDal.publishTemplate({
    storefrontId: seeded.storefrontId,
    themeId: seeded.themeId,
    templateId: seeded.templateId,
    sourceRevisionId: seeded.sourceRevisionId,
    themeBuildId: seeded.buildId,
    expectedDraftRevisionId: draft.id,
    expectedDraftGeneration: draft.generation,
    expectedReleaseGeneration: generation,
    createdBy: "merchant",
    verifySourceRevision: async () => {},
    readSourceRevisionFiles: async () => sourceFiles,
  });
}

/** The publish's refusal, which must be the typed one. */
async function refusalOf(seeded: Seeded): Promise<PublishHiddenSectionsError> {
  const error = await publish(seeded).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(PublishHiddenSectionsError);
  return error as PublishHiddenSectionsError;
}

/** Everything a publish writes. */
async function liveState(storefrontId: string) {
  return {
    active: await first(
      "SELECT active_release_id FROM storefronts WHERE id = ?1",
      storefrontId,
    ),
    releases: await first(
      "SELECT COUNT(*) AS n FROM storefront_releases WHERE storefront_id = ?1",
      storefrontId,
    ),
    publications: await first(
      "SELECT COUNT(*) AS n FROM storefront_content_publications WHERE storefront_id = ?1",
      storefrontId,
    ),
  };
}

/** The document a release sealed for one publication item. */
async function sealedDocument(
  releaseId: string,
  itemType: "page" | "template",
  contentId: string,
) {
  const row = await first<{ revision_id: string }>(
    `SELECT i.revision_id FROM storefront_releases r
       JOIN storefront_content_publication_items i ON i.publication_id = r.content_publication_id
      WHERE r.id = ?1 AND i.item_type = ?2 AND i.content_id = ?3 AND i.deleted_at IS NULL`,
    releaseId,
    itemType,
    contentId,
  );
  expect(row, `release ${releaseId} seals ${itemType} ${contentId}`).toBeTruthy();
  const table =
    itemType === "page"
      ? "storefront_page_revisions"
      : "storefront_theme_template_revisions";
  const revision = await first<{ document: string }>(
    `SELECT document FROM ${table} WHERE id = ?1`,
    row!.revision_id,
  );
  return JSON.parse(revision!.document) as ReturnType<typeof documentWith>;
}

const newsletterOf = (document: ReturnType<typeof documentWith>) =>
  document.sections.find((section) => section.id === "newsletter");

describe("publish refused for a hidden section: the refusal as data and what must be published", () => {
  it('a CMS Page: mustPublish "page"; Show again on its draft alone still refuses, the Page publish lets it through', async () => {
    const seeded = await seedTheme({ templateNewsletterShown: true });
    const pageId = await seedHiddenPublishedPage(seeded.storefrontId);
    const before = await liveState(seeded.storefrontId);

    const refused = await refusalOf(seeded);
    expect(refused.message).toMatch(
      /^PUBLISH_HIDDEN_SECTION_UNSUPPORTED: .*"newsletter" on the Page "About" \(\/pages\/about\) \(no-call-site\)/,
    );
    expect(refused.details).toEqual({
      kind: "publish-hidden-sections",
      truncated: false,
      problems: [
        {
          itemType: "page",
          contentId: pageId,
          templateType: "page",
          sectionId: "newsletter",
          reason: "no-call-site",
          refusedAs: "page",
          mustPublish: "page",
          label: 'the Page "About" (/pages/about)',
        },
      ],
    });
    expect(await liveState(seeded.storefrontId)).toEqual(before);

    // Show again on the Page's draft: the draft now shows it, but the Theme
    // publish seals the Page's published revision, which still hides it.
    const shown = await storefrontPageDal.showSectionAgain({
      id: pageId,
      storefrontId: seeded.storefrontId,
      sectionId: "newsletter",
      expectedDraftVersion: 1,
      createdBy: "merchant",
    });
    expect(shown).toMatchObject({ kind: "shown" });
    const again = await refusalOf(seeded);
    expect(again.details.problems).toEqual(refused.details.problems);
    expect(await liveState(seeded.storefrontId)).toEqual(before);

    // The Page published (the Dashboard's save with Publish page on), then
    // the Theme: it goes through and seals the shown newsletter, content
    // kept.
    const draft = await storefrontPageDal.findDetail(pageId, seeded.storefrontId);
    expect(draft).toBeTruthy();
    await storefrontPageDal.update({
      id: pageId,
      title: "About us",
      handle: "about",
      document: draft!.document,
      publish: true,
      hasPublishedVersion: true,
      createdBy: "merchant",
      storefrontId: seeded.storefrontId,
      expectedDraftVersion: draft!.version,
    });
    const published = await publish(seeded);
    expect(published?.releaseId).toBeTruthy();
    const sealed = await sealedDocument(published!.releaseId!, "page", pageId);
    expect(newsletterOf(sealed)).toEqual({
      ...documentWith(true).sections[1],
    });
    expect(newsletterOf(sealed)?.props).toEqual(NEWSLETTER_PROPS);
  });

  it('a Theme template: mustPublish "theme"; Show again on its draft is all the next Theme publish needs', async () => {
    const seeded = await seedTheme({ templateNewsletterShown: false });
    const before = await liveState(seeded.storefrontId);

    const refused = await refusalOf(seeded);
    expect(refused.details).toEqual({
      kind: "publish-hidden-sections",
      truncated: false,
      problems: [
        {
          itemType: "template",
          contentId: seeded.templateId,
          templateType: "index",
          sectionId: "newsletter",
          reason: "no-call-site",
          refusedAs: "unlisted",
          mustPublish: "theme",
          label: "the index page",
        },
      ],
    });
    expect(await liveState(seeded.storefrontId)).toEqual(before);

    const draft = await templateDraft(seeded.templateId);
    const shown = await showTemplateSectionAgain({
      storefrontId: seeded.storefrontId,
      themeId: seeded.themeId,
      templateId: seeded.templateId,
      sectionId: "newsletter",
      expectedDraftGeneration: draft.generation,
      createdBy: "merchant",
    });
    expect(shown).toMatchObject({ kind: "shown" });

    const published = await publish(seeded);
    expect(published?.releaseId).toBeTruthy();
    const sealed = await sealedDocument(
      published!.releaseId!,
      "template",
      seeded.templateId,
    );
    expect(newsletterOf(sealed)).toEqual(documentWith(true).sections[1]);
  });
});
