import { expect, test, type Page } from "@playwright/test";
import { EDITOR_PATH, previewFrame } from "./helpers";
import { openEditor, signedInPage } from "./native-acceptance";
import { writeThemeFiles } from "./native-compat";
import {
  DETAIL_ROUTE,
  DRAFT_MARKER_TEXT,
  HOME_ROUTE,
  NAV_FILES_DRAFT,
  removeNavMatrixFiles,
  scope,
} from "./navigation-matrix-fixture";

test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

async function exitSectionSelectionMode(page: Page) {
  const selectionButton = page.locator(
    'button[aria-label="Disable section selection"][aria-pressed="true"]',
  );
  if (await selectionButton.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await selectionButton.click();
    await expect(
      page.locator('button[aria-label="Enable section selection"]'),
    ).toBeVisible({ timeout: 5_000 });
  }
}

async function openEditorAtRoute(page: Page, routePath: string) {
  const url = new URL(EDITOR_PATH!, "http://placeholder");
  url.searchParams.set("routePath", routePath);
  await page.goto(`${url.pathname}${url.search}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  await exitSectionSelectionMode(page);
}

test.describe("Controlled repro: held frame-follow set-route(detail) after history.back()", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signedInPage(page);
      await openEditor(page);
      await writeThemeFiles(page, scope(), NAV_FILES_DRAFT);
    } finally {
      await context.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signedInPage(page);
      await openEditor(page);
      await removeNavMatrixFiles(page);
    } finally {
      await context.close();
    }
  });

  test("1. Repro: releasing held frame-follow set-route(detail) after history.back()", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.addInitScript(() => {
      const w = window as unknown as Record<string, any>;
      if (window === window.top) {
        w.__diagTopMessages = [];
        window.addEventListener(
          "message",
          (event: MessageEvent) => {
            const type = event.data?.type;
            if (
              type === "morph:storefront-preview-structure" ||
              type === "morph:storefront-preview-route-applied"
            ) {
              w.__diagTopMessages.push({
                t: Date.now(),
                type,
                routePath: event.data?.routePath ?? null,
                routeRequestId: event.data?.routeRequestId ?? null,
              });
            }
          },
          true,
        );
        return;
      }

      w.__diagFrameEvents = [];
      w.__morphHoldDetailSetRoute = false;
      w.__morphHeldSetRoutes = [];

      window.addEventListener("popstate", () => {
        w.__diagFrameEvents.push({
          t: Date.now(),
          kind: "popstate",
          pathname: window.location.pathname,
        });
      });

      window.addEventListener(
        "message",
        (event: MessageEvent) => {
          if (event.data?.type === "morph:storefront-preview-set-route") {
            const held =
              w.__morphHoldDetailSetRoute === true &&
              event.data?.routePath === "/e2e-nav-matrix-detail";
            w.__diagFrameEvents.push({
              t: Date.now(),
              kind: held ? "set-route-held" : "set-route-delivered",
              routePath: event.data?.routePath ?? null,
              routeRequestId: event.data?.routeRequestId ?? null,
              pathname: window.location.pathname,
            });
            if (held) {
              event.stopImmediatePropagation();
              w.__morphHeldSetRoutes.push({
                data: event.data,
                origin: event.origin,
                source: event.source,
              });
            }
          }
        },
        true,
      );

      w.__morphReleaseHeldSetRoutes = () => {
        w.__morphHoldDetailSetRoute = false;
        const held = w.__morphHeldSetRoutes.splice(0);
        for (const item of held) {
          w.__diagFrameEvents.push({
            t: Date.now(),
            kind: "set-route-released",
            routePath: item.data?.routePath ?? null,
            routeRequestId: item.data?.routeRequestId ?? null,
            pathname: window.location.pathname,
          });
          window.dispatchEvent(
            new MessageEvent("message", {
              data: item.data,
              origin: item.origin,
              source: item.source,
            }),
          );
        }
        return held.length;
      };
    });

    await openEditorAtRoute(page, HOME_ROUTE);
    const frame = previewFrame(page);
    const homeTitle = frame.locator('[data-e2e="nav-matrix-home-title"]');
    const detailTitle = frame.locator('[data-e2e="nav-matrix-detail-title"]');

    await expect(homeTitle).toBeVisible({ timeout: 45_000 });
    await expect(
      frame.locator('script[src*="__morph_preview_client.ts"]'),
    ).toBeAttached({ timeout: 15_000 });

    // Arm hold only for the real frame-follow set-route(detail) generated by the editor.
    await frame.locator("body").evaluate(() => {
      (window as unknown as Record<string, any>).__morphHoldDetailSetRoute = true;
    });

    await frame.locator('[data-e2e="nav-matrix-link-to-detail"]').click();
    await expect(detailTitle).toBeVisible({ timeout: 30_000 });
    await expect(homeTitle).toHaveCount(0);
    await expect(
      frame.locator('[data-e2e="nav-matrix-draft-marker"]'),
    ).toHaveText(DRAFT_MARKER_TEXT);

    // Wait until the editor actually emitted set-route(detail) following the frame.
    await expect
      .poll(
        async () =>
          frame
            .locator("body")
            .evaluate(
              () =>
                (window as unknown as Record<string, any>).__morphHeldSetRoutes
                  .length,
            ),
        { timeout: 15_000 },
      )
      .toBeGreaterThanOrEqual(1);

    // Navigate back inside the preview frame and confirm it landed on home.
    await frame.locator("body").evaluate(() => {
      window.history.back();
    });
    await expect(homeTitle).toBeVisible({ timeout: 30_000 });
    await expect(detailTitle).toHaveCount(0);
    const pathnameBeforeRelease = await frame
      .locator("body")
      .evaluate(() => window.location.pathname);
    expect(pathnameBeforeRelease).toBe(HOME_ROUTE);

    // Release the held real set-route(detail) message.
    const releasedCount = await frame.locator("body").evaluate(() => {
      return (
        window as unknown as Record<string, any>
      ).__morphReleaseHeldSetRoutes();
    });
    expect(releasedCount).toBeGreaterThanOrEqual(1);

    // Give the router/bridge a short window to process the released message, then inspect.
    await page.waitForTimeout(600);

    const pathnameAfterRelease = await frame
      .locator("body")
      .evaluate(() => window.location.pathname);
    const frameEvents = await frame
      .locator("body")
      .evaluate(() => (window as unknown as Record<string, any>).__diagFrameEvents);
    const topMessages = await page.evaluate(
      () => (window as unknown as Record<string, any>).__diagTopMessages,
    );

    console.log(
      "[controlled-repro] pathnameBeforeRelease=",
      pathnameBeforeRelease,
      "pathnameAfterRelease=",
      pathnameAfterRelease,
    );
    console.log("[controlled-repro] frameEvents=", JSON.stringify(frameEvents));
    console.log("[controlled-repro] topMessages=", JSON.stringify(topMessages));

    expect(pathnameAfterRelease).toBe(HOME_ROUTE);
  });

  test("2. Control: author selects /e2e-nav-matrix-detail from editor page list", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openEditorAtRoute(page, HOME_ROUTE);
    const frame = previewFrame(page);
    const homeTitle = frame.locator('[data-e2e="nav-matrix-home-title"]');
    const detailTitle = frame.locator('[data-e2e="nav-matrix-detail-title"]');

    await expect(homeTitle).toBeVisible({ timeout: 45_000 });
    await page
      .locator('button[title="Preview /e2e-nav-matrix-detail"]')
      .click();

    await expect(detailTitle).toBeVisible({ timeout: 30_000 });
    await expect(homeTitle).toHaveCount(0);
    const framePathname = await frame
      .locator("body")
      .evaluate(() => window.location.pathname);
    expect(framePathname).toBe(DETAIL_ROUTE);
  });
});
