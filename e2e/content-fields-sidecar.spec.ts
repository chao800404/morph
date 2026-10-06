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

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

async function openRoute(page: Page) {
  const url = new URL(EDITOR_PATH!, "http://placeholder");
  url.searchParams.set("routePath", ROUTE_PATH);
  await page.goto(`${url.pathname}${url.search}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  await expect(cardTitle(page, "sidecar-a")).toBeVisible({ timeout: 90_000 });
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
    const saved = await writeThemeFiles(page, scope!, FILES);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await page.context().close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const removed = await removeThemeFiles(
      page,
      scope!,
      FILES.map((file) => file.path),
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

  // Last: it removes the declaration the tests above rely on.
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
          (request.postData() ?? "").includes(COMPONENT) ? "sync-component" : "sync",
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
});
