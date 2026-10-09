import { randomUUID } from "node:crypto";

import { expect, test, type Frame, type Page } from "@playwright/test";

import { EDITOR_PATH } from "./helpers";
import {
  BUILDS,
  BUILD_PREVIEW,
  DOMAINS,
  RELEASES,
  THEMES,
  countPosts,
  editorContext,
  latestRelease,
  openEditor,
  openPublish,
  publishShowingRelease,
  savedField,
  serverFn,
  serverFnPaths,
  signedInPage,
  storefrontFetcher,
  storefrontHarness,
  writeDraftField,
  type Fetcher,
} from "./native-acceptance";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
} from "./native-compat";
import { astroConfig } from "../src/lib/storefront/theme-framework/astro-native-prerender.fixtures";

/**
 * G0's acceptance, for an Astro site (docs/astro-theme-plan.md A5): a build
 * and the CMS content it was sealed with stay paired through Build Preview,
 * publish, a refused stale publish, a concurrent draft change and rollback.
 *
 * The site is recorded as Astro straight in this run's D1: nothing in the
 * product records a framework yet (multi-runtime step 6 chooses it when a
 * site is created). The server builds Astro only with `MORPH_ASTRO_THEMES=1`.
 * Astro has no Live Preview yet (A6), so drafts are written through the
 * editor's own draft write, the one every field edit sends, and nothing is
 * edited on the canvas.
 *
 * The project's own `astro.config.mjs`, with no Wrangler config: the
 * adapter's defaults, `session: false` (the adapter's default `SESSION`
 * binding is refused at build time). Two pages read the home page's CMS
 * content the way an Astro Theme does, from `x-morph-content-origin`:
 * - `/astro-check`, server-rendered per request, carrying the code marker;
 * - `/`, the home page itself, prerendered at build time, which makes every
 *   build of this site depend on its content. A prerendered page reads only
 *   the sealed content of a static path its own build has
 *   (`NATIVE_PRERENDER_PATH_NOT_SEALED` otherwise; docs/astro-theme-plan.md
 *   4.3), so it is the page whose content it shows.
 *
 * Container transport only, and the local deployer, as in
 * native-publish-acceptance.spec.ts.
 */
const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Run through scripts/run-editor-e2e.mjs: this reads the run's own D1 and R2.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "The Astro build runs in the Sandbox container; run with MORPH_E2E_TRANSPORT=cloudflare-sandbox.",
);
test.skip(
  process.env.MORPH_ASTRO_THEMES !== "1",
  "Astro is built only where the server sets MORPH_ASTRO_THEMES=1.",
);

const scope = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
const HOST = "astro-accept.localhost";
const ROUTE = "/astro-check";
/** Prerendered, so it reads only its own path's sealed content (4.3). */
const SSG_ROUTE = "/";
const SSG_FILE = "src/pages/index.astro";
const HOME_CONTENT = "/_morph/content?path=%2F";

/** The Theme's own reader: the home page's slots, or none on any failure. */
const READER = `export async function homeSlots(request: Request): Promise<unknown> {
  const origin = request.headers.get("x-morph-content-origin");
  if (!origin) return null;
  try {
    const response = await fetch(origin + "/_morph/content?path=%2F");
    if (!response.ok) return null;
    return (await response.json())?.slots ?? null;
  } catch {
    return null;
  }
}
`;
const ssrPage = (marker: string) => `---
import { homeSlots } from "../morph/astro-acceptance";
export const prerender = false;
const slots = await homeSlots(Astro.request);
---
<html><body><main data-astro-check=${JSON.stringify(marker)} data-home-content={JSON.stringify(slots)}>${marker}</main></body></html>
`;
const SSG_PAGE = `---
import { homeSlots } from "../morph/astro-acceptance";
export const prerender = true;
const slots = await homeSlots(Astro.request);
const renderedAt = String(Date.now());
---
<html><body><main data-rendered-at={renderedAt} data-home-content={JSON.stringify(slots)} /></body></html>
`;
const OWN_PATHS = [
  "astro.config.mjs",
  "src/morph/astro-acceptance.ts",
  `src/pages${ROUTE}.astro`,
  SSG_FILE,
];
const themeFiles = (marker: string) => [
  { path: "astro.config.mjs", content: astroConfig() },
  { path: "src/morph/astro-acceptance.ts", content: READER },
  { path: `src/pages${ROUTE}.astro`, content: ssrPage(marker) },
  { path: SSG_FILE, content: SSG_PAGE },
];

const renderedAt = (html: string) =>
  /data-rendered-at="(\d+)"/.exec(html)?.[1] ?? null;

/**
 * The SSR page, the static page and the content endpoint carry exactly the
 * expected code and content: `content` is present, everything in `absent` is
 * not.
 */
