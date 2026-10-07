import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { unstable_startWorker } from "wrangler";

import {
  queryRunD1,
  verifyPublishedArtifact,
  writeRunD1,
} from "../scripts/verify-published-artifact.mjs";
import { buildPreviewOutboundService } from "../src/lib/storefront/service/build-preview/local-build-preview-worker";
import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  openContentTab,
  previewFrame,
  settleSelection,
} from "./helpers";

/**
 * What the native acceptance specs share: driving the editor, publishing,
 * serving the active release where Core forwards a local storefront, and
 * reading what a publish left in this run's D1. Container transport and the
 * local deployer only (see native-publish-acceptance.spec.ts).
 */

export type ThemeScope = { storefrontId: string; themeId: string };

export const RELEASES =
  "/src/server/storefront/storefront-releases.serverFn.ts";
export const BUILDS =
  "/src/server/storefront/storefront-theme-builds.serverFn.ts";
export const DOMAINS = "/src/server/storefront/storefront-domains.serverFn.ts";
export const THEMES = "/src/server/storefront/storefront-themes.serverFn.ts";
export const BUILD_PREVIEW = "/src/server/storefront/build-preview.serverFn.ts";

const THEME_WORKER_PORT = 8799;

export type Fetched = { status: number; body: string };
export type Fetcher = (path: string) => Promise<Fetched>;

/** A storefront request: to 127.0.0.1, naming the hostname in Host. */
function storefrontRequest(origin: string, path: string): Promise<Response> {
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: "127.0.0.1",
        port: url.port,
        path: url.pathname + url.search,
        headers: { host: url.host },
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            for (const item of [value ?? []].flat()) headers.append(name, item);
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: incoming.statusCode ?? 0,
              headers,
            }),
          );
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

/**
 * Requests on the storefront at `origin`, following a same-site redirect as
 * a browser would: static assets answer `/page` with a redirect to `/page/`.
 */
export function storefrontFetcher(origin: string): Fetcher {
  return async (path) => {
    let response = await storefrontRequest(origin, path);
    for (let hops = 0; hops < 3; hops += 1) {
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) break;
      const next = new URL(location, new URL(path, origin));
      expect(next.origin, `redirect from ${path} stays on the site`).toBe(
        origin,
      );
      path = next.pathname + next.search;
      response = await storefrontRequest(origin, path);
    }
    return { status: response.status, body: await response.text() };
  };
}

export async function serverFn(
  page: Page,
  module: string,
  name: string,
  data: unknown,
) {
  return page.evaluate(
    async ({ module, name, data }) => {
      const fns = await import(/* @vite-ignore */ module);
      return fns[name]({ data });
    },
    { module, name, data },
  );
}

export async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

/**
 * Waits until React has claimed a server-rendered element, which is when its
 * handlers are attached; a click before that reaches nothing. The same check
 * publish.spec.ts makes, for the same race.
 */
export async function expectHydrated(target: Locator) {
  await expect
    .poll(
      () =>
        target.evaluate((element) =>
          Object.keys(element).some((key) => key.startsWith("__reactProps$")),
        ),
      { timeout: 45_000 },
    )
    .toBe(true);
}

/** Turns the pointer tool on unless an earlier edit left it on. */
async function ensureSelection(page: Page) {
  const on = page.getByRole("button", { name: "Disable section selection" });
  if (await on.isVisible().catch(() => false)) return;
  await expectHydrated(
    page.getByRole("button", { name: "Enable section selection" }),
  );
  await enableSelection(page);
}

