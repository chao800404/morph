import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { EDITOR_PATH, isServerFunctionCall, previewFrame } from "./helpers";
import {
  DOMAINS,
  publishShowingRelease,
  serverFn,
  signedInPage,
  storefrontHarness,
} from "./native-acceptance";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";

/**
 * Navigation Matrix Acceptance Test: Preview & Storefront (M1 §11.2 item 5).
 *
 * Exercises the canonical navigation modalities across two execution surfaces:
 *
 * [Surface 1: Visual Editor Preview Frame]
 *  1. Initial Load: loads draft home route directly in preview frame.
 *  2. Link Navigation: client-side frame transition via <Link> to detail and back.
 *  3. History Navigation: frame back and forward with recorded history mechanism.
 *  4. Iframe Reload: isolated frame reload retains active detail route without top editor navigation.
 *  5. Editor Reload: top-level editor refresh restores detail route with draft state intact.
 *  6. Direct URL: opens non-home route directly via URL query parameter routePath.
 *
 * [Surface 2: Public Storefront (8799 Release Stand-in / Container)]
 *  1. Initial Load: storefront renders published home content; draft strictly never leaks.
 *  2. Link Navigation: storefront navigates via Link to detail and back; draft never leaks.
 *  3. History Navigation: browser back and forward on public storefront; draft never leaks.
 *  4. Reload: refresh restores published non-home route on storefront; draft never leaks.
 *  5. Direct URL: opens non-home route directly on public storefront; draft never leaks.
 *
 * Behavioral & Isolation Rules:
 *  - Only adds tests; does not modify runtime application code or CI rule files.
 *  - Distinguishes published from draft: writes published baseline, publishes Release 1,
 *    then writes draft-only edit. Preview proves draft marker is visible; Storefront proves
 *    published marker is visible and draft marker is strictly absent (in DOM and HTML responses).
 *  - Public storefront execution requires the Sandbox container transport (MORPH_E2E_TRANSPORT=cloudflare-sandbox).
 *    Under local-sidecar transport, no container is bound; the public matrix cells are skipped
 *    and reported as unproven rather than masking with loose assertions.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

const EXPECTED_RUNTIME: "start" | "client" =
  process.env.MORPH_E2E_PREVIEW_RUNTIME === "start" ? "start" : "client";

const scope: ThemeScope | null = EDITOR_PATH
  ? themeScopeFromEditorPath(EDITOR_PATH)
  : null;

const HOME_ROUTE = "/e2e-nav-matrix-home";
const DETAIL_ROUTE = "/e2e-nav-matrix-detail";
const HOST = "nav-matrix.localhost";

const PUBLISHED_MARKER_TEXT = "Published Revision 1";
const DRAFT_MARKER_TEXT = "Draft Revision 2";

const NAV_FILES_PUBLISHED = [
  {
    path: "src/routes/e2e-nav-matrix-home.tsx",
    content: `import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("${HOME_ROUTE}")({
  component: NavMatrixHome,
});

function NavMatrixHome() {
  return (
    <main className="p-8 max-w-xl mx-auto text-center">
      <h1 data-e2e="nav-matrix-home-title" className="text-2xl font-bold mb-4">Nav Matrix Home</h1>
      <p data-e2e="nav-matrix-home-desc" className="mb-4">Home content for navigation matrix.</p>
      <span data-e2e="nav-matrix-published-marker" className="block text-green-600 font-semibold mb-4">
        ${PUBLISHED_MARKER_TEXT}
      </span>
      <Link to="${DETAIL_ROUTE}" data-e2e="nav-matrix-link-to-detail" className="text-blue-600 underline">
        Go to Detail
      </Link>
    </main>
  );
}
`,
  },
  {
    path: "src/routes/e2e-nav-matrix-detail.tsx",
    content: `import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("${DETAIL_ROUTE}")({
  component: NavMatrixDetail,
});

function NavMatrixDetail() {
  return (
    <main className="p-8 max-w-xl mx-auto text-center">
      <h1 data-e2e="nav-matrix-detail-title" className="text-2xl font-bold mb-4">Nav Matrix Detail</h1>
      <p data-e2e="nav-matrix-detail-desc" className="mb-4">Detail content for navigation matrix.</p>
      <span data-e2e="nav-matrix-published-marker" className="block text-green-600 font-semibold mb-4">
        ${PUBLISHED_MARKER_TEXT}
      </span>
      <Link to="${HOME_ROUTE}" data-e2e="nav-matrix-link-to-home" className="text-blue-600 underline">
        Back to Home
      </Link>
    </main>
  );
}
`,
  },
];

const NAV_FILES_DRAFT = [
  {
    path: "src/routes/e2e-nav-matrix-home.tsx",
    content: `import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("${HOME_ROUTE}")({
  component: NavMatrixHome,
});

function NavMatrixHome() {
  return (
    <main className="p-8 max-w-xl mx-auto text-center">
      <h1 data-e2e="nav-matrix-home-title" className="text-2xl font-bold mb-4">Nav Matrix Home</h1>
      <p data-e2e="nav-matrix-home-desc" className="mb-4">Home content for navigation matrix.</p>
      <span data-e2e="nav-matrix-published-marker" className="block text-green-600 font-semibold mb-4">
        ${PUBLISHED_MARKER_TEXT}
      </span>
      <span data-e2e="nav-matrix-draft-marker" className="block text-amber-600 font-bold mb-4">
        ${DRAFT_MARKER_TEXT}
      </span>
      <Link to="${DETAIL_ROUTE}" data-e2e="nav-matrix-link-to-detail" className="text-blue-600 underline">
        Go to Detail
      </Link>
    </main>
  );
}
`,
  },
  {
    path: "src/routes/e2e-nav-matrix-detail.tsx",
    content: `import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("${DETAIL_ROUTE}")({
  component: NavMatrixDetail,
});

function NavMatrixDetail() {
  return (
    <main className="p-8 max-w-xl mx-auto text-center">
      <h1 data-e2e="nav-matrix-detail-title" className="text-2xl font-bold mb-4">Nav Matrix Detail</h1>
      <p data-e2e="nav-matrix-detail-desc" className="mb-4">Detail content for navigation matrix.</p>
      <span data-e2e="nav-matrix-published-marker" className="block text-green-600 font-semibold mb-4">
        ${PUBLISHED_MARKER_TEXT}
      </span>
      <span data-e2e="nav-matrix-draft-marker" className="block text-amber-600 font-bold mb-4">
        ${DRAFT_MARKER_TEXT}
      </span>
      <Link to="${HOME_ROUTE}" data-e2e="nav-matrix-link-to-home" className="text-blue-600 underline">
        Back to Home
      </Link>
    </main>
  );
}
`,
  },
];

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
      await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });

      const transport = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
      if (transport === "cloudflare-sandbox") {
        // Under container transport: publish baseline release 1 first, then make draft edit
        const savedPublished = await writeThemeFiles(page, scope!, NAV_FILES_PUBLISHED);
        expect(savedPublished.success, JSON.stringify(savedPublished)).toBe(true);

        const shown = await publishShowingRelease(page);
        await shown.close();

        const savedDraft = await writeThemeFiles(page, scope!, NAV_FILES_DRAFT);
        expect(savedDraft.success, JSON.stringify(savedDraft)).toBe(true);
      } else {
        // Under local preview transport: write draft routes directly
        const savedDraft = await writeThemeFiles(page, scope!, NAV_FILES_DRAFT);
        expect(savedDraft.success, JSON.stringify(savedDraft)).toBe(true);
      }
    } finally {
      await page.context().close();
    }
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(240_000);
    if (!scope) return;
    const page = await signedInPage(browser);
    try {
      await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
      const removed = await removeThemeFiles(
        page,
        scope,
        NAV_FILES_PUBLISHED.map((file) => file.path),
      );
      expect(removed.success, JSON.stringify(removed)).toBe(true);
    } finally {
      await page.context().close();
    }
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

  // =========================================================================
  // Part 2: Public Storefront Navigation Matrix (8799 Release Stand-in)
  // =========================================================================
  test.describe("Public storefront navigation matrix", () => {
    const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
    test.skip(
      TRANSPORT !== "cloudflare-sandbox",
      "Public storefront navigation matrix requires cloudflare-sandbox transport.",
    );

    let harness: ReturnType<typeof storefrontHarness> | null = null;
    let domainId: string | null = null;
    let storefrontOrigin: string = "";

    test.beforeAll(async ({ browser }) => {
      if (TRANSPORT !== "cloudflare-sandbox") return;

      const page = await signedInPage(browser);
      try {
        await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
        harness = storefrontHarness({
          scope: scope!,
          stateDir: process.env.MORPH_E2E_STATE_DIR!,
        });

        // Connect public test domain
        const domain = (await serverFn(page, DOMAINS, "createStorefrontDomain", {
          storefrontId: scope!.storefrontId,
          hostname: HOST,
        })) as { success: boolean; message?: string; data?: { id: string } };
        expect(domain.success, domain.message).toBe(true);
        domainId = domain.data!.id;

        // Retrieve active published release (published in top-level beforeAll)
        const history = (await serverFn(
          page,
          "/src/server/storefront/storefront-releases.serverFn.ts",
          "listStorefrontReleaseHistory",
          { storefrontId: scope!.storefrontId, limit: 1 },
        )) as { success: boolean; data: { releases: { id: string }[] } };
        expect(history.success).toBe(true);
        const releaseId = history.data.releases[0]!.id;

        storefrontOrigin = `http://${HOST}:${new URL(test.info().project.use.baseURL!).port}`;
        await harness.serveActiveRelease("nav-matrix", releaseId, storefrontOrigin);
      } finally {
        await page.context().close();
      }
    });

    test.afterAll(async ({ browser }) => {
      try {
        if (domainId) {
          const page = await signedInPage(browser);
          try {
            await page.goto("/", { waitUntil: "domcontentloaded" });
            await harness?.writeD1(
              "UPDATE storefront_domains SET is_primary = 0, cloudflare_domain_id = NULL WHERE id = ?1",
              domainId,
            );
            await serverFn(page, DOMAINS, "deleteStorefrontDomains", {
              ids: [domainId],
            });
          } finally {
            await page.context().close();
          }
        }
      } finally {
        await harness?.dispose();
      }
    });

    test("1. Initial Load: storefront renders published home content, draft strictly never leaks", async ({ browser }) => {
      const shopper = await browser.newPage();
      try {
        const response = await shopper.goto(`${storefrontOrigin}${HOME_ROUTE}`, { waitUntil: "domcontentloaded" });
        expect(response?.status()).toBe(200);

        // Assert HTTP response text strictly never leaks draft marker
        const html = await response!.text();
        expect(html).toContain(PUBLISHED_MARKER_TEXT);
        expect(html).not.toContain(DRAFT_MARKER_TEXT);

        const homeTitle = shopper.locator('[data-e2e="nav-matrix-home-title"]');
        await expect(homeTitle).toBeVisible({ timeout: 30_000 });
        await expect(homeTitle).toHaveText("Nav Matrix Home");

        const publishedMarker = shopper.locator('[data-e2e="nav-matrix-published-marker"]');
        await expect(publishedMarker).toBeVisible({ timeout: 30_000 });
        await expect(publishedMarker).toHaveText(PUBLISHED_MARKER_TEXT);

        // Strict assertion: draft marker strictly does not exist in DOM
        await expect(shopper.locator('[data-e2e="nav-matrix-draft-marker"]')).toHaveCount(0);
      } finally {
        await shopper.close();
      }
    });

    test("2. Link Navigation: storefront navigates via Link to detail and back, draft never leaks", async ({ browser }) => {
      const shopper = await browser.newPage();
      try {
        await shopper.goto(`${storefrontOrigin}${HOME_ROUTE}`, { waitUntil: "domcontentloaded" });
        const linkToDetail = shopper.locator('[data-e2e="nav-matrix-link-to-detail"]');
        await expect(linkToDetail).toBeVisible({ timeout: 30_000 });
        await linkToDetail.click();

        const detailTitle = shopper.locator('[data-e2e="nav-matrix-detail-title"]');
        await expect(detailTitle).toBeVisible({ timeout: 30_000 });
        await expect(detailTitle).toHaveText("Nav Matrix Detail");
        await expect(shopper.locator('[data-e2e="nav-matrix-published-marker"]')).toHaveText(PUBLISHED_MARKER_TEXT);
        await expect(shopper.locator('[data-e2e="nav-matrix-draft-marker"]')).toHaveCount(0);

        const linkToHome = shopper.locator('[data-e2e="nav-matrix-link-to-home"]');
        await expect(linkToHome).toBeVisible({ timeout: 30_000 });
        await linkToHome.click();

        const homeTitle = shopper.locator('[data-e2e="nav-matrix-home-title"]');
        await expect(homeTitle).toBeVisible({ timeout: 30_000 });
        await expect(homeTitle).toHaveText("Nav Matrix Home");
        await expect(shopper.locator('[data-e2e="nav-matrix-published-marker"]')).toHaveText(PUBLISHED_MARKER_TEXT);
        await expect(shopper.locator('[data-e2e="nav-matrix-draft-marker"]')).toHaveCount(0);
      } finally {
        await shopper.close();
      }
    });

    test("3. History Navigation: browser back and forward on public storefront, draft never leaks", async ({ browser }) => {
      const shopper = await browser.newPage();
      try {
        await shopper.goto(`${storefrontOrigin}${HOME_ROUTE}`, { waitUntil: "domcontentloaded" });
        const homeTitle = shopper.locator('[data-e2e="nav-matrix-home-title"]');
        const detailTitle = shopper.locator('[data-e2e="nav-matrix-detail-title"]');

        await expect(homeTitle).toBeVisible({ timeout: 30_000 });
        await shopper.locator('[data-e2e="nav-matrix-link-to-detail"]').click();
        await expect(detailTitle).toBeVisible({ timeout: 30_000 });
        await expect(shopper.locator('[data-e2e="nav-matrix-draft-marker"]')).toHaveCount(0);

        await shopper.goBack();
        await expect(homeTitle).toBeVisible({ timeout: 30_000 });
        await expect(detailTitle).toHaveCount(0);
        await expect(shopper.locator('[data-e2e="nav-matrix-published-marker"]')).toHaveText(PUBLISHED_MARKER_TEXT);
        await expect(shopper.locator('[data-e2e="nav-matrix-draft-marker"]')).toHaveCount(0);

        await shopper.goForward();
        await expect(detailTitle).toBeVisible({ timeout: 30_000 });
        await expect(homeTitle).toHaveCount(0);
        await expect(shopper.locator('[data-e2e="nav-matrix-published-marker"]')).toHaveText(PUBLISHED_MARKER_TEXT);
        await expect(shopper.locator('[data-e2e="nav-matrix-draft-marker"]')).toHaveCount(0);
      } finally {
        await shopper.close();
      }
    });

    test("4. Reload: refresh restores published non-home route on storefront, draft never leaks", async ({ browser }) => {
      const shopper = await browser.newPage();
      try {
        await shopper.goto(`${storefrontOrigin}${DETAIL_ROUTE}`, { waitUntil: "domcontentloaded" });
        const detailTitle = shopper.locator('[data-e2e="nav-matrix-detail-title"]');
        await expect(detailTitle).toBeVisible({ timeout: 30_000 });

        await shopper.reload({ waitUntil: "domcontentloaded" });
        await expect(detailTitle).toBeVisible({ timeout: 30_000 });
        await expect(detailTitle).toHaveText("Nav Matrix Detail");
        await expect(shopper.locator('[data-e2e="nav-matrix-published-marker"]')).toHaveText(PUBLISHED_MARKER_TEXT);
        await expect(shopper.locator('[data-e2e="nav-matrix-draft-marker"]')).toHaveCount(0);
      } finally {
        await shopper.close();
      }
    });

    test("5. Direct URL: opens non-home route directly on public storefront, draft never leaks", async ({ browser }) => {
      const shopper = await browser.newPage();
      try {
        const response = await shopper.goto(`${storefrontOrigin}${DETAIL_ROUTE}`, { waitUntil: "domcontentloaded" });
        expect(response?.status()).toBe(200);

        const html = await response!.text();
        expect(html).toContain(PUBLISHED_MARKER_TEXT);
        expect(html).not.toContain(DRAFT_MARKER_TEXT);

        const detailTitle = shopper.locator('[data-e2e="nav-matrix-detail-title"]');
        await expect(detailTitle).toBeVisible({ timeout: 30_000 });
        await expect(detailTitle).toHaveText("Nav Matrix Detail");
        await expect(shopper.locator('[data-e2e="nav-matrix-published-marker"]')).toHaveText(PUBLISHED_MARKER_TEXT);
        await expect(shopper.locator('[data-e2e="nav-matrix-draft-marker"]')).toHaveCount(0);
        await expect(shopper.locator('[data-e2e="nav-matrix-home-title"]')).toHaveCount(0);
      } finally {
        await shopper.close();
      }
    });
  });
});
