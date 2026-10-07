import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { EDITOR_PATH } from "./helpers";
import {
  DOMAINS,
  RELEASES,
  THEMES,
  countPosts,
  editHero,
  editorContext,
  latestRelease,
  openEditor,
  publish,
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
 * Content-only publishing on a native build that proved its artifact holds
 * no CMS content (start-native-import-plan, content dependency).
 *
 * The Theme's own config prerenders nothing; its one route reads the home
 * page's content per request. So its builds run once with no content in the
 * build at all and are recorded `independent`, and a content change can go
 * out on the release's build: SSR reads the new release's content. Proven
 * here, in real containers, against D1:
 *
 * 1. after a reload, an SSR-only content edit is published without a build,
 *    and the storefront shows it, as does the release preview the publish
 *    opens: the release's content, not the content build 1 was sealed with;
 * 2. rolling that content-only release back restores the earlier content;
 * 3. a build whose dependency is unknown (an older build) is held to its
 *    seal: a publish naming it with other content is refused, and the
 *    editor builds instead.
 *
 * A Theme whose static pages bake content in, and the concurrent and stale
 * cases, are native-publish-acceptance.spec.ts.
 *
 * Container transport only, with the local deployer, like that spec.
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
const HOST = "native-dep.localhost";
const ROUTE = "/dep-check";
const HOME_CONTENT = "/_morph/content?path=%2F";

/** The project's own build configuration; it prerenders nothing. */
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
  "name": "native-dep",
  "compatibility_date": "2025-09-02",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry",
}
`;
/** Server-rendered per request, reading the home page's content. */
const depRoute = (
  marker: string,
) => `import { createFileRoute } from "@tanstack/react-router";
import { loadContentSlots } from "../morph/content";

