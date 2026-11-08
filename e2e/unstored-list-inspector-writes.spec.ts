import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  isServerFunctionCall,
  openContentTab,
  previewFrame,
  settleSelection,
} from "./helpers";
import {
  countContentWrites,
  execLocalD1,
  nextContentWrite,
  queryLocalD1,
  unconfirmedNotice,
} from "./helpers/editor-writes-paused";
import { THEMES, serverFn } from "./native-acceptance";
import {
  themeScopeFromEditorPath,
  themeSourceGeneration,
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";
import { identifyUnstoredListRows } from "../src/lib/storefront/editor/normalize-row-ids";

/**
 * Inspector Add and Remove on a list the Document does not store yet, and
 * their Undo and Redo, through the real server writes and D1 (#388).
 *
 * The component declares three rows of its own and the Document holds none.
 * The panel draws those defaults with the ids their first write will store
 * (`identifyUnstoredListRows`). Adding or removing an entry stores the list as
 * drawn, changed once; undoing that stores nothing again (the `items` key is
 * removed, so the code's defaults render); redoing writes the same rows with
 * the same ids. Every assertion about what was written reads the route
 * Document from the run's own D1 file, not the editor's copy.
 *
 * Runs on a Theme of its own in the runner-owned database.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

const shared = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
let scope: ThemeScope | null = null;
let editorPath: string | null = null;
/** The route Document, ensured before any test so its id is known. */
let templateId: string | null = null;

const ROUTE_PATH = "/unstored-list";
/** One section per case, so no case starts from another's writes. */
const ADD = "unstored-add";
const REMOVE = "unstored-remove";
const ROW = "unstored-row";
const LOST = "unstored-lost";
const HEADING = "stored-heading";
const SECTIONS = [ADD, REMOVE, ROW, LOST, HEADING] as const;

const DEFAULT_ROWS = [
  { title: "Alpha" },
  { title: "Beta" },
  { title: "Gamma" },
] as const;
const DEFAULT_TITLES = DEFAULT_ROWS.map((row) => row.title);
const STORED_HEADING = "Stored heading";

const FILES = [
  {
    path: "src/routes/unstored-list.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import UnstoredList from "../unstored-list/UnstoredList";

export const Route = createFileRoute("${ROUTE_PATH}")({
  component: UnstoredListRoute,
});

function UnstoredListRoute() {
  return (
    <main>
${SECTIONS.map((id) => `      <UnstoredList {...content("${id}")} />`).join("\n")}
    </main>
  );
}
`,
  },
  {
    path: "src/unstored-list/UnstoredList.tsx",
    content: `export const contentFields = {
  heading: { type: "text", label: "Entries heading" },
  items: {
    type: "array",
    label: "Entries",
    fields: {
      title: { type: "text", label: "Entry title" },
    },
  },
} as const;

type Entry = { id?: string; title?: string };

export default function UnstoredList({
  heading = "Unstored entries",
  items = ${JSON.stringify(DEFAULT_ROWS)},
}: {
  heading?: string;
  items?: Entry[];
}) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{heading}</h2>
      <ul className="mt-6 grid gap-4">
        {items.map((item, index) => (
          <li key={item.id ?? index} className="rounded border p-4">
            <h3 className="text-lg font-medium">{item.title}</h3>
          </li>
        ))}
      </ul>
    </section>
  );
}
`,
  },
];

type Row = Record<string, unknown> & { id?: unknown; title?: unknown };

/** The defaults as the panel draws them: with the ids a first write stores. */
function drawnDefaults(sectionId: string): Row[] {
  return identifyUnstoredListRows("items", DEFAULT_ROWS, {
    templateId: templateId!,
    sectionId,
  }) as Row[];
}

async function createThrowawayTheme(): Promise<ThemeScope> {
  const created = { ...shared!, themeId: randomUUID() };
  const now = new Date().toISOString();
  execLocalD1(`INSERT INTO storefront_themes
    (id, storefront_id, name, metadata, created_at, updated_at)
    VALUES ('${created.themeId}', '${created.storefrontId}',
      'unstored-list-${created.themeId}', '{"starterTemplateVersion":1}',
      '${now}', '${now}');`);
  return created;
}

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

async function ensureRouteDocument(page: Page) {
  const ensured = (await serverFn(
    page,
    THEMES,
    "ensureStorefrontThemeRouteTemplate",
    { ...scope!, routePath: ROUTE_PATH },
  )) as { success: boolean; data?: { id: string; draftGeneration: number } };
  expect(ensured.success, JSON.stringify(ensured)).toBe(true);
  return ensured.data!;
}

/** Writes a section's props as another writer would: the server's own write. */
async function writeAsAnotherPage(
  page: Page,
  sectionId: string,
  props: Record<string, unknown>,
) {
  const ensured = await ensureRouteDocument(page);
  const stored = (await serverFn(
    page,
    THEMES,
    "updateStorefrontThemeSectionProps",
    {
      ...scope!,
      templateId: ensured.id,
      sectionId,
      props,
      expectedDraftGeneration: ensured.draftGeneration,
      expectedSourceGeneration: await themeSourceGeneration(page, scope!),
      routePath: ROUTE_PATH,
    },
  )) as { success: boolean };
  expect(stored.success, JSON.stringify(stored)).toBe(true);
}

/**
 * The route Document as D1 holds it — its draft revision, or the template's
 * own document before it has one — and its draft generation. Read from the
 * run's own SQLite file, not through the editor.
 */
function storedDocument() {
  if (!/^[0-9a-f-]{36}$/.test(templateId!)) throw new Error("template id");
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
  return { document, draftGeneration: Number(rows[0]!.draft_generation) };
}

/** A section's stored props; `null` when the Document has no such section. */
function storedProps(sectionId: string): Record<string, unknown> | null {
  const section = storedDocument().document.sections?.find(
    (candidate) => candidate.id === sectionId,
  );
  return section ? (section.props ?? {}) : null;
}

/** Whether the stored section has an `items` key at all. */
function storesItems(sectionId: string) {
  const props = storedProps(sectionId);
  return props !== null && Object.prototype.hasOwnProperty.call(props, "items");
}

function storedItems(sectionId: string): Row[] {
  const items = storedProps(sectionId)?.items;
  expect(Array.isArray(items), `${sectionId} stores a list`).toBe(true);
  return items as Row[];
}

async function openRoute(page: Page) {
  const url = new URL(editorPath!, "http://placeholder");
  url.searchParams.set("routePath", ROUTE_PATH);
  await page.goto(`${url.pathname}${url.search}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  await expect(canvasTitles(page, HEADING).first()).toBeVisible({
    timeout: 90_000,
  });
  // A fresh page: nothing recorded yet.
  await expectHistory(page, { depth: 0, undo: false, redo: false });
}

