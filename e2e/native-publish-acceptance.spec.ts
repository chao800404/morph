import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";
import { unstable_startWorker } from "wrangler";

import { verifyPublishedArtifact } from "../scripts/verify-published-artifact.mjs";
import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  openContentTab,
  previewFrame,
  settleSelection,
} from "./helpers";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
} from "./native-compat";

/**
 * The native Start build, accepted end to end on this machine
 * (docs/start-native-import-plan.md, step 1b-2 item 3).
 *
 * A Theme that carries its own `vite.config.ts` and `wrangler.jsonc`, saved
 * through Code, with the native build switched on for this run
 * (`MORPH_NATIVE_START_BUILD=1` in `.dev.vars`):
 *
 * 1. built from the toolbar — in the build container, with its own config —
 *    and previewed in the isolated Build Preview, which runs that build;
 * 2. published, reusing that same build rather than rebuilding;
 * 3. served on a storefront hostname: SSR with a server function in the
 *    loader, a static asset, and the Theme's own 404 — a first publish;
 * 4. changed and published again, then rolled back to the first release,
 *    which the storefront serves again.
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
const THEME_WORKER_PORT = 8799;
const ROUTE = "/native-check";

/** The project's own build configuration, as the official example writes it. */
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
  "name": "native-accept",
  "compatibility_date": "2025-09-02",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry",
}
`;
/** A route whose loader calls a server function, carrying `marker`. */
const nativeRoute = (
  marker: string,
) => `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const readMarker = createServerFn({ method: "GET" }).handler(async () => ({
  marker: ${JSON.stringify(marker)},
  runtime: typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
}));

