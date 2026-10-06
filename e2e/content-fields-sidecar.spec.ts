import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  isServerFunctionCall,
  openContentTab,
  previewFrame,
  saveEditedSource,
} from "./helpers";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
} from "./native-compat";

/**
 * A component whose content fields are declared in a sibling
 * `<Name>.fields.ts` (docs/multi-runtime-theme-plan.md), end to end: select
 * one instance on the canvas, edit its field, save, and see only that instance
 * change — then change the declaration in Code and see the Inspector follow.
 *
 * Writes its own route and component into the seeded, disposable store and
 * removes them afterwards.
 */
test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to a seeded editor store.");

const scope = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
const ROUTE_PATH = "/sidecar-fields";
const COMPONENT = "src/components/SidecarCard.tsx";
const SIDECAR = "src/components/SidecarCard.fields.ts";
const ROUTE = "src/routes/sidecar-fields.tsx";
const DEFAULT_TITLE = "Sidecar default title";

const FILES = [
  {
    path: ROUTE,
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import SidecarCard from "../components/SidecarCard";

export const Route = createFileRoute("${ROUTE_PATH}")({
  component: SidecarFieldsRoute,
});

function SidecarFieldsRoute() {
  return (
    <main>
      <SidecarCard {...content("sidecar-a")} />
      <SidecarCard {...content("sidecar-b")} />
    </main>
  );
}
`,
  },
  {
    // No declaration of its own: everything editable comes from the sibling.
    path: COMPONENT,
    content: `type SidecarCardProps = { title?: string };

export default function SidecarCard({ title = "${DEFAULT_TITLE}" }: SidecarCardProps) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{title}</h2>
    </section>
  );
}
`,
  },
  {
    path: SIDECAR,
    content: `export const contentFields = {
  title: { type: "text", label: "Card title" },
} as const;
`,
  },
];

// The cross-tab cases have components of their own, one per case: each case
// deletes its component's declaration, and re-creating a deleted file at the
// same path is not what they measure. They live in their own folder, listed
// below `src/components`: added there, they pushed the explorer row the
// deletion case above right-clicks to the bottom of the window, where the
// context menu opened over the pointer and the release chose "Duplicate".
const CROSS_TAB_ROUTE_PATH = "/sidecar-fields-cross-tab";
const RETURN_SLOT = "cross-tab-return";
const RETURN_SIDECAR = "src/cross-tab/CrossTabReturn.fields.ts";
const STALE_SLOT = "cross-tab-stale";
const STALE_SIDECAR = "src/cross-tab/CrossTabStale.fields.ts";

const crossTabComponent = (name: string) => [
  {
    path: `src/cross-tab/${name}.tsx`,
    content: `type ${name}Props = { title?: string };

export default function ${name}({ title = "${DEFAULT_TITLE}" }: ${name}Props) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{title}</h2>
    </section>
  );
}
`,
  },
  {
    path: `src/cross-tab/${name}.fields.ts`,
    content: `export const contentFields = {
  title: { type: "text", label: "${name} title" },
} as const;
`,
  },
];

const CROSS_TAB_FILES = [
  {
    path: "src/routes/sidecar-fields-cross-tab.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import CrossTabReturn from "../cross-tab/CrossTabReturn";
import CrossTabStale from "../cross-tab/CrossTabStale";

export const Route = createFileRoute("${CROSS_TAB_ROUTE_PATH}")({
  component: CrossTabRoute,
});

function CrossTabRoute() {
  return (
    <main>
      <CrossTabReturn {...content("${RETURN_SLOT}")} />
      <CrossTabStale {...content("${STALE_SLOT}")} />
    </main>
  );
}
`,
  },
  ...crossTabComponent("CrossTabReturn"),
  ...crossTabComponent("CrossTabStale"),
];

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

