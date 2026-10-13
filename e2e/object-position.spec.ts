import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  openEditor,
  openStylesTab,
  previewFrame,
} from "./helpers";

test.skip(
  !EDITOR_PATH,
  "Set E2E_EDITOR_PATH to the editor route of a theme with content.",
);

/**
 * The Inspector's object position on the Starter, in a real preview.
 *
 * A collection row's image reads `item.imagePosition`, a declared row field,
 * through an inline style: the control writes that field, and the canvas, the
 * stored draft and a reload agree. The story image reads `imagePosition` too,
 * but the Starter does not declare it, so the control is left to Code there —
 * a class edit beside the inline style would change nothing.
 */
const COLLECTIONS = '[data-storefront-section-id="starter-categories"]';
const STORY = '[data-storefront-section-id="starter-story"]';

async function selectImage(page: Page, section: string, nth: number) {
  const image = previewFrame(page).locator(`${section} img`).nth(nth);
  await expect(image).toBeAttached({ timeout: 45_000 });
  await image.scrollIntoViewIfNeeded();
  const clicked = await clickExposedElement(
    page,
    previewFrame(page).locator(`${section} img`),
    nth,
  );
  expect(clicked, "the image was never exposed to a click").not.toBeNull();
  await openStylesTab(page);
  return image;
}

/** The rendered value, not the stored one: what a visitor sees. */
const positionOf = (image: Locator) =>
  image.evaluate((element) => getComputedStyle(element).objectPosition);

test.describe("the Inspector's object position", () => {
  test("a collection image's position is saved, shown, and kept after a reload", async ({
    page,
  }) => {
    await openEditor(page);
    await enableSelection(page);
    const image = await selectImage(page, COLLECTIONS, 1);
    const control = page.getByRole("combobox", { name: "Object position" });
    await expect(control).toBeEnabled();

    await control.click();
    await page.getByRole("option", { name: "Top", exact: true }).click();
    await expect
      .poll(() => positionOf(image), { timeout: 20_000 })
      .toBe("50% 0%");

    await openEditor(page);
    const reloaded = previewFrame(page).locator(`${COLLECTIONS} img`).nth(1);
    await expect(reloaded).toBeAttached({ timeout: 45_000 });
    await expect
      .poll(() => positionOf(reloaded), { timeout: 20_000 })
      .toBe("50% 0%");
    // The neighbouring row kept its own stored position.
    await expect
      .poll(() =>
        positionOf(previewFrame(page).locator(`${COLLECTIONS} img`).nth(0)),
      )
      .toBe("30% 50%");

    await enableSelection(page);
    await selectImage(page, COLLECTIONS, 1);
    await expect(
      page.getByRole("combobox", { name: "Object position" }),
    ).toHaveText(/Top/);
  });

  test("the story image's position is left to Code: the Starter does not declare it", async ({
    page,
  }) => {
    await openEditor(page);
    await enableSelection(page);
    // Selected through the preview's own click handler rather than a pointer:
    // the story image sits about 2,700px down the page, and a pointer click
    // found no point of it exposed on screen even after scrolling it into
    // view, while the collection images above it are reachable that way.
    const image = previewFrame(page).locator(`${STORY} img`).first();
    await expect(image).toBeAttached({ timeout: 45_000 });
    await image.dispatchEvent("click");
    await openStylesTab(page);
    const before = await positionOf(image);
    const control = page.getByRole("combobox", { name: "Object position" });
    await expect(control).toBeDisabled();
    await expect(
      page.locator('[data-inspector-note="object-position"]'),
    ).toContainText("set in code, not by an editable field");
    // Fit is a class on the element and stays editable.
    await expect(
      page.getByRole("combobox", { name: "Object fit" }),
    ).toBeEnabled();
    expect(await positionOf(image)).toBe(before);
  });
});
