import { expect, test } from "@playwright/test";
import { enableSelection, openStylesTab, previewFrame } from "./helpers";

// Use a dedicated, disposable theme with the MyBanner fixture described in README.
// Never clear or replace the developer's working theme to prepare this test.
const editorPath = process.env.E2E_SCRATCH_EDITOR_PATH;
test.skip(
  !editorPath,
  "Set E2E_SCRATCH_EDITOR_PATH to a dedicated MyBanner fixture theme.",
);

test("a custom component retains Inspector content and styles after reload", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const open = async () => {
    await page.goto(editorPath!);
    await expect(
      previewFrame(page).locator('[data-storefront-field="title"]'),
    ).toBeVisible();
    await enableSelection(page);
  };
  const title = () =>
    previewFrame(page).locator('[data-storefront-field="title"]');
  const selectTitle = async () => {
    await title().click();
    await page.getByRole("checkbox", { name: "Content", exact: true }).check();
  };
  await open();
  const originalTitle = await title().innerText();
  const originalColor = await title().evaluate(
    (node) => getComputedStyle(node).color,
  );
  const editedTitle = `Saved custom content ${Date.now()}`;
  const save = async (edit: () => Promise<void>) => {
    const response = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).origin === new URL(page.url()).origin,
      { timeout: 30_000 },
    );
    const [saved] = await Promise.all([response, edit()]);
    expect(saved.ok()).toBe(true);
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      /^(Unpublished|Published)$/,
    );
  };
  const writeTitle = async (text: string) => {
    await selectTitle();
    const field = page
      .locator('[data-slot="inspector-content-field"]')
      .filter({ hasText: "Title" })
      .locator("input");
    if ((await field.inputValue()) === text) return;
    await save(async () => {
      await field.fill(text);
      await field.press("Tab");
    });
    await expect(title()).toHaveText(text);
  };
  const writeColor = async (color: string) => {
    await title().click();
    await openStylesTab(page);
    const field = page.getByLabel("Text color value");
    if (
      (await title().evaluate((node) => getComputedStyle(node).color)) === color
    )
      return;
    await save(async () => {
      await field.fill(color);
      await field.press("Enter");
    });
    await expect
      .poll(() => title().evaluate((node) => getComputedStyle(node).color))
      .toBe(color);
  };
  // Saving must finish before reloading; the fresh preview is the persistence check.
  const expectPersisted = async (text: string, color?: string) => {
    await open();
    await expect(title()).toHaveText(text);
    if (color)
      await expect
        .poll(() => title().evaluate((node) => getComputedStyle(node).color))
        .toBe(color);
  };
  try {
    await writeTitle(editedTitle);
    await expectPersisted(editedTitle);
    await writeColor("rgb(200, 30, 30)");
    await expectPersisted(editedTitle, "rgb(200, 30, 30)");
  } finally {
    await open();
    await writeTitle(originalTitle);
    await writeColor(originalColor);
    await expectPersisted(originalTitle, originalColor);
  }
});
