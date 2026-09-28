import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";
import { unstable_startWorker } from "wrangler";

import { verifyPublishedArtifact } from "../scripts/verify-published-artifact.mjs";
import {
  EDITOR_PATH,
  openContentTab,
  openEditor,
  previewFrame,
  settleSelection,
} from "./helpers";
import {
  NATIVE_COMPAT_FILES,
  removeThemeFiles,
  themeScopeFromEditorPath,
  uploadThemeBinary,
  writeThemeFiles,
} from "./native-compat";

/**
 * Ordinary TanStack Start code on the published storefront, reached the way a
 * shopper reaches it: a storefront hostname, through Morph Core, to the Theme
 * Worker built and published from these files.
 *
 * The same files as `native-compat.test.ts` (the built Worker, in CI) and
 * `native-compat-preview.spec.ts`. What differs from Start's own behaviour is
 * asserted as a `KNOWN GAP`, which fails once the gap closes.
 *
 * Sandbox transport only, like publish.spec.ts: the build runs in the
 * container. Needs `MORPH_ALLOW_LOCAL_DOMAIN_PROVISIONING=true` and
 * `MORPH_LOCAL_THEME_ORIGIN=http://127.0.0.1:8799` in `.dev.vars`, so a local
 * hostname can be connected and Core forwards it to the Worker served here.
 */
const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Run through scripts/run-editor-e2e.mjs: this reads the run's own D1 and R2.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "Publishing builds in the Sandbox container; run with MORPH_E2E_TRANSPORT=cloudflare-sandbox.",
);

const scope = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
const HOST = "native-compat.localhost";
const THEME_WORKER_PORT = 8799;
const IMAGE_PATH = "public/images/native-compat.png";
const FAVICON_PATH = "public/favicon.ico";
const ALL_PATHS = [
  ...NATIVE_COMPAT_FILES.map((file) => file.path),
  IMAGE_PATH,
  FAVICON_PATH,
];

/** A 1x1 PNG, and an ICO wrapping it: bytes no platform file has. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==",
  "base64",
);
const ICO = (() => {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(1, 6);
  header.writeUInt8(1, 7);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(PNG.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, PNG]);
})();
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * A request to the dev server as the storefront hostname: connects to
 * 127.0.0.1 and names the host in the Host header, since Node does not
 * resolve `*.localhost` the way browsers do. Redirects are not followed.
 */
function storefrontRequest(
  origin: string,
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<Response> {
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: "127.0.0.1",
        port: url.port,
        path: url.pathname + url.search,
        method: init.method ?? "GET",
        headers: { ...init.headers, host: url.host },
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            for (const item of [value ?? []].flat()) headers.append(name, item);
          }
          const status = incoming.statusCode ?? 0;
          const body = [101, 204, 205, 304].includes(status)
            ? null
            : Buffer.concat(chunks);
          resolve(new Response(body, { status, headers }));
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end(init.body);
  });
}

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
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

