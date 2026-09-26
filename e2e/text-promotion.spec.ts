import { expect, test, type Page } from "@playwright/test";
import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  openContentTab,
  openEditor,
  previewFrame,
  saveEditedSource,
} from "./helpers";

/**
 * Fixed text written in a component, made editable from Design.
 *
 * Runs against the seeded, disposable store only: it rewrites Theme source.
 * The text is added in Code first, since the starter has none left unbound.
 */
test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to a seeded editor store.");

const FIXED = "Fixed e2e text";
const EDITED = "Promoted e2e text";

async function selectFixedText(page: Page) {
  await expect(previewFrame(page).getByText(FIXED)).toBeVisible({
    timeout: 45_000,
  });
  // Opening a section from the tree can leave the pointer tool on already.
  if (
    await page
      .getByRole("button", { name: "Enable section selection" })
      .isVisible()
      .catch(() => false)
  ) {
    await enableSelection(page);
  }
  await previewFrame(page)
    .getByText(FIXED, { exact: true })
    .scrollIntoViewIfNeeded();
  const clicked = await clickExposedElement(
    page,
    previewFrame(page).getByText(FIXED, { exact: true }),
  );
  expect(
    clicked,
    "the fixed text was not exposed on the canvas",
  ).not.toBeNull();
  await openContentTab(page);
  const notice = page.getByTestId("editor-code-text-notice");
  await expect(notice).toHaveAttribute("data-status", "convertible");
  return notice;
}

test("fixed text in a component becomes a field of this page", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openEditor(page);

  // Write the fixed text into the hero, in Code. The seeded home page
  // renders its own copy of the hero, so the change is this page's alone.
  await page.getByRole("button", { name: "hero", exact: true }).click();
  await openContentTab(page);
  const openInCode = page.locator('button[title$=" in Monaco Code Editor"]');
  const hero = (await openInCode.getAttribute("title"))!
    .replace(/^Open /, "")
    .replace(/ in Monaco Code Editor$/, "");
  expect(hero).toMatch(/^src\/components\/page-sections\/index\//);
  await openInCode.click();
  await saveEditedSource(page, hero, (source) => {
    const end = source.lastIndexOf("</section>");
    return `${source.slice(0, end)}<p>${FIXED}</p>\n${source.slice(end)}`;
  });
  // The save's toast sits over the toolbar, and a toast the pointer rests on
  // pauses its own timer. Clicking Design moves the pointer onto it, so the
  // click waited on a toast that could then never leave — until the test's
  // four minutes ran out. Let it go first, with the pointer elsewhere.
  await page.mouse.move(0, 0);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: /^Design$/ }).click();

  const notice = await selectFixedText(page);
  await notice.locator("textarea").fill(EDITED);
  await notice.locator("input").fill("e2eNote");
  await notice.getByRole("button", { name: "Make editable" }).click();

  // A page's own copy reaches nothing else, so nothing is asked to confirm.
  await expect(previewFrame(page).getByText(EDITED)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("editor-code-text-notice")).toHaveCount(0);
  await expect(page.getByTestId("editor-code-text-shared")).toHaveCount(0);

  // What was written is what a fresh load renders.
  await openEditor(page);
  await expect(previewFrame(page).getByText(EDITED)).toBeVisible({
    timeout: 45_000,
  });
  await expect(
    previewFrame(page).getByText(FIXED, { exact: true }),
  ).toHaveCount(0);

  // Removing this page's value brings back the text the code holds.
  await enableSelection(page);
  await previewFrame(page).getByText(EDITED).scrollIntoViewIfNeeded();
  expect(
    await clickExposedElement(page, previewFrame(page).getByText(EDITED)),
    "the promoted text was not exposed on the canvas",
  ).not.toBeNull();
  await openContentTab(page);
  const field = page
    .locator('[data-slot="inspector-content-field"]')
    .filter({ hasText: "E2e note" });
  await field.getByRole("button", { name: "Use code default" }).click();
  await expect(
    previewFrame(page).getByText(FIXED, { exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  await openEditor(page);
  await expect(
    previewFrame(page).getByText(FIXED, { exact: true }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(previewFrame(page).getByText(EDITED)).toHaveCount(0);
});