async function expectServed(
  get: Fetcher,
  expected: { code: string; content: string; absent: readonly string[] },
) {
  const ssr = await get(ROUTE);
  const ssg = await get(SSG_ROUTE);
  const ssgAgain = await get(SSG_ROUTE);
  const content = await get(HOME_CONTENT);

  expect(ssr.status, ssr.body.slice(0, 500)).toBe(200);
  expect(ssr.body).toContain(`data-astro-check="${expected.code}"`);
  expect(ssr.body, "SSR renders the CMS content").toContain(expected.content);

  expect(ssg.status, ssg.body.slice(0, 500)).toBe(200);
  expect(ssg.body, "the static page carries the CMS content").toContain(
    expected.content,
  );
  // Static: rendered once at build time, so two requests see one render.
  expect(renderedAt(ssg.body)).not.toBeNull();
  expect(renderedAt(ssgAgain.body)).toBe(renderedAt(ssg.body));

  expect(content.status).toBe(200);
  expect(content.body).toContain(expected.content);

  for (const other of expected.absent) {
    expect(ssr.body).not.toContain(other);
    expect(ssg.body).not.toContain(other);
    expect(content.body).not.toContain(other);
  }
}

/** Fetches from inside a page on a Build Preview host. */
function previewFetcher(target: () => Page | Frame): Fetcher {
  return (path) =>
    target().evaluate(async (path) => {
      const response = await fetch(path, { cache: "no-store" });
      return { status: response.status, body: await response.text() };
    }, path);
}

/**
 * The home page's hero heading, as the draft holds it: the Starter's
 * `starter-hero` slot (`hero` in older Themes).
 */
async function heroDraft(page: Page) {
  const context = await editorContext(page, scope!);
  for (const template of context.templates) {
    const hero = template.document.sections.find(
      (section) => section.id === "hero" || section.id.endsWith("-hero"),
    );
    if (hero) return { template, sectionId: hero.id, key: "heading" };
  }
  throw new Error(
    `no template has a hero section: ${JSON.stringify(
      context.templates.map((template) =>
        template.document.sections.map((section) => section.id),
      ),
    )}`,
  );
}