/** Types `marker` into the page's hero, as publish.spec.ts does. */
export async function editHero(page: Page, marker: string) {
  await ensureSelection(page);
  const field = page
    .locator('[data-slot="inspector-content-field"] input')
    .first();
  const section = page.getByRole("button", { name: "hero", exact: true });
  if (await section.isVisible().catch(() => false)) {
    await section.click();
    await settleSelection(page);
    await openContentTab(page);
  }
  if (!(await field.isVisible().catch(() => false))) {
    const selected = await clickExposedElement(
      page,
      previewFrame(page).locator(
        "h1[data-storefront-field], h2[data-storefront-field], p[data-storefront-field]",
      ),
    );
    expect(selected, "no editable text field").not.toBeNull();
    await openContentTab(page);
  }
  await expect(field).toBeVisible({ timeout: 30_000 });
  await field.fill(marker);
  await field.press("Tab");
  await expect(
    previewFrame(page).getByText(marker, { exact: false }).first(),
  ).toBeVisible({ timeout: 30_000 });
}

export async function openPublish(page: Page) {
  await page.getByRole("button", { name: /^Publish$/ }).click();
  await page.locator("[data-publish-confirm]").click();
}

/** What a successful publish opens: the release it made, as served. */
export type ReleasePreview = {
  /** Requests made from inside the release preview's page. */
  fetch: Fetcher;
  /** Where "Open live site" goes, or null when it is not offered. */
  liveSite: string | null;
  close: () => Promise<void>;
};

/**
 * Publishes from the toolbar and returns the release preview the publish
 * opened. Asserts that no Build Preview was shown on the way: a build that
 * publishing makes may still be refused, so it is not presented as the store.
 */
export async function publishShowingRelease(
  page: Page,
): Promise<ReleasePreview> {
  // Recorded in the page, so a Build Preview shown and closed again between
  // two polls is still seen.
  await page.evaluate(() => {
    const flags = window as unknown as { __buildPreviewShown?: boolean };
    flags.__buildPreviewShown = false;
    const seen = () =>
      document.querySelector('iframe[data-build-preview="isolated"]') !== null;
    new MutationObserver(() => {
      if (seen()) flags.__buildPreviewShown = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await openPublish(page);
  await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
    "aria-label",
    "Published",
    { timeout: 9 * 60_000 },
  );
  const frame = page.locator('iframe[data-build-preview="release"]');
  await expect(frame, "a successful publish shows its release").toBeVisible({
    timeout: 60_000,
  });
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __buildPreviewShown?: boolean })
          .__buildPreviewShown,
    ),
    "no Build Preview is shown while publishing",
  ).toBe(false);
  const host = new URL((await frame.getAttribute("src"))!).hostname;
  const inFrame = () => page.frame({ url: (url) => url.hostname === host });
  await expect.poll(inFrame, { timeout: 120_000 }).toBeTruthy();
  const liveSite = page.locator("[data-release-preview-live-site]");
  return {
    fetch: (path) =>
      inFrame()!.evaluate(async (path) => {
        const response = await fetch(path, { cache: "no-store" });
        return { status: response.status, body: await response.text() };
      }, path),
    liveSite: (await liveSite.count())
      ? await liveSite.getAttribute("href")
      : null,
    close: async () => {
      await page.keyboard.press("Escape");
      await expect(frame).toBeHidden({ timeout: 30_000 });
    },
  };
}

export async function publish(page: Page) {
  await (await publishShowingRelease(page)).close();
}

/** Opens the editor and waits for the Publish control to be live. */
export async function openEditor(page: Page) {
  await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
  const publishButton = page.getByRole("button", { name: /^Publish$/ });
  await expect(publishButton).toBeVisible({ timeout: 45_000 });
  await expectHydrated(publishButton);
}

export type EditorContext = {
  theme: { releaseGeneration: number };
  templates: Array<{
    id: string;
    document: {
      sections: Array<{ id: string; props?: Record<string, unknown> | null }>;
    };
    draftRevisionId: string | null;
    draftGeneration: number;
  }>;
};

export async function editorContext(
  page: Page,
  scope: ThemeScope,
): Promise<EditorContext> {
  const result = (await serverFn(
    page,
    THEMES,
    "getStorefrontThemeEditor",
    scope,
  )) as { success: boolean; message?: string; data: EditorContext };
  expect(result.success, result.message).toBe(true);
  return result.data;
}