test.describe("TanStack Start on the published storefront", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(12 * 60_000);

  let storefrontOrigin = "";
  let domainId: string | null = null;
  let worker: Awaited<ReturnType<typeof unstable_startWorker>> | null = null;
  let artifactDir = "";

  test.afterAll(async ({ browser }) => {
    await worker?.dispose();
    if (artifactDir) rmSync(artifactDir, { recursive: true, force: true });
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    if (domainId) {
      await serverFn(
        page,
        "/src/server/storefront/storefront-domains.serverFn.ts",
        "deleteStorefrontDomains",
        { ids: [domainId] },
      );
    }
    const removed = await removeThemeFiles(page, scope!, ALL_PATHS);
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    await page.context().close();
  });

  test("publishes the Theme and serves it on a storefront hostname", async ({
    page,
  }) => {
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    // Anything an earlier run left behind would refuse the new uploads.
    const cleared = await removeThemeFiles(page, scope!, ALL_PATHS);
    expect(cleared.success, JSON.stringify(cleared)).toBe(true);
    const saved = await writeThemeFiles(page, scope!, NATIVE_COMPAT_FILES);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    for (const [path, bytes] of [
      [IMAGE_PATH, PNG],
      [FAVICON_PATH, ICO],
    ] as const) {
      const uploaded = await uploadThemeBinary(page, scope!, path, bytes);
      expect(uploaded.status(), `${path}: ${await uploaded.text()}`).toBe(200);
    }

    // Opened again so the preview starts from the files just written.
    await openEditor(page);

    // KNOWN GAP (not asserted here, since earlier specs may already have made
    // one): a store publishes only once a Design edit has created a draft
    // revision. A plain Start app needs no such step.
    const marker = `native-compat-${Date.now()}`;
    await page.getByRole("button", { name: "hero", exact: true }).click();
    await settleSelection(page);
    await openContentTab(page);
    const field = page
      .locator('[data-slot="inspector-content-field"] input')
      .first();
    await expect(field).toBeVisible({ timeout: 30_000 });
    await field.fill(marker);
    await field.press("Tab");
    await expect(
      previewFrame(page).getByText(marker, { exact: false }).first(),
    ).toBeVisible({ timeout: 60_000 });

    const build = page.locator("button[data-editor-build-action]");
    await build.click();
    await expect(build).toHaveAttribute("data-build-pending", "true", {
      timeout: 30_000,
    });
    await expect(build).toHaveAttribute("data-build-pending", "false", {
      timeout: 9 * 60_000,
    });
    const buildPreview = page.locator('[aria-label="Build preview"]');
    if (await buildPreview.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape");
      await expect(buildPreview).toBeHidden({ timeout: 30_000 });
    }
    await page.getByRole("button", { name: /^Publish$/ }).click();
    await page.locator("[data-publish-confirm]").click();
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      "Published",
      { timeout: 3 * 60_000 },
    );

    const history = (await serverFn(
      page,
      "/src/server/storefront/storefront-releases.serverFn.ts",
      "listStorefrontReleaseHistory",
      { storefrontId: scope!.storefrontId, limit: 1 },
    )) as { success: boolean; data: { releases: { id: string }[] } };
    const releaseId = history.data.releases[0]!.id;

    const domain = (await serverFn(
      page,
      "/src/server/storefront/storefront-domains.serverFn.ts",
      "createStorefrontDomain",
      { storefrontId: scope!.storefrontId, hostname: HOST },
    )) as { success: boolean; message?: string; data?: { id: string } };
    expect(
      domain.success,
      `connecting ${HOST}: ${domain.message} (is MORPH_ALLOW_LOCAL_DOMAIN_PROVISIONING=true in .dev.vars?)`,
    ).toBe(true);
    domainId = domain.data!.id;

    // The published artifact, read back from this run's R2 and checked
    // against its manifest, then served where Core forwards storefront pages.
    artifactDir = mkdtempSync(join(tmpdir(), "native-compat-published-"));
    const handoff = join(artifactDir, "handoff.json");
    writeFileSync(
      handoff,
      JSON.stringify({
        schemaVersion: 2,
        marker,
        releaseLabel: releaseId.slice(0, 8),
        storefrontId: scope!.storefrontId,
        themeId: scope!.themeId,
        image: null,
      }),
    );
    const published = await verifyPublishedArtifact({
      handoffPath: handoff,
      persistTo: STATE_DIR!,
      outDir: join(artifactDir, "artifact"),
    });
    worker = await unstable_startWorker({
      config: published.workerConfig,
      dev: {
        server: { hostname: "127.0.0.1", port: THEME_WORKER_PORT },
        inspector: false,
        logLevel: "error",
      },
    });
    await worker.ready;

    storefrontOrigin = `http://${HOST}:${new URL(test.info().project.use.baseURL!).port}`;
    const home = await storefrontRequest(storefrontOrigin, "/compat-other");
    expect(home.status).toBe(200);
  });

  const request = (
    path: string,
    init?: Parameters<typeof storefrontRequest>[2],
  ) => storefrontRequest(storefrontOrigin, path, init);

  test("server-renders a page whose loader calls a server function, with both middlewares", async () => {
    const response = await request("/compat");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-compat-request-mw")).toBe("1");
    const html = await response.text();
    expect(html).toContain("hello loader");
    expect(html).toContain("fn-mw-ok");
  });

  test("answers server routes and redirects through Core", async () => {
    const get = await request("/api/compat?q=hi");
    expect(await get.json()).toEqual({ ok: true, method: "GET", q: "hi" });
    const post = await request("/api/compat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    expect(await post.json()).toEqual({
      ok: true,
      method: "POST",
      body: { hello: "world" },
    });
    const moved = await request("/api/compat-redirect");
    expect(moved.status).toBe(302);
    expect(moved.headers.get("location")).toBe("/compat-other");
    const redirected = await request("/compat-redirect");
    expect(redirected.headers.get("location")).toContain("/compat-other");
  });

  test("serves a public/ image at its root URL", async () => {
    const response = await request("/images/native-compat.png");
    expect(response.status).toBe(200);
    expect(sha256(new Uint8Array(await response.arrayBuffer()))).toBe(
      sha256(PNG),
    );
  });

  test("calls server functions from the browser, with cookies, and navigates client-side", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const shopper = await context.newPage();
    await shopper.goto(`${storefrontOrigin}/compat`, {
      waitUntil: "networkidle",
    });
    const result = shopper.locator('[data-compat="result"]');
    await expect(shopper.locator('[data-compat="loader"]')).toContainText(
      "hello loader",
    );

    await shopper.locator('[data-compat="get"]').click();
    await expect(result).toContainText('"greeting":"hello client"');
    await expect(result).toContainText('"ranOnServer":true');

    await shopper.locator('[data-compat="post"]').click();
    await expect(result).toContainText('"count":2');
    await shopper.locator('[data-compat="post"]').click();
    await expect(result).toContainText('"count":4');
    const cookie = (await context.cookies()).find(
      (entry) => entry.name === "compat_count",
    );
    expect(cookie?.httpOnly).toBe(true);

    await shopper.locator('[data-compat="fail"]').click();
    await expect(result).toHaveText("caught:compat-fn-error");

    await shopper.locator('[data-compat="link"]').click();
    await expect(shopper.locator('[data-compat="other"]')).toHaveText("other");
    await expect(shopper).toHaveURL(`${storefrontOrigin}/compat-other`);
    await context.close();
  });

  // The Theme Worker answers each of these correctly on its own; Core's
  // static files answer first on a storefront hostname.
  test("KNOWN GAP: Morph's own static files answer a storefront's paths", async () => {
    const platformFavicon = readFileSync("public/favicon.ico");
    const favicon = await request("/favicon.ico");
    expect(sha256(new Uint8Array(await favicon.arrayBuffer()))).toBe(
      sha256(platformFavicon),
    );
    expect(sha256(platformFavicon)).not.toBe(sha256(ICO));

    const robots = await request("/robots.txt");
    expect(await robots.text()).toBe(readFileSync("public/robots.txt", "utf8"));

    // The Theme has no manifest.json at all.
    const manifest = await request("/manifest.json");
    expect(manifest.status).toBe(200);
    expect(await manifest.text()).toBe(
      readFileSync("public/manifest.json", "utf8"),
    );
  });
});