test.describe("an Astro site, from Code to a rolled-back storefront", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(40 * 60_000);
  test.use({ actionTimeout: 60_000 });

  const harness = STATE_DIR
    ? storefrontHarness({ scope: scope!, stateDir: STATE_DIR })
    : null;
  let domainId: string | null = null;

  test.afterAll(async ({ browser }) => {
    // The site goes back to recording nothing, for the specs after this one.
    await harness?.writeD1(
      "UPDATE storefront_themes SET framework = NULL WHERE id = ?1 AND storefront_id = ?2",
      scope!.themeId,
      scope!.storefrontId,
    );
    await harness?.dispose();
    const page = await signedInPage(browser);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (domainId) {
      await serverFn(page, DOMAINS, "deleteStorefrontDomains", {
        ids: [domainId],
      });
    }
    const removed = await removeThemeFiles(page, scope!, OWN_PATHS);
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    await page.context().close();
  });

  test("keeps each Astro build paired with its sealed content through publish, a stale publish, a concurrent edit and rollback", async ({
    page,
    browser,
  }) => {
    const v1 = `astro-v1-${randomUUID()}`;
    const v2 = `astro-v2-${randomUUID()}`;
    const contentA = `astro-content-a-${randomUUID()}`;
    const contentB = `astro-content-b-${randomUUID()}`;
    const contentC = `astro-content-c-${randomUUID()}`;
    const contentD = `astro-content-d-${randomUUID()}`;
    const origin = `http://${HOST}:${new URL(test.info().project.use.baseURL!).port}`;
    const storefront = storefrontFetcher(origin);
    const { serveActiveRelease, publishedState, releaseBuild, writeD1 } =
      harness!;

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const paths = await serverFnPaths(page);
    const posts = countPosts(page, paths);

    // 0. The site is recorded as Astro, here only.
    expect(
      await writeD1(
        "UPDATE storefront_themes SET framework = 'astro' WHERE id = ?1 AND storefront_id = ?2",
        scope!.themeId,
        scope!.storefrontId,
      ),
    ).toBe(1);
    expect((await editorContext(page, scope!)) as unknown).toMatchObject({
      theme: { framework: "astro" },
    });

    // 1. The project, saved through Code; draft A.
    const cleared = await removeThemeFiles(page, scope!, OWN_PATHS);
    expect(cleared.success, JSON.stringify(cleared)).toBe(true);
    const saved = await writeThemeFiles(page, scope!, themeFiles(v1));
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await writeDraftField(page, scope!, await heroDraft(page), contentA);
    await savedField(page, scope!, contentA);
    await openEditor(page);

    // 2. Built from the toolbar in the container, sealing draft A; the
    //    isolated Build Preview runs that build and shows A.
    const build = page.locator("button[data-editor-build-action]");
    await expect(build).toBeEnabled({ timeout: 30_000 });
    await build.click();
    await expect(build).toHaveAttribute("data-build-pending", "true", {
      timeout: 30_000,
    });
    await expect(build).toHaveAttribute("data-build-pending", "false", {
      timeout: 9 * 60_000,
    });
    expect(posts.build).toBe(1);
    // The build it made, as recorded: built as Astro, and why not if not.
    const listed = (await serverFn(page, BUILDS, "listThemeBuilds", {
      ...scope!,
      limit: 1,
    })) as {
      success: boolean;
      data: Array<{
        status: string;
        framework: string | null;
        errorMessage: string | null;
      }>;
    };
    expect(listed.success).toBe(true);
    expect(listed.data[0], JSON.stringify(listed.data[0])).toMatchObject({
      status: "succeeded",
      framework: "astro",
    });
    const frame = page.locator('iframe[data-build-preview="isolated"]');
    await expect(frame).toBeVisible({ timeout: 60_000 });
    const previewHost = new URL((await frame.getAttribute("src"))!).hostname;
    const isolated = () =>
      page.frame({ url: (url) => url.hostname === previewHost });
    await expect.poll(isolated, { timeout: 120_000 }).toBeTruthy();
    await expectServed(previewFetcher(() => isolated()!), {
      code: v1,
      content: contentA,
      absent: [],
    });
    await page.keyboard.press("Escape");
    await expect(frame).toBeHidden({ timeout: 30_000 });

    // 3. Published, reusing that build: the release it shows carries v1
    //    and A, and the storefront serves it.
    const shown1 = await publishShowingRelease(page);
    expect(posts.build, "publish reuses the previewed build").toBe(1);
    await expectServed(shown1.fetch, { code: v1, content: contentA, absent: [] });
    await shown1.close();
    const release1 = await latestRelease(page, scope!);
    expect((await releaseBuild(release1)).dependency).toBe("dependent");
    const domain = (await serverFn(page, DOMAINS, "createStorefrontDomain", {
      storefrontId: scope!.storefrontId,
      hostname: HOST,
    })) as { success: boolean; message?: string; data?: { id: string } };
    expect(domain.success, domain.message).toBe(true);
    domainId = domain.data!.id;

    const published1 = await serveActiveRelease(contentA, release1, origin);
    const built1 = (await serverFn(page, BUILDS, "getThemeBuild", {
      ...scope!,
      buildId: published1.buildId,
    })) as {
      success: boolean;
      data: {
        framework: string | null;
        compilerId: string;
        manifestJson: {
          artifactEntry: string;
          runtime?: { kind: string; workerEntry?: string; previewEntry?: string };
        };
      };
    };
    // Recorded and built as Astro: Astro's own Worker entry, no preview page.
    expect(built1.success).toBe(true);
    expect(built1.data.framework).toBe("astro");
    expect(built1.data.compilerId).toBe("astro-native");
    expect(built1.data.manifestJson.artifactEntry).toBe(
      "runtime/server/entry.mjs",
    );
    expect(built1.data.manifestJson.runtime).toMatchObject({
      kind: "cloudflare-worker",
      workerEntry: "runtime/server/entry.mjs",
    });
    expect(built1.data.manifestJson.runtime?.previewEntry).toBeUndefined();

    await expectServed(storefront, { code: v1, content: contentA, absent: [] });
    expect((await storefront(`/no-such-page-${randomUUID()}`)).status).toBe(
      404,
    );

    // 4. Draft B, not built. Build A's preview, opened again, still shows
    //    A: a stale build's preview does not read the newer draft.
    await writeDraftField(
      page,
      scope!,
      await savedField(page, scope!, contentA),
      contentB,
    );
    const reopened = (await serverFn(page, BUILD_PREVIEW, "openBuildPreview", {
      ...scope!,
      buildId: published1.buildId,
    })) as { success: boolean; message?: string; data: { url: string } };
    expect(reopened.success, reopened.message).toBe(true);
    const previewA = await signedInPage(browser);
    await previewA.goto(reopened.data.url, { waitUntil: "domcontentloaded" });
    await expectServed(previewFetcher(() => previewA), {
      code: v1,
      content: contentA,
      absent: [contentB],
    });
    await previewA.context().close();

    // 5. Draft B, and a publish that names build A: refused by the content
    //    check, before anything is written.
    const beforeStale = await publishedState();
    expect(beforeStale.active).toBe(release1);
    const fieldB = await savedField(page, scope!, contentB);
    const draftB = await editorContext(page, scope!);
    const stale = (await serverFn(
      page,
      THEMES,
      "publishStorefrontThemeTemplate",
      {
        ...scope!,
        templateId: fieldB.template.id,
        sourceRevisionId: published1.sourceRevisionId,
        themeBuildId: published1.buildId,
        expectedDraftRevisionId: fieldB.template.draftRevisionId,
        expectedDraftGeneration: fieldB.template.draftGeneration,
        expectedReleaseGeneration: draftB.theme.releaseGeneration,
      },
    )) as { success: boolean; error?: string };
    expect(stale).toMatchObject({
      success: false,
      error: "PUBLISH_BUILD_CONTENT_MISMATCH",
    });
    expect(await publishedState()).toEqual(beforeStale);

    // 6. Code v2, then the toolbar publish of draft B: build A is not
    //    reused; B is built and published, and nothing mixes in A.
    const saved2 = await writeThemeFiles(page, scope!, [
      { path: `src/pages${ROUTE}.astro`, content: ssrPage(v2) },
    ]);
    expect(saved2.success, JSON.stringify(saved2)).toBe(true);
    await openEditor(page);
    const buildsBeforeB = posts.build;
    const shown2 = await publishShowingRelease(page);
    expect(posts.build, "draft B is built, not published on build A").toBe(
      buildsBeforeB + 1,
    );
    await expectServed(shown2.fetch, {
      code: v2,
      content: contentB,
      absent: [contentA],
    });
    await shown2.close();
    const release2 = await latestRelease(page, scope!);
    expect(release2).not.toBe(release1);
    expect((await releaseBuild(release2)).dependency).toBe("dependent");
    await serveActiveRelease(contentB, release2, origin);
    await expectServed(storefront, {
      code: v2,
      content: contentB,
      absent: [contentA],
    });

    // 7. Draft C after a reload, so the editor holds no build: the publish
    //    builds anew. Before that publish request reaches Core, another
    //    writer changes the draft to D; the final draft check (OCC on the
    //    draft generation) refuses it, and nothing is written.
    await writeDraftField(
      page,
      scope!,
      await savedField(page, scope!, contentB),
      contentC,
    );
    await openEditor(page);
    const writer = await signedInPage(browser);
    await writer.goto("/", { waitUntil: "domcontentloaded" });
    const beforeConcurrent = await publishedState();
    expect(beforeConcurrent.active).toBe(release2);
    let intercepted = 0;
    const isPublish = (url: URL) => url.pathname === paths.publish;
    await page.route(isPublish, async (route) => {
      if (route.request().method() === "POST" && intercepted === 0) {
        intercepted += 1;
        await writeDraftField(
          writer,
          scope!,
          await savedField(writer, scope!, contentC),
          contentD,
        );
      }
      await route.continue();
    });
    const buildsBeforeC = posts.build;
    const publishesBeforeC = posts.publish;
    const refused = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === paths.publish &&
        response.request().method() === "POST",
      { timeout: 9 * 60_000 },
    );
    await openPublish(page);
    expect(await (await refused).text()).toContain("TEMPLATE_DRAFT_CONFLICT");
    expect(intercepted).toBe(1);
    // No retry loop: one build of C, one publish attempt, and nothing more
    // while the editor settles.
    await page.waitForTimeout(20_000);
    expect(posts.build).toBe(buildsBeforeC + 1);
    expect(posts.publish).toBe(publishesBeforeC + 1);
    await expect(page.locator("[data-editor-save-status]")).not.toHaveAttribute(
      "aria-label",
      "Published",
    );
    await page.unroute(isPublish);
    expect(await publishedState()).toEqual(beforeConcurrent);
    await expectServed(storefront, {
      code: v2,
      content: contentB,
      absent: [contentC, contentD],
    });
    await savedField(writer, scope!, contentD);
    await writer.context().close();

    // 8. Rolled back to the first release: code and CMS content are A again.
    const rolledBack = (await serverFn(
      page,
      RELEASES,
      "activateStorefrontRelease",
      {
        storefrontId: scope!.storefrontId,
        releaseId: release1,
        expectedActiveReleaseId: release2,
      },
    )) as { success: boolean; message?: string };
    expect(rolledBack.success, rolledBack.message).toBe(true);
    const restored = await serveActiveRelease(contentA, release1, origin);
    expect(restored.buildId).toBe(published1.buildId);
    expect(restored.contentPublicationId).toBe(published1.contentPublicationId);
    await expectServed(storefront, {
      code: v1,
      content: contentA,
      absent: [v2, contentB, contentC, contentD],
    });
  });
});
