import { randomUUID } from "node:crypto";

import { expect, test, type Frame, type Page } from "@playwright/test";

import { EDITOR_PATH } from "./helpers";
import {
  BUILDS,
  BUILD_PREVIEW,
  THEMES,
  countPosts,
  editHero,
  editorContext,
  openEditor,
  openPublish,
  savedField,
  serverFn,
  serverFnPaths,
  signedInPage,
  storefrontHarness,
  type Fetcher,
} from "./native-acceptance";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
} from "./native-compat";

/**
 * A native Start build that prerenders, accepted end to end on this machine
 * (docs/start-native-import-plan.md, step 1b-2 item 3): the build and the
 * CMS content it was sealed with stay paired through Build Preview and a
 * refused stale publish, and its production deployment is refused, because
 * step 1 of the native build contract is SSR only
 * (`NATIVE_HTML_ASSET_UNAVAILABLE`, render plan v2, design section 1): the
 * asset layer would answer the prerendered page before the Theme Worker and
 * Core. Publishing, a concurrent draft change and rollback of such a build
 * come back with native SSG (step 3); an SSR-only native Theme's publishing
 * is native-content-dependency.spec.ts.
 *
 * A Theme that carries its own `vite.config.ts` and `wrangler.jsonc`, saved
 * through Code, with the native build switched on for this run
 * (`MORPH_NATIVE_START_BUILD=1` in `.dev.vars`). Two of its routes read the
 * home page's CMS content:
 * - `/native-check`, server-rendered per request, whose loader also calls a
 *   server function carrying the code marker;
 * - `/native-ssg`, prerendered by the project's own config at build time,
 *   which makes every build of this Theme depend on its content.
 * Each is read together with Core's `/_morph/content` for the home page.
 *
 * Only builds with sealed content are covered: the toolbar build and the
 * build a publish makes both seal the draft. Other build entries are not
 * part of this guarantee.
 *
 * Container transport only (the build runs in the Sandbox container), and
 * the local deployer (`MORPH_LOCAL_THEME_ORIGIN`), whose publish plans the
 * same production deployment a real one does.
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

test.describe("a native Start build that prerenders, from Code to a refused publish", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(40 * 60_000);
  // One stuck click fails here instead of waiting out the whole test while
  // the signed-in session idles out under every spec that runs after it.
  test.use({ actionTimeout: 60_000 });

  const harness = STATE_DIR
    ? storefrontHarness({ scope: scope!, stateDir: STATE_DIR })
    : null;

  test.afterAll(async ({ browser }) => {
    await harness?.dispose();
    const page = await signedInPage(browser);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const removed = await removeThemeFiles(page, scope!, OWN_PATHS);
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    await page.context().close();
  });

  test("keeps the build paired with its sealed content in Build Preview, and refuses to publish its static HTML", async ({
    page,
    browser,
  }) => {
    const v1 = `native-v1-${randomUUID()}`;
    const contentA = `content-a-${randomUUID()}`;
    const contentB = `content-b-${randomUUID()}`;
    const { publishedState } = harness!;

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
    //    isolated Build Preview runs that build and shows A, static page
    //    included: Build Preview serves every file the build wrote.
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

    // The build's canonical manifest: a native Worker artifact with no
    // client-only preview page, carrying the SDK resolution proof and naming
    // the static page it prerendered.
    const listed = (await serverFn(page, BUILDS, "listThemeBuilds", {
      ...scope!,
      limit: 1,
    })) as {
      success: boolean;
      data: Array<{
        id: string;
        sourceRevisionId: string;
        compilerId: string;
        compilerVersion: string;
        manifestJson: {
          artifactEntry: string;
          runtime?: {
            kind: string;
            workerEntry?: string;
            previewEntry?: string;
            nativeProof?: {
              version: string;
              sdk: { environments: Array<{ output: string; specifiers: string[] }> };
              html: Array<{ path: string; source: string }>;
            };
          };
        };
      }>;
    };
    expect(listed.success).toBe(true);
    const buildA = listed.data[0]!;
    expect(buildA.compilerId).toBe("tanstack-start-native");
    expect(buildA.compilerVersion).toMatch(/\.hide-\d+\.np-1$/);
    expect(buildA.manifestJson.artifactEntry).toBe("runtime/server/index.js");
    expect(buildA.manifestJson.runtime).toMatchObject({
      kind: "cloudflare-worker",
      workerEntry: "runtime/server/index.js",
    });
    expect(buildA.manifestJson.runtime?.previewEntry).toBeUndefined();
    const proof = buildA.manifestJson.runtime?.nativeProof;
    expect(proof?.version).toBe("np-1");
    expect(
      proof?.sdk.environments.find((entry) => entry.output === "server")
        ?.specifiers,
    ).toContain("@morph/sdk/start");
    expect(proof?.html).toContainEqual({
      path: `runtime/client${SSG_ROUTE}/index.html`,
      source: "prerender",
    });

    // 3. Published from the toolbar: the publish reuses build A, which is
    //    refused before the publish writes anything. Step 1 of the native
    //    build is SSR only: the asset layer would answer the prerendered page
    //    before the Theme Worker and Core (native SSG is step 3). No release,
    //    no content publication, and the active pointer never moves (the
    //    DAL test watches the pointer itself: storefront-theme.dal.test.ts).
    const beforePublish = await publishedState();
    const refusedPublish = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === paths.publish &&
        response.request().method() === "POST",
      { timeout: 9 * 60_000 },
    );
    await openPublish(page);
    const refusal = await (await refusedPublish).text();
    expect(refusal).toContain("PUBLISH_NATIVE_BUILD_REFUSED");
    expect(refusal).toContain("NATIVE_HTML_ASSET_UNAVAILABLE");
    // The response names the file and the path it would be served at.
    expect(refusal).toContain(
      `runtime/client${SSG_ROUTE}/index.html (prerendered) as ${SSG_ROUTE}/index.html`,
    );
    expect(refusal).not.toContain("RELEASE_DEPLOYMENT_FAILED");
    expect(posts.build, "publish reuses the previewed build").toBe(1);
    expect(posts.publish).toBe(1);
    await expect(page.locator("[data-editor-save-status]")).not.toHaveAttribute(
      "aria-label",
      "Published",
    );
    expect(await publishedState()).toEqual(beforePublish);

    // 4. Draft B, not built. Build A's preview, opened again, still shows
    //    A: a stale build's preview does not read the newer draft.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await openEditor(page);
    await editHero(page, contentB);
    const reopened = (await serverFn(page, BUILD_PREVIEW, "openBuildPreview", {
      ...scope!,
      buildId: buildA.id,
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
    //    check, before the deployment is even planned.
    const beforeStale = await publishedState();
    const fieldB = await savedField(page, scope!, contentB);
    const draftB = await editorContext(page, scope!);
    const stale = (await serverFn(
      page,
      THEMES,
      "publishStorefrontThemeTemplate",
      {
        ...scope!,
        templateId: fieldB.template.id,
        sourceRevisionId: buildA.sourceRevisionId,
        themeBuildId: buildA.id,
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
  });
});
