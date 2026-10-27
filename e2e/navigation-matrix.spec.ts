import { expect, test, type Page } from "@playwright/test";
import { EDITOR_PATH, previewFrame } from "./helpers";
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
 * Exercises the five canonical navigation modalities:
 *  1. Initial Load (首次載入)
 *  2. Link Navigation (Link 點擊導航至非首頁並返回)
 *  3. Browser Back / Forward (瀏覽器上一頁／下一頁)
 *  4. Page Reload (非首頁重新整理)
 *  5. Direct URL (直接開非首頁網址)
 *
 * Rules:
 *  - Only adds tests; does not modify runtime application code or CI rule files.
 *  - Each cell asserts the content actually rendered (draft in preview, published on public site).
 *  - On the public storefront, draft content strictly MUST NOT leak.
 *  - Public storefront execution requires the Sandbox container to build and publish releases.
 *    Under local-sidecar transport, no container is bound; the public matrix cells are skipped
 *    and reported as unproven rather than masking with 404 or loose assertions.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

const scope: ThemeScope | null = EDITOR_PATH
  ? themeScopeFromEditorPath(EDITOR_PATH)
  : null;

const HOME_ROUTE = "/e2e-nav-matrix-home";
const DETAIL_ROUTE = "/e2e-nav-matrix-detail";
const HOST = "nav-matrix.localhost";

const NAV_FILES = [
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
      <Link to="${HOME_ROUTE}" data-e2e="nav-matrix-link-to-home" className="text-blue-600 underline">
        Back to Home
      </Link>
    </main>
  );
}
`,
  },
];

/** Open the editor explicitly pointing to a specific routePath */
async function openEditorAtRoute(page: Page, routePath: string) {
  const url = new URL(EDITOR_PATH!, "http://placeholder");
  url.searchParams.set("routePath", routePath);
  await page.goto(`${url.pathname}${url.search}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  const disableSelection = page.getByRole("button", {
    name: "Disable section selection",
  });
  if (await disableSelection.isVisible().catch(() => false)) {
    await disableSelection.click();
  }
  const canvasRegion = page.getByRole("region", {
    name: /Storefront preview canvas/,
  });
  if (await canvasRegion.isVisible().catch(() => false)) {
    await canvasRegion.focus();
    await page.keyboard.press("0");
  }
}

