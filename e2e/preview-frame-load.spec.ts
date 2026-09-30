import {
  expect,
  test,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";
import { EDITOR_PATH, previewFrame } from "./helpers";

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
/**
 * How long the bridge's own modules wait. The editor leaves the loading phase
 * as soon as the bridge answers, so holding it is what keeps the frame in the
 * phase under test for longer than the old deadline.
 */
const BRIDGE_HELD_MS = 55_000;

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
    const documents = countFrameDocuments(page);
    let firstAt: number | null = null;
    let queue = Promise.resolve();

    await page.route("**/*", async (route) => {
      const request = route.request();
      if (!isPreviewSubresource(page, request)) return route.fallback();
      firstAt ??= Date.now();
      if (new URL(request.url()).pathname.includes("/src/morph/")) {
        await sleep(firstAt + BRIDGE_HELD_MS - Date.now());
      } else {
        const turn = queue.then(() => sleep(SPACING_MS));
        queue = turn;
        await turn;
      }
      await answer(route);
    });

    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const loading = page
      .getByRole("status")
      .filter({ hasText: "Loading React preview…" });
    await expect(loading).toBeVisible({ timeout: 180_000 });
    const loadingSince = Date.now();

    // Still loading, still the first frame, well past the old deadline.
    await sleep(loadingSince + OLD_DEADLINE_MS + 5_000 - Date.now());
    await expect(loading).toBeVisible({ timeout: 1_000 });
    expect(documents, "the frame should not have been reloaded").toHaveLength(
      1,
    );

    await expect(
      previewFrame(page).locator("[data-storefront-section-id]").first(),
    ).toBeAttached({ timeout: 120_000 });
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

    // The first few requests go through, so the page has started and said
    // so; everything after that is never answered.
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (!isPreviewSubresource(page, request)) return route.fallback();
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

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await alert.getByRole("button", { name: "Retry Preview" }).click();
    await expect(
      previewFrame(page).locator("[data-storefront-section-id]").first(),
    ).toBeAttached({ timeout: 120_000 });
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});
