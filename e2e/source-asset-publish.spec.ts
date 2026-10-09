import { createHash, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";

import { expect, test, type Page } from "@playwright/test";

import { EDITOR_PATH } from "./helpers";
import {
  BUILD_PREVIEW,
  DOMAINS,
  RELEASES,
  editHero,
  latestRelease,
  openEditor,
  publishShowingRelease,
  savedField,
  serverFn,
  signedInPage,
  storefrontFetcher,
  storefrontHarness,
  writeDraftField,
} from "./native-acceptance";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
} from "./native-compat";
import { noisyPng } from "../src/lib/storefront/theme-image.test-support";

/**
 * A binary file kept under src/ (docs/astro-theme-plan.md 5.2.5), accepted
 * through the real container: a route imports it; it is built in the
 * Sandbox, shown by the release's Build Preview, published, replaced and
 * published again, and rolled back — and each release serves the bytes it
 * was built with, the rolled-back one from the original blob.
 *
 * Container transport only, with the local deployer
 * (`MORPH_ALLOW_LOCAL_DOMAIN_PROVISIONING=true`,
 * `MORPH_LOCAL_THEME_ORIGIN=http://127.0.0.1:8799`): the storefront is the
 * active release's artifact, read back from this run's R2, as in
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
  "The build runs in the Sandbox container; run with MORPH_E2E_TRANSPORT=cloudflare-sandbox.",
);

const scope = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
const HOST = "source-asset.localhost";
const ROUTE = "/e2e-source-asset";
const IMAGE_PATH = "src/assets/e2e-source-asset.png";
const ROUTE_FILE = {
  path: `src/routes${ROUTE}.tsx`,
  content:
    'import { createFileRoute } from "@tanstack/react-router";\n' +
    'import image from "../assets/e2e-source-asset.png";\n' +
    `export const Route = createFileRoute("${ROUTE}")({ component: Page });\n` +
    'function Page() { return <img data-e2e-source-asset="" src={image} alt="" />; }\n',
};
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Bytes from the storefront at `origin`, by Host, as a browser would ask. */
function storefrontBytes(origin: string, path: string): Promise<{ status: number; sha256: string }> {
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      { host: "127.0.0.1", port: url.port, path: url.pathname + url.search, headers: { host: url.host } },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () =>
          resolve({ status: incoming.statusCode ?? 0, sha256: sha256(Buffer.concat(chunks)) }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

/** Writes the image through the entry Code mode's upload uses. */
async function upload(
  page: Page,
  bytes: Uint8Array,
  replacing: { id: string; version: number } | null,
  generation = 0,
): Promise<{ id: string; version: number; blobDigest: string }> {
  const send = (expectedSourceGeneration: number) =>
    page.request.post(
      `/api/storefront/theme-binary-file?${new URLSearchParams({
        ...scope!,
        path: IMAGE_PATH,
        expectedSourceGeneration: String(expectedSourceGeneration),
        ...(replacing
          ? { expectedFileId: replacing.id, expectedVersion: String(replacing.version) }
          : { expectMissing: "1" }),
      })}`,
      { headers: { "content-type": "application/octet-stream" }, data: Buffer.from(bytes) },
    );
  let response = await send(generation);
  if (response.status() === 409) {
    const { message } = (await response.json()) as { message: string };
    const current = /source generation is (\d+)/.exec(message);
    if (current) response = await send(Number(current[1]));
  }
  expect(response.status(), await response.text()).toBe(200);
  const { data } = (await response.json()) as {
    data: { id: string; version: number; blobDigest: string };
  };
  return data;
}

/** The image URL the route's server-rendered page points at. */
async function imageUrl(get: (path: string) => Promise<{ status: number; body: string }>) {
  const page = await get(ROUTE);
  expect(page.status, page.body.slice(0, 500)).toBe(200);
  const src = /<img[^>]*data-e2e-source-asset[^>]*src="([^"]+)"/.exec(page.body)?.[1]
    ?? /<img[^>]*src="([^"]+)"[^>]*data-e2e-source-asset/.exec(page.body)?.[1];
  expect(src, "the route renders the imported image").toBeTruthy();
  // Bundled: a built asset, never the source path.
  expect(src).not.toContain("src/assets");
  return src!;
}

