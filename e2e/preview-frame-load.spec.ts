import {
  expect,
  test,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";
import {
  EDITOR_PATH,
  enableSelection,
  openEditor,
  previewFrame,
} from "./helpers";

/**
 * How long the editor waits for a Live Preview frame that is still loading.
 *
 * It used to be a fixed 45 seconds from the frame being created, which
 * reloaded a cold page that was still fetching its module graph — measured on
 * a slow sandbox, where the reload also threw away everything already
 * fetched. It is now measured from the page's last reported progress. These
 * two cases control the frame's network to show both halves of that: a page
 * that keeps moving is waited for past the old deadline, and a page that
 * stops is still given up on, once automatically and then with the author's
 * retry.
 *
 * Only requests made from inside the preview frame are held. The frame's own
 * document always goes through, so its first script — the one that reports
 * progress — always runs.
 */

/** Past the old fixed deadline, which is what this has to outlast. */
const OLD_DEADLINE_MS = 45_000;
/** Time between the frame's requests, so progress trickles in. */
const SPACING_MS = 800;
function isPreviewSubresource(page: Page, request: Request) {
  if (request.isNavigationRequest()) return false;
  try {
    return request.frame() !== page.mainFrame();
  } catch {
    // A request with no frame, such as a service worker's, is not the frame's.
    return false;
  }
}

/** Every document the preview frame loads: one per attempt to show it. */
function countFrameDocuments(page: Page) {
  const documents: number[] = [];
  page.on("request", (request) => {
    if (!request.isNavigationRequest()) return;
    if (request.frame() === page.mainFrame()) return;
    documents.push(Date.now());
  });
  return documents;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

async function answer(route: Route) {
  // The frame may have been replaced while this request was held.
  await route.continue().catch(() => undefined);
}

test.describe("a Live Preview frame that is slow to load", () => {
  test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to open the editor.");

  test("is waited for while it keeps making progress", async ({ page }) => {
    test.setTimeout(300_000);
    // Settle workspace/config HMR before measuring a deliberate new frame.
    // CI previously replaced the initial frame during app reload; its old
    // network timestamp then released the bridge before the assertion.
    await openEditor(page);
    const documents = countFrameDocuments(page);
    let queue = Promise.resolve();
    let releaseBridge!: () => void;
    const bridgeGate = new Promise<void>((resolve) => {
      releaseBridge = resolve;
    });
    let heldBridgeRequests = 0;

    await page.route("**/*", async (route) => {
      const request = route.request();
      if (!isPreviewSubresource(page, request)) return route.fallback();
      if (new URL(request.url()).pathname.includes("/src/morph/")) {
        heldBridgeRequests += 1;
        await bridgeGate;
      } else {
        const turn = queue.then(() => sleep(SPACING_MS));
        queue = turn;
        await Promise.race([turn, bridgeGate]);
      }
      await answer(route);
    });

    const loading = page
      .getByRole("status")
      .filter({ hasText: "Loading React preview…" });
    try {
      await page
        .getByRole("button", { name: "Refresh preview", exact: true })
        .click();
      await expect(loading).toBeVisible({ timeout: 180_000 });
      await expect.poll(() => heldBridgeRequests).toBeGreaterThan(0);
      expect(documents, "one new controlled frame").toHaveLength(1);

      // The bridge cannot become ready until the assertion has run, regardless
      // of when the main frame paints Loading or how busy the runner is.
      await sleep(documents[0] + OLD_DEADLINE_MS + 5_000 - Date.now());
      await expect(loading).toBeVisible({ timeout: 1_000 });
      expect(documents, "the frame should not have been reloaded").toHaveLength(
        1,
      );
      await expect(page.getByRole("alert")).toHaveCount(0);
    } finally {
      releaseBridge();
    }

    await expect(
      previewFrame(page).locator("[data-storefront-section-id]").first(),
    ).toBeAttached({ timeout: 120_000 });
    await expect(loading).not.toBeVisible({ timeout: 120_000 });
    expect(documents, "the frame should not have been reloaded").toHaveLength(
      1,
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("is given up on once it stops, and can then be retried", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const documents = countFrameDocuments(page);
    let answered = 0;
    let retried = false;

    // The first few requests go through, so the page has started and said
    // so; everything after that is never answered — not even after Retry,
    // so the stalled frame cannot recover by itself and only a working Retry
    // can bring the preview back. Requests made after Retry go through.
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (!isPreviewSubresource(page, request)) return route.fallback();
      if (retried) return answer(route);
      if (answered >= 10) return;
      answered += 1;
      await answer(route);
    });

    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("status").filter({ hasText: "Loading React preview…" }),
    ).toBeVisible({ timeout: 180_000 });

    // One automatic reconnect, which stalls the same way, and then the
    // author is told — not a third attempt.
    const alert = page.getByRole("alert").filter({
      hasText: "Live Preview loading timed out: it stopped making progress",
    });
    await expect(alert).toBeVisible({ timeout: 2 * OLD_DEADLINE_MS + 60_000 });
    expect(
      documents,
      "one automatic reconnect, then no more attempts",
    ).toHaveLength(2);

    retried = true;
    // A real pointer press, as an author makes it: the canvas behind the
    // alert used to capture the pointer and swallow the click.
    await alert.getByRole("button", { name: "Retry Preview" }).click();
    await expect(
      previewFrame(page).locator("[data-storefront-section-id]").first(),
    ).toBeAttached({ timeout: 120_000 });
    await expect(page.getByRole("alert")).toHaveCount(0);
    // Brought back by a new frame, not by the stalled one recovering.
    expect(documents.length, "a new frame after Retry").toBeGreaterThan(2);
  });
});

/**
 * A preview page whose modules a runtime interruption refused.
 *
 * When the Sandbox runtime is interrupted for longer than the proxy's bounded
 * retries, the proxy answers the module read with its interruption status
 * (preview-runtime-interruption.ts). The module's graph fails for that
 * document, and the container is serving again a moment later — so no server
 * check finds anything wrong, and the page used to sit on "Loading React
 * preview…" until the load watchdog's no-progress window ran out.
 *
 * These cases answer one bridge module with exactly what the proxy sends, from
 * inside the frame's network, and show the editor reconnecting the frame as
 * soon as the page reports it — well inside the watchdog's window — and, when
 * the interruption does not end, giving up after that one reconnect.
 */
const INTERRUPTED_MODULE = "/src/morph/preview/preview-sizing-css.ts";

function interruptedModule() {
  return {
    status: 503,
    contentType: "application/json",
    headers: { "Cache-Control": "no-store" },
    body: JSON.stringify({
      error:
        "Live Preview's runtime was interrupted while serving this module. Reload the preview.",
      code: "PREVIEW_RUNTIME_INTERRUPTED",
    }),
  };
}

function collectLifecycle(page: Page) {
  const lines: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("[preview-lifecycle]")) lines.push(text);
  });
  return lines;
}

