import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { EDITOR_PATH, openContentTab, previewFrame } from "./helpers";
import {
  THEMES,
  openPublish,
  publishShowingRelease,
  serverFn,
} from "./native-acceptance";
import { themeScopeFromEditorPath, type ThemeScope } from "./native-compat";

/**
 * A Header edit on a published store can be published.
 *
 * The Header's content lives in the shared layout Document, which every
 * page's publish seals along with the page (`publishTemplate`'s
 * `pendingShell`). The editor decided whether Publish was on from the page's
 * draft alone, so on a store that had been published once, a Header edit was
 * saved and then the toolbar said "Published" with Publish off: the edit could
 * not reach the storefront at all.
 *
 *   1. saved, the edit turns Publish on and says what it is;
 *   2. a publish that fails leaves it unpublished, before and after a reload;
 *   3. published, the release serves the new name;
 *   4. with nothing changed since, the status is back to Published.
 *
 * Container transport only: publishing builds in the Sandbox container. Runs
 * on a Theme of its own; named to run after native-compat-published.spec.ts,
 * which needs a storefront that has never been published.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);
test.skip(
  process.env.E2E_EXPECT_PREVIEW_TRANSPORT !== "cloudflare-sandbox",
  "Publishing builds in the Sandbox container; run with MORPH_E2E_TRANSPORT=cloudflare-sandbox.",
);

let scope: ThemeScope | null = null;
let editorPath: string | null = null;

async function createThrowawayTheme(): Promise<ThemeScope> {
  const created = {
    ...themeScopeFromEditorPath(EDITOR_PATH!),
    themeId: randomUUID(),
  };
  const now = new Date().toISOString();
  await promisify(execFile)("npx", [
    "wrangler",
    "d1",
    "execute",
    "DATABASE",
    "--local",
    "--persist-to",
    process.env.MORPH_E2E_STATE_DIR!,
    "--command",
    `INSERT INTO storefront_themes
    (id, storefront_id, name, metadata, created_at, updated_at)
    VALUES ('${created.themeId}', '${created.storefrontId}',
      'publish-layout-${created.themeId}', '{"starterTemplateVersion":1}',
      '${now}', '${now}');`,
  ]);
  return created;
}

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

const status = (page: Page) => page.locator("[data-editor-save-status]");
const publishButton = (page: Page) =>
  page.getByRole("button", { name: /^Publish$/ });

async function openEditor(page: Page) {
  await page.goto(editorPath!, { waitUntil: "domcontentloaded" });
  await expect(publishButton(page)).toBeVisible({ timeout: 45_000 });
  await expect(
    previewFrame(page).locator('[data-storefront-section-id="starter-header"]'),
  ).toBeAttached({ timeout: 90_000 });
  // The toolbar renders before the page hydrates; a click in that window is
  // received by nothing.
  await page.waitForTimeout(2_000);
}

/**
 * The server's own record: whether the layout has an unpublished draft, and
 * which release the storefront serves.
 */
async function serverState(page: Page) {
  const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
    ...scope!,
  })) as {
    success: boolean;
    data?: {
      storefront: { activeReleaseId: string | null };
      templates: Array<{
        type: string;
        draftRevisionId: string | null;
        publishedRevisionId: string | null;
      }>;
    };
  };
  expect(result.success, JSON.stringify(result)).toBe(true);
  const layout = result.data!.templates.find((t) => t.type === "layout")!;
  return {
    layoutPending:
      Boolean(layout.draftRevisionId) &&
      layout.draftRevisionId !== layout.publishedRevisionId,
    activeReleaseId: result.data!.storefront.activeReleaseId,
  };
}
const layoutDraftPending = async (page: Page) =>
  (await serverState(page)).layoutPending;