const canvasTitles = (page: Page, sectionId: string) =>
  previewFrame(page).locator(
    `[data-storefront-section-id="${sectionId}"] li h3`,
  );

/**
 * A section's row in the structure panel, by the preview's tree node. Every
 * section here is the same component, so the rows share one label.
 */
const panelRow = (page: Page, sectionId: string) =>
  page.locator(
    `[data-editor-tree-node-id^="${sectionId}:"] button[title^="Select "]`,
  );

/** Turns section selection on, if it is off. */
async function selectionOn(page: Page) {
  if (
    await page
      .getByRole("button", { name: "Enable section selection" })
      .isVisible()
      .catch(() => false)
  ) {
    await enableSelection(page);
  }
}

/**
 * Opens the list in the Inspector the one way a browser reaches an unstored
 * list: by clicking a row's title on the canvas. The row has no id, so the row
 * itself is refused and its whole list is offered, unscoped.
 *
 * Selecting the section does not reach it here: the section's element is a
 * `display: contents` wrapper with no box to click, and its root element (the
 * panel row, or a click on the component's own <section>) is reported with
 * the rows' fields as descendants without ids, which the Inspector drops
 * (`rebaseSelectedRowPath` refuses them), so only the heading is offered
 * (run2-new-spec and run4-new-spec).
 */
async function selectListThroughRow(page: Page, sectionId: string) {
  await selectionOn(page);
  const title = previewFrame(page).locator(
    `[data-storefront-section-id="${sectionId}"] [data-storefront-field-path="items.1.title"]:not([data-morph-preview-row-wrapper])`,
  );
  await expect(title).toHaveText("Beta", { timeout: 30_000 });
  await title.scrollIntoViewIfNeeded();
  expect(
    await clickExposedElement(page, title),
    `the second row's title of ${sectionId} was not exposed on the canvas`,
  ).not.toBeNull();
  await openContentTab(page);
  // The row itself is refused for want of an id; its list is offered.
  await expect(page.getByText("This entry has no id yet")).toBeVisible({
    timeout: 15_000,
  });
  await expect(addEntry(page)).toBeVisible();
  await expect(rowCards(page)).toHaveCount(3);
}