test.describe("a Live Preview frame whose modules an interruption refused", () => {
  test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to open the editor.");

  test("is reconnected at once, without waiting for the load watchdog", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const documents = countFrameDocuments(page);
    const lifecycle = collectLifecycle(page);
    let refused = 0;

    // Only the first document's request is refused, as an interruption that
    // has ended by the time the frame is loaded again.
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (!isPreviewSubresource(page, request)) return route.fallback();
      if (
        documents.length === 1 &&
        new URL(request.url()).pathname.endsWith(INTERRUPTED_MODULE)
      ) {
        refused += 1;
        return route.fulfill(interruptedModule());
      }
      await answer(route);
    });

    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    await expect
      .poll(() => documents.length, { timeout: 180_000 })
      .toBeGreaterThanOrEqual(2);
    // Sections alone prove nothing: the refused module is the bridge's, so the
    // broken document still renders the Theme. A working bridge in the new
    // document does — the step the interrupted run never got past.
    await enableSelection(page);

    expect(refused, "the first document asked for the module").toBe(1);
    expect(documents, "one reconnect, to a new document").toHaveLength(2);
    // Reconnected because the page said why, not because it fell silent.
    expect(documents[1] - documents[0]).toBeLessThan(OLD_DEADLINE_MS);
    expect(lifecycle).toContainEqual(
      expect.stringMatching(
        /^\[preview-lifecycle\] reconnecting recoveries=1 \| Live Preview was interrupted while loading/,
      ),
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("is given up on after one reconnect if the interruption goes on", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const documents = countFrameDocuments(page);
    let retried = false;

    await page.route("**/*", async (route) => {
      const request = route.request();
      if (!isPreviewSubresource(page, request)) return route.fallback();
      if (
        !retried &&
        new URL(request.url()).pathname.endsWith(INTERRUPTED_MODULE)
      ) {
        return route.fulfill(interruptedModule());
      }
      await answer(route);
    });

    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const alert = page.getByRole("alert").filter({
      hasText: "Live Preview was interrupted while loading",
    });
    await expect(alert).toBeVisible({ timeout: 180_000 });
    expect(
      documents,
      "one automatic reconnect, then no more attempts",
    ).toHaveLength(2);
    expect(documents[1] - documents[0]).toBeLessThan(OLD_DEADLINE_MS);

    retried = true;
    await alert.getByRole("button", { name: "Retry Preview" }).click();
    await expect
      .poll(() => documents.length, { timeout: 120_000 })
      .toBeGreaterThan(2);
    await enableSelection(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});