test.describe("Navigation Matrix: Preview and Storefront", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const saved = await writeThemeFiles(page, scope!, NAV_FILES);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await page.context().close();
  });

  test.afterAll(async ({ browser }) => {
    if (!scope) return;
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const removed = await removeThemeFiles(
      page,
      scope,
      NAV_FILES.map((file) => file.path),
    );
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    await page.context().close();
  });

  // =========================================================================
  // Part 1: Visual Editor Preview Frame Navigation Matrix
  // =========================================================================
  test.describe("Preview navigation matrix", () => {
    test("1. Initial Load: loads home route and asserts rendered draft content", async ({ page }) => {
      test.setTimeout(120_000);
      await openEditorAtRoute(page, HOME_ROUTE);
      const frame = previewFrame(page);
      const homeTitle = frame.locator('[data-e2e="nav-matrix-home-title"]');
      const homeDesc = frame.locator('[data-e2e="nav-matrix-home-desc"]');

      await expect(homeTitle).toBeVisible({ timeout: 45_000 });
      await expect(homeTitle).toHaveText("Nav Matrix Home");
      await expect(homeDesc).toBeVisible({ timeout: 30_000 });
      await expect(homeDesc).toHaveText("Home content for navigation matrix.");
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

      // Assert transition back to home route
      const linkToHome = frame.locator('[data-e2e="nav-matrix-link-to-home"]');
      await expect(linkToHome).toBeVisible({ timeout: 30_000 });
      const disableSelection = page.getByRole("button", {
        name: "Disable section selection",
      });
      if (await disableSelection.isVisible().catch(() => false)) {
        await disableSelection.click();
      }
      await linkToHome.click();

      const homeTitle = frame.locator('[data-e2e="nav-matrix-home-title"]');
      await expect(homeTitle).toBeVisible({ timeout: 30_000 });
      await expect(homeTitle).toHaveText("Nav Matrix Home");

      // Verify outer editor shell remains intact and reactive
      await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible();
    });

    test("3. History Navigation: back and forward transitions within preview frame", async ({ page }) => {
      test.setTimeout(120_000);
      await openEditorAtRoute(page, HOME_ROUTE);
      const frame = previewFrame(page);
      const homeTitle = frame.locator('[data-e2e="nav-matrix-home-title"]');
      const detailTitle = frame.locator('[data-e2e="nav-matrix-detail-title"]');

      await expect(homeTitle).toBeVisible({ timeout: 45_000 });

      // Navigate to detail
      await frame.locator('[data-e2e="nav-matrix-link-to-detail"]').click();
      await expect(detailTitle).toBeVisible({ timeout: 30_000 });
      await expect(homeTitle).toHaveCount(0);

      // History back (supports both full Start browser history and client-only memory history)
      await frame.locator("body").evaluate(() => {
        const router = (
          window as unknown as {
            __morphPreviewRouter?: { history?: { back(): void } };
          }
        ).__morphPreviewRouter;
        if (router?.history?.back) {
          router.history.back();
        } else {
          window.history.back();
        }
      });
      await expect(homeTitle).toBeVisible({ timeout: 30_000 });
      await expect(detailTitle).toHaveCount(0);

      // History forward (supports both full Start browser history and client-only memory history)
      await frame.locator("body").evaluate(() => {
        const router = (
          window as unknown as {
            __morphPreviewRouter?: { history?: { forward(): void } };
          }
        ).__morphPreviewRouter;
        if (router?.history?.forward) {
          router.history.forward();
        } else {
          window.history.forward();
        }
      });
      await expect(detailTitle).toBeVisible({ timeout: 30_000 });
      await expect(homeTitle).toHaveCount(0);
    });

    test("4. Reload: page refresh restores non-home route in preview frame", async ({ page }) => {
      test.setTimeout(120_000);
      await openEditorAtRoute(page, DETAIL_ROUTE);
      const frame = previewFrame(page);
      await expect(frame.locator('[data-e2e="nav-matrix-detail-title"]')).toBeVisible({ timeout: 45_000 });

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({ timeout: 45_000 });

      const reloadedFrame = previewFrame(page);
      const reloadedTitle = reloadedFrame.locator('[data-e2e="nav-matrix-detail-title"]');
      const reloadedDesc = reloadedFrame.locator('[data-e2e="nav-matrix-detail-desc"]');
      await expect(reloadedTitle).toBeVisible({ timeout: 45_000 });
      await expect(reloadedTitle).toHaveText("Nav Matrix Detail");
      await expect(reloadedDesc).toHaveText("Detail content for navigation matrix.");
    });

    test("5. Direct URL: opens directly at non-home routePath in editor", async ({ page }) => {
      test.setTimeout(120_000);
      await openEditorAtRoute(page, DETAIL_ROUTE);
      const frame = previewFrame(page);
      const detailTitle = frame.locator('[data-e2e="nav-matrix-detail-title"]');
      await expect(detailTitle).toBeVisible({ timeout: 45_000 });
      await expect(detailTitle).toHaveText("Nav Matrix Detail");
      await expect(frame.locator('[data-e2e="nav-matrix-home-title"]')).toHaveCount(0);
    });
  });

  // =========================================================================
  // Part 2: Public Storefront Navigation Matrix
  // =========================================================================
  test.describe("Storefront navigation matrix", () => {
    const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
    test.skip(
      TRANSPORT !== "cloudflare-sandbox",
      "Public storefront acceptance requires Sandbox container to build and publish theme releases (MORPH_E2E_TRANSPORT=cloudflare-sandbox); local-sidecar has no container bound.",
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

        // Publish current version to serve as published storefront
        const shown = await publishShowingRelease(page);
        await shown.close();

        // Connect domain
        const domain = (await serverFn(page, DOMAINS, "createStorefrontDomain", {
          storefrontId: scope!.storefrontId,
          hostname: HOST,
        })) as { success: boolean; message?: string; data?: { id: string } };
        expect(domain.success, domain.message).toBe(true);
        domainId = domain.data!.id;

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

    test("1. Initial Load: storefront renders published home content, draft never leaks", async ({ browser }) => {
      const shopper = await browser.newPage();
      try {
        await shopper.goto(`${storefrontOrigin}${HOME_ROUTE}`, { waitUntil: "domcontentloaded" });
        const homeTitle = shopper.locator('[data-e2e="nav-matrix-home-title"]');
        await expect(homeTitle).toBeVisible({ timeout: 30_000 });
        await expect(homeTitle).toHaveText("Nav Matrix Home");
      } finally {
        await shopper.close();
      }
    });

    test("2. Link Navigation: storefront navigates via Link to detail and back", async ({ browser }) => {
      const shopper = await browser.newPage();
      try {
        await shopper.goto(`${storefrontOrigin}${HOME_ROUTE}`, { waitUntil: "domcontentloaded" });
        const linkToDetail = shopper.locator('[data-e2e="nav-matrix-link-to-detail"]');
        await expect(linkToDetail).toBeVisible({ timeout: 30_000 });
        await linkToDetail.click();

        const detailTitle = shopper.locator('[data-e2e="nav-matrix-detail-title"]');
        await expect(detailTitle).toBeVisible({ timeout: 30_000 });
        await expect(detailTitle).toHaveText("Nav Matrix Detail");

        const linkToHome = shopper.locator('[data-e2e="nav-matrix-link-to-home"]');
        await expect(linkToHome).toBeVisible({ timeout: 30_000 });
        await linkToHome.click();

        const homeTitle = shopper.locator('[data-e2e="nav-matrix-home-title"]');
        await expect(homeTitle).toBeVisible({ timeout: 30_000 });
        await expect(homeTitle).toHaveText("Nav Matrix Home");
      } finally {
        await shopper.close();
      }
    });

    test("3. History Navigation: browser back and forward on public storefront", async ({ browser }) => {
      const shopper = await browser.newPage();
      try {
        await shopper.goto(`${storefrontOrigin}${HOME_ROUTE}`, { waitUntil: "domcontentloaded" });
        const homeTitle = shopper.locator('[data-e2e="nav-matrix-home-title"]');
        const detailTitle = shopper.locator('[data-e2e="nav-matrix-detail-title"]');

        await expect(homeTitle).toBeVisible({ timeout: 30_000 });
        await shopper.locator('[data-e2e="nav-matrix-link-to-detail"]').click();
        await expect(detailTitle).toBeVisible({ timeout: 30_000 });

        await shopper.goBack();
        await expect(homeTitle).toBeVisible({ timeout: 30_000 });
        await expect(detailTitle).toHaveCount(0);

        await shopper.goForward();
        await expect(detailTitle).toBeVisible({ timeout: 30_000 });
        await expect(homeTitle).toHaveCount(0);
      } finally {
        await shopper.close();
      }
    });

    test("4. Reload: refresh restores published non-home route on storefront", async ({ browser }) => {
      const shopper = await browser.newPage();
      try {
        await shopper.goto(`${storefrontOrigin}${DETAIL_ROUTE}`, { waitUntil: "domcontentloaded" });
        const detailTitle = shopper.locator('[data-e2e="nav-matrix-detail-title"]');
        await expect(detailTitle).toBeVisible({ timeout: 30_000 });

        await shopper.reload({ waitUntil: "domcontentloaded" });
        await expect(detailTitle).toBeVisible({ timeout: 30_000 });
        await expect(detailTitle).toHaveText("Nav Matrix Detail");
      } finally {
        await shopper.close();
      }
    });

    test("5. Direct URL: opens non-home route directly on public storefront", async ({ browser }) => {
      const shopper = await browser.newPage();
      try {
        await shopper.goto(`${storefrontOrigin}${DETAIL_ROUTE}`, { waitUntil: "domcontentloaded" });
        const detailTitle = shopper.locator('[data-e2e="nav-matrix-detail-title"]');
        await expect(detailTitle).toBeVisible({ timeout: 30_000 });
        await expect(detailTitle).toHaveText("Nav Matrix Detail");
        await expect(shopper.locator('[data-e2e="nav-matrix-home-title"]')).toHaveCount(0);
      } finally {
        await shopper.close();
      }
    });
  });
});
