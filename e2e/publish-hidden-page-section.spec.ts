import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { EDITOR_PATH } from "./helpers";
import { execLocalD1, queryLocalD1 } from "./helpers/editor-writes-paused";
import { insertThrowawayTheme, specPreviewRuntime } from "./helpers/throwaway-theme";
import {
  DOMAINS,
  THEMES,
  editHero,
  openEditor,
  openPublish,
  publishShowingRelease,
  servedRelease,
  serverFn,
  signedInPage,
  storefrontFetcher,
} from "./native-acceptance";
import { themeScopeFromEditorPath, type ThemeScope } from "./native-compat";

/**
 * M3 stage 1, the newsletter acceptance (handoff 2026-11-26
 * m3-reshow-plan.md): a CMS Page whose published revision hides a section
 * Morph cannot prove a Theme publish leaves out.
 *
 *   1. The Theme publish is refused, naming the Page and the section with
 *      "Show again". The active release is unchanged.
 *   2. Show again changes the Page's draft only. Before anything is
 *      republished the public page is unchanged.
 *   3. The Page is published, then the Theme: the newsletter is back on the
 *      public page with the same content it had before it was hidden.
 *
 * "The public page" is Core's public content answer for `/pages/<handle>` on
 * the storefront's own hostname, the content the page renders from, with the
 * release that answered named in its ETag (`servedRelease`).
 *
 * Container transport only: a Theme publish needs a build, and builds run in
 * the Sandbox container. Runs on a Theme of its own in the runner-owned
 * database, as section-visibility-layout.spec.ts does.
 */
const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;

test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Needs the runner-owned throwaway store.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "Publishing builds in the Sandbox container; run with MORPH_E2E_TRANSPORT=cloudflare-sandbox.",
);

const PAGES = "/src/server/storefront/storefront-pages.serverFn.ts";
const HOST = "m3-show-again.localhost";
const HANDLE = `newsletter-${randomUUID().slice(0, 8)}`;
const PAGE_PATH = `/pages/${HANDLE}`;
/** The newsletter's content, which no component default can produce. */
const NEWSLETTER = {
  heading: `Join the list ${randomUUID()}`,
  body: `Monthly, never more. ${randomUUID()}`,
};

type PageDocument = {
  version: number;
  handle?: string;
  sections: Array<{
    id: string;
    type: string;
    enabled?: boolean;
    props?: Record<string, unknown>;
  }>;
};
type PageDetail = {
  id: string;
  title: string;
  handle: string;
  version: number;
  document: PageDocument;
  publishedRevisionId: string | null;
};
type ContentAnswer = {
  slots: Record<string, Record<string, unknown>>;
  hiddenSlots: string[];
};

let scope: ThemeScope | null = null;
let editorPath = "";
let origin = "";
let domainId: string | null = null;
let pageId = "";
/** The release live before the hide, and the public page it served. */
let liveRelease = "";
let publicBefore: ContentAnswer | null = null;

async function pageDetail(page: Page): Promise<PageDetail> {
  const read = (await serverFn(page, PAGES, "getStorefrontPage", {
    id: pageId,
  })) as { success: boolean; message?: string; data: PageDetail };
  expect(read.success, read.message).toBe(true);
  return read.data;
}

async function savePage(
  page: Page,
  values: { title: string; document: PageDocument; publish: boolean },
) {
  const current = await pageDetail(page);
  const saved = (await serverFn(page, PAGES, "updateStorefrontPage", {
    id: pageId,
    title: values.title,
    handle: HANDLE,
    document: values.document,
    publish: values.publish,
    expectedDraftVersion: current.version,
  })) as { success: boolean; message?: string };
  expect(saved.success, saved.message).toBe(true);
}

/** The public page's content answer, and the release Core answered it from. */
async function publicPage(): Promise<{ release: string; answer: ContentAnswer }> {
  const release = await servedRelease(origin, PAGE_PATH);
  const read = await storefrontFetcher(origin)(
    `/_morph/content?path=${encodeURIComponent(PAGE_PATH)}`,
  );
  expect(read.status).toBe(200);
  const parsed = JSON.parse(read.body) as ContentAnswer;
  // What the page renders: its slots and which are hidden.
  return {
    release,
    answer: { slots: parsed.slots, hiddenSlots: [...parsed.hiddenSlots].sort() },
  };
}

/** The storefront's active release and release count, read from D1. */
function liveState() {
  const [row] = queryLocalD1<{ active: string | null; releases: number }>(
    `SELECT (SELECT active_release_id FROM storefronts WHERE id = '${scope!.storefrontId}') AS active,
            (SELECT COUNT(*) FROM storefront_releases WHERE storefront_id = '${scope!.storefrontId}') AS releases`,
  );
  return row!;
}

const newsletterOf = (document: PageDocument) =>
  document.sections.find((section) => section.id === "newsletter");

