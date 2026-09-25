import { expect, test, type Page } from "@playwright/test";
import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  openContentTab,
  openEditor,
  previewFrame,
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

async function saveEditedSource(
  page: Page,
  path: string,
  edit: (source: string) => string,
) {
  await expect
    .poll(
      () =>
        page.evaluate(
          (target) =>
            Boolean(
              (window as any).monaco?.editor
                .getModels()
                .some((model: any) => model.uri.path.endsWith(target)),
            ),
          path,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  const source = await page.evaluate(
    (target) =>
      (window as any).monaco.editor
        .getModels()
        .find((model: any) => model.uri.path.endsWith(target))
        .getValue() as string,
    path,
  );
  await page.evaluate(
    ({ target, next }) =>
      (window as any).monaco.editor
        .getModels()
        .find((model: any) => model.uri.path.endsWith(target))
        .setValue(next),
    { target: path, next: edit(source) },
  );
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      (response.request().postData() ?? "").includes(path),
    { timeout: 30_000 },
  );
  await page.keyboard.press("Control+s");
  expect((await saved).ok()).toBe(true);
}

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
});