async function openRoute(
  page: Page,
  routePath = ROUTE_PATH,
  slot = "sidecar-a",
) {
  const url = new URL(EDITOR_PATH!, "http://placeholder");
  url.searchParams.set("routePath", routePath);
  await page.goto(`${url.pathname}${url.search}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  await expect(cardTitle(page, slot)).toBeVisible({ timeout: 90_000 });
}

const cardTitle = (page: Page, slot: string) =>
  previewFrame(page).locator(
    `[data-storefront-section-id="${slot}"] [data-storefront-field="title"]`,
  );

const titleField = (page: Page, label: string) =>
  page
    .locator('[data-slot="inspector-content-field"]')
    .filter({ hasText: label })
    .locator("input");

async function selectCard(page: Page, slot: string, element?: string) {
  const target = element
    ? previewFrame(page).locator(
        `[data-storefront-section-id="${slot}"] ${element}`,
      )
    : cardTitle(page, slot);
  if (
    await page
      .getByRole("button", { name: "Enable section selection" })
      .isVisible()
      .catch(() => false)
  ) {
    await enableSelection(page);
  }
  await target.scrollIntoViewIfNeeded();
  expect(
    await clickExposedElement(page, target),
    `the ${slot} title was not exposed on the canvas`,
  ).not.toBeNull();
  await openContentTab(page);
}

test.describe("content fields declared in <Name>.fields.ts", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const saved = await writeThemeFiles(page, scope!, [
      ...FILES,
      ...CROSS_TAB_FILES,
    ]);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await page.context().close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const removed = await removeThemeFiles(
      page,
      scope!,
      [...FILES, ...CROSS_TAB_FILES].map((file) => file.path),
    );
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    await page.context().close();
  });

  test("edits one instance's field without touching the other", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openRoute(page);
    // Marked from the sibling declaration: the component itself declares nothing.
    await expect(cardTitle(page, "sidecar-a")).toHaveText(DEFAULT_TITLE);
    await expect(cardTitle(page, "sidecar-b")).toHaveText(DEFAULT_TITLE);

    await selectCard(page, "sidecar-a");
    const field = titleField(page, "Card title");
    await expect(field).toBeVisible();
    const edited = `Sidecar edited ${Date.now()}`;
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).origin === new URL(page.url()).origin &&
        (response.request().postData() ?? "").includes(edited),
      { timeout: 30_000 },
    );
    await field.fill(edited);
    await field.press("Tab");
    expect((await saved).ok()).toBe(true);
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      /^(Unpublished|Published)$/,
    );

    await expect(cardTitle(page, "sidecar-a")).toHaveText(edited);
    await expect(cardTitle(page, "sidecar-b")).toHaveText(DEFAULT_TITLE);

    // What was saved is what a fresh load renders.
    await openRoute(page);
    await expect(cardTitle(page, "sidecar-a")).toHaveText(edited);
    await expect(cardTitle(page, "sidecar-b")).toHaveText(DEFAULT_TITLE);
  });

  test("follows a change to the declaration made in Code", async ({ page }) => {
    test.setTimeout(180_000);
    await openRoute(page);
    await selectCard(page, "sidecar-b");
    await expect(titleField(page, "Card title")).toBeVisible();

    await page.getByRole("button", { name: /^Code$/ }).click();
    // Saving acts on the open file, so open the declaration first — once the
    // Code workspace is there to take the shortcut; before that, Ctrl+P is
    // the Design shell's page search.
    await expect(page.locator(".monaco-editor").first()).toBeVisible({
      timeout: 30_000,
    });
    await page.keyboard.press("Control+p");
    const quickOpen = page.getByPlaceholder("Search files by name or path…");
    await quickOpen.fill("SidecarCard.fields.ts");
    await quickOpen.press("Enter");
    await saveEditedSource(page, SIDECAR, (source) =>
      source.replace('label: "Card title"', 'label: "Card heading"'),
    );
    await page.mouse.move(0, 0);
    await page.getByRole("button", { name: /^Design$/ }).focus();
    await page.keyboard.press("Enter");

    await selectCard(page, "sidecar-b");
    await expect(titleField(page, "Card heading")).toBeVisible({
      timeout: 30_000,
    });
    await expect(titleField(page, "Card title")).toHaveCount(0);
  });

  // After the tests that rely on the declaration: it removes it.
  test("drops the fields when only the declaration file is deleted", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openRoute(page);
    await expect(cardTitle(page, "sidecar-a")).toBeVisible();

    await page.getByRole("button", { name: /^Code$/ }).click();
    await expect(page.locator(".monaco-editor").first()).toBeVisible({
      timeout: 30_000,
    });
    await page.keyboard.press("Control+p");
    const quickOpen = page.getByPlaceholder("Search files by name or path…");
    await quickOpen.fill("SidecarCard.fields.ts");
    await quickOpen.press("Enter");
    // The explorer row, as an author would reach it; the component is untouched.
    await page
      .locator("span.truncate", { hasText: /^SidecarCard\.fields\.ts$/ })
      .first()
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const deleted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        (response.request().postData() ?? "").includes(SIDECAR),
      { timeout: 30_000 },
    );
    // From here on: the preview is re-marked by a file sync carrying the
    // component, not by starting the preview again.
    const previewCalls: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (isServerFunctionCall(url, "startThemePreviewServer"))
        previewCalls.push("start");
      else if (isServerFunctionCall(url, "applyThemePreviewFiles"))
        previewCalls.push(
          (request.postData() ?? "").includes(COMPONENT)
            ? "sync-component"
            : "sync",
        );
    });
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete" })
      .click();
    expect((await deleted).ok()).toBe(true);

    await page.mouse.move(0, 0);
    await page.getByRole("button", { name: /^Design$/ }).focus();
    await page.keyboard.press("Enter");

    // The component declares nothing itself and is not a section folder, so
    // nothing of it is editable any more: not on the canvas, not in the panel.
    const section = (slot: string) =>
      previewFrame(page).locator(`[data-storefront-section-id="${slot}"]`);
    await expect(section("sidecar-a").locator("h2")).toBeVisible({
      timeout: 45_000,
    });
    await expect(
      section("sidecar-a").locator('[data-storefront-field="title"]'),
    ).toHaveCount(0, { timeout: 45_000 });
    await expect(
      section("sidecar-b").locator('[data-storefront-field="title"]'),
    ).toHaveCount(0);
    expect(previewCalls).toContain("sync-component");
    expect(previewCalls).not.toContain("start");

    // And the panel agrees with the canvas: the title offers no field.
    await selectCard(page, "sidecar-a", "h2");
    await expect(titleField(page, "Card heading")).toHaveCount(0);
  });

  // After the deletion above. Made again under the same name, the declaration
  // starts over at version 1 — below the version the Code save laid out —
  // and the preview refused every start from then on as stale, so the fields
  // never came back until the dev server restarted.
  test("brings the fields back when the declaration file is made again", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const saved = await writeThemeFiles(
      page,
      scope!,
      FILES.filter((file) => file.path === SIDECAR),
    );
    expect(saved.success, JSON.stringify(saved)).toBe(true);

    const starts: string[] = [];
    page.on("response", (response) => {
      if (isServerFunctionCall(response.url(), "startThemePreviewServer")) {
        void response.text().then(
          (body) => starts.push(body),
          () => undefined,
        );
      }
    });
    await openRoute(page);
    expect(starts.join("\n")).not.toContain("PREVIEW_START_STALE");
    await expect(cardTitle(page, "sidecar-b")).toBeVisible();

    await selectCard(page, "sidecar-b");
    await expect(titleField(page, "Card title")).toBeVisible();
  });

  // Another tab — or anything else that writes the source — deletes a
  // declaration while this tab has the editor open. Measured before the fix:
  // this tab showed the field on the canvas and in the Inspector for as long
  // as it stayed open; an edit to it was dropped by the server (nothing
  // written to a field that no longer exists) but shown here as saved; coming
  // back to the tab re-read the files, which cleared the Inspector and left
  // the canvas marked until a reload.
  test("follows a declaration another tab deleted, once back on this tab", async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    await openRoute(page, CROSS_TAB_ROUTE_PATH, RETURN_SLOT);
    await selectCard(page, RETURN_SLOT);
    await expect(titleField(page, "CrossTabReturn title")).toBeVisible();

    const resent: string[] = [];
    page.on("request", (request) => {
      if (
        isServerFunctionCall(request.url(), "applyThemePreviewFiles") &&
        (request.postData() ?? "").includes("src/cross-tab/CrossTabReturn.tsx")
      ) {
        resent.push(request.url());
      }
    });
    await deleteInAnotherTab(browser, RETURN_SIDECAR);

    // The files are read again when the author comes back to the tab, once
    // the copy here is older than the editor's cache window (30 s).
    await expect(async () => {
      await returnToTab(page);
      await expect(cardTitle(page, RETURN_SLOT)).toHaveCount(0, {
        timeout: 5_000,
      });
    }).toPass({ timeout: 120_000, intervals: [5_000] });
    expect(resent.length).toBeGreaterThan(0);
    await expect(titleField(page, "CrossTabReturn title")).toHaveCount(0);
    // The other component keeps its declaration and its field.
    await expect(cardTitle(page, STALE_SLOT)).toHaveCount(1);
  });

  test("does not save an edit to a field another tab deleted, and says so", async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    await openRoute(page, CROSS_TAB_ROUTE_PATH, STALE_SLOT);
    await selectCard(page, STALE_SLOT);
    const field = titleField(page, "CrossTabStale title");
    await expect(field).toBeVisible();

    await deleteInAnotherTab(browser, STALE_SIDECAR);

    // Straight away: this tab has not read the files again and still offers
    // the field.
    const edited = `Stale edit ${Date.now()}`;
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        isServerFunctionCall(
          response.url(),
          "updateStorefrontThemeSectionProps",
        ) &&
        (response.request().postData() ?? "").includes(edited),
      { timeout: 30_000 },
    );
    await field.fill(edited);
    await field.press("Tab");
    expect((await saved).ok()).toBe(true);

    await expect(
      page.getByText(
        /Not saved: "title" is not an editable field in the current Theme source/,
      ),
    ).toBeVisible({ timeout: 15_000 });
    const heading = previewFrame(page).locator(
      `[data-storefront-section-id="${STALE_SLOT}"] h2`,
    );
    await expect(heading).toHaveText(DEFAULT_TITLE, { timeout: 15_000 });
    await expect(cardTitle(page, STALE_SLOT)).toHaveCount(0, {
      timeout: 45_000,
    });
    await expect(field).toHaveCount(0);

    // Nothing was stored for the field: a fresh load renders the default.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(heading).toBeVisible({ timeout: 90_000 });
    await expect(heading).toHaveText(DEFAULT_TITLE);
    await expect(cardTitle(page, STALE_SLOT)).toHaveCount(0);
  });
});

/** Deletes `path` the way another tab would, through its own session. */
async function deleteInAnotherTab(browser: Browser, path: string) {
  const other = await signedInPage(browser);
  try {
    await other.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const removed = await removeThemeFiles(other, scope!, [path]);
    expect(removed.success, JSON.stringify(removed)).toBe(true);
  } finally {
    await other.context().close();
  }
}

/** What the browser fires when the author switches back to this tab. */
async function returnToTab(page: Page) {
  await page.evaluate(() => {
    for (const state of ["hidden", "visible"]) {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => state,
      });
      window.dispatchEvent(new Event("visibilitychange"));
    }
  });
}
