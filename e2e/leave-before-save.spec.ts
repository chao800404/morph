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

type QueryClientWindow = {
  __TSR_ROUTER__: {
    options: { context: { queryClient: { isFetching(): number } } };
  };
};

/**
 * Holds back the next fetch of the Theme's data until `answer` is called.
 *
 * A save fetches the Theme again once the server has answered it, and the
 * toolbar says "Saving…" until that fetch is in. Held, it stands for the
 * window in which an author can already open the saved text on the canvas.
 */
async function holdNextThemeFetch(page: Page) {
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  let caught!: () => void;
  const held = new Promise<void>((resolve) => (caught = resolve));
  let armed = true;
  await page.route(
    (url) => isServerFn(url.toString(), "getStorefrontThemeEditor"),
    async (route) => {
      if (!armed) return route.fallback();
      armed = false;
      caught();
      const response = await route.fetch();
      await answered;
      await route.fulfill({ response });
    },
  );
  return { held, answer };
}

/**
 * Lets the held fetch answer, and says whether the page was told its route
 * because of it.
 *
 * Messages from the editor reach the page in the order they were posted, so a
 * marker posted once the fetched data has been rendered arrives after anything
 * that render sent. Counting the route only up to the marker is what makes
 * "not sent" an answer rather than a race.
 */
async function answerHeldThemeFetch(
  page: Page,
  fetch: Awaited<ReturnType<typeof holdNextThemeFetch>>,
) {
  const frame = await (await page.locator("iframe").first().elementHandle())!
    .contentFrame();
  if (!frame) throw new Error("No preview frame");
  await frame.evaluate(() => {
    const seen = { routes: 0, marker: false };
    (window as unknown as { __e2eSeen: typeof seen }).__e2eSeen = seen;
    window.addEventListener("message", (event) => {
      const type = (event.data as { type?: unknown } | null)?.type;
      if (seen.marker) return;
      if (type === "morph:storefront-preview-set-route") seen.routes += 1;
      if (type === "e2e:fetched-theme-rendered") seen.marker = true;
    });
  });
  const fetched = page.waitForResponse(
    (response) =>
      isServerFn(response.url(), "getStorefrontThemeEditor") && response.ok(),
    { timeout: 30_000 },
  );
  fetch.answer();
  await fetched;
  // Taken in by the editor's cache, rendered, and its effects run: they post
  // before the next frame's task.
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as QueryClientWindow
        ).__TSR_ROUTER__.options.context.queryClient.isFetching(),
      ),
    )
    .toBe(0);
  await page.evaluate(async () => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => setTimeout(resolve, 0)),
    );
    document
      .querySelector("iframe")
      ?.contentWindow?.postMessage({ type: "e2e:fetched-theme-rendered" }, "*");
  });
  await expect
    .poll(() =>
      frame.evaluate(
        () =>
          (window as unknown as { __e2eSeen: { marker: boolean } }).__e2eSeen
            .marker,
      ),
    )
    .toBe(true);
  const routes = await frame.evaluate(
    () =>
      (window as unknown as { __e2eSeen: { routes: number } }).__e2eSeen.routes,
  );
  return { routeSent: routes > 0 };
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
    // The save's own fetch of the Theme is held until the text is open and
    // typed into. The editor used to tell the page its route again when that
    // fetch came in, and the page ends an open edit before navigating: text
    // opened while a save settled closed under the author, and what was typed
    // so far was committed.
    const themeFetch = await holdNextThemeFetch(page);
    await writeHeroField(page, 0, base);
    await themeFetch.held;
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

    const writes = watchContentWrites(page);
    const told = await answerHeldThemeFetch(page, themeFetch);
    expect(told.routeSent, "the route was sent to the page again").toBe(false);

    // Typed, not committed: only the preview has it.
    await expect(editing).toContainText(`${base} typed`);
    const status = page.locator("[data-editor-save-status]");
    await expect(status).toHaveAttribute("data-save-state", "unsaved");
    expect(writes.sent, "nothing typed was sent").toBe(0);

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
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await openEditor(page);
    await writeHeroField(page, 0, original);
  }
});