export const Route = createFileRoute(${JSON.stringify(ROUTE)})({
  loader: () => readMarker(),
  component: () => {
    const data = Route.useLoaderData();
    return <main data-native-check={data.marker}>{data.marker} via {data.runtime}</main>;
  },
});
`;
const OWN_PATHS = [
  "vite.config.ts",
  "wrangler.jsonc",
  `src/routes${ROUTE}.tsx`,
];
const themeFiles = (marker: string) => [
  { path: "vite.config.ts", content: OWN_VITE_CONFIG },
  { path: "wrangler.jsonc", content: OWN_WRANGLER },
  { path: `src/routes${ROUTE}.tsx`, content: nativeRoute(marker) },
];

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

async function serverFn(
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

const RELEASES = "/src/server/storefront/storefront-releases.serverFn.ts";
const BUILDS = "/src/server/storefront/storefront-theme-builds.serverFn.ts";
const DOMAINS = "/src/server/storefront/storefront-domains.serverFn.ts";

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

/** Types `marker` into the page's hero, as publish.spec.ts does. */
async function editHero(page: Page, marker: string) {
  await enableSelection(page);
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

async function publish(page: Page) {
  await page.getByRole("button", { name: /^Publish$/ }).click();
  await page.locator("[data-publish-confirm]").click();
  await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
    "aria-label",
    "Published",
    { timeout: 9 * 60_000 },
  );
}

test.describe("a native Start build, from Code to a rolled-back storefront", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(20 * 60_000);

  let worker: Awaited<ReturnType<typeof unstable_startWorker>> | null = null;
  let domainId: string | null = null;
  const artifactDirs: string[] = [];

  test.afterAll(async ({ browser }) => {
    await worker?.dispose();
    for (const dir of artifactDirs)
      rmSync(dir, { recursive: true, force: true });
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

  /** Serves the active release's artifact where Core forwards the storefront. */
  async function serveActiveRelease(contentMarker: string, releaseId: string) {
    const dir = mkdtempSync(join(tmpdir(), "native-accept-"));
    artifactDirs.push(dir);
    const handoff = join(dir, "handoff.json");
    writeFileSync(
      handoff,
      JSON.stringify({
        schemaVersion: 2,
        marker: contentMarker,
        releaseLabel: releaseId.slice(0, 8),
        storefrontId: scope!.storefrontId,
        themeId: scope!.themeId,
        image: null,
      }),
    );
    const published = await verifyPublishedArtifact({
      handoffPath: handoff,
      persistTo: STATE_DIR!,
      outDir: join(dir, "artifact"),
    });
    await worker?.dispose();
    worker = await unstable_startWorker({
      config: published.workerConfig,
      dev: {
        server: { hostname: "127.0.0.1", port: THEME_WORKER_PORT },
        inspector: false,
        logLevel: "error",
      },
    });
    await worker.ready;
    return published;
  }

  test("builds natively, previews and publishes that build, serves it, and rolls back", async ({
    page,
  }) => {
    const v1 = `native-v1-${randomUUID()}`;
    const v2 = `native-v2-${randomUUID()}`;
    const contentMarker = `morph-native-${randomUUID()}`;

    // 1. The project's own configuration, saved through Code.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const cleared = await removeThemeFiles(page, scope!, OWN_PATHS);
    expect(cleared.success, JSON.stringify(cleared)).toBe(true);
    const saved = await writeThemeFiles(page, scope!, themeFiles(v1));
    expect(saved.success, JSON.stringify(saved)).toBe(true);

    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    await page.waitForTimeout(4_000);
    await editHero(page, contentMarker);

    const buildUrl = await page.evaluate(async (module) => {
      const fns = await import(/* @vite-ignore */ module);
      return fns.createPreviewBuild.url as string;
    }, BUILDS);
    const buildPath = new URL(buildUrl, page.url()).pathname;
    let buildRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === buildPath
      ) {
        buildRequests += 1;
      }
    });

    // 2. Built from the toolbar, in the container, with its own config.
    const build = page.locator("button[data-editor-build-action]");
    await expect(build).toBeEnabled({ timeout: 30_000 });
    await build.click();
    await expect(build).toHaveAttribute("data-build-pending", "true", {
      timeout: 30_000,
    });
    await expect(build).toHaveAttribute("data-build-pending", "false", {
      timeout: 9 * 60_000,
    });

    // 3. Previewed by running that build, isolated.
    const frame = page.locator('iframe[data-build-preview="isolated"]');
    await expect(frame).toBeVisible({ timeout: 60_000 });
    const previewHost = new URL((await frame.getAttribute("src"))!).hostname;
    const isolated = () =>
      page.frame({ url: (url) => url.hostname === previewHost });
    await expect.poll(isolated, { timeout: 120_000 }).toBeTruthy();
    const previewed = await isolated()!.evaluate(async (route) => {
      const response = await fetch(route);
      return { status: response.status, body: await response.text() };
    }, ROUTE);
    expect(previewed.status).toBe(200);
    expect(previewed.body).toContain(v1);
    await page.keyboard.press("Escape");
    await expect(frame).toBeHidden({ timeout: 30_000 });

    // 4. Published: the same build, not a rebuild.
    await publish(page);
    expect(buildRequests, "publish reuses the previewed build").toBe(1);
    const history1 = (await serverFn(
      page,
      RELEASES,
      "listStorefrontReleaseHistory",
      {
        storefrontId: scope!.storefrontId,
        limit: 1,
      },
    )) as { success: boolean; data: { releases: { id: string }[] } };
    expect(history1.success).toBe(true);
    const release1 = history1.data.releases[0]!.id;

    const domain = (await serverFn(page, DOMAINS, "createStorefrontDomain", {
      storefrontId: scope!.storefrontId,
      hostname: HOST,
    })) as { success: boolean; message?: string; data?: { id: string } };
    expect(domain.success, domain.message).toBe(true);
    domainId = domain.data!.id;

    const published1 = await serveActiveRelease(contentMarker, release1);
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

    // 5. Served on the storefront: SSR through a server function, an asset,
    //    and the Theme's own 404.
    const origin = `http://${HOST}:${new URL(test.info().project.use.baseURL!).port}`;
    const page1 = await storefrontRequest(origin, ROUTE);
    expect(page1.status).toBe(200);
    const html1 = await page1.text();
    expect(html1).toContain(`data-native-check="${v1}"`);
    const asset = /(?:href|src)="(\/assets\/[^"]+)"/.exec(html1)?.[1];
    expect(asset, "the page links a built asset").toBeTruthy();
    expect((await storefrontRequest(origin, asset!)).status).toBe(200);
    expect(
      (await storefrontRequest(origin, `/no-such-page-${randomUUID()}`)).status,
    ).toBe(404);

    // 6. Changed and published again.
    const saved2 = await writeThemeFiles(page, scope!, [
      { path: `src/routes${ROUTE}.tsx`, content: nativeRoute(v2) },
    ]);
    expect(saved2.success, JSON.stringify(saved2)).toBe(true);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    await page.waitForTimeout(4_000);
    await enableSelection(page);
    await publish(page);
    const history2 = (await serverFn(
      page,
      RELEASES,
      "listStorefrontReleaseHistory",
      {
        storefrontId: scope!.storefrontId,
        limit: 1,
      },
    )) as { success: boolean; data: { releases: { id: string }[] } };
    const release2 = history2.data.releases[0]!.id;
    expect(release2).not.toBe(release1);
    await serveActiveRelease(contentMarker, release2);
    expect(await (await storefrontRequest(origin, ROUTE)).text()).toContain(
      `data-native-check="${v2}"`,
    );

    // 7. Rolled back to the first release: the storefront serves it again.
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
    const restored = await serveActiveRelease(contentMarker, release1);
    expect(restored.buildId).toBe(published1.buildId);
    const back = await storefrontRequest(origin, ROUTE);
    expect(back.status).toBe(200);
    const backHtml = await back.text();
    expect(backHtml).toContain(`data-native-check="${v1}"`);
    expect(backHtml).not.toContain(v2);
  });
});
