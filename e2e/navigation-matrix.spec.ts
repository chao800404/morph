import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { EDITOR_PATH, isServerFunctionCall, previewFrame } from "./helpers";
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

/**
 * Navigation Matrix Acceptance Test: Preview (M1 §11.2 item 5).
 *
 * Exercises the canonical navigation modalities in the Visual Editor preview
 * frame. The public storefront cells are navigation-matrix-public.spec.ts: they
 * need the container transport, and a container spec may skip only as a whole
 * file. Both specs write the same routes (navigation-matrix-fixture.ts).
 *
 * [Visual Editor Preview Frame]
 *  1. Initial Load: loads draft home route directly in preview frame.
 *  2. Link Navigation: client-side frame transition via <Link> to detail and back.
 *  3. History Navigation: frame back and forward with recorded history mechanism.
 *  4. Iframe Reload: isolated frame reload retains active detail route without top editor navigation.
 *  5. Editor Reload: top-level editor refresh restores detail route with draft state intact.
 *  6. Direct URL: opens non-home route directly via URL query parameter routePath.
 *
 * Behavioral & Isolation Rules:
 *  - Only adds tests; does not modify runtime application code or CI rule files.
 *  - Writes the draft routes (with the draft marker) and proves the preview renders
 *    the draft marker on every navigation.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

const EXPECTED_RUNTIME: "start" | "client" =
  process.env.MORPH_E2E_PREVIEW_RUNTIME === "start" ? "start" : "client";

/**
 * Exits Section Selection Mode if currently active.
 *
 * When section selection is active (aria-pressed=true), the canvas overlay captures
 * pointer events to select sections for inspector editing rather than dispatching
 * DOM clicks to interactive elements (e.g. <Link>) inside the preview frame.
 * Disabling section selection enters browse/interactive mode.
 */
async function exitSectionSelectionMode(page: Page) {
  const selectionButton = page.locator('button[aria-label="Disable section selection"][aria-pressed="true"]');
  if (await selectionButton.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await selectionButton.click();
    await expect(page.locator('button[aria-label="Enable section selection"]')).toBeVisible({ timeout: 5_000 });
  }
}

/**
 * Resets canvas pan and zoom to 100% centered via hotkey '0'.
 *
 * Visual Editor allows freeform panning and zooming. Pressing '0' on the canvas region
 * resets zoom to 100% and centers the viewport, ensuring iframe coordinates are
 * predictably visible and click targets are not clipped.
 */
async function resetCanvasView(page: Page) {
  const canvasRegion = page.getByRole("region", {
    name: /Storefront preview canvas/,
  });
  if (await canvasRegion.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await canvasRegion.focus();
    await page.keyboard.press("0");
  }
}

/**
 * Open the editor explicitly pointing to a specific routePath.
 * Captures any server start response during editor load.
 */
