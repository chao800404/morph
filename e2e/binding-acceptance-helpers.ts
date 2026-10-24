import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  isServerFunctionCall,
  openContentTab,
  previewFrame,
  settleSelection,
} from "./helpers";
import { THEMES, serverFn } from "./native-acceptance";
import {
  themeScopeFromEditorPath,
  themeSourceGeneration,
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";
import { recordedPreviewRuntimeSql } from "./helpers/recorded-preview-runtime";
import { B1_INTEGRATION_CASES } from "../src/lib/test-utils/binding-acceptance-b1-cases";
import {
  BAS_HERO_LABELS,
  BAS_HERO_PATH,
  BAS_HERO_SOURCE,
  basCaseRootId,
  basRouteSource,
  storedSectionsOf,
  unexpectedDocumentChanges,
  type BasCase,
  type BasElement,
  type StoredDocument,
  type StoredSections,
} from "../src/lib/test-utils/binding-acceptance-cases";

/**
 * Binding acceptance suite, editor E2E layer (ROADMAP 1.2 "綁定驗收規範",
 * draft rule in PR #284). Cases and targets:
 * `src/lib/test-utils/binding-acceptance-cases.ts`; live layer:
 * `src/lib/storefront/binding-acceptance.live.test.ts`.
 *
 * Every case is walked twice, once editing in the Inspector and once typing
 * on the canvas, and each walk records the five steps on their own:
 *
 *   S1 the stored Document renders on the canvas
 *   S2 a click locates the target: the canvas claim (section, field) and the
 *      Inspector field it offers
 *   S3 the edit goes through the editor's real write (authorization, OCC)
 *   S4 the stored Document, read raw from D1 (the draft revision row, not
 *      `getStorefrontThemeEditor`, which filters), changed only at the target
 *   S5 after a reload the canvas, the Inspector and storage agree
 *
 * A step that fails is recorded as a soft failure and the walk goes on, so one
 * run measures every step. The targets are the rule's; a refusal is not a
 * pass where the rule asks for an edit.
 *
 * Runtime: the default client-only Live Preview reads with `content("x")`; the
 * full Start preview (`MORPH_E2E_PREVIEW_RUNTIME=start`, with the Worker's
 * `MORPH_THEME_PREVIEW_RUNTIME=start`) reads with server function -> loader ->
 * `Route.useLoaderData()`, which the client-only preview cannot run at all.
 *
 * Runs on a Theme of its own in the runner-owned database. The stored content
 * is seeded through the editor's own write, on a route shape the product
 * binds, and the case shapes are then saved over it; saving source writes no
 * content.
 */
export const RUNTIME =
  process.env.MORPH_E2E_PREVIEW_RUNTIME === "start" ? "start" : "client";
const SPELLING = RUNTIME === "start" ? "loader" : "content";

const shared = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;

type Fixture = { scope: ThemeScope; editorPath: string };
let fixture: Fixture | null = null;

type Mode = "inspector" | "inline";
const MODES: readonly Mode[] = ["inspector", "inline"];

/** The route and Document one walk owns. */
const routeFor = (testCase: BasCase, mode: Mode) => ({
  routePath: `/bas-${testCase.id}-${mode}`,
  routeFile: `src/routes/bas-${testCase.id}-${mode}.tsx`,
});

/** One D1 statement against the runner-owned database, its rows as JSON. */
async function d1(sql: string): Promise<Array<Record<string, unknown>>> {
  const { stdout } = await promisify(execFile)(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DATABASE",
      "--local",
      ...((process.env.MORPH_E2E_TRANSPORT ?? "local-sidecar") === "local-sidecar"
        ? ["--env", "local_preview_e2e"]
        : []),
      "--persist-to",
      process.env.MORPH_E2E_STATE_DIR!,
      "--json",
      "--command",
      sql,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return (
    (JSON.parse(stdout) as Array<{ results?: Array<Record<string, unknown>> }>)[0]
      ?.results ?? []
  );
}

const uuid = (value: string) => {
  if (!/^[0-9a-f-]{36}$/.test(value)) throw new Error(`Not an id: ${value}`);
  return value;
};

/** The route's stored Document, from its draft revision row. */
async function rawDocument(routePath: string): Promise<StoredDocument> {
  if (!/^\/[a-z0-9-]+$/.test(routePath)) throw new Error(routePath);
  const rows = await d1(
    `SELECT r.document AS document
     FROM storefront_theme_templates t
     JOIN storefront_theme_template_revisions r
       ON r.id = t.draft_revision_id AND r.template_id = t.id
     WHERE t.theme_id = '${uuid(fixture!.scope.themeId)}'
       AND t.route_path = '${routePath}'
       AND t.deleted_at IS NULL`,
  );
  expect(rows, `one stored draft for ${routePath}`).toHaveLength(1);
  return JSON.parse(String(rows[0]!.document)) as StoredDocument;
}

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

async function createThrowawayTheme(): Promise<ThemeScope> {
  const created = { ...shared!, themeId: randomUUID() };
  const now = new Date().toISOString();
  await d1(
    `INSERT INTO storefront_themes
    (id, storefront_id, name, metadata, preview_runtime, created_at, updated_at)
    VALUES ('${created.themeId}', '${uuid(created.storefrontId)}',
      'binding-acceptance-${created.themeId}', '{"starterTemplateVersion":1}',
      ${recordedPreviewRuntimeSql()}, '${now}', '${now}');`,
  );
  return created;
}

/** Stores one section's props through the editor's own write. */
async function storeSlot(
  page: Page,
  routePath: string,
  sectionId: string,
  props: Record<string, string>,
) {
  const scope = fixture!.scope;
  const ensured = (await serverFn(page, THEMES, "ensureStorefrontThemeRouteTemplate", {
    ...scope,
    routePath,
  })) as { success: boolean; data?: { id: string; draftGeneration: number } };
  expect(ensured.success, JSON.stringify(ensured)).toBe(true);
  const stored = (await serverFn(page, THEMES, "updateStorefrontThemeSectionProps", {
    ...scope,
    templateId: ensured.data!.id,
    sectionId,
    props,
    expectedDraftGeneration: ensured.data!.draftGeneration,
    expectedSourceGeneration: await themeSourceGeneration(page, scope),
    routePath,
  })) as { success: boolean };
  expect(stored.success, `seed ${routePath} ${sectionId}: ${JSON.stringify(stored)}`).toBe(
    true,
  );
}

/**
 * The Theme, its seeded content and the case routes, once per run and
 * runtime. A failed test restarts the worker, and with it `beforeAll`; the
 * fixture is kept in the run's own state directory so a restart reuses it
 * instead of building a second Theme.
 */
export async function ensureFixture(browser: Browser) {
  const cache = join(process.env.MORPH_E2E_STATE_DIR!, `bas-fixture-${RUNTIME}.json`);
  if (existsSync(cache)) {
    fixture = JSON.parse(readFileSync(cache, "utf8")) as Fixture;
    return;
  }
  const page = await signedInPage(browser);
  try {
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const scope = await createThrowawayTheme();
    const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
      ...scope,
    })) as { success: boolean; data?: { templates: Array<{ id: string; type: string }> } };
    expect(result.success, JSON.stringify(result)).toBe(true);
    const home = result.data!.templates.find((template) => template.type === "index");
    expect(home).toBeDefined();
    fixture = {
      scope,
      editorPath: `/store/${scope.storefrontId}/themes/${scope.themeId}/editor?templateId=${home!.id}`,
    };

    // Seed: every section spread once, the shape the product binds. Each
    // case and mode has a route and Document of its own, so what one walk
    // writes (or deletes) never becomes the next walk's starting point.
    const walks = B1_INTEGRATION_CASES.flatMap((testCase) =>
      MODES.map((mode) => ({ testCase, ...routeFor(testCase, mode) })),
    );
    const seedFiles = [
      { path: BAS_HERO_PATH, content: BAS_HERO_SOURCE },
      ...walks.map(({ testCase, routePath, routeFile }) => ({
        path: routeFile,
        content: basRouteSource(testCase, SPELLING, { routePath, seed: true }),
      })),
    ];
    const seeded = await writeThemeFiles(page, scope, seedFiles);
    expect(seeded.success, JSON.stringify(seeded)).toBe(true);
    for (const { testCase, routePath } of walks) {
      for (const [section, props] of Object.entries(testCase.seed)) {
        await storeSlot(page, routePath, section, { ...props });
      }
      expect(storedSectionsOf(await rawDocument(routePath))).toEqual(testCase.seed);
    }

    // The case shapes, saved over the seed routes. No content is written.
    const caseFiles = walks.map(({ testCase, routePath, routeFile }) => ({
      path: routeFile,
      content: basRouteSource(testCase, SPELLING, { routePath }),
    }));
    const saved = await writeThemeFiles(page, scope, caseFiles);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    for (const { testCase, routePath } of walks) {
      expect(storedSectionsOf(await rawDocument(routePath))).toEqual(testCase.seed);
    }
    writeFileSync(cache, JSON.stringify(fixture), { mode: 0o600 });
  } finally {
    await page.context().close();
  }
}

