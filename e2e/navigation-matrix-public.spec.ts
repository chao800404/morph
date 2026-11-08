import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { EDITOR_PATH } from "./helpers";
import {
  DOMAINS,
  editHero,
  openEditor,
  publishShowingRelease,
  savedField,
  serverFn,
  signedInPage,
  storefrontHarness,
} from "./native-acceptance";
import { writeThemeFiles } from "./native-compat";
import {
  DETAIL_ROUTE,
  DRAFT_MARKER_TEXT,
  HOME_ROUTE,
  NAV_FILES_DRAFT,
  NAV_FILES_PUBLISHED,
  PUBLISHED_MARKER_TEXT,
  removeNavMatrixFiles,
  scope,
} from "./navigation-matrix-fixture";

/**
 * Navigation Matrix Acceptance Test: Public Storefront (M1 §11.2 item 5).
 *
 * The public storefront half of the navigation matrix; the preview frame half
 * is navigation-matrix.spec.ts. Both write the same routes
 * (navigation-matrix-fixture.ts).
 *
 * [Public Storefront (8799 Release Stand-in / Container)]
 *  1. Initial Load: storefront renders published home content; draft strictly never leaks.
 *  2. Link Navigation: storefront navigates via Link to detail and back; draft never leaks.
 *  3. History Navigation: browser back and forward on public storefront; draft never leaks.
 *  4. Reload: refresh restores published non-home route on storefront; draft never leaks.
 *  5. Direct URL: opens non-home route directly on public storefront; draft never leaks.
 *
 * Behavioral & Isolation Rules:
 *  - Only adds tests; does not modify runtime application code or CI rule files.
 *  - Distinguishes published from draft: writes published baseline, publishes Release 1,
 *    then writes draft-only edit. Storefront proves published marker is visible and
 *    draft marker is strictly absent (in DOM and HTML responses).
 *  - Requires the Sandbox container transport (MORPH_E2E_TRANSPORT=cloudflare-sandbox):
 *    publishing builds in a container. Under local-sidecar transport the whole file
 *    skips and its cells are unproven there; the exact list a container run must pass
 *    is scripts/container-acceptance-targets/navigation-matrix-public.mjs.
 */
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;

test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "Public storefront navigation matrix requires cloudflare-sandbox transport.",
);

/**
 * A content edit this run publishes with the baseline release. The release is
 * served through the harness, which only serves a release whose content
 * publication carries this run's authored edit; the routes this spec writes
 * are source, not content, so they cannot be that edit.
 */
const PUBLISHED_CONTENT_MARKER = `nav-matrix-${randomUUID().slice(0, 8)}`;

const HOST = "nav-matrix.localhost";

test.describe("Public storefront navigation matrix", () => {
  test.describe.configure({ mode: "serial" });

  let harness: ReturnType<typeof storefrontHarness> | null = null;
  let domainId: string | null = null;
  let storefrontOrigin: string = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await signedInPage(browser);
    try {
      // Waits for the Publish control to be hydrated: a click on the
      // server-rendered button before that sends no publish.
      await openEditor(page);

      // Publish baseline release 1 first, then make the draft edit
      const savedPublished = await writeThemeFiles(page, scope!, NAV_FILES_PUBLISHED);
      expect(savedPublished.success, JSON.stringify(savedPublished)).toBe(true);

      // Reopened after the write: an editor loaded before it holds the older
      // source generation, and publishing refuses on that difference.
      await openEditor(page);
      await editHero(page, PUBLISHED_CONTENT_MARKER);
      await savedField(page, scope!, PUBLISHED_CONTENT_MARKER);
      const shown = await publishShowingRelease(page);
      await shown.close();

      const savedDraft = await writeThemeFiles(page, scope!, NAV_FILES_DRAFT);
      expect(savedDraft.success, JSON.stringify(savedDraft)).toBe(true);
    } finally {
      await page.context().close();
    }
  });

  test.beforeAll(async ({ browser }) => {
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

      // Retrieve active published release (published in the beforeAll above)
      const history = (await serverFn(
        page,
        "/src/server/storefront/storefront-releases.serverFn.ts",
        "listStorefrontReleaseHistory",
        { storefrontId: scope!.storefrontId, limit: 1 },
      )) as { success: boolean; data: { releases: { id: string }[] } };
      expect(history.success).toBe(true);
      const releaseId = history.data.releases[0]!.id;

      storefrontOrigin = `http://${HOST}:${new URL(test.info().project.use.baseURL!).port}`;
      await harness.serveActiveRelease(PUBLISHED_CONTENT_MARKER, releaseId, storefrontOrigin);
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

  test.afterAll(async ({ browser }) => {
    test.setTimeout(240_000);
    await removeNavMatrixFiles(browser);
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
