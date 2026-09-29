import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { EDITOR_PATH, previewFrame, saveEditedSource } from "./helpers";
import {
  NATIVE_COMPAT_COOKIE_HELPER_FILES,
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

/**
 * PROTOTYPE: the preview under test runs TanStack Start's server (workerd),
 * not the client-only build. Set with the Worker's
 * `MORPH_THEME_PREVIEW_RUNTIME=start`. Where that closes a gap, the gap's
 * `KNOWN GAP` test does not apply and an ordinary assertion runs instead.
 */
const START_PREVIEW = process.env.MORPH_E2E_PREVIEW_RUNTIME === "start";
const ALL_FILES = [...NATIVE_COMPAT_FILES, ...NATIVE_COMPAT_COOKIE_HELPER_FILES];
const FILE_PATHS = ALL_FILES.map((file) => file.path);

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

/**
 * Lets clicks reach the Theme instead of the editor's selection tool, once
 * the page has hydrated (Start's router exists in the frame).
 */
async function interactWithTheme(page: Page) {
  // Clicks are then dispatched inside the frame (dispatchEvent): the
  // editor's panels lie over parts of the canvas, and Playwright's hit test
  // does not look across the frame boundary; see clickExposedElement.
  const disableSelection = page.getByRole("button", {
    name: "Disable section selection",
  });
  if (await disableSelection.isVisible().catch(() => false)) {
    await disableSelection.click();
  }
  await expect(
    page.getByRole("button", { name: "Enable section selection" }),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        previewFrame(page)
          .locator("body")
          .evaluate(() =>
            Boolean(
              (window as unknown as { __TSR_ROUTER__?: unknown }).__TSR_ROUTER__,
            ),
          ),
      { timeout: 60_000 },
    )
    .toBe(true);
}

/** Marks the framed document; a document load takes the mark away. */
async function markFrame(page: Page) {
  await previewFrame(page)
    .locator("body")
    .evaluate(() => {
      (window as unknown as { __compatMark: number }).__compatMark = 1;
    });
}

async function frameMarked(page: Page) {
  return previewFrame(page)
    .locator("body")
    .evaluate(
      () => (window as unknown as { __compatMark?: number }).__compatMark,
    );
}

test.describe("TanStack Start in the Live Preview", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(4 * 60_000);

  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const saved = await writeThemeFiles(page, scope!, ALL_FILES);
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
    test.skip(START_PREVIEW, "Closed by the Start preview; asserted below.");
    await openRoute(page, "/compat");
    // The preview has no Start server, so the server function's handler runs
    // in the browser and reaches the preview's throwing stand-in.
    await expect(
      previewFrame(page).getByText(
        "Theme preview cannot call getRequest(): server APIs run only in the deployed Theme Worker.",
      ),
    ).toBeVisible({ timeout: 90_000 });
  });

  // Start's cookie helpers read the request, which a browser cannot supply. The
  // Theme builds and previews (the page below is reached through the editor),
  // and the call says why it cannot run here; the published Worker runs it.
  // Until the preview runs Start's server, this is the behaviour to expect.
  test("KNOWN GAP: a cookie helper is refused when called, saying so", async ({
    page,
  }) => {
    test.skip(START_PREVIEW, "Closed by the Start preview; asserted below.");
    await openRoute(page, "/compat-cookies");
    await expect(
      previewFrame(page).getByText(
        "Theme preview cannot call getCookie(): server APIs run only in the deployed Theme Worker.",
      ),
    ).toBeVisible({ timeout: 90_000 });
  });

  // The published Worker answers these; see native-compat.test.ts.
  test("KNOWN GAP: server routes do not exist", async ({ page }) => {
    test.skip(START_PREVIEW, "Closed by the Start preview; asserted below.");
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

  // --- The same behaviours once the preview runs Start's server. ---

  test("server-renders a loader calling a GET server function through function middleware", async ({
    page,
  }) => {
    test.skip(!START_PREVIEW, "Needs the Start preview.");
    await openRoute(page, "/compat");
    const loader = previewFrame(page).locator('[data-compat="loader"]');
    await expect(loader).toContainText("hello loader", { timeout: 90_000 });
    expect(JSON.parse((await loader.textContent())!)).toEqual({
      greeting: "hello loader",
      middleware: "fn-mw-ok",
      ranOnServer: true,
      method: "GET",
    });
    await expect(
      previewFrame(page).locator('[data-compat="conditional"]'),
    ).toHaveText("server-rendered-branch");
    // The page's own document came from the server with the loader's answer
    // in it, and global request middleware ran on it.
    const document = await previewFrame(page)
      .locator("body")
      .evaluate(async () => {
        const response = await fetch(location.pathname, { cache: "no-store" });
        return {
          middleware: response.headers.get("x-compat-request-mw"),
          html: await response.text(),
        };
      });
    expect(document.middleware).toBe("1");
    expect(document.html).toContain("hello loader");
  });

  test("calls server functions from the client: GET, POST and a thrown error", async ({
    page,
  }) => {
    test.skip(!START_PREVIEW, "Needs the Start preview.");
    await openRoute(page, "/compat");
    const frame = previewFrame(page);
    await expect(frame.locator('[data-compat="loader"]')).toContainText(
      "hello loader",
      { timeout: 90_000 },
    );
    await interactWithTheme(page);
    const result = frame.locator('[data-compat="result"]');
    await frame.locator('[data-compat="get"]').dispatchEvent("click");
    await expect(result).toContainText('"greeting":"hello client"');
    await frame.locator('[data-compat="post"]').dispatchEvent("click");
    await expect(result).toContainText('"method":"POST"');
    await frame.locator('[data-compat="fail"]').dispatchEvent("click");
    await expect(result).toHaveText("caught:compat-fn-error");
  });

  // The canvas frames the preview on an origin of its own, cross-site to the
  // editor, so the Theme runs as a third party there: a cookie it sets with
  // the browser's default SameSite=Lax is not kept. Opened as the page itself
  // (below), the same cookie round-trips as on the published storefront.
  test("KNOWN GAP: in the editor canvas a Theme's default (Lax) cookie is not kept", async ({
    page,
  }) => {
    test.skip(!START_PREVIEW, "Needs the Start preview.");
    await openRoute(page, "/compat");
    const frame = previewFrame(page);
    await expect(frame.locator('[data-compat="loader"]')).toContainText(
      "hello loader",
      { timeout: 90_000 },
    );
    await interactWithTheme(page);
    const result = frame.locator('[data-compat="result"]');
    await frame.locator('[data-compat="post"]').dispatchEvent("click");
    await expect(result).toContainText('"count":2');
    await frame.locator('[data-compat="post"]').dispatchEvent("click");
    await expect(result).toContainText('"method":"POST"');
    await expect(result).toContainText('"count":2');
  });

  test("round-trips HttpOnly cookies on the preview's own page: setResponseHeader and getCookie/setCookie", async ({
    page,
  }) => {
    test.skip(!START_PREVIEW, "Needs the Start preview.");
    await openRoute(page, "/compat");
    await expect(
      previewFrame(page).locator('[data-compat="loader"]'),
    ).toContainText("hello loader", { timeout: 90_000 });
    const framed = new URL((await page.locator("iframe").first().getAttribute("src"))!);
    // The preview's own origin, top level, as a shopper meets the storefront.
    const own = await page.context().newPage();
    await own.goto(new URL("/compat", framed.origin).href);
    await expect(own.locator('[data-compat="loader"]')).toContainText("hello loader");
    await expect
      .poll(() => own.evaluate(() => Boolean((window as unknown as { __TSR_ROUTER__?: unknown }).__TSR_ROUTER__)), { timeout: 60_000 })
      .toBe(true);
    const result = own.locator('[data-compat="result"]');
    await own.locator('[data-compat="post"]').click();
    await expect(result).toContainText('"method":"POST"');
    const first = JSON.parse((await result.textContent())!).count as number;
    await own.locator('[data-compat="post"]').click();
    await expect(result).toContainText(`"count":${first + 2}`);

    const answers = await own.evaluate(async () => {
      const read = async (query = "") =>
        (await fetch("/api/compat-cookie" + query, { cache: "no-store" })).json();
      const cleared = await read("?clear=1");
      const first = await read();
      const second = await read();
      return { cleared, first, second, visible: document.cookie };
    });
    expect(answers.first).toEqual({ before: null });
    expect(answers.second).toEqual({ before: "set" });
    // Both cookies are HttpOnly: page script sees neither.
    expect(answers.visible).not.toContain("compat_helper");
    expect(answers.visible).not.toContain("compat_count");
    // A server function's loader reads the same cookie while rendering.
    await own.goto(new URL("/compat-cookies", framed.origin).href);
    await expect(own.locator('[data-compat="cookie"]')).toHaveText(
      JSON.stringify({ value: "set" }),
    );
    await own.close();
  });

  test("answers server routes: JSON GET and POST, a redirect, and robots.txt", async ({
    page,
  }) => {
    test.skip(!START_PREVIEW, "Needs the Start preview.");
    await openRoute(page, "/compat-other");
    const frame = previewFrame(page);
    await expect(frame.locator('[data-compat="other"]')).toHaveText("other", {
      timeout: 90_000,
    });
    const answers = await frame.locator("body").evaluate(async () => {
      const get = await fetch("/api/compat?q=hi", { cache: "no-store" });
      const post = await fetch("/api/compat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      });
      const moved = await fetch("/api/compat-redirect", { redirect: "manual" });
      const robots = await fetch("/robots.txt", { cache: "no-store" });
      return {
        get: await get.json(),
        middleware: get.headers.get("x-compat-request-mw"),
        post: await post.json(),
        movedType: moved.type,
        robotsType: robots.headers.get("content-type") ?? "",
        robots: await robots.text(),
      };
    });
    expect(answers.get).toEqual({ ok: true, method: "GET", q: "hi" });
    expect(answers.middleware).toBe("1");
    expect(answers.post).toEqual({ ok: true, method: "POST", body: { hello: "world" } });
    // A manual redirect is opaque to page script; that it was one is the fact.
    expect(answers.movedType).toBe("opaqueredirect");
    expect(answers.robotsType).toMatch(/^text\/plain/);
    expect(answers.robots).toBe("User-agent: *\nAllow: /\n");
  });

  test("navigates with a client Link, keeping the document", async ({ page }) => {
    test.skip(!START_PREVIEW, "Needs the Start preview.");
    await openRoute(page, "/compat");
    const frame = previewFrame(page);
    await expect(frame.locator('[data-compat="loader"]')).toContainText(
      "hello loader",
      { timeout: 90_000 },
    );
    await interactWithTheme(page);
    await markFrame(page);
    await frame.locator('[data-compat="link"]').dispatchEvent("click");
    await expect(frame.locator('[data-compat="other"]')).toHaveText("other");
    // Client navigation, not a document load.
    expect(await frameMarked(page)).toBe(1);
  });

  // Browser history changes the framed URL, which is where the editor's
  // channel is carried; the client-only preview never changed it. The channel
  // is kept for the document (documentPreviewRuntimeChannel), so the page goes
  // on answering the editor's heartbeat instead of being reloaded as dead.
  test("keeps answering the editor after the Theme's own navigation", async ({
    page,
  }) => {
    test.skip(!START_PREVIEW, "Needs the Start preview.");
    await openRoute(page, "/compat");
    const frame = previewFrame(page);
    await expect(frame.locator('[data-compat="loader"]')).toContainText(
      "hello loader",
      { timeout: 90_000 },
    );
    await interactWithTheme(page);
    await markFrame(page);
    await frame.locator('[data-compat="link"]').dispatchEvent("click");
    await expect(frame.locator('[data-compat="other"]')).toHaveText("other");
    // Past the editor's 15 s heartbeat timeout: still the same document.
    await page.waitForTimeout(25_000);
    expect(await frameMarked(page)).toBe(1);
  });

  test("applies a Code-mode save by HMR, keeping the document", async ({
    page,
  }) => {
    test.skip(!START_PREVIEW, "Needs the Start preview.");
    await openRoute(page, "/compat");
    const frame = previewFrame(page);
    await expect(frame.locator('[data-compat="loader"]')).toContainText(
      "hello loader",
      { timeout: 90_000 },
    );
    await interactWithTheme(page);
    await page
      .getByRole("button", { name: "Open src/routes/compat-other.tsx" })
      .click();
    await frame.locator('[data-compat="link"]').dispatchEvent("click");
    await expect(frame.locator('[data-compat="other"]')).toHaveText("other");
    await markFrame(page);
    const before =
      'component: () => <p data-compat="other">{Route.useLoaderData().at}</p>,';
    await saveEditedSource(page, "src/routes/compat-other.tsx", (source) => {
      expect(source).toContain(before);
      return source.replace(
        before,
        'component: () => <><p data-compat="other">{Route.useLoaderData().at}</p><span data-compat="hmr">hmr-applied</span></>,',
      );
    });
    await expect(frame.locator('[data-compat="hmr"]')).toHaveText(
      "hmr-applied",
      { timeout: 60_000 },
    );
    // Applied by HMR: the same document, still marked.
    expect(await frameMarked(page)).toBe(1);
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