// ---------------------------------------------------------------------------
// The canvas and the Inspector

const caseRoot = (page: Page, testCase: BasCase) =>
  previewFrame(page).locator(`[data-bas-case="${basCaseRootId(testCase)}"]`);

const elementLocator = (page: Page, testCase: BasCase, element: BasElement) =>
  caseRoot(page, testCase).locator(element.tag).nth(element.nth);

const inspectorFieldBox = (page: Page, field: "title" | "desc") =>
  page
    .locator('[data-slot="inspector-content-field"]')
    .filter({ hasText: BAS_HERO_LABELS[field] });

const inspectorInput = (page: Page, field: "title" | "desc") =>
  inspectorFieldBox(page, field).locator("input, textarea").first();

async function openCase(page: Page, testCase: BasCase) {
  const url = new URL(fixture!.editorPath, "http://placeholder");
  url.searchParams.set("routePath", testCase.routePath);
  await page.goto(`${url.pathname}${url.search}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  await expect(caseRoot(page, testCase), "the case's page rendered").toBeVisible({
    timeout: 90_000,
  });
}

async function ensureSelection(page: Page) {
  const enable = page.getByRole("button", { name: "Enable section selection" });
  const visible = await enable.isVisible().catch(() => false);
  await (visible ? enableSelection(page) : Promise.resolve());
}

/** Clicks the element on the canvas and opens the Content tab. */
async function selectElement(page: Page, testCase: BasCase, element: BasElement) {
  await ensureSelection(page);
  const target = elementLocator(page, testCase, element);
  await target.scrollIntoViewIfNeeded({ timeout: 10_000 });
  expect(
    await clickExposedElement(page, target),
    "the element was not exposed on the canvas",
  ).not.toBeNull();
  await settleSelection(page);
  await openContentTab(page);
}

/** What the canvas claims for the element: its section and its field. */
async function canvasClaim(page: Page, testCase: BasCase, element: BasElement) {
  return elementLocator(page, testCase, element).evaluate((node) => ({
    section:
      node
        .closest("[data-storefront-section-id]")
        ?.getAttribute("data-storefront-section-id") ?? null,
    field: node.getAttribute("data-storefront-field"),
    bindingState: node.getAttribute("data-morph-binding-state"),
    selected: node.getAttribute("data-storefront-editor-selected"),
    text: node.textContent,
  }));
}

/** Every content field input the Inspector offers now, with its value. */
async function offeredFields(page: Page) {
  return page
    .locator('[data-slot="inspector-content-field"]')
    .evaluateAll((boxes) =>
      boxes.map((box) => ({
        text: (box.textContent ?? "").slice(0, 60),
        value:
          (box.querySelector("input, textarea") as HTMLInputElement | null)?.value ??
          null,
        focused: box.className.includes("ring-primary/30"),
      })),
    );
}

// ---------------------------------------------------------------------------
// One walk

type Walk = {
  runtime: string;
  mode: Mode;
  case: string;
  steps: Record<string, string>;
  observed: Record<string, unknown>;
};

function record(walk: Walk) {
  const line = JSON.stringify({ layer: "e2e", ...walk });
  test.info().annotations.push({ type: "bas-walk", description: line });
  const file = process.env.BAS_OBS_FILE;
  // The observation log is optional; the annotation above always carries it.
  for (const target of file ? [file] : []) appendFileSync(target, `${line}\n`);
}

/** Runs one step; a failure is recorded softly and the walk goes on. */
async function step(walk: Walk, name: string, body: () => Promise<void>) {
  let failure: string | null = null;
  try {
    await test.step(name, body);
  } catch (error) {
    failure = (error instanceof Error ? error.message : String(error))
      .replace(/\x1b\[[0-9;]*m/g, "")
      .split("\n")
      .filter((line) => line.trim() && !/^\s+at /.test(line))
      .slice(0, 12)
      .join(" | ")
      .slice(0, 900);
  }
  walk.steps[name] = failure ? `FAIL: ${failure}` : "PASS";
  expect.soft(failure, `${walk.case} ${walk.mode} ${name}`).toBeNull();
}

/** The change the target asks for, in this mode, or none. */
function wantedChange(testCase: BasCase, mode: Mode, value: string) {
  const element = testCase.elements[testCase.edit.element]!;
  const inspector = testCase.edit.inspector;
  if (mode === "inspector") {
    return inspector ? { section: inspector.section, field: inspector.field, value } : null;
  }
  // Typing on the canvas writes only over a direct field.
  return element.target.kind === "field" && testCase.edit.inlineWrites
    ? { section: element.target.section, field: element.target.field, value }
    : null;
}

function applyChange(
  stored: StoredSections,
  change: ReturnType<typeof wantedChange>,
): StoredSections {
  return change
    ? {
        ...stored,
        [change.section]: { ...stored[change.section], [change.field]: change.value },
      }
    : stored;
}

/** S2 for a direct field: the canvas claims it and the Inspector offers it. */
async function expectLocatedField(
  page: Page,
  testCase: BasCase,
  element: BasElement,
  stored: StoredSections,
) {
  const target = element.target as Extract<BasElement["target"], { kind: "field" }>;
  expect(await canvasClaim(page, testCase, element)).toMatchObject({
    section: target.section,
    field: target.field,
    selected: "true",
  });
  await expect(inspectorInput(page, target.field)).toBeVisible({ timeout: 10_000 });
  await expect(inspectorInput(page, target.field)).toHaveValue(
    stored[target.section]![target.field]!,
  );
  await expect(inspectorFieldBox(page, target.field)).toHaveClass(/ring-primary\/30/);
}

/** S2 for composed text: its raw fields are offered with their stored values. */
async function expectLocatedRawFields(
  page: Page,
  _testCase: BasCase,
  element: BasElement,
  stored: StoredSections,
) {
  const target = element.target as Extract<BasElement["target"], { kind: "composed" }>;
  for (const field of target.rawFields) {
    await expect(inspectorInput(page, field), `raw field ${field}`).toBeVisible({
      timeout: 10_000,
    });
    await expect(inspectorInput(page, field)).toHaveValue(stored[target.section]![field]!);
  }
}

/** S2 for a literal: shown as written in code, never as a stored field. */
async function expectShownAsCode(
  page: Page,
  testCase: BasCase,
  element: BasElement,
  _stored: StoredSections,
) {
  const claim = await canvasClaim(page, testCase, element);
  const storedIds = Object.keys(testCase.seed);
  const expectedState =
    element.target.kind === "untraced"
      ? "untraced"
      : testCase.id === "p4a"
        ? "derived"
        : "not-cms";
  expect(
    claim.section !== null &&
      storedIds.includes(claim.section) &&
      claim.field !== null &&
      claim.field.length > 0
      ? `${claim.section}.${claim.field}`
      : null,
    "a literal is not claimed as a stored field",
  ).toBeNull();
  expect(claim.bindingState, "Design reports the correct non-editable value state").toBe(
    expectedState,
  );
  await expect(page.locator('[data-testid="inspector-content-binding-state"]'))
    .toHaveAttribute("data-binding-state", expectedState, { timeout: 10_000 });
  await expect(inspectorInput(page, literalProp(element))).toHaveCount(0);
}

const LOCATE = {
  field: expectLocatedField,
  composed: expectLocatedRawFields,
  literal: expectShownAsCode,
  untraced: expectShownAsCode,
} as const;

export async function walkCase(page: Page, sharedCase: BasCase, mode: Mode) {
  test.setTimeout(420_000);
  // This walk's own route and Document.
  const testCase: BasCase = { ...sharedCase, ...routeFor(sharedCase, mode) };
  const walk: Walk = {
    runtime: RUNTIME,
    mode,
    case: testCase.id,
    steps: {},
    observed: {},
  };
  const writes: string[] = [];
  page.on("request", (request) => {
    if (isServerFunctionCall(request.url(), "updateStorefrontThemeSectionProps")) {
      writes.push((request.postData() ?? "").slice(0, 400));
    }
  });
  const element = testCase.elements[testCase.edit.element]!;
  const before = await rawDocument(testCase.routePath);
  const storedBefore = storedSectionsOf(before);
  const value = `BAS ${RUNTIME} ${testCase.id} ${mode} ${Date.now()}`;
  const change = wantedChange(testCase, mode, value);
  const storedAfter = applyChange(storedBefore, change);
  walk.observed.before = storedBefore;
  walk.observed.change = change;
  let afterWrite: StoredDocument | null = null;

  try {
    await step(walk, "S1", async () => {
      await openCase(page, testCase);
      const shown = await Promise.all(
        testCase.elements.map((candidate) =>
          elementLocator(page, testCase, candidate)
            .textContent({ timeout: 10_000 })
            .catch(() => null),
        ),
      );
      walk.observed.S1shown = shown;
      expect(shown).toEqual(testCase.elements.map((candidate) => candidate.text(storedBefore)));
    });

    await step(walk, "S2", async () => {
      await selectElement(page, testCase, element);
      walk.observed.S2claim = await canvasClaim(page, testCase, element).catch(
        (error) => String(error).slice(0, 200),
      );
      walk.observed.S2offered = await offeredFields(page).catch(() => null);
      walk.observed.S2notice = await page
        .locator('[data-testid="editor-code-text-notice"], [data-testid="inspector-content-binding-state"], [data-slot="inspector-content-unavailable"]')
        .allTextContents()
        .catch(() => null);
      walk.observed.S2noEditableContent = await page
        .getByText("This element has no editable content.")
        .isVisible()
        .catch(() => null);
      await LOCATE[element.target.kind](page, testCase, element, storedBefore);
    });

    await step(walk, "S3", async () => {
      const writesBefore = writes.length;
      const shownS1 = walk.observed.S1shown as Array<string | null> | undefined;
      const context: EditContext = {
        value,
        change,
        storedBefore,
        shownBefore: shownS1?.[testCase.edit.element] ?? null,
      };
      const edit = mode === "inspector" ? inspectorEdit : inlineEdit;
      try {
        await edit(page, testCase, element, context, walk);
      } finally {
        walk.observed.S3writes = writes.slice(writesBefore);
      }
      // Without a target write, nothing carrying the typed text was sent.
      expect(
        change
          ? []
          : writes.slice(writesBefore).filter((body) => body.includes(value)),
        "no content write was sent",
      ).toEqual([]);
    });

    await step(walk, "S4", async () => {
      afterWrite = await rawDocument(testCase.routePath);
      walk.observed.S4after = storedSectionsOf(afterWrite);
      const problems = unexpectedDocumentChanges(before, afterWrite, change);
      walk.observed.S4problems = problems;
      expect(problems).toEqual([]);
    });

    await step(walk, "S5", async () => {
      await openCase(page, testCase);
      const shown = await Promise.all(
        testCase.elements.map((candidate) =>
          elementLocator(page, testCase, candidate)
            .textContent({ timeout: 10_000 })
            .catch(() => null),
        ),
      );
      walk.observed.S5shown = shown;
      const reloaded = await rawDocument(testCase.routePath);
      walk.observed.S5stored = storedSectionsOf(reloaded);
      expect(
        JSON.stringify(reloaded),
        "storage after the reload is what the edit left",
      ).toBe(JSON.stringify(afterWrite ?? reloaded));
      expect(storedSectionsOf(reloaded), "storage holds the edit and nothing else").toEqual(
        storedAfter,
      );
      expect(shown, "the canvas shows what is stored").toEqual(
        testCase.elements.map((candidate) => candidate.text(storedAfter)),
      );
      await selectElement(page, testCase, element);
      walk.observed.S5offered = await offeredFields(page).catch(() => null);
      await LOCATE[element.target.kind](page, testCase, element, storedAfter);
    });
  } finally {
    record(walk);
  }
}

type EditContext = {
  value: string;
  change: ReturnType<typeof wantedChange>;
  storedBefore: StoredSections;
  shownBefore: string | null;
};

/** The prop a literal sits on: what an editor would wrongly offer for it. */
const literalProp = (element: BasElement) => (element.tag === "h1" ? "title" : "desc");

/** S3 in the Inspector: the target's field is edited where the panel offers it. */
async function inspectorEdit(
  page: Page,
  testCase: BasCase,
  element: BasElement,
  context: EditContext,
  walk: Walk,
) {
  const { value } = context;
  const inspector = testCase.edit.inspector;
  // A literal has no field to edit. Should the panel offer the prop it sits
  // on anyway, that field is edited: were the boundary ever to give, this is
  // the edit that would land. Afterwards nothing may have been written.
  const wrongly = inspectorInput(page, literalProp(element));
  walk.observed.S3literalPropOffered = inspector
    ? null
    : await wrongly.isVisible().catch(() => false);
  for (const input of inspector || !walk.observed.S3literalPropOffered ? [] : [wrongly]) {
    await input.fill(value).catch(() => undefined);
    await input.press("Tab").catch(() => undefined);
  }
  for (const target of inspector ? [inspector] : []) {
    const input = inspectorInput(page, target.field);
    await expect(input, `the Inspector offers ${target.field}`).toBeVisible({
      timeout: 10_000,
    });
    const saved = page.waitForResponse(
      (response) =>
        isServerFunctionCall(response.url(), "updateStorefrontThemeSectionProps") &&
        (response.request().postData() ?? "").includes(value),
      { timeout: 20_000 },
    );
    await input.fill(value);
    await input.press("Tab");
    const response = await saved;
    const body = await response.text();
    walk.observed.S3response = body.slice(0, 400);
    expect(response.ok(), body.slice(0, 400)).toBe(true);
    expect(body, "the server accepted the write").not.toMatch(
      /SECTION_SOURCE_UNCONFIRMED|SELECTION_SOURCE_CONFLICT|"success":false/,
    );
  }
  await page.waitForTimeout(2_000);
  await expectCanvasAfterEdit(
    page,
    testCase,
    element,
    context.change,
    context.storedBefore,
    context.shownBefore,
  );
}

/** S3 on the canvas: double-click, type over the text, commit. */
async function inlineEdit(
  page: Page,
  testCase: BasCase,
  element: BasElement,
  context: EditContext,
  walk: Walk,
) {
  const { value, change } = context;
  const target = elementLocator(page, testCase, element);
  const box = await target.boundingBox();
  expect(box, "no box for the element").not.toBeNull();
  await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.waitForTimeout(800);
  walk.observed.S3editable = await target.getAttribute("contenteditable").catch(() => null);
  if (element.target.kind === "untraced") {
    expect(walk.observed.S3editable, "an untraced value cannot enter canvas editing").toBeNull();
    walk.observed.S3refused = true;
    return;
  }
  // Over a direct field, editing must have begun before anything is typed.
  expect(
    change ? walk.observed.S3editable : "plaintext-only",
    "editing began on the canvas",
  ).toBe("plaintext-only");
  const saved = change
    ? page.waitForResponse(
        (response) =>
          isServerFunctionCall(response.url(), "updateStorefrontThemeSectionProps") &&
          (response.request().postData() ?? "").includes(value),
        { timeout: 20_000 },
      )
    : null;
  // The edit opens with its text selected, so typing replaces it. Over a
  // literal or composed text it is typed all the same: this is the keystroke
  // that must not land.
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
  for (const pending of saved ? [saved] : []) {
    const response = await pending;
    const body = await response.text();
    walk.observed.S3response = body.slice(0, 400);
    expect(response.ok(), body.slice(0, 400)).toBe(true);
    expect(body, "the server accepted the write").not.toMatch(
      /SECTION_SOURCE_UNCONFIRMED|SELECTION_SOURCE_CONFLICT|"success":false/,
    );
  }
  await page.waitForTimeout(2_500);
  await expectCanvasAfterEdit(
    page,
    testCase,
    element,
    change,
    context.storedBefore,
    context.shownBefore,
  );
}

/**
 * After S3 the canvas shows the edit, rendered by the Theme (for composed
 * text, composed again from the edited raw field); without a write it shows
 * what it showed before.
 */
async function expectCanvasAfterEdit(
  page: Page,
  testCase: BasCase,
  element: BasElement,
  change: ReturnType<typeof wantedChange>,
  storedBefore: StoredSections,
  shownBefore: string | null,
) {
  await expect(elementLocator(page, testCase, element)).toHaveText(
    change ? element.text(applyChange(storedBefore, change)) : (shownBefore ?? ""),
    { timeout: 15_000 },
  );
}