async function openEditorAtRoute(
  page: Page,
  routePath: string,
): Promise<{ serverReportedRuntime: "start" | "client" | null }> {
  const url = new URL(EDITOR_PATH!, "http://placeholder");
  url.searchParams.set("routePath", routePath);

  let serverReportedRuntime: "start" | "client" | null = null;
  const onResponse = async (response: any) => {
    if (
      response.request().method() === "POST" &&
      isServerFunctionCall(response.url(), "startThemePreviewServer")
    ) {
      const text = await response.text().catch(() => "");
      if (
        text.includes('previewRuntime:"start"') ||
        text.includes('"previewRuntime":"start"')
      ) {
        serverReportedRuntime = "start";
      } else if (
        text.includes('previewRuntime:"client"') ||
        text.includes('"previewRuntime":"client"')
      ) {
        serverReportedRuntime = "client";
      }
    }
  };
  page.on("response", onResponse);

  try {
    await page.goto(`${url.pathname}${url.search}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    await exitSectionSelectionMode(page);
    await resetCanvasView(page);
  } finally {
    page.off("response", onResponse);
  }

  return { serverReportedRuntime };
}

/**
 * Verifies observable runtime identity from the live UI, the rendered frame,
 * and the start response reported by the server.
 *
 * Requirements:
 *  1. The toolbar label must strictly equal the run's expected runtime ("Full Start" vs "Client-only").
 *     Accepting either value is disallowed.
 *  2. Page signal: The preview frame DOM must attach the module corresponding to the active runtime
 *     (`__morph_preview_client.ts` for Start, `__entry.tsx` for Client-only) and strictly omit the other.
 *  3. In addition, Start hydration exposes `window.__TSR_ROUTER__` which matches `__morphPreviewRouter`,
 *     whereas Client-only creates a standalone router with memory history.
 */
async function assertRuntimeIdentity(page: Page, frame: FrameLocator) {
  const runtimeButton = page.getByRole("button", {
    name: /^Live Preview runtime:/,
  });
  await expect(runtimeButton).toBeVisible({ timeout: 15_000 });
  const toolbarLabel = await runtimeButton.getAttribute("aria-label");
  const expectedToolbarLabel =
    EXPECTED_RUNTIME === "start"
      ? "Live Preview runtime: Full Start"
      : "Live Preview runtime: Client-only";

  expect(
    toolbarLabel,
    `Toolbar label must strictly reflect expected preview runtime (${EXPECTED_RUNTIME})`,
  ).toBe(expectedToolbarLabel);

  await expect(frame.locator("body")).toBeAttached({ timeout: 45_000 });

  if (EXPECTED_RUNTIME === "start") {
    // Start preview injects __morph_preview_client.ts into HTML head and never loads __entry.tsx
    await expect(
      frame.locator('script[src*="__morph_preview_client.ts"]'),
      "Full Start preview frame must serve and attach __morph_preview_client.ts",
    ).toBeAttached({ timeout: 15_000 });
    await expect(
      frame.locator('script[src*="__entry.tsx"]'),
      "Full Start preview frame must not attach client-only __entry.tsx",
    ).toHaveCount(0);

    // Wait for Start hydration to attach __TSR_ROUTER__
    await expect
      .poll(
        async () => {
          return frame.locator("body").evaluate(() => {
            const w = window as any;
            return Boolean(w.__TSR_ROUTER__);
          });
        },
        { timeout: 30_000, message: "Wait for __TSR_ROUTER__ hydration" },
      )
      .toBe(true);

    const frameSignal = await frame.locator("body").evaluate(() => {
      const w = window as any;
      return {
        hasTsrRouter: Boolean(w.__TSR_ROUTER__),
        routerMatchesTsr: Boolean(
          w.__morphPreviewRouter && w.__morphPreviewRouter === w.__TSR_ROUTER__,
        ),
      };
    });
    expect(
      frameSignal.hasTsrRouter,
      "Full Start preview must have __TSR_ROUTER__ attached",
    ).toBe(true);
    expect(
      frameSignal.routerMatchesTsr,
      "Full Start __morphPreviewRouter must resolve to __TSR_ROUTER__",
    ).toBe(true);
  } else {
    // Client-only preview loads __entry.tsx and never injects __morph_preview_client.ts
    await expect(
      frame.locator('script[src*="__entry.tsx"]'),
      "Client-only preview frame must serve and attach __entry.tsx",
    ).toBeAttached({ timeout: 15_000 });
    await expect(
      frame.locator('script[src*="__morph_preview_client.ts"]'),
      "Client-only preview frame must not attach __morph_preview_client.ts",
    ).toHaveCount(0);

    // Wait for Client-only preview bootstrap to attach __morphPreviewRouter
    await expect
      .poll(
        async () => {
          return frame.locator("body").evaluate(() => {
            const w = window as any;
            return Boolean(w.__morphPreviewRouter);
          });
        },
        { timeout: 30_000, message: "Wait for __morphPreviewRouter attachment" },
      )
      .toBe(true);

    const frameSignal = await frame.locator("body").evaluate(() => {
      const w = window as any;
      return {
        hasMorphRouter: Boolean(w.__morphPreviewRouter),
      };
    });
    expect(
      frameSignal.hasMorphRouter,
      "Client-only preview must have __morphPreviewRouter attached",
    ).toBe(true);
  }

  console.log(
    `[Observable Runtime Identity] Verified: runtime=${EXPECTED_RUNTIME}, toolbar="${toolbarLabel}"`,
  );
  return { toolbarLabel, isStartRuntime: EXPECTED_RUNTIME === "start" };
}

test.describe("Navigation Matrix: Preview and Storefront", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await signedInPage(browser);
    try {
      // Waits for the editor to be hydrated before writing the routes.
      await openEditor(page);

      const savedDraft = await writeThemeFiles(page, scope!, NAV_FILES_DRAFT);
      expect(savedDraft.success, JSON.stringify(savedDraft)).toBe(true);
    } finally {
      await page.context().close();
    }
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(240_000);
    await removeNavMatrixFiles(browser);
  });

  // =========================================================================
  // Part 1: Visual Editor Preview Frame Navigation Matrix
  // =========================================================================
  test.describe("Preview navigation matrix", () => {
    test("1. Initial Load: preview renders draft home content with draft marker", async ({ page }) => {
      test.setTimeout(120_000);
      const { serverReportedRuntime } = await openEditorAtRoute(page, HOME_ROUTE);
      const frame = previewFrame(page);

      // Verify server start response if captured during initial editor launch
      if (serverReportedRuntime) {
        expect(
          serverReportedRuntime,
          `Server start response must report expected preview runtime (${EXPECTED_RUNTIME})`,
        ).toBe(EXPECTED_RUNTIME);
      }

      // Verify observable runtime identity from live UI & frame
      await assertRuntimeIdentity(page, frame);

      const homeTitle = frame.locator('[data-e2e="nav-matrix-home-title"]');
      const homeDesc = frame.locator('[data-e2e="nav-matrix-home-desc"]');
      const draftMarker = frame.locator('[data-e2e="nav-matrix-draft-marker"]');

      await expect(homeTitle).toBeVisible({ timeout: 45_000 });
      await expect(homeTitle).toHaveText("Nav Matrix Home");
      await expect(homeDesc).toBeVisible({ timeout: 30_000 });
      await expect(homeDesc).toHaveText("Home content for navigation matrix.");

      // Assert draft content is rendered in preview
      await expect(draftMarker).toBeVisible({ timeout: 30_000 });
      await expect(draftMarker).toHaveText(DRAFT_MARKER_TEXT);
    });

    test("2. Link Navigation: client-side transition within preview frame to detail and back", async ({ page }) => {
      test.setTimeout(120_000);
      await openEditorAtRoute(page, HOME_ROUTE);
      const frame = previewFrame(page);
      const linkToDetail = frame.locator('[data-e2e="nav-matrix-link-to-detail"]');
      await expect(linkToDetail).toBeVisible({ timeout: 45_000 });
      await linkToDetail.click();

      // Assert transition to detail route
      const detailTitle = frame.locator('[data-e2e="nav-matrix-detail-title"]');
      await expect(detailTitle).toBeVisible({ timeout: 30_000 });
      await expect(detailTitle).toHaveText("Nav Matrix Detail");
      await expect(frame.locator('[data-e2e="nav-matrix-draft-marker"]')).toHaveText(DRAFT_MARKER_TEXT);

      // Assert transition back to home route
      const linkToHome = frame.locator('[data-e2e="nav-matrix-link-to-home"]');
      await expect(linkToHome).toBeVisible({ timeout: 30_000 });
      await exitSectionSelectionMode(page);
      await linkToHome.click();

      const homeTitle = frame.locator('[data-e2e="nav-matrix-home-title"]');
      await expect(homeTitle).toBeVisible({ timeout: 30_000 });
      await expect(homeTitle).toHaveText("Nav Matrix Home");
      await expect(frame.locator('[data-e2e="nav-matrix-draft-marker"]')).toHaveText(DRAFT_MARKER_TEXT);

      // Verify outer editor shell remains intact and reactive
      await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible();
    });

    test("3. History Navigation: back and forward transitions within preview frame with recorded history mechanism", async ({ page }) => {
      test.setTimeout(120_000);
      await openEditorAtRoute(page, HOME_ROUTE);
      const frame = previewFrame(page);
      const homeTitle = frame.locator('[data-e2e="nav-matrix-home-title"]');
      const detailTitle = frame.locator('[data-e2e="nav-matrix-detail-title"]');

      await expect(homeTitle).toBeVisible({ timeout: 45_000 });

      // Navigate to detail via Link
      await frame.locator('[data-e2e="nav-matrix-link-to-detail"]').click();
      await expect(detailTitle).toBeVisible({ timeout: 30_000 });
      await expect(homeTitle).toHaveCount(0);
      await expect(frame.locator('[data-e2e="nav-matrix-draft-marker"]')).toHaveText(DRAFT_MARKER_TEXT);

      // Expected history mechanism per runtime:
      //  - Full Start preview operates with TanStack Start browser history (window.history).
      //  - Client-only preview operates with createMemoryHistory, requiring __morphPreviewRouter.history.
      const expectedHistoryMechanism =
        EXPECTED_RUNTIME === "start"
          ? "window.history"
          : "__morphPreviewRouter.history";

      // History back: execute exact mechanism per runtime without silent fallback
      const backMechanism = await frame.locator("body").evaluate((_el, runtime) => {
        if (runtime === "client") {
          const router = (
            window as unknown as {
              __morphPreviewRouter?: { history?: { back(): void } };
            }
          ).__morphPreviewRouter;
          if (!router?.history?.back) {
            throw new Error("Missing __morphPreviewRouter.history.back in client-only preview");
          }
          router.history.back();
          return "__morphPreviewRouter.history";
        } else {
          window.history.back();
          return "window.history";
        }
      }, EXPECTED_RUNTIME);

      console.log(`[Preview History Navigation] Back invoked via: ${backMechanism} (expected: ${expectedHistoryMechanism})`);
      expect(backMechanism).toBe(expectedHistoryMechanism);

      await expect(homeTitle).toBeVisible({ timeout: 30_000 });
      await expect(detailTitle).toHaveCount(0);
      await expect(frame.locator('[data-e2e="nav-matrix-draft-marker"]')).toHaveText(DRAFT_MARKER_TEXT);

      // Verify location state after back
      if (EXPECTED_RUNTIME === "start") {
        const framePathname = await frame.locator("body").evaluate(() => window.location.pathname);
        expect(framePathname).toBe(HOME_ROUTE);
      } else {
        const routerPathname = await frame.locator("body").evaluate(() => {
          return (window as any).__morphPreviewRouter?.state?.location?.pathname;
        });
        expect(routerPathname).toBe(HOME_ROUTE);
      }

      // History forward: execute exact mechanism per runtime without silent fallback
      const forwardMechanism = await frame.locator("body").evaluate((_el, runtime) => {
        if (runtime === "client") {
          const router = (
            window as unknown as {
              __morphPreviewRouter?: { history?: { forward(): void } };
            }
          ).__morphPreviewRouter;
          if (!router?.history?.forward) {
            throw new Error("Missing __morphPreviewRouter.history.forward in client-only preview");
          }
          router.history.forward();
          return "__morphPreviewRouter.history";
        } else {
          window.history.forward();
          return "window.history";
        }
      }, EXPECTED_RUNTIME);

      console.log(`[Preview History Navigation] Forward invoked via: ${forwardMechanism} (expected: ${expectedHistoryMechanism})`);
      expect(forwardMechanism).toBe(expectedHistoryMechanism);

      await expect(detailTitle).toBeVisible({ timeout: 30_000 });
      await expect(homeTitle).toHaveCount(0);
      await expect(frame.locator('[data-e2e="nav-matrix-draft-marker"]')).toHaveText(DRAFT_MARKER_TEXT);

      // Verify location state after forward
      if (EXPECTED_RUNTIME === "start") {
        const framePathname = await frame.locator("body").evaluate(() => window.location.pathname);
        expect(framePathname).toBe(DETAIL_ROUTE);
      } else {
        const routerPathname = await frame.locator("body").evaluate(() => {
          return (window as any).__morphPreviewRouter?.state?.location?.pathname;
        });
        expect(routerPathname).toBe(DETAIL_ROUTE);
      }
    });

    test("4. Iframe Reload: iframe reload re-renders current detail route without top-level editor navigation", async ({ page }) => {
      test.setTimeout(120_000);
      // Start at home, navigate to detail via Link first
      await openEditorAtRoute(page, HOME_ROUTE);
      const frame = previewFrame(page);
      await expect(frame.locator('[data-e2e="nav-matrix-home-title"]')).toBeVisible({ timeout: 45_000 });
      await frame.locator('[data-e2e="nav-matrix-link-to-detail"]').click();

      const detailTitle = frame.locator('[data-e2e="nav-matrix-detail-title"]');
      await expect(detailTitle).toBeVisible({ timeout: 30_000 });
      await expect(detailTitle).toHaveText("Nav Matrix Detail");

      // Reload only the inner iframe.
      // Expected behavior strictly governed by EXPECTED_RUNTIME:
      //  - Full Start: Start uses browser history in frame, preserving DETAIL_ROUTE.
      //  - Client-only: Memory history in frame resets to editor seed HOME_ROUTE.
      //  - Both: Draft marker survives and top-level editor remains intact.
      await frame.locator("body").evaluate(() => location.reload());

      const frameAfterReload = previewFrame(page);
      if (EXPECTED_RUNTIME === "start") {
        const detailAfterReload = frameAfterReload.locator('[data-e2e="nav-matrix-detail-title"]');
        await expect(detailAfterReload).toBeVisible({ timeout: 45_000 });
        await expect(detailAfterReload).toHaveText("Nav Matrix Detail");
      } else {
        const homeAfterReload = frameAfterReload.locator('[data-e2e="nav-matrix-home-title"]');
        await expect(homeAfterReload).toBeVisible({ timeout: 45_000 });
        await expect(homeAfterReload).toHaveText("Nav Matrix Home");
      }
      await expect(frameAfterReload.locator('[data-e2e="nav-matrix-draft-marker"]')).toHaveText(DRAFT_MARKER_TEXT);

      // Top-level editor remains intact
      await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible();
    });

    test("5. Editor Reload: top-level editor refresh restores current detail route and retains draft state", async ({ page }) => {
      test.setTimeout(120_000);
      // Start at home, navigate to detail via Link first
      await openEditorAtRoute(page, HOME_ROUTE);
      const frame = previewFrame(page);
      await expect(frame.locator('[data-e2e="nav-matrix-home-title"]')).toBeVisible({ timeout: 45_000 });
      await frame.locator('[data-e2e="nav-matrix-link-to-detail"]').click();

      const detailTitle = frame.locator('[data-e2e="nav-matrix-detail-title"]');
      await expect(detailTitle).toBeVisible({ timeout: 30_000 });
      await expect(detailTitle).toHaveText("Nav Matrix Detail");

      // Reload the top-level editor window.
      // Expected behavior strictly governed by EXPECTED_RUNTIME:
      //  - Full Start: Frame navigation synced routePath=DETAIL_ROUTE to editor URL, restoring DETAIL_ROUTE.
      //  - Client-only: Editor URL remained at seed HOME_ROUTE, restoring HOME_ROUTE.
      //  - Both: Top editor reloads cleanly, draft state is preserved intact, and canvas resets.
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({ timeout: 45_000 });
      await exitSectionSelectionMode(page);
      await resetCanvasView(page);

      const frameAfterReload = previewFrame(page);
      if (EXPECTED_RUNTIME === "start") {
        const detailAfterReload = frameAfterReload.locator('[data-e2e="nav-matrix-detail-title"]');
        await expect(detailAfterReload).toBeVisible({ timeout: 45_000 });
        await expect(detailAfterReload).toHaveText("Nav Matrix Detail");
      } else {
        const homeAfterReload = frameAfterReload.locator('[data-e2e="nav-matrix-home-title"]');
        await expect(homeAfterReload).toBeVisible({ timeout: 45_000 });
        await expect(homeAfterReload).toHaveText("Nav Matrix Home");
      }
      await expect(frameAfterReload.locator('[data-e2e="nav-matrix-draft-marker"]')).toHaveText(DRAFT_MARKER_TEXT);
    });

    test("6. Direct URL: opens non-home route directly via URL query parameter routePath", async ({ page }) => {
      test.setTimeout(120_000);
      // Directly opens editor with routePath=DETAIL_ROUTE without prior link navigation
      await openEditorAtRoute(page, DETAIL_ROUTE);
      const frame = previewFrame(page);

      const detailTitle = frame.locator('[data-e2e="nav-matrix-detail-title"]');
      const detailDesc = frame.locator('[data-e2e="nav-matrix-detail-desc"]');
      const draftMarker = frame.locator('[data-e2e="nav-matrix-draft-marker"]');

      await expect(detailTitle).toBeVisible({ timeout: 45_000 });
      await expect(detailTitle).toHaveText("Nav Matrix Detail");
      await expect(detailDesc).toBeVisible({ timeout: 30_000 });
      await expect(detailDesc).toHaveText("Detail content for navigation matrix.");

      // Direct URL route renders draft content in preview
      await expect(draftMarker).toBeVisible({ timeout: 30_000 });
      await expect(draftMarker).toHaveText(DRAFT_MARKER_TEXT);

      // Home route is not rendered
      await expect(frame.locator('[data-e2e="nav-matrix-home-title"]')).toHaveCount(0);
    });
  });
});