export const Route = createFileRoute(${JSON.stringify(ROUTE)})({
  loader: async () => ({ marker: ${JSON.stringify(marker)}, home: await loadContentSlots("/") }),
  component: () => {
    const data = Route.useLoaderData();
    return <main data-dep-check={data.marker} data-home-content={JSON.stringify(data.home.slots)} />;
  },
});
`;
const OWN_PATHS = [
  "vite.config.ts",
  "wrangler.jsonc",
  `src/routes${ROUTE}.tsx`,
];

/** The route and the content endpoint carry `content`, and nothing in `absent`. */
async function expectServed(
  get: Fetcher,
  expected: { code: string; content: string; absent: readonly string[] },
) {
  const ssr = await get(ROUTE);
  const content = await get(HOME_CONTENT);
  expect(ssr.status).toBe(200);
  expect(ssr.body).toContain(`data-dep-check="${expected.code}"`);
  expect(ssr.body, "SSR renders the CMS content").toContain(expected.content);
  expect(content.status).toBe(200);
  expect(content.body).toContain(expected.content);
  for (const other of expected.absent) {
    expect(ssr.body).not.toContain(other);
    expect(content.body).not.toContain(other);
  }
}

test.describe("content-only publishing on a build proven independent of content", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(30 * 60_000);
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

  test("publishes content without a build only where the build proved it holds none", async ({
    page,
  }) => {
    const code = `dep-code-${randomUUID()}`;
    const contentA = `dep-a-${randomUUID()}`;
    const contentB = `dep-b-${randomUUID()}`;
    const contentC = `dep-c-${randomUUID()}`;
    const origin = `http://${HOST}:${new URL(test.info().project.use.baseURL!).port}`;
    const storefront = storefrontFetcher(origin);
    const { serveActiveRelease, publishedState, releaseBuild, writeD1 } =
      harness!;

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const posts = countPosts(page, await serverFnPaths(page));

    // Content A, published: there is no build yet, so publishing builds,
    // sealing A. Nothing prerenders, so the build was proven independent.
    const cleared = await removeThemeFiles(page, scope!, OWN_PATHS);
    expect(cleared.success, JSON.stringify(cleared)).toBe(true);
    const saved = await writeThemeFiles(page, scope!, [
      { path: "vite.config.ts", content: OWN_VITE_CONFIG },
      { path: "wrangler.jsonc", content: OWN_WRANGLER },
      { path: `src/routes${ROUTE}.tsx`, content: depRoute(code) },
    ]);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await openEditor(page);
    await editHero(page, contentA);
    await publish(page);
    expect(posts.build).toBe(1);
    const release1 = await latestRelease(page, scope!);
    const build1 = await releaseBuild(release1);
    expect(build1.dependency).toBe("independent");
    expect(build1.buildContent).not.toBeNull();

    const domain = (await serverFn(page, DOMAINS, "createStorefrontDomain", {
      storefrontId: scope!.storefrontId,
      hostname: HOST,
    })) as { success: boolean; message?: string; data?: { id: string } };
    expect(domain.success, domain.message).toBe(true);
    domainId = domain.data!.id;
    const published1 = await serveActiveRelease(contentA, release1, origin);
    await expectServed(storefront, { code, content: contentA, absent: [] });

    // 1. After a reload, so the editor holds no build: content B, published
    //    without building. The release reuses build 1 with B's content, and
    //    the storefront's SSR shows B.
    await openEditor(page);
    await editHero(page, contentB);
    const buildsBeforeB = posts.build;
    //    The preview it opens is the release's: B, though build 1 was sealed
    //    with A.
    const shown = await publishShowingRelease(page);
    expect(posts.build, "a content-only publish does not build").toBe(
      buildsBeforeB,
    );
    await expectServed(shown.fetch, {
      code,
      content: contentB,
      absent: [contentA],
    });
    await shown.close();
    const release2 = await latestRelease(page, scope!);
    expect(release2).not.toBe(release1);
    const build2 = await releaseBuild(release2);
    expect(build2.buildId).toBe(build1.buildId);
    expect(build2.releaseContent).not.toBe(build1.releaseContent);
    await serveActiveRelease(contentB, release2, origin);
    await expectServed(storefront, {
      code,
      content: contentB,
      absent: [contentA],
    });

    // 2. Rolled back to release 1: the same build, and A's content again.
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
    await serveActiveRelease(contentA, release1, origin);
    await expectServed(storefront, {
      code,
      content: contentA,
      absent: [contentB],
    });

    // 3. Build 1 as an older build would be: its dependency unknown. The
    //    draft (B) differs from its seal (A).
    expect(
      await writeD1(
        "UPDATE storefront_theme_builds SET content_dependency = NULL WHERE id = ?1",
        build1.buildId,
      ),
    ).toBe(1);
    //    a. A publish naming it with that draft is refused by the server,
    //       and nothing is written.
    const before = await publishedState();
    const fieldB = await savedField(page, scope!, contentB);
    const context = await editorContext(page, scope!);
    const refused = (await serverFn(
      page,
      THEMES,
      "publishStorefrontThemeTemplate",
      {
        ...scope!,
        templateId: fieldB.template.id,
        sourceRevisionId: published1.sourceRevisionId,
        themeBuildId: build1.buildId,
        expectedDraftRevisionId: fieldB.template.draftRevisionId,
        expectedDraftGeneration: fieldB.template.draftGeneration,
        expectedReleaseGeneration: context.theme.releaseGeneration,
      },
    )) as { success: boolean; error?: string };
    expect(refused).toMatchObject({
      success: false,
      error: "PUBLISH_BUILD_CONTENT_MISMATCH",
    });
    expect(await publishedState()).toEqual(before);
    //    b. The editor, reloaded, sees the release's build bound to its
    //       content and builds for content C instead of reusing it.
    await writeDraftField(page, scope!, fieldB, contentC);
    await openEditor(page);
    const buildsBeforeC = posts.build;
    await publish(page);
    expect(posts.build, "an unknown build is not reused for new content").toBe(
      buildsBeforeC + 1,
    );
    const release3 = await latestRelease(page, scope!);
    const build3 = await releaseBuild(release3);
    expect(build3.buildId).not.toBe(build1.buildId);
    expect(build3.dependency).toBe("independent");
    await serveActiveRelease(contentC, release3, origin);
    await expectServed(storefront, {
      code,
      content: contentC,
      absent: [contentA, contentB],
    });
  });
});