const addEntry = (page: Page) =>
  page.getByRole("button", { name: "Add entry", exact: true });

/** The row cards the panel draws for the list. */
const rowCards = (page: Page) =>
  page.locator('[class*="bg-muted/30"]').filter({
    has: page.locator('[data-slot="inspector-content-field"]', {
      hasText: "Entry title",
    }),
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

/**
 * Presses `press` and waits for the one content write it sends to be
 * answered as saved. Exactly one write: none before it, none after it.
 */
async function writeOnce(
  page: Page,
  writes: { sent: number },
  label: string,
  press: () => Promise<void>,
) {
  const before = writes.sent;
  const answer = nextContentWrite(page);
  await press();
  expect(await answer, `the write of ${label}`).toBe("saved");
  // Long enough for a second write to have gone (the debounce is 300 ms).
  await page.waitForTimeout(1_500);
  expect(writes.sent - before, `writes sent for ${label}`).toBe(1);
}

/** The defaults render again: the Document stores no list for the section. */
async function expectCodeDefaults(page: Page, sectionId: string) {
  expect(storesItems(sectionId), `${sectionId} stores no items`).toBe(false);
  await expect(canvasTitles(page, sectionId)).toHaveText(DEFAULT_TITLES, {
    timeout: 30_000,
  });
}

function expectIds(rows: readonly Row[], ids: readonly unknown[]) {
  expect(rows.map((row) => row.id)).toEqual(ids);
}

test.describe("Inspector Add and Remove on a list nothing stores yet", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    scope = await createThrowawayTheme();
    const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
      ...scope,
    })) as {
      success: boolean;
      data?: { templates: Array<{ id: string; type: string }> };
    };
    expect(result.success, JSON.stringify(result)).toBe(true);
    const home = result.data!.templates.find(
      (template) => template.type === "index",
    );
    expect(home).toBeDefined();
    editorPath = `/store/${scope.storefrontId}/themes/${scope.themeId}/editor?templateId=${home!.id}`;
    const saved = await writeThemeFiles(page, scope, FILES);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    templateId = (await ensureRouteDocument(page)).id;
    // Only the last case's heading is stored; every list is unstored.
    await writeAsAnotherPage(page, HEADING, { heading: STORED_HEADING });
    for (const id of SECTIONS) expect(storesItems(id), id).toBe(false);
    expect(storedProps(HEADING)).toEqual({ heading: STORED_HEADING });
    await page.context().close();
  });

  test("Add stores the drawn defaults with their ids plus one row; Undo stores nothing again; Redo the same rows, twice over", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await openRoute(page);
    await expectCodeDefaults(page, ADD);
    await selectListThroughRow(page, ADD);
    await expect(rowCards(page)).toHaveCount(3);
    const writes = countContentWrites(page);
    const drawn = drawnDefaults(ADD);

    await writeOnce(page, writes, "Add", () => addEntry(page).click());
    const added = storedItems(ADD);
    expect(added, "the defaults as drawn, then one new row").toHaveLength(4);
    expect(added.slice(0, 3)).toEqual(drawn);
    expect(typeof added[3]!.id).toBe("string");
    expect(drawn.map((row) => row.id)).not.toContain(added[3]!.id);
    await expectHistory(page, { depth: 1, undo: true, redo: false });
    await expect(canvasTitles(page, ADD)).toHaveCount(4, { timeout: 30_000 });

    for (const round of [1, 2]) {
      await writeOnce(page, writes, `Undo, round ${round}`, () =>
        undoButton(page).click(),
      );
      await expectCodeDefaults(page, ADD);
      await expectHistory(page, { depth: 0, undo: false, redo: true });

      await writeOnce(page, writes, `Redo, round ${round}`, () =>
        redoButton(page).click(),
      );
      expect(storedItems(ADD), `round ${round}: the same rows`).toEqual(added);
      await expectHistory(page, { depth: 1, undo: true, redo: false });
      await expect(canvasTitles(page, ADD)).toHaveCount(4, {
        timeout: 30_000,
      });
    }

    // What the server holds is what a fresh load shows.
    await openRoute(page);
    expect(storedItems(ADD)).toEqual(added);
    await expect(canvasTitles(page, ADD)).toHaveText([...DEFAULT_TITLES, ""]);
  });

  test("Remove of the middle of three drawn rows keeps the first and third with their ids; Undo and Redo once", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openRoute(page);
    await expectCodeDefaults(page, REMOVE);
    await selectListThroughRow(page, REMOVE);
    await expect(rowCards(page)).toHaveCount(3);
    const writes = countContentWrites(page);
    const drawn = drawnDefaults(REMOVE);

    await writeOnce(page, writes, "Remove", () =>
      rowCards(page)
        .nth(1)
        .getByRole("button", { name: "Remove", exact: true })
        .click(),
    );
    const removed = storedItems(REMOVE);
    expect(removed).toEqual([drawn[0], drawn[2]]);
    expectIds(removed, [drawn[0]!.id, drawn[2]!.id]);
    await expectHistory(page, { depth: 1, undo: true, redo: false });
    await expect(canvasTitles(page, REMOVE)).toHaveText(["Alpha", "Gamma"], {
      timeout: 30_000,
    });

    await writeOnce(page, writes, "Undo", () => undoButton(page).click());
    await expectCodeDefaults(page, REMOVE);
    await expectHistory(page, { depth: 0, undo: false, redo: true });

    await writeOnce(page, writes, "Redo", () => redoButton(page).click());
    expect(storedItems(REMOVE)).toEqual(removed);
    await expectHistory(page, { depth: 1, undo: true, redo: false });
    await expect(canvasTitles(page, REMOVE)).toHaveText(["Alpha", "Gamma"], {
      timeout: 30_000,
    });
  });

  test("with an id-less row of the unstored list selected on the canvas, Inspector Add and Remove write; Undo each once", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await openRoute(page);
    await expectCodeDefaults(page, ROW);
    const writes = countContentWrites(page);
    const drawn = drawnDefaults(ROW);

    await selectListThroughRow(page, ROW);
    await writeOnce(page, writes, "Add", () => addEntry(page).click());
    const added = storedItems(ROW);
    expect(added).toHaveLength(4);
    expect(added.slice(0, 3)).toEqual(drawn);
    expect(typeof added[3]!.id).toBe("string");
    await expectHistory(page, { depth: 1, undo: true, redo: false });

    await writeOnce(page, writes, "Undo of the Add", () =>
      undoButton(page).click(),
    );
    await expectCodeDefaults(page, ROW);
    await expectHistory(page, { depth: 0, undo: false, redo: true });

    // Selected again on the list as the code draws it once more.
    await selectListThroughRow(page, ROW);
    await writeOnce(page, writes, "Remove", () =>
      rowCards(page)
        .nth(1)
        .getByRole("button", { name: "Remove", exact: true })
        .click(),
    );
    expect(storedItems(ROW)).toEqual([drawn[0], drawn[2]]);
    // A new edit: the Add's undone entry is gone, this is the only one.
    await expectHistory(page, { depth: 1, undo: true, redo: false });

    await writeOnce(page, writes, "Undo of the Remove", () =>
      undoButton(page).click(),
    );
    await expectCodeDefaults(page, ROW);
    await expectHistory(page, { depth: 0, undo: false, redo: true });
  });

  test("an Undo whose answer is lost after it landed: held unconfirmed, nothing resent; Check and save finds it landed and moves history once", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await openRoute(page);
    await expectCodeDefaults(page, LOST);
    await selectListThroughRow(page, LOST);
    const writes = countContentWrites(page);

    await writeOnce(page, writes, "Add", () => addEntry(page).click());
    const added = storedItems(LOST);
    expect(added).toHaveLength(4);
    await expectHistory(page, { depth: 1, undo: true, redo: false });
    const generationAfterAdd = storedDocument().draftGeneration;

    // The Undo's write reaches the server and is made; its answer is cut
    // off on the way back. Only that one request.
    let cut = false;
    let landed: boolean | null = null;
    await page.route("**/_serverFn/**", async (route) => {
      if (
        cut ||
        !isServerFunctionCall(
          route.request().url(),
          "updateStorefrontThemeSectionProps",
        )
      ) {
        return route.fallback();
      }
      cut = true;
      const response = await route.fetch();
      landed = response.ok();
      await route.abort("connectionreset");
    });
    const before = writes.sent;
    await undoButton(page).click();
    await expect(unconfirmedNotice(page)).toBeVisible({ timeout: 15_000 });
    expect(landed, "the Undo's write itself was made").toBe(true);
    // Long enough for anything sent on its own to have gone several times.
    await page.waitForTimeout(5_000);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(writes.sent - before, "the Undo, sent once and not again").toBe(1);
    // It landed: one generation on, and the list is gone from the section.
    expect(storesItems(LOST)).toBe(false);
    expect(storedDocument().draftGeneration).toBe(generationAfterAdd + 1);
    // Unanswered, so the history has not moved.
    await expectHistory(page, { depth: 1, undo: true, redo: false });

    await unconfirmedNotice(page)
      .getByRole("button", { name: "Check and save" })
      .click();
    await expect(unconfirmedNotice(page)).toHaveCount(0, { timeout: 30_000 });
    // Found landed: the history moves exactly once, and nothing is written.
    await expectHistory(page, { depth: 0, undo: false, redo: true });
    await page.waitForTimeout(2_000);
    expect(writes.sent - before, "nothing sent by the check").toBe(1);
    expect(storesItems(LOST)).toBe(false);
    expect(storedDocument().draftGeneration).toBe(generationAfterAdd + 1);
    await expect(canvasTitles(page, LOST)).toHaveText(DEFAULT_TITLES, {
      timeout: 30_000,
    });

    // The Redo it made available writes the same rows back, once.
    await writeOnce(page, writes, "Redo", () => redoButton(page).click());
    expect(storedItems(LOST)).toEqual(added);
    await expectHistory(page, { depth: 1, undo: true, redo: false });
  });

  test("a Content Undo after another page changed the same field, which the editor has read: refused, the other value kept", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    let lastEditorRead = 0;
    page.on("response", (response) => {
      if (isServerFunctionCall(response.url(), "getStorefrontThemeEditor")) {
        lastEditorRead = Date.now();
      }
    });
    await openRoute(page);
    await panelRow(page, HEADING).click();
    await settleSelection(page);
    await openContentTab(page);
    // `heading` is one of the Inspector's own direct fields: a textarea,
    // saved on blur (run5-new-spec looked for an input).
    const heading = page.getByPlaceholder("Main headline...");
    await expect(heading).toHaveValue(STORED_HEADING, { timeout: 30_000 });
    const writes = countContentWrites(page);

    const mine = `Mine ${Date.now()}`;
    await writeOnce(page, writes, "the heading edit", async () => {
      await heading.fill(mine);
      await heading.press("Tab");
    });
    expect(storedProps(HEADING)).toEqual({ heading: mine });
    await expectHistory(page, { depth: 1, undo: true, redo: false });

    // Another page writes the same field.
    const theirs = `Theirs ${Date.now()}`;
    const other = await signedInPage(browser);
    try {
      await other.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
      await writeAsAnotherPage(other, HEADING, { heading: theirs });
    } finally {
      await other.context().close();
    }
    expect(storedProps(HEADING)).toEqual({ heading: theirs });

    // The editor reads the Theme again, as it does when its tab is shown
    // again once its copy is stale (30 s): TanStack Query refetches on
    // `visibilitychange`.
    const staleFor = 31_000 - (Date.now() - lastEditorRead);
    if (staleFor > 0) await page.waitForTimeout(staleFor);
    const reread = page.waitForResponse(
      (response) =>
        isServerFunctionCall(response.url(), "getStorefrontThemeEditor"),
      { timeout: 30_000 },
    );
    await page.evaluate(() =>
      window.dispatchEvent(new Event("visibilitychange")),
    );
    expect((await reread).ok(), "the editor's read").toBe(true);
    await page.waitForTimeout(1_000);

    const before = writes.sent;
    await undoButton(page).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: /Could not undo/ }),
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2_000);
    expect(
      writes.sent - before,
      "nothing is sent over a step that was not this editor's own",
    ).toBe(0);
    expect(storedProps(HEADING)).toEqual({ heading: theirs });
    await expectHistory(page, { depth: 1, undo: true, redo: false });
  });
});