/** The draft template, section and field holding `marker`. */
export function heroField(context: EditorContext, marker: string) {
  for (const template of context.templates) {
    for (const section of template.document.sections) {
      for (const [key, value] of Object.entries(section.props ?? {})) {
        if (value === marker) return { template, sectionId: section.id, key };
      }
    }
  }
  throw new Error(`no draft field holds ${marker}`);
}

/**
 * The store's primary domain, or null when it has none: where "Open live
 * site" goes. Read rather than assumed, because the specs in one run share
 * the store, and a primary domain cannot be removed, so an earlier spec's
 * domain may still be the primary one.
 */
export async function primaryDomain(page: Page): Promise<string | null> {
  const listed = (await serverFn(
    page,
    DOMAINS,
    "listStorefrontDomains",
    {},
  )) as {
    success: boolean;
    message?: string;
    data?: { domains: { hostname: string; isPrimary: boolean }[] };
  };
  expect(listed.success, listed.message).toBe(true);
  return (
    listed.data!.domains.find((domain) => domain.isPrimary)?.hostname ?? null
  );
}

/** Where a release preview's "Open live site" goes, as a hostname. */
export function liveSiteHost(preview: { liveSite: string | null }) {
  return preview.liveSite ? new URL(preview.liveSite).hostname : null;
}

/** The saved draft holding `marker`, once the editor's write has landed. */
export async function savedField(
  page: Page,
  scope: ThemeScope,
  marker: string,
) {
  let found: ReturnType<typeof heroField> | null = null;
  await expect
    .poll(
      async () => {
        try {
          found = heroField(await editorContext(page, scope), marker);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 30_000, message: `the draft holding ${marker} is saved` },
    )
    .toBe(true);
  return found!;
}

/** Writes a draft field the way every field edit does, without the canvas. */
export async function writeDraftField(
  page: Page,
  scope: ThemeScope,
  field: Awaited<ReturnType<typeof savedField>>,
  value: string,
) {
  const written = (await serverFn(
    page,
    THEMES,
    "updateStorefrontThemeSectionProps",
    {
      ...scope,
      templateId: field.template.id,
      sectionId: field.sectionId,
      props: { [field.key]: value },
      expectedDraftGeneration: field.template.draftGeneration,
    },
  )) as { success: boolean; message?: string };
  expect(written.success, written.message).toBe(true);
}

export async function latestRelease(page: Page, scope: ThemeScope) {
  const history = (await serverFn(
    page,
    RELEASES,
    "listStorefrontReleaseHistory",
    { storefrontId: scope.storefrontId, limit: 1 },
  )) as { success: boolean; data: { releases: { id: string }[] } };
  expect(history.success).toBe(true);
  return history.data.releases[0]!.id;
}

/** Counts the POSTs to `paths` a page sends, by path. */
export function countPosts(page: Page, paths: Record<string, string>) {
  const counts = Object.fromEntries(
    Object.keys(paths).map((name) => [name, 0]),
  ) as Record<string, number>;
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    for (const [name, wanted] of Object.entries(paths)) {
      if (path === wanted) counts[name]! += 1;
    }
  });
  return counts;
}

/** The URL paths of the build and publish server functions. */
export async function serverFnPaths(page: Page) {
  const [build, publishUrl] = await page.evaluate(
    async ({ builds, themes }) => [
      (await import(/* @vite-ignore */ builds)).createPreviewBuild
        .url as string,
      (await import(/* @vite-ignore */ themes)).publishStorefrontThemeTemplate
        .url as string,
    ],
    { builds: BUILDS, themes: THEMES },
  );
  return {
    build: new URL(build, page.url()).pathname,
    publish: new URL(publishUrl, page.url()).pathname,
  };
}

/**
 * The run's storefront harness: serves the active release's artifact where
 * Core forwards a local storefront, and reads or writes this run's D1.
 */
