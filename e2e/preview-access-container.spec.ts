import {
  expect,
  test,
  type Browser,
  type Frame,
  type Page,
} from "@playwright/test";

import { openEditor, signedInPage } from "./native-acceptance";

/**
 * #214 P2: a Live Preview's address is not a credential
 * (handoff/2026-10-28/preview-access-design.md §11, P2 a, b, d, e, g).
 *
 * On the container transport the editor frames the preview's `pv-` host
 * through the authorization flow. Every request there must carry a grant that
 * verifies against D1 at that request.
 *
 * - (a) the author's frame shows the draft;
 * - (b) the same address in another browser — signed out, or signed in but
 *   without this frame's grant — gets no draft bytes, document or module;
 * - (d) once a session signs out, its frame's next request is refused, with
 *   no draft bytes;
 * - (e) the same author's other session keeps working throughout;
 * - (g) the Sandbox SDK's own host shape is refused from outside.
 *
 * (c), a stolen code redeemed elsewhere, is proven at the function and HTTP
 * layers (preview-access.test.ts): it needs the binder cookie no other
 * browser has.
 */

const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
const EDITOR_PATH = process.env.E2E_EDITOR_PATH;

test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Run through scripts/run-editor-e2e.mjs: this writes the run's own D1.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "The pv- host fronts the Sandbox container; run with MORPH_E2E_TRANSPORT=cloudflare-sandbox.",
);

const HERO = '[data-storefront-section-id="starter-hero"]';

/** The editor's preview frame once it has come back from the access flow. */
async function previewDocument(page: Page): Promise<Frame> {
  let found: Frame | undefined;
  await expect
    .poll(
      () => {
        found = page
          .frames()
          .find(
            (frame) =>
              new URL(frame.url() || "about:blank").hostname.startsWith(
                "pv-",
              ) &&
              !new URL(frame.url()).pathname.startsWith(
                "/__morph/preview-auth/",
              ),
          );
        return Boolean(found);
      },
      { timeout: 90_000, message: "the preview frame lands on its pv- host" },
    )
    .toBe(true);
  return found!;
}

/** A new context signed in as the E2E user with a session of its own. */
async function ownSessionPage(browser: Browser): Promise<Page> {
  const { baseURL } = test.info().project.use;
  const context = await browser.newContext({ baseURL });
  const signedIn = await context.request.post("/api/auth/sign-in/email", {
    headers: { origin: new URL(baseURL!).origin },
    data: {
      email: process.env.E2E_EMAIL,
      password: process.env.E2E_PASSWORD,
    },
  });
  expect(signedIn.ok(), "a second sign-in for its own session").toBe(true);
  return context.newPage();
}

/** What a request from inside the frame gets, on the frame's own origin. */
function fetchInFrame(frame: Frame, path: string) {
  return frame.evaluate(async (path) => {
    const response = await fetch(path, { cache: "no-store" });
    return { status: response.status, body: await response.text() };
  }, path);
}

test.describe("Live Preview private access on the pv- host", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(15 * 60_000);

  test("verifies every request, and a copied address alone never gets the draft", async ({
    page,
    browser,
  }) => {
    // (a) The author's preview, framed through the flow.
    await openEditor(page);
    const frame = await previewDocument(page);
    const hero = frame.locator(HERO);
    await expect(hero, "the author's frame shows the draft").toBeVisible({
      timeout: 90_000,
    });
    const marker = (await hero.innerText()).trim().split("\n")[0]!.trim();
    expect(marker.length, "a draft marker to look for").toBeGreaterThan(3);

    const framedUrl = new URL(frame.url());
    expect(framedUrl.hostname).toMatch(/^pv-[0-9a-f]{32}\./);
    // The SDK address, with its port token, never reaches the browser.
    const srcs = await page
      .locator("iframe")
      .evaluateAll((frames) => frames.map((f) => (f as HTMLIFrameElement).src));
    for (const src of [...srcs, frame.url()]) {
      expect(new URL(src).hostname, src).not.toMatch(/^\d{4,5}-/);
    }

    // (b) The same address in a browser with no session.
    const stranger = await browser.newContext();
    try {
      const response = await stranger.request.get(framedUrl.toString(), {
        maxRedirects: 0,
      });
      expect(response.status()).toBe(401);
      expect(await response.text()).not.toContain(marker);
      // Modules too, the draft snapshot among them.
      for (const path of [
        "/@vite/client",
        "/src/morph/preview-content-snapshot.ts",
      ]) {
        const module = await stranger.request.get(
          new URL(path, framedUrl).toString(),
        );
        expect(module.status(), path).toBe(401);
        expect(await module.text(), path).not.toContain(marker);
      }
    } finally {
      await stranger.close();
    }

    // (b) A signed-in browser without this frame's grant gets nothing either:
    // the Morph session is not a preview credential.
    const signedIn = await signedInPage(browser);
    try {
      const response = await signedIn.request.get(framedUrl.toString(), {
        maxRedirects: 0,
      });
      expect(response.status()).toBe(401);
      expect(await response.text()).not.toContain(marker);
    } finally {
      await signedIn.context().close();
    }

    // (g) The SDK host shape is closed from outside.
    const parent = framedUrl.hostname.split(".").slice(1).join(".");
    const sdkShaped = new URL(framedUrl);
    sdkShaped.hostname = `5173-${"a".repeat(32)}-tokentoken.${parent}`;
    const sdk = await page.request.get(sdkShaped.toString(), {
      maxRedirects: 0,
    });
    expect(sdk.status(), "an SDK-shaped host is refused").toBe(404);

    // (d, e) A second session of the same author previews on its own grant;
    // signing it out refuses its next request and leaves the first alone.
    const second = await ownSessionPage(browser);
    try {
      await openEditor(second);
      const secondFrame = await previewDocument(second);
      await expect(secondFrame.locator(HERO)).toBeVisible({ timeout: 90_000 });
      expect((await fetchInFrame(secondFrame, framedUrl.pathname)).status).toBe(
        200,
      );

      const signedOut = await second
        .context()
        .request.post("/api/auth/sign-out", {
          headers: { origin: new URL(test.info().project.use.baseURL!).origin },
          data: {},
        });
      expect(signedOut.ok(), "the second session signs out").toBe(true);

      const refused = await fetchInFrame(secondFrame, framedUrl.pathname);
      expect(refused.status, "the signed-out session's next request").toBe(403);
      expect(refused.body).not.toContain(marker);

      // A status, not the marker: the client-only runtime's document is a
      // shell its scripts fill in.
      const stillServed = await fetchInFrame(frame, framedUrl.pathname);
      expect(stillServed.status, "the author's other session").toBe(200);
      await expect(frame.locator(HERO)).toBeVisible();
    } finally {
      await second.context().close();
    }
  });
});