test.describe("a hidden CMS Page section refused at publish, shown again", () => {
  test.describe.configure({ mode: "serial" });
  // Each Theme publish may build the whole workspace in a container.
  test.setTimeout(20 * 60_000);

  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    try {
      await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
      scope = {
        ...themeScopeFromEditorPath(EDITOR_PATH!),
        themeId: randomUUID(),
      };
      insertThrowawayTheme({
        themeId: scope.themeId,
        storefrontId: scope.storefrontId,
        name: `m3-show-again-${scope.themeId}`,
        previewRuntime: specPreviewRuntime(),
      });
      const editor = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
        ...scope,
      })) as {
        success: boolean;
        data?: { templates: Array<{ id: string; type: string }> };
      };
      expect(editor.success, JSON.stringify(editor)).toBe(true);
      const home = editor.data!.templates.find((t) => t.type === "index");
      expect(home, "the Theme has a home template").toBeDefined();
      editorPath = `/store/${scope.storefrontId}/themes/${scope.themeId}/editor?templateId=${home!.id}`;

      const domain = (await serverFn(page, DOMAINS, "createStorefrontDomain", {
        storefrontId: scope.storefrontId,
        hostname: HOST,
      })) as { success: boolean; message?: string; data?: { id: string } };
      expect(domain.success, domain.message).toBe(true);
      domainId = domain.data!.id;
      origin = `http://${HOST}:${new URL(test.info().project.use.baseURL!).port}`;

      // The Page, published with its newsletter shown.
      const created = (await serverFn(page, PAGES, "createStorefrontPage", {
        title: "Newsletter",
        handle: HANDLE,
        publish: false,
      })) as { success: boolean; message?: string; data?: { id: string } };
      expect(created.success, created.message).toBe(true);
      pageId = created.data!.id;
      await savePage(page, {
        title: "Newsletter",
        publish: true,
        document: {
          version: 1,
          sections: [
            {
              id: "newsletter",
              type: "newsletter",
              enabled: true,
              props: { ...NEWSLETTER },
            },
          ],
        },
      });
    } finally {
      await page.context().close();
    }
  });

  test.afterAll(async ({ browser }) => {
    if (!domainId) return;
    const page = await signedInPage(browser);
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      // As b1-route-publish-rollback-acceptance.spec.ts: the local stand-in
      // domain has no Cloudflare custom domain, and a primary domain cannot
      // be deleted.
      execLocalD1(
        `UPDATE storefront_domains SET is_primary = 0, cloudflare_domain_id = NULL WHERE id = '${domainId}';`,
      );
      const removed = (await serverFn(page, DOMAINS, "deleteStorefrontDomains", {
        ids: [domainId],
      })) as { success: boolean; message?: string };
      expect(removed.success, removed.message).toBe(true);
    } finally {
      await page.context().close();
    }
  });

  test("the newsletter is live, then hidden in the Page's published revision", async ({
    page,
  }) => {
    await openEditor(page, editorPath);
    const first = await publishShowingRelease(page);
    await first.close();
    liveRelease = liveState().active!;
    expect(liveRelease).toBeTruthy();
    const live = await publicPage();
    expect(live.release).toBe(liveRelease);
    expect(live.answer.slots.newsletter).toEqual(NEWSLETTER);
    expect(live.answer.hiddenSlots).not.toContain("newsletter");
    publicBefore = live.answer;

    // The legacy state: a Page revision published with the newsletter
    // hidden, from before Pages refused new hides. Written as a new
    // revision, so the live one keeps its content.
    const detail = await pageDetail(page);
    const hidden = structuredClone(detail.document);
    newsletterOf(hidden)!.enabled = false;
    const revisionId = randomUUID();
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const now = new Date().toISOString();
    execLocalD1(`
      INSERT INTO storefront_page_revisions (id, page_id, version, document, created_by, created_at, published_at)
        VALUES (${quote(revisionId)}, ${quote(pageId)}, ${detail.version + 1}, ${quote(JSON.stringify(hidden))}, 'm3-e2e-legacy', ${quote(now)}, ${quote(now)});
      UPDATE storefront_pages SET draft_revision_id = ${quote(revisionId)}, published_revision_id = ${quote(revisionId)}, updated_at = ${quote(now)}
        WHERE id = ${quote(pageId)};
    `);
    expect(newsletterOf((await pageDetail(page)).document)?.enabled).toBe(false);

    // The merchant edits the Page's title and publishes the Page.
    await savePage(page, {
      title: "Newsletter (edited)",
      document: (await pageDetail(page)).document,
      publish: true,
    });
    // Still the release from before: a Page goes live with a Theme publish.
    expect((await publicPage()).answer).toEqual(publicBefore);
  });

  test("1 and 2. the Theme publish is refused and the active release is unchanged; Show again changes only the Page's draft", async ({
    page,
  }) => {
    expect(publicBefore, "the first test ran").not.toBeNull();
    const before = liveState();
    const refusal = page.locator("[data-publish-hidden-sections]");
    const row = refusal.locator('[data-hidden-section-id="newsletter"]');

    await test.step("1. publish: refused, naming the Page and the section", async () => {
      await openEditor(page, editorPath);
      // Something of the Theme's own to publish, so Publish is offered.
      await editHero(page, `m3-show-again-${randomUUID()}`);
      await openPublish(page);
      await expect(refusal).toBeVisible({ timeout: 12 * 60_000 });
      await expect(row).toContainText(
        `the Page "Newsletter (edited)" (${PAGE_PATH})`,
      );
      await expect(row.getByRole("button", { name: "Show again" })).toBeVisible();
      await expect(refusal).toContainText("The live site is unchanged.");

      // Assertion 1: the active release is the one from before, and no
      // release was added.
      expect(liveState()).toEqual(before);
      expect(before.active).toBe(liveRelease);
      // Assertion 2, before Show again: the public page is unchanged.
      const now = await publicPage();
      expect(now.release).toBe(liveRelease);
      expect(now.answer).toEqual(publicBefore);
    });

    await test.step("2. Show again: only the draft's visibility changes; the public page is unchanged", async () => {
      const draftBefore = await pageDetail(page);
      await row.getByRole("button", { name: "Show again" }).click();
      await expect(row).toContainText(
        "Publish the Page first, then publish the Theme again.",
        { timeout: 30_000 },
      );
      const link = row.getByRole("link", { name: /Open the Page/ });
      await expect(link).toHaveAttribute(
        "href",
        `/dashboard/pages/${pageId}/edit`,
      );
      await expect(link).toHaveAttribute("target", "_blank");

      const after = await pageDetail(page);
      expect(after.version).toBeGreaterThan(draftBefore.version);
      const expected = structuredClone(draftBefore.document);
      newsletterOf(expected)!.enabled = true;
      expect(after.document).toEqual(expected);
      expect(newsletterOf(after.document)?.props).toEqual(NEWSLETTER);
      // Nothing was published.
      expect(after.publishedRevisionId).toBe(draftBefore.publishedRevisionId);
      expect(liveState()).toEqual(before);
      // Assertion 2, before the republish: the public page is unchanged.
      const now = await publicPage();
      expect(now.release).toBe(liveRelease);
      expect(now.answer).toEqual(publicBefore);

      await refusal.getByRole("button", { name: "Close" }).last().click();
      await expect(refusal).toBeHidden();
    });
  });

  test("3. Page published, then the Theme: the newsletter is back with the same content", async ({
    page,
  }) => {
    // Server functions are called from an app page, not about:blank.
    await openEditor(page, editorPath);
    const draft = await pageDetail(page);
    expect(newsletterOf(draft.document)?.enabled).toBe(true);
    // The Page first, as the refusal said; then the Theme.
    await savePage(page, {
      title: draft.title,
      document: draft.document,
      publish: true,
    });
    await editHero(page, `m3-show-again-${randomUUID()}`);
    const republished = await publishShowingRelease(page);
    await republished.close();

    const state = liveState();
    expect(state.active).not.toBe(liveRelease);
    const now = await publicPage();
    expect(now.release).toBe(state.active);
    expect(now.answer.hiddenSlots).not.toContain("newsletter");
    expect(now.answer.slots.newsletter).toEqual(NEWSLETTER);
    // The same public content as before the hide.
    expect(now.answer).toEqual(publicBefore);

    // The title is updated, and every revision since the newsletter was
    // added kept its content: the first save, the legacy hide, the title
    // edit, Show again and the Page publish. Only the revision the Page was
    // created with comes before it.
    const published = await pageDetail(page);
    expect(published.title).toBe("Newsletter (edited)");
    const revisions = queryLocalD1<{ version: number; document: string }>(
      `SELECT version, document FROM storefront_page_revisions WHERE page_id = '${pageId}' ORDER BY version`,
    ).map((revision) => ({
      version: revision.version,
      newsletter: newsletterOf(JSON.parse(revision.document) as PageDocument),
    }));
    const firstWithNewsletter = revisions.findIndex((r) => r.newsletter);
    expect(firstWithNewsletter, "the newsletter was added by the first save").toBe(1);
    const since = revisions.slice(firstWithNewsletter);
    expect(since.length).toBeGreaterThanOrEqual(5);
    for (const revision of since) {
      expect(
        revision.newsletter?.props,
        `revision ${revision.version} kept the newsletter's content`,
      ).toEqual(NEWSLETTER);
    }
    expect(since.map((r) => r.newsletter?.enabled)).toEqual([
      true,
      false,
      false,
      true,
      true,
    ]);
  });
});
