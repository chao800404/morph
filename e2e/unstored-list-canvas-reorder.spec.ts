import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  isServerFunctionCall,
  previewFrame,
} from "./helpers";
import {
  countContentWrites,
  nextContentWrite,
  queryLocalD1,
} from "./helpers/editor-writes-paused";
import { THEMES, serverFn } from "./native-acceptance";
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

  test("stores the drawn rows in their new order, and reorders the stored list again", async ({
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

    await selectRow(page, 1);
    await dropSelectedOnto(page, 0);

    await expect(
      page.getByText("cannot be mapped to a safe array position"),
    ).toHaveCount(0);
    expect(writes).toHaveLength(1);
    const body = writes[0]!;
    // The whole list, in its new order, every row with a derived id.
    expect(body.indexOf(SECOND)).toBeGreaterThan(-1);
    expect(body.indexOf(SECOND)).toBeLessThan(body.indexOf(FIRST));
    const ids = body.match(/morph-mig-[0-9a-f]+/g) ?? [];
    expect(ids).toHaveLength(2);
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      /^(Unpublished|Published)$/,
    );
    await expect(row(page, 0).locator("h3")).toHaveText(SECOND);
    await expect(row(page, 1).locator("h3")).toHaveText(FIRST);

    // The list is stored now. The same entry, selected again where it landed
    // (after the write the canvas selects the section) and dragged back: a
    // second write, under the ids the first one stored.
    await selectRow(page, 0);
    await dropSelectedOnto(page, 1);
    expect(writes).toHaveLength(2);
    expect(writes[1]!.indexOf(FIRST)).toBeLessThan(writes[1]!.indexOf(SECOND));
    expect(writes[1]!.match(/morph-mig-[0-9a-f]+/g)).toEqual([ids[1], ids[0]]);
    await expect(row(page, 0).locator("h3")).toHaveText(FIRST);
    await expect(row(page, 1).locator("h3")).toHaveText(SECOND);

    // What was saved is what a fresh load renders.
    await openRoute(page);
    await expect(row(page, 0).locator("h3")).toHaveText(FIRST);
    await expect(row(page, 1).locator("h3")).toHaveText(SECOND);

    // A stored list, selected afresh after the load, dragged once more.
    await selectRow(page, 1);
    await dropSelectedOnto(page, 0);
    expect(writes).toHaveLength(3);
    expect(writes[2]!.indexOf(SECOND)).toBeLessThan(writes[2]!.indexOf(FIRST));
    await openRoute(page);
    await expect(row(page, 0).locator("h3")).toHaveText(SECOND);
    await expect(row(page, 1).locator("h3")).toHaveText(FIRST);
  });

  /**
   * #390: the Undo and Redo of a canvas reorder of a stored list are each one
   * write of the list, read back from the run's own D1 file: the order and
   * ids, and one draft generation per step.
   */
  test("on a stored list, Undo puts the order and ids back and Redo swaps them again, one draft generation each", async ({
    page,
  }) => {
    test.skip(
      !process.env.MORPH_E2E_STATE_DIR,
      "Reads the runner-owned D1 file.",
    );
    test.setTimeout(240_000);
    const writes = countContentWrites(page);
    await openRoute(page);
    const templateId = await routeTemplateId(page);
    if (!storedRows(templateId)) {
      // Run on its own: store the list first.
      await selectRow(page, 1);
      await dropSelectedOnto(page, 0);
      await openRoute(page);
    }
    const start = storedRows(templateId)!;
    expect(start.rows, "a stored list of two").toHaveLength(2);
    const ids = start.rows.map((entry) => entry.id);
    const titles = start.rows.map((entry) => String(entry.title));
    expect(start.rows.map((entry) => entry.title)).toEqual(titles);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(
      true,
    );
    await expectHistory(page, { depth: 0, undo: false, redo: false });

    // The drag: one write, the rows swapped with their ids.
    let before = writes.sent;
    await selectRow(page, 1);
    await dropSelectedOnto(page, 0);
    await page.waitForTimeout(1_500);
    expect(writes.sent - before, "the drag's writes").toBe(1);
    const swapped = storedRows(templateId)!;
    expect(swapped.rows.map((entry) => entry.id)).toEqual([ids[1], ids[0]]);
    expect(swapped.draftGeneration).toBe(start.draftGeneration + 1);
    await expectHistory(page, { depth: 1, undo: true, redo: false });

    // Undo, from the toolbar: the first order and ids again.
    before = writes.sent;
    let answer = nextContentWrite(page);
    await undoButton(page).click();
    expect(await answer, "the Undo's write").toBe("saved");
    await page.waitForTimeout(1_500);
    expect(writes.sent - before, "the Undo's writes").toBe(1);
    const undone = storedRows(templateId)!;
    expect(undone.rows.map((entry) => entry.id)).toEqual(ids);
    expect(undone.rows.map((entry) => entry.title)).toEqual(titles);
    expect(undone.draftGeneration).toBe(swapped.draftGeneration + 1);
    await expectHistory(page, { depth: 0, undo: false, redo: true });
    await expect(row(page, 0).locator("h3")).toHaveText(titles[0]!);
    await expect(row(page, 1).locator("h3")).toHaveText(titles[1]!);

    // Redo: swapped again.
    before = writes.sent;
    answer = nextContentWrite(page);
    await redoButton(page).click();
    expect(await answer, "the Redo's write").toBe("saved");
    await page.waitForTimeout(1_500);
    expect(writes.sent - before, "the Redo's writes").toBe(1);
    const redone = storedRows(templateId)!;
    expect(redone.rows.map((entry) => entry.id)).toEqual([ids[1], ids[0]]);
    expect(redone.rows.map((entry) => entry.title)).toEqual([
      titles[1],
      titles[0],
    ]);
    expect(redone.draftGeneration).toBe(undone.draftGeneration + 1);
    await expectHistory(page, { depth: 1, undo: true, redo: false });

    // What was saved is what a fresh load renders.
    await openRoute(page);
    await expect(row(page, 0).locator("h3")).toHaveText(titles[1]!);
    await expect(row(page, 1).locator("h3")).toHaveText(titles[0]!);
  });
});

