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
  editHero,
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

/**
 * The native Start build, accepted end to end on this machine
 * (docs/start-native-import-plan.md, step 1b-2 item 3): a build and the CMS
 * content it was sealed with stay paired through Build Preview, publish, a
 * refused stale publish, a concurrent draft change and rollback.
 *
 * A Theme that carries its own `vite.config.ts` and `wrangler.jsonc`, saved
 * through Code, with the native build switched on for this run
 * (`MORPH_NATIVE_START_BUILD=1` in `.dev.vars`). Two of its routes read the
 * home page's CMS content:
 * - `/native-check`, server-rendered per request, whose loader also calls a
 *   server function carrying the code marker;
 * - `/native-ssg`, prerendered by the project's own config at build time,
 *   which makes every build of this Theme depend on its content. The CMS
 *   policy stays SSR: a page the CMS itself marks SSG is still refused at
 *   publish, so this is the only kind of static page that can be published
 *   today.
 * Each is read together with Core's `/_morph/content` for the home page.
 * native-content-dependency.spec.ts covers a Theme whose builds do not
 * depend on content.
 *
 * Only builds with sealed content are covered: the toolbar build and the
 * build a publish makes both seal the draft. Other build entries are not
 * part of this guarantee.
 *
 * Container transport only (the build runs in the Sandbox container), and
 * the local deployer: `MORPH_ALLOW_LOCAL_DOMAIN_PROVISIONING=true` and
 * `MORPH_LOCAL_THEME_ORIGIN=http://127.0.0.1:8799`, so Core forwards a local
 * storefront hostname to the Worker this spec serves from the active
 * release's artifact, read back from this run's R2.
 */
const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Run through scripts/run-editor-e2e.mjs: this reads the run's own D1 and R2.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "The native build runs in the Sandbox container; run with MORPH_E2E_TRANSPORT=cloudflare-sandbox.",
);

const scope = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
const HOST = "native-accept.localhost";
const ROUTE = "/native-check";
const SSG_ROUTE = "/native-ssg";
const HOME_CONTENT = "/_morph/content?path=%2F";

/** The project's own build configuration; it prerenders `SSG_ROUTE`. */
const OWN_VITE_CONFIG = `import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart({
      prerender: { enabled: true, crawlLinks: false, autoStaticPathsDiscovery: false },
      pages: [{ path: ${JSON.stringify(SSG_ROUTE)} }],
    }),
    viteReact(),
  ],
});
`;
const OWN_WRANGLER = `{
  // The author's own deployment config.
  "name": "native-accept",
  "compatibility_date": "2025-09-02",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry",
}
`;
/**
 * A route whose loader calls a server function carrying `marker` and reads
 * the home page's content the way the Theme's own pages do.
 */
const nativeRoute = (
  marker: string,
) => `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { loadContentSlots } from "../morph/content";

const readMarker = createServerFn({ method: "GET" }).handler(async () => ({
  marker: ${JSON.stringify(marker)},
  runtime: typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
}));

export const Route = createFileRoute(${JSON.stringify(ROUTE)})({
  loader: async () => ({ ...(await readMarker()), home: await loadContentSlots("/") }),
  component: () => {
    const data = Route.useLoaderData();
    return (
      <main data-native-check={data.marker} data-home-content={JSON.stringify(data.home.slots)}>
        {data.marker} via {data.runtime}
      </main>
    );
  },
});
`;
/** Prerendered: the content it shows is whatever the build sealed. */
const SSG_PAGE = `import { createFileRoute } from "@tanstack/react-router";
import { loadContentSlots } from "../morph/content";

export const Route = createFileRoute(${JSON.stringify(SSG_ROUTE)})({
  loader: async () => ({ home: await loadContentSlots("/"), renderedAt: String(Date.now()) }),
  component: () => {
    const data = Route.useLoaderData();
    return <main data-rendered-at={data.renderedAt} data-home-content={JSON.stringify(data.home.slots)} />;
  },
});
`;
const OWN_PATHS = [
  "vite.config.ts",
  "wrangler.jsonc",
  `src/routes${ROUTE}.tsx`,
  `src/routes${SSG_ROUTE}.tsx`,
];
const themeFiles = (marker: string) => [
  { path: "vite.config.ts", content: OWN_VITE_CONFIG },
  { path: "wrangler.jsonc", content: OWN_WRANGLER },
  { path: `src/routes${ROUTE}.tsx`, content: nativeRoute(marker) },
  { path: `src/routes${SSG_ROUTE}.tsx`, content: SSG_PAGE },
];

const renderedAt = (html: string) =>
  /data-rendered-at="(\d+)"/.exec(html)?.[1] ?? null;

