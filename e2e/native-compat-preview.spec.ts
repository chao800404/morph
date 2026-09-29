import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { EDITOR_PATH, previewFrame } from "./helpers";
import {
  NATIVE_COMPAT_FILES,
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
} from "./native-compat";

/**
 * Ordinary TanStack Start code in the Live Preview.
 *
 * The same Theme files as `native-compat.test.ts` (the built Worker) and
 * `native-compat-published.spec.ts` (the published storefront). The goal is
 * one behaviour in all three; the Live Preview today builds for the browser
 * only, with no Start server. What works there is asserted as working, and
 * what does not is asserted as a `KNOWN GAP`: each fails once the gap closes,
 * so it has to become an ordinary assertion instead of a stale claim.
 *
 * Runs on both preview transports. Writes the files through Code mode's own
 * save and removes them afterwards, on the seeded, disposable store.
 */
test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to a seeded editor store.");

const scope = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
const FILE_PATHS = NATIVE_COMPAT_FILES.map((file) => file.path);

/** A signed-in page outside a test: hooks get no project context of their own. */
async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

/** The editor, with the canvas on one route. */
async function openRoute(page: Page, routePath: string) {
  const url = new URL(EDITOR_PATH!, "http://placeholder");
  url.searchParams.set("routePath", routePath);
  url.searchParams.set("section", routePath);
  await page.goto(`${url.pathname}${url.search}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
}

test.describe("TanStack Start in the Live Preview", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(4 * 60_000);

  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const saved = await writeThemeFiles(page, scope!, NATIVE_COMPAT_FILES);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await page.context().close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const removed = await removeThemeFiles(page, scope!, FILE_PATHS);
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    await page.context().close();
  });

  test("runs a route loader in the browser", async ({ page }) => {
    await openRoute(page, "/compat-other");
    await expect(
      previewFrame(page).locator('[data-compat="other"]'),
    ).toHaveText("other", { timeout: 90_000 });
  });

  test("renders a loader error through the route's errorComponent", async ({
    page,
  }) => {
    await openRoute(page, "/compat-error");
    await expect(
      previewFrame(page).locator('[data-compat="error"]'),
    ).toHaveText("caught compat-loader-error", { timeout: 90_000 });
  });

  test("follows a redirect thrown from beforeLoad", async ({ page }) => {
    await openRoute(page, "/compat-redirect");
    await expect(
      previewFrame(page).locator('[data-compat="other"]'),
    ).toHaveText("other", { timeout: 90_000 });
  });

  // The published Worker server-renders this page; see native-compat.test.ts.
  test("KNOWN GAP: a loader calling a server function crashes the page", async ({
    page,
  }) => {
    await openRoute(page, "/compat");
    // The preview has no Start server, so the server function's handler runs
    // in the browser and reaches the preview's throwing stand-in.
    await expect(
      previewFrame(page).getByText(
        "Theme preview cannot call getRequest(): server APIs run only in the deployed Theme Worker.",
      ),
    ).toBeVisible({ timeout: 90_000 });
  });

  // The published Worker answers these; see native-compat.test.ts.
  test("KNOWN GAP: server routes do not exist", async ({ page }) => {
    await openRoute(page, "/compat-other");
    const frame = previewFrame(page);
    await expect(frame.locator('[data-compat="other"]')).toHaveText("other", {
      timeout: 90_000,
    });
    const answer = await frame.locator("body").evaluate(async () => {
      const response = await fetch(
        new URL("api/compat?q=hi", document.baseURI).href,
      );
      return {
        status: response.status,
        type: response.headers.get("content-type") ?? "",
      };
    });
    // The dev server's HTML shell, not the route's JSON.
    expect(answer.status).toBe(200);
    expect(answer.type).toMatch(/^text\/html/);
  });

  // A preview hostname is the Theme's site, like a storefront's. This Theme
  // has neither file, so anything served must not be Morph's own.
  test("does not answer a preview's root paths with Morph's own files", async ({
    page,
  }) => {
    await openRoute(page, "/compat-other");
    const frame = previewFrame(page);
    await expect(frame.locator('[data-compat="other"]')).toHaveText("other", {
      timeout: 90_000,
    });
    for (const [path, platformFile] of [
      ["/favicon.ico", "public/favicon.ico"],
      ["/robots.txt", "public/robots.txt"],
    ] as const) {
      const served = await frame.locator("body").evaluate(async (_, path) => {
        const response = await fetch(new URL(path, location.origin).href);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
      }, path);
      expect(served, path).not.toBe(
        createHash("sha256").update(readFileSync(platformFile)).digest("hex"),
      );
    }
  });
});