test.describe("publishing an edit to the shared layout", () => {
  test.describe.configure({ mode: "serial" });
  // Three builds of the whole workspace, each in a container.
  test.setTimeout(30 * 60_000);

  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    scope = await createThrowawayTheme();
    const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
      ...scope,
    })) as {
      success: boolean;
      data?: { templates: Array<{ id: string; type: string }> };
    };
    expect(result.success, JSON.stringify(result)).toBe(true);
    const home = result.data!.templates.find((t) => t.type === "index");
    expect(home).toBeDefined();
    editorPath = `/store/${scope.storefrontId}/themes/${scope.themeId}/editor?templateId=${home!.id}`;
    await page.context().close();
  });

  test("a Header store name edit is offered, survives a failed publish, and ships", async ({
    page,
  }) => {
    // A published baseline, so nothing is unpublished merely for never having
    // shipped.
    await openEditor(page);
    await (await publishShowingRelease(page)).close();
    await openEditor(page);
    await expect(status(page)).toHaveAttribute("aria-label", "Published", {
      timeout: 30_000,
    });
    await expect(publishButton(page)).toBeDisabled();

    // The edit, made the way an author makes it: the Global Header row, then
    // its field in the Inspector.
    const storeName = `Store ${randomUUID().slice(0, 8)}`;
    await page.getByRole("button", { name: /^Header\s*Global$/ }).click();
    await openContentTab(page);
    const field = page
      .locator('[data-slot="inspector-content-field"]')
      .filter({ hasText: "Store name" })
      .locator("input");
    await expect(field).toBeVisible({ timeout: 30_000 });
    await field.fill(storeName);
    await field.press("Tab");
    await expect(previewFrame(page).getByText(storeName)).toBeVisible({
      timeout: 30_000,
    });

    // 1. Saved, and not published: the two states stay separate.
    await expect
      .poll(() => layoutDraftPending(page), { timeout: 30_000 })
      .toBe(true);
    await expect(status(page)).toHaveAttribute("aria-label", "Unpublished", {
      timeout: 30_000,
    });
    await expect(status(page)).toHaveAttribute(
      "data-unpublished-reason",
      "Shared layout edited",
    );
    await expect(publishButton(page)).toBeEnabled();

    // 2. A publish that fails changes nothing about that. The request is
    // aborted in the browser before it is sent, so its outcome is known: the
    // server never received it. (A request whose answer is lost after it was
    // sent is a different case — it may have published — and is not what this
    // checks.) The release the storefront serves is read before and after.
    const releaseBefore = (await serverState(page)).activeReleaseId;
    expect(releaseBefore, "the baseline publish made a release").toBeTruthy();
    const publishUrl = await page.evaluate(async (module) => {
      const fns = await import(/* @vite-ignore */ module);
      return fns.publishStorefrontThemeTemplate.url as string;
    }, THEMES);
    const publishPath = new URL(publishUrl, page.url()).pathname;
    let refused = 0;
    await page.route(`**${publishPath}*`, async (route) => {
      refused += 1;
      await route.abort("failed");
    });
    await openPublish(page);
    await expect.poll(() => refused, { timeout: 9 * 60_000 }).toBe(1);
    await page.unroute(`**${publishPath}*`);
    await expect(status(page)).toHaveAttribute("aria-label", "Unpublished", {
      timeout: 30_000,
    });
    expect(await serverState(page)).toEqual({
      layoutPending: true,
      activeReleaseId: releaseBefore,
    });
    await openEditor(page);
    await expect(status(page)).toHaveAttribute("aria-label", "Unpublished", {
      timeout: 30_000,
    });
    await expect(publishButton(page)).toBeEnabled();

    // 3. Published, the release serves the new name, and it is a new release.
    const release = await publishShowingRelease(page);
    try {
      const home = await release.fetch("/");
      expect(home.status).toBe(200);
      expect(home.body).toContain(storeName);
    } finally {
      await release.close();
    }

    // 4. Nothing changed since: Published, and Publish is off again — in this
    // page and after a reload.
    await expect(status(page)).toHaveAttribute("aria-label", "Published", {
      timeout: 30_000,
    });
    const after = await serverState(page);
    expect(after.layoutPending).toBe(false);
    expect(after.activeReleaseId).not.toBe(releaseBefore);
    await openEditor(page);
    await expect(status(page)).toHaveAttribute("aria-label", "Published", {
      timeout: 30_000,
    });
    await expect(publishButton(page)).toBeDisabled();
  });
});
