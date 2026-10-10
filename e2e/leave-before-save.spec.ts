import { expect, test, type Page } from "@playwright/test";
import { EDITOR_PATH, openEditor } from "./helpers";
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