const undoButton = (page: Page) =>
  page.locator('button[aria-label="Undo"][data-editor-undo-depth]');
const redoButton = (page: Page) => page.locator('button[aria-label="Redo"]');

/** The history as the toolbar shows it: depth, and which buttons can be pressed. */
async function expectHistory(
  page: Page,
  want: { depth: number; undo: boolean; redo: boolean },
) {
  await expect(undoButton(page)).toHaveAttribute(
    "data-editor-undo-depth",
    String(want.depth),
    { timeout: 30_000 },
  );
  if (want.undo) await expect(undoButton(page)).toBeEnabled();
  else await expect(undoButton(page)).toBeDisabled();
  if (want.redo) await expect(redoButton(page)).toBeEnabled();
  else await expect(redoButton(page)).toBeDisabled();
}

/** The id of the route's own Document (it exists once a write stored it). */
async function routeTemplateId(page: Page) {
  const ensured = (await serverFn(
    page,
    THEMES,
    "ensureStorefrontThemeRouteTemplate",
    { ...scope!, routePath: ROUTE_PATH },
  )) as { success: boolean; data?: { id: string } };
  expect(ensured.success, JSON.stringify(ensured)).toBe(true);
  const id = ensured.data!.id;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error(`template id ${id}`);
  return id;
}

/**
 * The slot's stored rows and the route Document's draft generation, as D1
 * holds them (the draft revision, or the template's own document before it
 * has one); `null` while the slot stores no list.
 */
function storedRows(templateId: string) {
  const rows = queryLocalD1<{ document: string; draft_generation: number }>(
    `SELECT CASE WHEN t.draft_revision_id IS NULL THEN t.document ELSE r.document END AS document,
       t.draft_generation AS draft_generation
     FROM storefront_theme_templates t LEFT JOIN storefront_theme_template_revisions r
       ON r.id = t.draft_revision_id AND r.template_id = t.id
     WHERE t.id = '${templateId}' AND t.deleted_at IS NULL`,
  );
  expect(rows, "one stored route Document").toHaveLength(1);
  const document = JSON.parse(String(rows[0]!.document)) as {
    sections?: Array<{ id: string; props?: Record<string, unknown> }>;
  };
  const items = document.sections?.find((section) => section.id === SLOT)
    ?.props?.items;
  if (!Array.isArray(items)) return null;
  return {
    rows: items as Array<{ id?: unknown; title?: unknown }>,
    draftGeneration: Number(rows[0]!.draft_generation),
  };
}

/** Clicks one entry on the canvas, so the drag handle sits on it. */
async function selectRow(page: Page, index: number) {
  if (
    await page
      .getByRole("button", { name: "Enable section selection" })
      .isVisible()
      .catch(() => false)
  ) {
    await enableSelection(page);
  }
  await row(page, index).scrollIntoViewIfNeeded();
  expect(
    await clickExposedElement(page, row(page, index)),
    `entry ${index} was not exposed on the canvas`,
  ).not.toBeNull();
  await expect(dragHandle(page)).toBeVisible({ timeout: 15_000 });
}

const dragHandle = (page: Page) =>
  previewFrame(page).locator('[data-storefront-editor-drag-handle="true"]');

/**
 * Drops the selected entry onto another one and waits for the write.
 *
 * The frame's own drag-and-drop listeners, driven with the events a drop
 * fires: Playwright's `dragTo` starts the gesture inside an iframe but never
 * delivers its drop, which leaves the canvas mid-drag. A drop the editor
 * refuses names the notice it raised instead of timing out silently.
 */
async function dropSelectedOnto(page: Page, index: number) {
  const saved = page
    .waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        isServerFunctionCall(
          response.url(),
          "updateStorefrontThemeSectionProps",
        ),
      { timeout: 20_000 },
    )
    .catch(() => null);
  const dataTransfer = await previewFrame(page)
    .locator("body")
    .evaluateHandle(() => new DataTransfer());
  const handle = dragHandle(page);
  await handle.dispatchEvent("dragstart", { dataTransfer });
  await row(page, index).dispatchEvent("dragover", { dataTransfer });
  await row(page, index).dispatchEvent("drop", { dataTransfer });
  await handle.dispatchEvent("dragend", { dataTransfer }).catch(() => {});
  const response = await saved;
  if (!response) {
    const notices = await page
      .locator("[data-sonner-toast]")
      .allInnerTexts()
      .catch(() => []);
    throw new Error(
      `the drop sent no write; notices: ${JSON.stringify(notices)}`,
    );
  }
  expect(response.ok()).toBe(true);
  await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
    "aria-label",
    /^(Unpublished|Published)$/,
  );
}