export function storefrontHarness(options: {
  scope: ThemeScope;
  stateDir: string;
}) {
  const { scope, stateDir } = options;
  let worker: Awaited<ReturnType<typeof unstable_startWorker>> | null = null;
  const tempDirs: string[] = [];
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "native-accept-"));
    tempDirs.push(dir);
    return dir;
  };

  return {
    /**
     * This run's D1, read directly: what a refused publish left behind.
     *
     * Publications a build sealed are left out: a publish that has to build
     * first seals its draft in that build before the publish itself is
     * decided, and that one stays with the build whatever happens next. What
     * a publish writes is a publication no build holds.
     */
    async publishedState() {
      const [row] = await queryRunD1(
        { persistTo: stateDir, workDir: tempDir() },
        `SELECT
           (SELECT active_release_id FROM storefronts WHERE id = ?1) AS active,
           (SELECT COUNT(*) FROM storefront_releases WHERE storefront_id = ?1) AS releases,
           (SELECT COUNT(*) FROM storefront_content_publications p
             WHERE p.storefront_id = ?1
               AND NOT EXISTS (
                 SELECT 1 FROM storefront_theme_builds b
                 WHERE b.content_publication_id = p.id
               )) AS publications`,
        scope.storefrontId,
      );
      return row as { active: string; releases: number; publications: number };
    },

    /** A release's build and what its build proved about content. */
    async releaseBuild(releaseId: string) {
      const [row] = await queryRunD1(
        { persistTo: stateDir, workDir: tempDir() },
        `SELECT r.theme_build_id AS buildId,
                r.content_publication_id AS releaseContent,
                b.content_publication_id AS buildContent,
                b.content_dependency AS dependency
           FROM storefront_releases r
           JOIN storefront_theme_builds b ON b.id = r.theme_build_id
          WHERE r.id = ?1`,
        releaseId,
      );
      return row as {
        buildId: string;
        releaseContent: string | null;
        buildContent: string | null;
        dependency: "dependent" | "independent" | null;
      };
    },

    /** Puts a row into a state the product no longer produces. */
    async writeD1(sql: string, ...params: unknown[]) {
      return writeRunD1(
        { persistTo: stateDir, workDir: tempDir() },
        sql,
        ...params,
      );
    },

    /**
     * Serves the active release's artifact where Core forwards the storefront.
     *
     * This is the operator's step on this machine
     * (`OperatorManagedThemeWorkerDeployer`). The Theme Worker calls back on
     * the storefront hostname for content, and workerd does not resolve
     * `*.localhost`; that one origin is connected to Core's own listener with
     * its Host kept, by the outbound mapping the local Build Preview worker
     * uses. Core answers from the hostname and the active release as it does
     * for any host. Nothing else is reachable from the Worker.
     */
    async serveActiveRelease(
      contentMarker: string,
      releaseId: string,
      origin: string,
    ) {
      const dir = tempDir();
      const handoff = join(dir, "handoff.json");
      writeFileSync(
        handoff,
        JSON.stringify({
          schemaVersion: 2,
          marker: contentMarker,
          releaseLabel: releaseId.slice(0, 8),
          storefrontId: scope.storefrontId,
          themeId: scope.themeId,
          image: null,
        }),
      );
      const published = await verifyPublishedArtifact({
        handoffPath: handoff,
        persistTo: stateDir,
        outDir: join(dir, "artifact"),
      });
      expect(published.releaseId).toBe(releaseId);
      await worker?.dispose();
      worker = await unstable_startWorker({
        config: published.workerConfig,
        dev: {
          server: { hostname: "127.0.0.1", port: THEME_WORKER_PORT },
          inspector: false,
          logLevel: "error",
          // Passed through to the runtime; not part of Wrangler's public types.
          outboundService: buildPreviewOutboundService([
            { origin, upstream: `http://127.0.0.1:${new URL(origin).port}` },
          ]),
        },
      } as Parameters<typeof unstable_startWorker>[0]);
      await worker.ready;
      return published;
    },

    async dispose() {
      await worker?.dispose();
      for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    },
  };
}