test.describe("a src/ image from Code to a rolled-back storefront", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(30 * 60_000);
  test.use({ actionTimeout: 60_000 });

  const harness = STATE_DIR ? storefrontHarness({ scope: scope!, stateDir: STATE_DIR }) : null;
  let domainId: string | null = null;

  test.afterAll(async ({ browser }) => {
    await harness?.dispose();
    const page = await signedInPage(browser);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (domainId) {
      await serverFn(page, DOMAINS, "deleteStorefrontDomains", { ids: [domainId] });
    }
    const removed = await removeThemeFiles(page, scope!, [ROUTE_FILE.path, IMAGE_PATH]);
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    await page.context().close();
  });

  test("each release serves the image bytes it was built with, rollback included", async ({
    page,
    browser,
  }) => {
    const v1 = noisyPng(64, 48);
    const v2 = noisyPng(72, 40);
    expect(sha256(v1)).not.toBe(sha256(v2));
    const marker1 = `source-asset-a-${randomUUID()}`;
    const marker2 = `source-asset-b-${randomUUID()}`;
    const origin = `http://${HOST}:${new URL(test.info().project.use.baseURL!).port}`;
    const storefront = storefrontFetcher(origin);

    // 1. The route, through Code, and the image v1, through the upload entry.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const cleared = await removeThemeFiles(page, scope!, [ROUTE_FILE.path, IMAGE_PATH]);
    expect(cleared.success, JSON.stringify(cleared)).toBe(true);
    const saved = await writeThemeFiles(page, scope!, [ROUTE_FILE]);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await openEditor(page);
    const first = await upload(page, v1, null);
    expect(first.blobDigest).toBe(sha256(v1));

    // 2. Published: built in the container from the frozen revision.
    await openEditor(page);
    await editHero(page, marker1);
    const shown1 = await publishShowingRelease(page);
    await shown1.close();
    const release1 = await latestRelease(page, scope!);
    const build1 = await harness!.releaseBuild(release1);

    // The release's build, in its isolated Build Preview: the bytes uploaded.
    const opened = (await serverFn(page, BUILD_PREVIEW, "openBuildPreview", {
      ...scope!,
      buildId: build1.buildId,
    })) as { success: boolean; message?: string; data: { url: string } };
    expect(opened.success, opened.message).toBe(true);
    // Opened at the address it gives, then asked from inside, on its host.
    const preview = await signedInPage(browser);
    await preview.goto(opened.data.url, { waitUntil: "domcontentloaded" });
    const previewServed = await preview.evaluate(async (route) => {
      const page = await (await fetch(route, { cache: "no-store" })).text();
      const src =
        /<img[^>]*data-e2e-source-asset[^>]*src="([^"]+)"/.exec(page)?.[1] ??
        /<img[^>]*src="([^"]+)"[^>]*data-e2e-source-asset/.exec(page)?.[1];
      if (!src) return { status: 0, sha256: "", page: page.slice(0, 300) };
      const response = await fetch(src, { cache: "no-store" });
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", await response.arrayBuffer()),
      );
      return {
        status: response.status,
        sha256: [...digest].map((b) => b.toString(16).padStart(2, "0")).join(""),
      };
    }, ROUTE);
    expect(previewServed).toEqual({ status: 200, sha256: sha256(v1) });
    await preview.context().close();

    // The storefront, serving that release.
    const domain = (await serverFn(page, DOMAINS, "createStorefrontDomain", {
      storefrontId: scope!.storefrontId,
      hostname: HOST,
    })) as { success: boolean; message?: string; data?: { id: string } };
    expect(domain.success, domain.message).toBe(true);
    domainId = domain.data!.id;
    await harness!.serveActiveRelease(marker1, release1, origin);
    const src1 = await imageUrl(storefront);
    expect(await storefrontBytes(origin, src1)).toEqual({ status: 200, sha256: sha256(v1) });

    // 3. Replaced (OCC on the file's version) and published again: v2.
    //    The second draft is written through the editor's own draft write and
    //    published from the toolbar without the canvas, as
    //    native-publish-acceptance.spec.ts does from its step 6: this is about
    //    the build, publish and rollback, and a Live Preview that does not
    //    come back after a source change is its own problem.
    const second = await upload(page, v2, first);
    expect(second.version).toBe(first.version + 1);
    await writeDraftField(page, scope!, await savedField(page, scope!, marker1), marker2);
    await openEditor(page);
    await (await publishShowingRelease(page)).close();
    const release2 = await latestRelease(page, scope!);
    expect(release2).not.toBe(release1);
    await harness!.serveActiveRelease(marker2, release2, origin);
    const src2 = await imageUrl(storefront);
    expect(await storefrontBytes(origin, src2)).toEqual({ status: 200, sha256: sha256(v2) });

    // 4. Rolled back to the first release: v1 again, from the original blob.
    const rolledBack = (await serverFn(page, RELEASES, "activateStorefrontRelease", {
      storefrontId: scope!.storefrontId,
      releaseId: release1,
      expectedActiveReleaseId: release2,
    })) as { success: boolean; message?: string };
    expect(rolledBack.success, rolledBack.message).toBe(true);
    const restored = await harness!.serveActiveRelease(marker1, release1, origin);
    expect(restored.buildId).toBe(build1.buildId);
    const src3 = await imageUrl(storefront);
    expect(await storefrontBytes(origin, src3)).toEqual({ status: 200, sha256: sha256(v1) });
  });
});
