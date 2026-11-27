import { randomUUID } from "node:crypto";

import { expect, test, type Frame, type Page } from "@playwright/test";

import { EDITOR_PATH } from "./helpers";
import {
  BUILDS,
  DOMAINS,
  RELEASES,
  countPosts,
  editHero,
  latestRelease,
  liveSiteHost,
  openEditor,
  openPublish,
  primaryDomain,
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
 * An SSR-only native Start build (render plan v2 step 1), end to end on this
 * machine: published, published again with new code and content, a publish
 * whose draft changes before it reaches Core, and rollback, each checked on
 * the public storefront.
 *
 * The prerendering fixture (native-publish-acceptance.spec.ts) can no
 * longer be published in step 1 (`NATIVE_HTML_ASSET_UNAVAILABLE`); this one
 * carries what it used to cover for publishing. Its own `vite.config.ts`
 * prerenders nothing and it has no `public/` HTML, so its production
 * deployment passes the step 1 admission: an SDK resolution proof and no
 * static HTML. With nothing prerendered, no build reads content, so every
 * build is proven independent of it; the content-dependent pairing (a stale
 * build refused for newer content) is native-publish-acceptance.spec.ts's
 * Build Preview part and returns to publishing with native SSG (step 3).
 *
 * The native build switched on for this run (`MORPH_NATIVE_START_BUILD=1`),
 * container transport only, and the local deployer
 * (`MORPH_ALLOW_LOCAL_DOMAIN_PROVISIONING=true`,
 * `MORPH_LOCAL_THEME_ORIGIN=http://127.0.0.1:8799`): Core forwards a local
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
const HOST = "native-ssr-accept.localhost";
const ROUTE = "/native-ssr-check";
const HOME_CONTENT = "/_morph/content?path=%2F";

/** The guide's own build configuration: SSR only, nothing prerendered. */
const OWN_VITE_CONFIG = `import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});
`;
const OWN_WRANGLER = `{
  // The author's own deployment config.
  "name": "native-ssr-accept",
  "compatibility_date": "2025-09-02",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry",
  "observability": { "enabled": true },
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
}));

export const Route = createFileRoute(${JSON.stringify(ROUTE)})({
  loader: async () => ({ ...(await readMarker()), home: await loadContentSlots("/") }),
  component: () => {
    const data = Route.useLoaderData();
    return (
      <main data-native-check={data.marker} data-home-content={JSON.stringify(data.home.slots)}>
        {data.marker}
      </main>
    );
  },
});
`;
const OWN_PATHS = ["vite.config.ts", "wrangler.jsonc", `src/routes${ROUTE}.tsx`];
const themeFiles = (marker: string) => [
  { path: "vite.config.ts", content: OWN_VITE_CONFIG },
  { path: "wrangler.jsonc", content: OWN_WRANGLER },
  { path: `src/routes${ROUTE}.tsx`, content: nativeRoute(marker) },
];

/**
 * The SSR route and the content endpoint carry exactly the expected code and
 * content: `content` is present, everything in `absent` is not.
 */
async function expectServed(
  get: Fetcher,
  expected: { code: string; content: string; absent: readonly string[] },
) {
  const ssr = await get(ROUTE);
  const content = await get(HOME_CONTENT);
  expect(ssr.status).toBe(200);
  expect(ssr.body).toContain(`data-native-check="${expected.code}"`);
  expect(ssr.body, "SSR renders the CMS content").toContain(expected.content);
  expect(content.status).toBe(200);
  expect(content.body).toContain(expected.content);
  for (const other of expected.absent) {
    expect(ssr.body).not.toContain(other);
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

type BuildRecord = {
  success: boolean;
  data: {
    compilerId: string;
    compilerVersion: string;
    manifestJson: {
      runtime?: {
        kind: string;
        workerEntry?: string;
        nativeProof?: {
          version: string;
          sdk: { environments: Array<{ output: string; specifiers: string[] }> };
          html: unknown[];
        };
      };
    };
  };
};

test.describe("an SSR-only native Start build, from Code to a rolled-back storefront", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(40 * 60_000);
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

  test("publishes, publishes again, refuses a publish whose draft changed, and rolls back, on the public storefront", async ({
    page,
    browser,
  }) => {
    const v1 = `native-ssr-v1-${randomUUID()}`;
    const v2 = `native-ssr-v2-${randomUUID()}`;
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

    // 2. Built from the toolbar in the container; Build Preview shows v1, A.
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
    await expectServed(previewFetcher(() => isolated()!), {
      code: v1,
      content: contentA,
      absent: [],
    });
    await page.keyboard.press("Escape");
    await expect(frame).toBeHidden({ timeout: 30_000 });

    // 3. Published, reusing that build: it passes the step 1 production
    //    admission (proof, no static HTML). The release and the storefront
    //    carry v1 and A.
    const shown1 = await publishShowingRelease(page);
    expect(posts.build, "publish reuses the previewed build").toBe(1);
    await expectServed(shown1.fetch, { code: v1, content: contentA, absent: [] });
    expect(liveSiteHost(shown1)).toBe(await primaryDomain(page));
    await shown1.close();
    const release1 = await latestRelease(page, scope!);
    // Nothing prerenders, so the build read no content: independent.
    expect((await releaseBuild(release1)).dependency).toBe("independent");
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
    })) as BuildRecord;
    expect(built1.success).toBe(true);
    expect(built1.data.compilerId).toBe("tanstack-start-native");
    expect(built1.data.compilerVersion).toMatch(/\.hide-\d+\.np-1$/);
    expect(built1.data.manifestJson.runtime).toMatchObject({
      kind: "cloudflare-worker",
      workerEntry: "runtime/server/index.js",
    });
    const proof = built1.data.manifestJson.runtime?.nativeProof;
    expect(proof?.version).toBe("np-1");
    expect(proof?.html).toEqual([]);
    expect(
      proof?.sdk.environments.find((entry) => entry.output === "server")
        ?.specifiers,
    ).toContain("@morph/sdk/start");

    await expectServed(storefront, { code: v1, content: contentA, absent: [] });
    const html1 = (await storefront(ROUTE)).body;
    const asset = /(?:href|src)="(\/assets\/[^"]+)"/.exec(html1)?.[1];
    expect(asset, "the page links a built asset").toBeTruthy();
    expect((await storefront(asset!)).status).toBe(200);
    expect((await storefront(`/no-such-page-${randomUUID()}`)).status).toBe(
      404,
    );

    // 4. Code v2 and draft B, published from the toolbar: the code changed,
    //    so B is built and published. The storefront shows v2 and B, with
    //    nothing of A.
    await editHero(page, contentB);
    const saved2 = await writeThemeFiles(page, scope!, [
      { path: `src/routes${ROUTE}.tsx`, content: nativeRoute(v2) },
    ]);
    expect(saved2.success, JSON.stringify(saved2)).toBe(true);
    await openEditor(page);
    const buildsBeforeB = posts.build;
    const shown2 = await publishShowingRelease(page);
    expect(posts.build, "new code is built, not published on build A").toBe(
      buildsBeforeB + 1,
    );
    await expectServed(shown2.fetch, {
      code: v2,
      content: contentB,
      absent: [contentA],
    });
    const primary2 = await primaryDomain(page);
    expect(primary2).not.toBeNull();
    expect(liveSiteHost(shown2)).toBe(primary2);
    await shown2.close();
    const release2 = await latestRelease(page, scope!);
    expect(release2).not.toBe(release1);
    await serveActiveRelease(contentB, release2, origin);
    await expectServed(storefront, {
      code: v2,
      content: contentB,
      absent: [contentA, v1],
    });

    // 5. Draft C after a reload, then a publish; before that publish request
    //    reaches Core, another writer changes the draft to D. The request
    //    still names draft C, so the final draft check (OCC on the draft
    //    generation) refuses it. Nothing is written and nothing retried: the
    //    storefront still shows v2 and B.
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
    // No retry loop: at most one build (build B already covers draft C, as
    // its build is independent of content) and exactly one publish attempt.
    await page.waitForTimeout(20_000);
    expect(posts.build - buildsBeforeC).toBeLessThanOrEqual(1);
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

    // 6. Rolled back to the first release: code and CMS content are A again
    //    on the storefront, and the release's build is build A.
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
