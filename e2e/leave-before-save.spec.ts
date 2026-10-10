import { expect, test, type Page } from "@playwright/test";
import {
  EDITOR_PATH,
  enableSelection,
  openEditor,
  previewFrame,
} from "./helpers";
import {
  heroContentField,
  isServerFn,
  writeHeroField,
} from "./helpers/editor-writes-paused";

/**
 * Leaving the editor right after an edit, before its save has gone out.
 *
 * A content edit waits out a 300ms debounce before it is sent. CI run
 * 37964261465 typed, saw the toolbar say "Unpublished", and navigated inside
 * that window: no request ever left and the edit was gone. These read the
 * Document back from the server after leaving, which is the only answer that
 * counts — the toolbar and the canvas are both this tab's own copy.
 *
 * Each restores the hero's text in `finally`, through the editor, so the
 * seeded Theme other specs read is left as it was.
 */

test.skip(
  !EDITOR_PATH,
  "Run through scripts/run-editor-e2e.mjs, or set E2E_EDITOR_PATH.",
);

const THEMES = "/src/server/storefront/storefront-themes.serverFn.ts";

function scope() {
  const match = /\/store\/([^/]+)\/themes\/([^/?]+)\/editor/.exec(EDITOR_PATH!);
  if (!match) throw new Error(`Unexpected E2E_EDITOR_PATH: ${EDITOR_PATH}`);
  return { storefrontId: match[1]!, themeId: match[2]! };
}

/** Whether the server's copy of the Theme's Documents holds `marker`. */
async function storedDocumentsHold(page: Page, marker: string) {
  const stored = await page.evaluate(
    async ({ module, scope }) => {
      const fns = await import(/* @vite-ignore */ module);
      const result = await fns.getStorefrontThemeEditor({ data: scope });
      if (!result.success) throw new Error(result.message);
      return JSON.stringify(result.data.templates);
    },
    { module: THEMES, scope: scope() },
  );
  return stored.includes(marker);
}

/** Records when the content write is answered, from now on. */
function watchContentWrites(page: Page) {
  const watched = { sent: 0, answeredAt: null as number | null };
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      isServerFn(request.url(), "updateStorefrontThemeSectionProps")
    ) {
      watched.sent += 1;
    }
  });
  page.on("response", (response) => {
    if (
      response.request().method() === "POST" &&
      isServerFn(response.url(), "updateStorefrontThemeSectionProps")
    ) {
      watched.answeredAt = Date.now();
    }
  });
  return watched;
}

test("leaving the editor right after an edit saves it first", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openEditor(page);
  const field = await heroContentField(page, 0);
  const original = await field.inputValue();
  const marker = `leave-before-save ${Date.now()}`;

  try {
    const writes = watchContentWrites(page);
    await field.click();
    await field.fill(marker);
    // At once: inside the debounce, nothing has been sent yet.
    await page.getByRole("link", { name: "Back to Online Store" }).click();

    await page.waitForURL(/\/dashboard\/online-store/, { timeout: 30_000 });
    // Answered before the editor let go, not afterwards by a timer that
    // happened to outlive it.
    expect(writes.answeredAt, "the write answered before leaving").not.toBeNull();
    expect(writes.sent).toBe(1);
    expect(await storedDocumentsHold(page, marker)).toBe(true);
  } finally {
    await openEditor(page);
    await writeHeroField(page, 0, original);
  }
});

test("reloading right after an edit warns, and staying lets it save", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openEditor(page);
  const field = await heroContentField(page, 0);
  const original = await field.inputValue();
  const marker = `reload-before-save ${Date.now()}`;

  try {
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.type());
      // Stay on the page.
      void dialog.dismiss();
    });
    await field.click();
    await field.fill(marker);
    // A reload cannot be held for the save, only warned about.
    await page
      .reload({ waitUntil: "domcontentloaded", timeout: 10_000 })
      .catch(() => {});
    expect(dialogs).toEqual(["beforeunload"]);

    // Stayed: the edit is saved on its own schedule.
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "data-save-state",
      "saved",
      { timeout: 30_000 },
    );
    expect(await storedDocumentsHold(page, marker)).toBe(true);

    // With nothing unsaved, a reload is not interrupted.
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(dialogs).toEqual(["beforeunload"]);
  } finally {
    page.removeAllListeners("dialog");
    await openEditor(page);
    await writeHeroField(page, 0, original);
  }
});

test("text typed on the canvas is warned about on reload, and saved once finished", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openEditor(page);
  const field = await heroContentField(page, 0);
  const original = await field.inputValue();
  // Stored first: the canvas opens text for typing only when it is the
  // stored value.
  const base = `inline-base ${Date.now()}`;

  try {
    await writeHeroField(page, 0, base);
    const text = previewFrame(page).getByText(base, { exact: true });
    await expect(text).toBeVisible({ timeout: 30_000 });
    const enable = page.getByRole("button", {
      name: "Enable section selection",
    });
    if (await enable.isVisible()) await enableSelection(page);
    await expect(
      previewFrame(page).locator(
        "html[data-storefront-editor-selection-enabled]",
      ),
    ).toBeAttached({ timeout: 45_000 });
    const box = await text.boundingBox();
    expect(box, "no box for the hero text").not.toBeNull();
    await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);
    const editing = previewFrame(page).locator(
      "[data-storefront-editor-inline-editing]",
    );
    await expect(editing).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("End");
    await page.keyboard.type(" typed");

    // Typed, not committed: only the preview has it.
    const status = page.locator("[data-editor-save-status]");
    await expect(status).toHaveAttribute("data-save-state", "unsaved");

    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });
    await page
      .reload({ waitUntil: "domcontentloaded", timeout: 10_000 })
      .catch(() => {});
    expect(dialogs).toEqual(["beforeunload"]);

    // Stayed, with the text still open; finishing it saves it.
    await expect(editing).toContainText(`${base} typed`);
    await page.keyboard.press("Enter");
    await expect(status).toHaveAttribute("data-save-state", "saved", {
      timeout: 30_000,
    });
    expect(await storedDocumentsHold(page, `${base} typed`)).toBe(true);
  } finally {
    page.removeAllListeners("dialog");
    await openEditor(page);
    await writeHeroField(page, 0, original);
  }
});
