import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  openContentTab,
  openEditor,
  previewFrame,
} from "./helpers";
import { THEMES, serverFn } from "./native-acceptance";
import { themeScopeFromEditorPath, type ThemeScope } from "./native-compat";

/**
 * The Starter's Header, edited on the canvas a new store opens with.
 *
 * Its content lives in the layout Document and reaches the Header through the
 * layout's `content("starter-header")` slot, in the Starter's own modules,
 * through the Live Preview's content interface. Unit tests hold each piece
 * with a stand-in for the transport; this holds them together in a browser:
 * the field is reachable on the canvas, an edit is stored in the layout
 * Document (not the page's), one row of the menu changes without the others,
 * and a fresh load renders what was stored.
 *
 * Runs on a Theme of its own, inserted into the runner-owned database, so the
 * shared Theme's Header is never rewritten.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

const SLOT = "starter-header";
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
    ...((process.env.MORPH_E2E_TRANSPORT ?? "local-sidecar") === "local-sidecar"
      ? ["--env", "local_preview_e2e"]
      : []),
    "--persist-to",
    process.env.MORPH_E2E_STATE_DIR!,
    "--command",
    `INSERT INTO storefront_themes
    (id, storefront_id, name, metadata, created_at, updated_at)
    VALUES ('${created.themeId}', '${created.storefrontId}',
      'starter-shell-${created.themeId}', '{"starterTemplateVersion":1}',
      '${now}', '${now}');`,
  ]);
  return created;
}

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

type Section = { id: string; props?: Record<string, unknown> };

/** The Header's values in each stored Document that holds the slot. */
async function storedHeader(
  page: Page,
): Promise<{ layout: Record<string, unknown> | undefined; others: number }> {
  const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
    ...scope!,
  })) as {
    success: boolean;
    data?: {
      templates: Array<{ type: string; document: { sections: Section[] } }>;
    };
  };
  expect(result.success, JSON.stringify(result)).toBe(true);
  const templates = result.data!.templates;
  const layout = templates
    .find((template) => template.type === "layout")
    ?.document.sections.find((section) => section.id === SLOT);
  // Shell content belongs to the layout. A copy in a page's Document would
  // shadow it on that page only, which is exactly the drift this guards.
  const others = templates
    .filter((template) => template.type !== "layout")
    .flatMap((template) => template.document.sections)
    .filter((section) => section.id === SLOT).length;
  return { layout: layout?.props, others };
}

const header = (page: Page) =>
  previewFrame(page).locator(`[data-storefront-section-id="${SLOT}"]`);
const storeName = (page: Page) =>
  header(page).locator('[data-storefront-field="storeName"]');
const menuLabel = (page: Page, index: number) =>
  header(page).locator(
    `[data-storefront-field-path="navItems.${index}.label"]`,
  );
const inspectorInput = (page: Page, label: string) =>
  page
    .locator('[data-slot="inspector-content-field"]')
    .filter({ hasText: label })
    .locator("input")
    .first();

async function open(page: Page) {
  // The shared opener also resets the canvas pan and zoom.
  await openEditor(page, editorPath!);
  await expect(storeName(page)).toBeVisible({ timeout: 90_000 });
  // At 1440px the frame is wider than the canvas and the store name at its
  // left edge sits under the Pages panel. A tablet width fits at 100% — and
  // still shows the menu, which the Header hides only below `sm`. Zooming out
  // instead would scale the frame, which the click helper does not map.
  const unlock = page.getByRole("button", {
    name: "Width locked (click to unlock)",
  });
  if (await unlock.isVisible().catch(() => false)) await unlock.click();
  await page
    .getByRole("button", { name: "Tablet preview, 768 pixels" })
    .click();
  await expect(menuLabel(page, 1)).toBeVisible();
}

async function select(page: Page, target: ReturnType<typeof storeName>) {
  if (
    await page
      .getByRole("button", { name: "Enable section selection" })
      .isVisible()
      .catch(() => false)
  ) {
    await enableSelection(page);
  }
  await target.scrollIntoViewIfNeeded();
  expect(await clickExposedElement(page, target)).not.toBeNull();
  await openContentTab(page);
}

test.describe("the Starter Header on the canvas", () => {
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
    const home = result.data!.templates.find(
      (template) => template.type === "index",
    );
    expect(home).toBeDefined();
    editorPath = `/store/${scope.storefrontId}/themes/${scope.themeId}/editor?templateId=${home!.id}`;
    await page.context().close();
  });

  test("edits the store name and one menu row through the layout slot", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await open(page);
    const before = await storedHeader(page);
    expect(before.others).toBe(0);
    const labelsBefore = await header(page)
      .locator('[data-storefront-field-path$=".label"]')
      .allInnerTexts();
    expect(labelsBefore.length).toBeGreaterThanOrEqual(2);

    // The store name: a field of the Header, reached on the canvas, stored
    // on the layout Document.
    await select(page, storeName(page));
    const name = `Shell store ${Date.now()}`;
    await inspectorInput(page, "Store name").fill(name);
    await inspectorInput(page, "Store name").press("Tab");
    await expect(storeName(page)).toHaveText(name);
    await expect
      .poll(async () => (await storedHeader(page)).layout?.storeName)
      .toBe(name);

    // One row of the menu: its own label changes, the others do not.
    await select(page, menuLabel(page, 1));
    const label = `Row ${Date.now() % 100_000}`;
    await inspectorInput(page, "Label").fill(label);
    await inspectorInput(page, "Label").press("Tab");
    await expect(menuLabel(page, 1)).toHaveText(label);
    await expect
      .poll(async () => {
        const items = (await storedHeader(page)).layout?.navItems as
          Array<{ label?: string }> | undefined;
        return items?.map((item) => item.label);
      })
      .toEqual(labelsBefore.map((text, index) => (index === 1 ? label : text)));
    expect((await storedHeader(page)).others).toBe(0);

    // A fresh load renders what was stored, through the content interface.
    await open(page);
    await expect(storeName(page)).toHaveText(name);
    await expect(menuLabel(page, 0)).toHaveText(labelsBefore[0]!);
    await expect(menuLabel(page, 1)).toHaveText(label);
  });
});
