import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  isServerFunctionCall,
  previewFrame,
} from "./helpers";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
} from "./native-compat";

/**
 * A canvas drag on a list the Document does not store yet, in the real Live
 * Preview.
 *
 * The list is on screen as the component's declared defaults, which carry no
 * row ids. Dropping one entry on the other used to find no rows in the stored
 * props: the shell refused with "cannot be mapped to a safe array position",
 * put the canvas back and wrote nothing. The swap now starts from the rows the
 * Inspector draws, with the ids the server derives for them
 * (`identifyUnstoredListRows`), and stores the list in its new order.
 *
 * Writes its own route and component into the seeded, disposable store, in a
 * folder of their own, and removes them afterwards. The slot is named per run,
 * so the list is unstored at the start of every run.
 */
test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to a seeded editor store.");

const scope = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
const ROUTE_PATH = "/unstored-list-reorder";
const SLOT = `steps-${Date.now().toString(36)}`;
const FIRST = "Alpha step";
const SECOND = "Beta step";

const FILES = [
  {
    path: "src/routes/unstored-list-reorder.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import StepList from "../unstored-list-reorder/StepList";

export const Route = createFileRoute("${ROUTE_PATH}")({
  component: UnstoredListReorderRoute,
});

function UnstoredListReorderRoute() {
  return (
    <main>
      <StepList {...content("${SLOT}")} />
    </main>
  );
}
`,
  },
  {
    path: "src/unstored-list-reorder/StepList.tsx",
    content: `export const contentFields = {
  items: {
    type: "array",
    label: "Steps",
    fields: { title: { type: "text", label: "Step title" } },
  },
} as const;

type Step = { id?: string; title?: string };

export default function StepList({
  items = [{ title: "${FIRST}" }, { title: "${SECOND}" }],
}: {
  items?: Step[];
}) {
  return (
    <section className="px-6 py-10">
      <ol className="grid gap-6">
        {items.map((item, index) => (
          <li key={item.id ?? index} className="rounded border p-8">
            <h3 className="text-lg font-medium">{item.title}</h3>
          </li>
        ))}
      </ol>
    </section>
  );
}
`,
  },
];

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

/** One entry of the list on the canvas: the row element, by its path. */
const row = (page: Page, index: number) =>
  previewFrame(page).locator(
    `[data-storefront-section-id="${SLOT}"] li[data-storefront-field-path="items.${index}"]`,
  );

async function openRoute(page: Page) {
  const url = new URL(EDITOR_PATH!, "http://placeholder");
  url.searchParams.set("routePath", ROUTE_PATH);
  await page.goto(`${url.pathname}${url.search}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  await expect(row(page, 1)).toBeVisible({ timeout: 90_000 });
}

test.describe("dragging an entry of a list nothing stores yet", () => {
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

  test("stores the drawn rows in their new order, with the ids they were drawn with", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        isServerFunctionCall(request.url(), "updateStorefrontThemeSectionProps")
      ) {
        writes.push(request.postData() ?? "");
      }
    });
    await openRoute(page);
    await expect(row(page, 0).locator("h3")).toHaveText(FIRST);
    await expect(row(page, 1).locator("h3")).toHaveText(SECOND);

    if (
      await page
        .getByRole("button", { name: "Enable section selection" })
        .isVisible()
        .catch(() => false)
    ) {
      await enableSelection(page);
    }
    await row(page, 1).scrollIntoViewIfNeeded();
    expect(
      await clickExposedElement(page, row(page, 1)),
      "the second entry was not exposed on the canvas",
    ).not.toBeNull();
    const handle = previewFrame(page).locator(
      '[data-storefront-editor-drag-handle="true"]',
    );
    await expect(handle).toBeVisible({ timeout: 15_000 });

    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        isServerFunctionCall(
          response.url(),
          "updateStorefrontThemeSectionProps",
        ),
      { timeout: 30_000 },
    );
    // The frame's own drag-and-drop listeners, driven with the events a drop
    // fires. Playwright's `dragTo` starts the gesture inside an iframe but
    // never delivers its drop, which leaves the canvas mid-drag.
    const dataTransfer = await previewFrame(page)
      .locator("body")
      .evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent("dragstart", { dataTransfer });
    await row(page, 0).dispatchEvent("dragover", { dataTransfer });
    await row(page, 0).dispatchEvent("drop", { dataTransfer });
    await handle.dispatchEvent("dragend", { dataTransfer });
    const response = await saved;
    expect(response.ok()).toBe(true);

    await expect(
      page.getByText("cannot be mapped to a safe array position"),
    ).toHaveCount(0);
    expect(writes).toHaveLength(1);
    const body = writes[0]!;
    // The whole list, in its new order, every row with a derived id.
    expect(body.indexOf(SECOND)).toBeGreaterThan(-1);
    expect(body.indexOf(SECOND)).toBeLessThan(body.indexOf(FIRST));
    expect(body.match(/morph-mig-[0-9a-f]+/g) ?? []).toHaveLength(2);
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      /^(Unpublished|Published)$/,
    );
    await expect(row(page, 0).locator("h3")).toHaveText(SECOND);
    await expect(row(page, 1).locator("h3")).toHaveText(FIRST);

    // What was saved is what a fresh load renders.
    await openRoute(page);
    await expect(row(page, 0).locator("h3")).toHaveText(SECOND);
    await expect(row(page, 1).locator("h3")).toHaveText(FIRST);
  });
});