/**
 * The SSR route, the static page and the content endpoint carry exactly the
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

  expect(ssr.status).toBe(200);
  expect(ssr.body).toContain(`data-native-check="${expected.code}"`);
  expect(ssr.body, "SSR renders the CMS content").toContain(expected.content);

  expect(ssg.status).toBe(200);
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

test.describe("a native Start build, from Code to a rolled-back storefront", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(40 * 60_000);
  // One stuck click fails here instead of waiting out the whole test while
  // the signed-in session idles out under every spec that runs after it.
  test.use({ actionTimeout: 60_000 });

  const harness = STATE_DIR
    ? storefrontHarness({ scope: scope!, stateDir: STATE_DIR })
    : null;
  let domainId: string | null = null;

  test.afterAll(async ({ browser }) => {
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

  test("keeps each build paired with its sealed content through publish, a stale publish, a concurrent edit and rollback", async ({
    page,
    browser,
  }) => {
    const v1 = `native-v1-${randomUUID()}`;
    const v2 = `native-v2-${randomUUID()}`;
    const contentA = `content-a-${randomUUID()}`;
    const contentB = `content-b-${randomUUID()}`;
    const contentC = `content-c-${randomUUID()}`;
    const contentD = `content-d-${randomUUID()}`;
    const origin = `http://${HOST}:${new URL(test.info().project.use.baseURL!).port}`;
    const storefront = storefrontFetcher(origin);
    const { serveActiveRelease, publishedState, releaseBuild } = harness!;

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const paths = await serverFnPaths(page);
    const posts = countPosts(page, paths);

    // 1. The project's own configuration, saved through Code; draft A.
    const cleared = await removeThemeFiles(page, scope!, OWN_PATHS);
    expect(cleared.success, JSON.stringify(cleared)).toBe(true);
    const saved = await writeThemeFiles(page, scope!, themeFiles(v1));
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await openEditor(page);
    await editHero(page, contentA);

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
    const frame = page.locator('iframe[data-build-preview="isolated"]');
    await expect(frame).toBeVisible({ timeout: 60_000 });
    const previewHost = new URL((await frame.getAttribute("src"))!).hostname;
    const isolated = () =>
      page.frame({ url: (url) => url.hostname === previewHost });
    await expect.poll(isolated, { timeout: 120_000 }).toBeTruthy();
    await expectServed(
      previewFetcher(() => isolated()!),
      {
        code: v1,
        content: contentA,
        absent: [],
      },
    );
    await page.keyboard.press("Escape");
    await expect(frame).toBeHidden({ timeout: 30_000 });

    // 3. Published, reusing that build. The release it shows, and the
    //    storefront, carry v1 and A. No domain yet, so no live address.
    const shown1 = await publishShowingRelease(page);
    expect(posts.build, "publish reuses the previewed build").toBe(1);
    await expectServed(shown1.fetch, {
      code: v1,
      content: contentA,
      absent: [],
    });
    expect(shown1.liveSite).toBeNull();
    await shown1.close();
    const release1 = await latestRelease(page, scope!);
    // Its static page read the content while prerendering, so the build was
    // given it: the artifact depends on it.
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
        compilerId: string;
        manifestJson: {
          artifactEntry: string;
          runtime?: {
            kind: string;
            workerEntry?: string;
            previewEntry?: string;
          };
        };
      };
    };
    // The canonical manifest the artifact store keeps: a native artifact is
    // a Worker with no client-only preview page.
    expect(built1.success).toBe(true);
    expect(built1.data.compilerId).toBe("tanstack-start-native");
    expect(built1.data.manifestJson.artifactEntry).toBe(
      "runtime/server/index.js",
    );
    expect(built1.data.manifestJson.runtime).toMatchObject({
      kind: "cloudflare-worker",
      workerEntry: "runtime/server/index.js",
    });
    expect(built1.data.manifestJson.runtime?.previewEntry).toBeUndefined();

    await expectServed(storefront, { code: v1, content: contentA, absent: [] });
    const html1 = (await storefront(ROUTE)).body;
    const asset = /(?:href|src)="(\/assets\/[^"]+)"/.exec(html1)?.[1];
    expect(asset, "the page links a built asset").toBeTruthy();
    expect((await storefront(asset!)).status).toBe(200);
    expect((await storefront(`/no-such-page-${randomUUID()}`)).status).toBe(
      404,
    );

    // 4. Draft B, not built. Build A's preview, opened again, still shows
    //    A: a stale build's preview does not read the newer draft.
    await editHero(page, contentB);
    const reopened = (await serverFn(page, BUILD_PREVIEW, "openBuildPreview", {
      ...scope!,
      buildId: published1.buildId,
    })) as { success: boolean; message?: string; data: { url: string } };
    expect(reopened.success, reopened.message).toBe(true);
    const previewA = await signedInPage(browser);
    await previewA.goto(reopened.data.url, { waitUntil: "domcontentloaded" });
    await expectServed(
      previewFetcher(() => previewA),
      { code: v1, content: contentA, absent: [contentB] },
    );
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
    //    reused; B is built and published. Static page, SSR route and the
    //    content endpoint all show B; none mixes in A.
    //    Steps 6 and 7 publish without editing on the canvas, so they wait
    //    for the Publish control, not the Live Preview: a preview that does
    //    not come back after a source change is its own problem (kept and
    //    investigated separately), not this acceptance's.
    const saved2 = await writeThemeFiles(page, scope!, [
      { path: `src/routes${ROUTE}.tsx`, content: nativeRoute(v2) },
    ]);
    expect(saved2.success, JSON.stringify(saved2)).toBe(true);
    await openEditor(page);
    const buildsBeforeB = posts.build;
    //    Shown once published, not when its build finished: the release, v2
    //    and B, with the store's live address.
    const shown2 = await publishShowingRelease(page);
    expect(posts.build, "draft B is built, not published on build A").toBe(
      buildsBeforeB + 1,
    );
    await expectServed(shown2.fetch, {
      code: v2,
      content: contentB,
      absent: [contentA],
    });
    expect(new URL(shown2.liveSite!).hostname).toBe(HOST);
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

    // 7. Draft C after a reload, so the editor holds no build: the static
    //    page bakes content in, so the release's build cannot take C and the
    //    publish builds anew. Before that publish request reaches Core,
    //    another writer changes the draft to D. The request still names
    //    draft C, which matches build C, so the content check passes; the
    //    final draft check (OCC on the draft generation) refuses it. This is
    //    the only timing driven end to end; the draft changing while Core is
    //    already processing is covered by storefront-theme.dal.test.ts
    //    ("final draft check"). Draft C is written through the editor's own
    //    draft write, the one every field edit sends (steps 1 and 4 drove it
    //    from the canvas).
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
    // Nothing of it was written: the same active release, no new release and
    // no new content publication. The storefront still shows B; D is the
    // draft.
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
