import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import {
  recordedPreviewRuntimeSql,
  verifyRecordedThemePreviewRuntime,
} from "./helpers/recorded-preview-runtime";

/**
 * A prop set at a section's call site next to its content spread, edited in
 * Design: in the Inspector and by typing on the canvas.
 *
 *   <OverrideHero {...content("hero")} title="Sale" />
 *
 * JSX builds the props left to right, so the literal replaces the spread's
 * title: the page shows the code's "Sale", and the stored `hero.title` holds
 * "Sale" too. The text cannot say which won; the source does. Neither route
 * may write anything for that element. Written before the spread, the same
 * literal is replaced by the stored title, and the element is `hero.title`:
 * both routes write it, which is also what shows the refusal above is not an
 * editor that writes nothing at all.
 *
 * Both runtimes run the `content("x")` form. The full Start preview
 * (`MORPH_E2E_PREVIEW_RUNTIME=start`) also runs the loader form, verifying
 * that the section and untouched fields remain bound while a literal override
 * is still code-controlled and cannot be written as CMS content.
 *
 * Runs on a Theme of its own in the runner-owned database.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

const RUNTIME =
  process.env.MORPH_E2E_PREVIEW_RUNTIME === "start" ? "start" : "client";

const shared = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
let scope: ThemeScope | null = null;
let editorPath: string | null = null;

const SLOT = "hero";
const AFTER_ROUTE = "/spread-after";
const BEFORE_ROUTE = "/spread-before";
const LOADER_ROUTE = "/spread-after-loader";
/** The overridden instance beside a second, untouched one. */
const TWO_ROUTE = "/spread-two";
const PLAIN = "plain";
const SALE = "Sale";
const STORED = { title: SALE, subtitle: "Stored subtitle" };
const PLAIN_STORED = { title: SALE, subtitle: "Plain subtitle" };
const LOADER_STORED = {
  title: "Stored loader title",
  subtitle: "Stored loader subtitle",
};

const HERO_FILE = {
  path: "src/components/OverrideHero.tsx",
  content: `export const contentFields = {
  title: { type: "text", label: "Override title" },
  subtitle: { type: "text", label: "Override subtitle" },
} as const;

type OverrideHeroProps = { title?: string; subtitle?: string };

export default function OverrideHero({
  title = "Override default title",
  subtitle = "Override default subtitle",
}: OverrideHeroProps) {
  return (
    <section data-override-hero="" className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-2">{subtitle}</p>
    </section>
  );
}
`,
};

function contentRoute(path: string, name: string, element: string) {
  return {
    path: `src/routes${path}.tsx`,
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import OverrideHero from "../components/OverrideHero";

export const Route = createFileRoute("${path}")({ component: ${name} });

function ${name}() {
  return (
    <main>
      ${element}
    </main>
  );
}
`,
  };
}

function loaderRoute(element: string) {
  return {
    path: `src/routes${LOADER_ROUTE}.tsx`,
    content: `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import OverrideHero from "../components/OverrideHero";

const getPage = createServerFn().handler(() => morph.pages.get("${LOADER_ROUTE}"));

export const Route = createFileRoute("${LOADER_ROUTE}")({
  loader: () => getPage(),
  component: SpreadAfterLoaderRoute,
});

function SpreadAfterLoaderRoute() {
  const { ${SLOT} } = Route.useLoaderData();
  return (
    <main>
      ${element}
    </main>
  );
}
`,
  };
}

const FILES = [
  HERO_FILE,
  contentRoute(
    TWO_ROUTE,
    "SpreadTwoRoute",
    `<OverrideHero {...content("${SLOT}")} />
      <OverrideHero {...content("${PLAIN}")} />`,
  ),
  contentRoute(
    AFTER_ROUTE,
    "SpreadAfterRoute",
    `<OverrideHero {...content("${SLOT}")} />`,
  ),
  contentRoute(
    BEFORE_ROUTE,
    "SpreadBeforeRoute",
    `<OverrideHero {...content("${SLOT}")} />`,
  ),
];

const OVERRIDE_FILES = [
  contentRoute(
    TWO_ROUTE,
    "SpreadTwoRoute",
    `<OverrideHero {...content("${SLOT}")} title="${SALE}" />
      <OverrideHero {...content("${PLAIN}")} />`,
  ),
  contentRoute(
    AFTER_ROUTE,
    "SpreadAfterRoute",
    `<OverrideHero {...content("${SLOT}")} title="${SALE}" />`,
  ),
  contentRoute(
    BEFORE_ROUTE,
    "SpreadBeforeRoute",
    `<OverrideHero title="${SALE}" {...content("${SLOT}")} />`,
  ),
];

async function createThrowawayTheme(): Promise<ThemeScope> {
  const created = { ...shared!, themeId: randomUUID() };
  const now = new Date().toISOString();
  await promisify(execFile)("npx", [
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
    "--command",
    `INSERT INTO storefront_themes
    (id, storefront_id, name, metadata, preview_runtime, created_at, updated_at)
    VALUES ('${created.themeId}', '${created.storefrontId}',
      'spread-override-binding-${created.themeId}', '{"starterTemplateVersion":1}',
      ${recordedPreviewRuntimeSql()}, '${now}', '${now}');`,
  ]);
  verifyRecordedThemePreviewRuntime(created);
  return created;
}

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

/** Stores the slot's props through the editor's own write. */
async function storeSlot(
  page: Page,
  routePath: string,
  props: Record<string, string>,
  sectionId = SLOT,
) {
  const ensured = (await serverFn(
    page,
    THEMES,
    "ensureStorefrontThemeRouteTemplate",
    { ...scope!, routePath },
  )) as { success: boolean; data?: { id: string; draftGeneration: number } };
  expect(ensured.success, JSON.stringify(ensured)).toBe(true);
  const stored = (await serverFn(
    page,
    THEMES,
    "updateStorefrontThemeSectionProps",
    {
      ...scope!,
      templateId: ensured.data!.id,
      sectionId,
      props,
      expectedDraftGeneration: ensured.data!.draftGeneration,
      expectedSourceGeneration: await themeSourceGeneration(page, scope!),
      routePath,
    },
  )) as { success: boolean };
  expect(stored.success, `seed ${routePath}: ${JSON.stringify(stored)}`).toBe(
    true,
  );
}

/** The slot's stored props on a route, as the editor reads them. */
/**
 * A section's props as the database holds them: the route's draft revision,
 * or the template's own document before it has one. Read from the
 * runner-owned D1, not through the editor's read.
 */
async function rawStoredProps(
  routePath: string,
  sectionId: string,
): Promise<Record<string, unknown> | null> {
  if (!/^\/[a-z0-9-]+$/.test(routePath)) throw new Error(routePath);
  if (!/^[0-9a-f-]{36}$/.test(scope!.themeId)) throw new Error("theme id");
  const { stdout } = await promisify(execFile)(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DATABASE",
      "--local",
      ...((process.env.MORPH_E2E_TRANSPORT ?? "local-sidecar") ===
      "local-sidecar"
        ? ["--env", "local_preview_e2e"]
        : []),
      "--persist-to",
      process.env.MORPH_E2E_STATE_DIR!,
      "--json",
      "--command",
      `SELECT CASE WHEN t.draft_revision_id IS NULL THEN t.document ELSE r.document END AS document
       FROM storefront_theme_templates t LEFT JOIN storefront_theme_template_revisions r
         ON r.id = t.draft_revision_id AND r.template_id = t.id
       WHERE t.theme_id = '${scope!.themeId}' AND t.route_path = '${routePath}'
         AND t.deleted_at IS NULL`,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const rows =
    (
      JSON.parse(stdout) as Array<{ results?: Array<Record<string, unknown>> }>
    )[0]?.results ?? [];
  expect(rows, `one stored template for ${routePath}`).toHaveLength(1);
  const document = JSON.parse(String(rows[0]!.document)) as {
    sections: Array<{ id: string; props?: Record<string, unknown> }>;
  };
  return (
    document.sections.find((section) => section.id === sectionId)?.props ?? null
  );
}

async function storedProps(page: Page, routePath: string) {
  const editor = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
    ...scope!,
  })) as {
    success: boolean;
    data?: {
      templates: Array<{
        routePath: string | null;
        document: {
          sections: Array<{ id: string; props?: Record<string, unknown> }>;
        };
      }>;
    };
  };
  expect(editor.success, JSON.stringify(editor)).toBe(true);
  const template = editor.data!.templates.find(
    (candidate) => candidate.routePath === routePath,
  );
  return (
    template?.document.sections.find((section) => section.id === SLOT)?.props ??
    null
  );
}

const heading = (page: Page) =>
  previewFrame(page).locator("[data-override-hero] h2");
const inlineEditor = (page: Page) =>
  previewFrame(page).locator("[data-storefront-editor-inline-editing]");
const offeredFields = (page: Page) =>
  page
    .locator('[data-slot="inspector-content-field"]')
    .filter({ hasText: /Override (title|subtitle)/ })
    .locator("input");
const subtitleField = (page: Page) =>
  page
    .locator('[data-slot="inspector-content-field"]')
    .filter({ hasText: "Override subtitle" })
    .locator("input");
const codeSetNotice = (page: Page) =>
  page.locator('[data-slot="inspector-code-set-fields"]');
/** A section's row in the structure panel, by the preview's tree node. */
const panelRow = (page: Page, sectionId: string) =>
  page.locator(
    `[data-editor-tree-node-id^="${sectionId}:"] button[title^="Select "]`,
  );
const sectionHeading = (page: Page, sectionId: string) =>
  previewFrame(page).locator(
    `[data-storefront-section-id="${sectionId}"] [data-override-hero] h2`,
  );
const sectionText = (page: Page, sectionId: string) =>
  previewFrame(page).locator(
    `[data-storefront-section-id="${sectionId}"] [data-override-hero] p`,
  );
const titleField = (page: Page) =>
  page
    .locator('[data-slot="inspector-content-field"]')
    .filter({ hasText: "Override title" })
    .locator("input");

async function openRoute(page: Page, routePath: string) {
  const url = new URL(editorPath!, "http://placeholder");
  url.searchParams.set("routePath", routePath);
  await page.goto(`${url.pathname}${url.search}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  await expect(heading(page)).toHaveText(SALE, { timeout: 90_000 });
}

/** Clicks `target` on the canvas, turning section selection on first. */
async function clickOnCanvas(page: Page, target: Locator) {
  if (
    await page
      .getByRole("button", { name: "Enable section selection" })
      .isVisible()
      .catch(() => false)
  ) {
    await enableSelection(page);
  }
  await target.scrollIntoViewIfNeeded();
  expect(
    await clickExposedElement(page, target),
    "the element was not exposed on the canvas",
  ).not.toBeNull();
  await settleSelection(page);
}

/** Every section-props write this tab sends from the moment it is called. */
function watchWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      isServerFunctionCall(request.url(), "updateStorefrontThemeSectionProps")
    ) {
      writes.push(request.postData() ?? "");
    }
  });
  return writes;
}

/**
 * Tries both editing routes on the heading: every field the Inspector offers
 * for it, and typing on the canvas. Nothing may be written.
 */
/**
 * The section, selected from the structure panel. With a structure from the
 * preview the row selects the section's root element; without one, the
 * section itself. Either way the title the code sets is not a control: it is
 * named as set in code, and nothing is written for it. (Which other fields
 * the form offers depends on that entry; the shell test pins the section
 * form, where the fields the call site leaves alone stay editable.)
 */
async function structurePanelWithholdsTheTitle(page: Page, routePath: string) {
  const writes = watchWrites(page);
  await openRoute(page, routePath);
  await page
    .locator('button[title^="Select "]')
    .filter({ hasText: /hero/ })
    .first()
    .click();
  await openContentTab(page);
  await expect(codeSetNotice(page)).toContainText("Override title");
  await expect(codeSetNotice(page)).toContainText(
    "passes its own value for these fields after this section's content",
  );
  await expect(titleField(page)).toHaveCount(0);
  // Long enough for a save the editor would send (its debounce is 400 ms).
  await page.waitForTimeout(1_500);
  expect(writes).toEqual([]);
  expect(await rawStoredProps(routePath, SLOT)).toEqual(STORED);
  await expect(heading(page)).toHaveText(SALE);
}

async function bothRoutesWriteNothing(page: Page, routePath: string) {
  const writes = watchWrites(page);
  await openRoute(page, routePath);
  await clickOnCanvas(page, heading(page));
  await openContentTab(page);
  await expect(offeredFields(page)).toHaveCount(0);
  // Were the refusal ever to stop holding, this is the edit that would land.
  for (const input of await offeredFields(page).all()) {
    await input.fill(`Leaked through the panel ${Date.now()}`);
    await input.press("Tab");
  }
  await heading(page).dblclick();
  await expect(inlineEditor(page)).toHaveCount(0);
  await page.keyboard.type(" typed");
  await page.keyboard.press("Enter");
  // Long enough for a save the editor would send (its debounce is 400 ms).
  await page.waitForTimeout(1_500);
  expect(writes).toEqual([]);
  await expect(heading(page)).toHaveText(SALE);
}

test.describe(`a prop beside the content spread (${RUNTIME} preview)`, () => {
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
    // Seed the sections while every call site is a plain content spread.
    // The server correctly rejects writes to a field that a later literal
    // overrides, so install the override forms only after the seed is stored.
    await storeSlot(page, AFTER_ROUTE, STORED);
    await storeSlot(page, BEFORE_ROUTE, STORED);
    await storeSlot(page, TWO_ROUTE, STORED);
    await storeSlot(page, TWO_ROUTE, PLAIN_STORED, PLAIN);
    expect(await rawStoredProps(TWO_ROUTE, SLOT)).toEqual(STORED);
    expect(await rawStoredProps(TWO_ROUTE, PLAIN)).toEqual(PLAIN_STORED);
    expect(await storedProps(page, AFTER_ROUTE)).toEqual(STORED);
    expect(await storedProps(page, BEFORE_ROUTE)).toEqual(STORED);

    const overridesSaved = await writeThemeFiles(page, scope, OVERRIDE_FILES);
    expect(overridesSaved.success, JSON.stringify(overridesSaved)).toBe(true);

    if (RUNTIME === "start") {
      // The loader form does not bind the overridden call site, so the slot
      // is stored while the route spreads it alone, and the route is then
      // saved over; saving source writes no content.
      const sole = await writeThemeFiles(page, scope, [
        loaderRoute(`<OverrideHero {...${SLOT}} />`),
      ]);
      expect(sole.success, JSON.stringify(sole)).toBe(true);
      await storeSlot(page, LOADER_ROUTE, LOADER_STORED);
      expect(await storedProps(page, LOADER_ROUTE)).toEqual(LOADER_STORED);
      const overridden = await writeThemeFiles(page, scope, [
        loaderRoute(`<OverrideHero {...${SLOT}} title="${SALE}" />`),
      ]);
      expect(overridden.success, JSON.stringify(overridden)).toBe(true);
    }
    await page.context().close();
  });

  test("content(): the literal after the spread wins, and neither the Inspector nor the canvas writes", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openRoute(page, AFTER_ROUTE);
    // Still the section, so its stored content renders and stays editable
    // from the section; the element itself names no field.
    await expect(
      previewFrame(page).locator(`[data-storefront-section-id="${SLOT}"]`),
    ).toHaveCount(1);
    await expect(heading(page)).toHaveAttribute("data-storefront-field", "");
    await expect(
      previewFrame(page).locator("[data-override-hero] p"),
    ).toHaveText(STORED.subtitle);

    await bothRoutesWriteNothing(page, AFTER_ROUTE);
    expect(await storedProps(page, AFTER_ROUTE)).toEqual(STORED);

    await structurePanelWithholdsTheTitle(page, AFTER_ROUTE);
  });

  test("content(): the spread after the literal wins, and both routes write hero.title", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openRoute(page, BEFORE_ROUTE);
    await expect(heading(page)).toHaveAttribute(
      "data-storefront-field",
      "title",
    );
    await clickOnCanvas(page, heading(page));
    await openContentTab(page);
    await expect(titleField(page)).toHaveValue(SALE);

    const edited = `Spread wins ${Date.now()}`;
    const saved = page.waitForResponse(
      (response) =>
        isServerFunctionCall(
          response.url(),
          "updateStorefrontThemeSectionProps",
        ) && (response.request().postData() ?? "").includes(edited),
      { timeout: 30_000 },
    );
    await titleField(page).fill(edited);
    await titleField(page).press("Tab");
    expect((await saved).ok()).toBe(true);
    expect(await storedProps(page, BEFORE_ROUTE)).toEqual({
      ...STORED,
      title: edited,
    });
    await expect(heading(page)).toHaveText(edited, { timeout: 30_000 });

    // Typing on the canvas writes the same field.
    const box = await heading(page).boundingBox();
    expect(box, "no box for the heading").not.toBeNull();
    await page.mouse.dblclick(
      box!.x + box!.width / 2,
      box!.y + box!.height / 2,
    );
    await expect(inlineEditor(page)).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("End");
    await page.keyboard.type(" typed");
    const typed = page.waitForResponse(
      (response) =>
        isServerFunctionCall(
          response.url(),
          "updateStorefrontThemeSectionProps",
        ) && (response.request().postData() ?? "").includes(`${edited} typed`),
      { timeout: 30_000 },
    );
    await page.keyboard.press("Enter");
    expect((await typed).ok()).toBe(true);
    expect(await storedProps(page, BEFORE_ROUTE)).toEqual({
      ...STORED,
      title: `${edited} typed`,
    });
  });

  test("content(), two instances: the overridden title is set in code, the untouched instance edits, saves and reloads", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const writes = watchWrites(page);
    const url = new URL(editorPath!, "http://placeholder");
    url.searchParams.set("routePath", TWO_ROUTE);
    await page.goto(`${url.pathname}${url.search}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    await expect(sectionHeading(page, SLOT)).toHaveText(SALE, {
      timeout: 90_000,
    });
    await expect(sectionHeading(page, PLAIN)).toHaveText(SALE);
    await expect(sectionText(page, SLOT)).toHaveText(STORED.subtitle);
    await expect(sectionText(page, PLAIN)).toHaveText(PLAIN_STORED.subtitle);

    // The overridden instance, from its structure-panel row.
    await panelRow(page, SLOT).click();
    await openContentTab(page);
    await expect(codeSetNotice(page)).toContainText("Override title");
    await expect(codeSetNotice(page)).toContainText(
      "passes its own value for these fields after this section's content",
    );
    await expect(titleField(page)).toHaveCount(0);
    await page.waitForTimeout(1_500);
    expect(writes).toEqual([]);
    expect(await rawStoredProps(TWO_ROUTE, SLOT)).toEqual(STORED);

    // The subtitle the call site leaves alone is still hero.subtitle: the
    // row's form offers it, and so does a click on it on the canvas.
    await expect(subtitleField(page)).toHaveValue(STORED.subtitle);
    await clickOnCanvas(page, sectionText(page, SLOT));
    await openContentTab(page);
    await expect(titleField(page)).toHaveCount(0);
    await expect(subtitleField(page)).toHaveValue(STORED.subtitle);
    const heroSubtitle = `Hero subtitle ${Date.now()}`;
    const heroSaved = page.waitForResponse(
      (response) =>
        isServerFunctionCall(
          response.url(),
          "updateStorefrontThemeSectionProps",
        ) && (response.request().postData() ?? "").includes(heroSubtitle),
      { timeout: 30_000 },
    );
    await subtitleField(page).fill(heroSubtitle);
    await subtitleField(page).press("Tab");
    expect((await heroSaved).ok()).toBe(true);
    // Only hero.subtitle changed; the title stays as stored, and so does the
    // other instance.
    expect(await rawStoredProps(TWO_ROUTE, SLOT)).toEqual({
      ...STORED,
      subtitle: heroSubtitle,
    });
    expect(await rawStoredProps(TWO_ROUTE, PLAIN)).toEqual(PLAIN_STORED);
    await expect(sectionText(page, SLOT)).toHaveText(heroSubtitle, {
      timeout: 30_000,
    });
    await expect(sectionHeading(page, SLOT)).toHaveText(SALE);
    const heroWrites = writes.length;
    expect(heroWrites).toBeGreaterThan(0);
    for (const body of writes) expect(body).toContain(`"${SLOT}"`);

    // The untouched instance of the same component, from its row.
    await panelRow(page, PLAIN).click();
    await openContentTab(page);
    await expect(codeSetNotice(page)).toHaveCount(0);
    await expect(titleField(page)).toHaveValue(SALE);
    await expect(subtitleField(page)).toHaveValue(PLAIN_STORED.subtitle);
    const stamp = Date.now();
    const subtitle = `Plain subtitle ${stamp}`;
    const title = `Plain title ${stamp}`;
    for (const [field, value] of [
      [subtitleField(page), subtitle],
      [titleField(page), title],
    ] as const) {
      const saved = page.waitForResponse(
        (response) =>
          isServerFunctionCall(
            response.url(),
            "updateStorefrontThemeSectionProps",
          ) && (response.request().postData() ?? "").includes(value),
        { timeout: 30_000 },
      );
      await field.fill(value);
      await field.press("Tab");
      expect((await saved).ok()).toBe(true);
    }
    expect(writes.length).toBeGreaterThan(heroWrites);
    for (const body of writes.slice(heroWrites)) {
      expect(body).toContain(`"${PLAIN}"`);
    }
    expect(await rawStoredProps(TWO_ROUTE, PLAIN)).toEqual({ title, subtitle });
    expect(await rawStoredProps(TWO_ROUTE, SLOT)).toEqual({
      ...STORED,
      subtitle: heroSubtitle,
    });

    // A fresh load: the canvas and the Inspector read the stored values.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(sectionHeading(page, PLAIN)).toHaveText(title, {
      timeout: 90_000,
    });
    await expect(sectionText(page, PLAIN)).toHaveText(subtitle);
    await expect(sectionHeading(page, SLOT)).toHaveText(SALE);
    await expect(sectionText(page, SLOT)).toHaveText(heroSubtitle);
    await panelRow(page, PLAIN).click();
    await openContentTab(page);
    await expect(titleField(page)).toHaveValue(title);
    await expect(subtitleField(page)).toHaveValue(subtitle);
    await panelRow(page, SLOT).click();
    await openContentTab(page);
    await expect(codeSetNotice(page)).toContainText("Override title");
    await expect(titleField(page)).toHaveCount(0);
    await expect(subtitleField(page)).toHaveValue(heroSubtitle);
  });

  // The loader form runs a server function, which only the full Start
  // preview can run, so the test exists only there.
  if (RUNTIME === "start") {
    test("the loader form: the section and untouched field stay bound, but its literal override is not writable", async ({
      page,
    }) => {
      test.setTimeout(240_000);
      const writes = watchWrites(page);
      await openRoute(page, LOADER_ROUTE);
      const loaderHeading = sectionHeading(page, SLOT);
      const loaderSubtitle = sectionText(page, SLOT);
      await expect(
        previewFrame(page).locator(`[data-storefront-section-id="${SLOT}"]`),
      ).toHaveCount(1);
      await expect(loaderHeading).toHaveText(SALE);
      await expect(loaderHeading).toHaveAttribute("data-storefront-field", "");
      await expect(loaderSubtitle).toHaveText(LOADER_STORED.subtitle);
      await expect(loaderSubtitle).toHaveAttribute(
        "data-storefront-field",
        "subtitle",
      );

      // Selecting the section exposes the code-controlled title as a reason,
      // not as an editable CMS input. A canvas attempt on that literal must
      // also leave both the write log and the stored props unchanged.
      await panelRow(page, SLOT).click();
      await openContentTab(page);
      await expect(codeSetNotice(page)).toContainText("Override title");
      await expect(titleField(page)).toHaveCount(0);
      await expect(subtitleField(page)).toHaveValue(LOADER_STORED.subtitle);
      await loaderHeading.dblclick();
      await expect(inlineEditor(page)).toHaveCount(0);
      await page.keyboard.type(" should not persist");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1_500);
      expect(writes).toEqual([]);
      expect(await rawStoredProps(LOADER_ROUTE, SLOT)).toEqual(LOADER_STORED);
      await expect(loaderHeading).toHaveText(SALE);

      // Inspector edit follows the loader provenance and changes only the
      // untouched CMS field; the separately stored title must stay intact.
      await clickOnCanvas(page, loaderSubtitle);
      await openContentTab(page);
      await expect(codeSetNotice(page)).toContainText("Override title");
      await expect(titleField(page)).toHaveCount(0);
      await expect(subtitleField(page)).toHaveValue(LOADER_STORED.subtitle);
      const inspectorValue = `Loader subtitle ${Date.now()}`;
      const inspectorSaved = page.waitForResponse(
        (response) =>
          isServerFunctionCall(
            response.url(),
            "updateStorefrontThemeSectionProps",
          ) && (response.request().postData() ?? "").includes(inspectorValue),
        { timeout: 30_000 },
      );
      await subtitleField(page).fill(inspectorValue);
      await subtitleField(page).press("Tab");
      const inspectorResponse = await inspectorSaved;
      expect(inspectorResponse.ok(), await inspectorResponse.text()).toBe(true);
      expect(await rawStoredProps(LOADER_ROUTE, SLOT)).toEqual({
        ...LOADER_STORED,
        subtitle: inspectorValue,
      });
      await expect(loaderSubtitle).toHaveText(inspectorValue, {
        timeout: 30_000,
      });

      // Inline editing follows the same field provenance. Read D1 after the
      // write so this cannot pass merely because the preview changed locally.
      await clickOnCanvas(page, loaderSubtitle);
      const box = await loaderSubtitle.boundingBox();
      expect(box, "no box for the loader subtitle").not.toBeNull();
      await page.mouse.dblclick(
        box!.x + box!.width / 2,
        box!.y + box!.height / 2,
      );
      await expect(inlineEditor(page)).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press("End");
      await page.keyboard.type(" inline");
      const inlineValue = `${inspectorValue} inline`;
      const inlineSaved = page.waitForResponse(
        (response) =>
          isServerFunctionCall(
            response.url(),
            "updateStorefrontThemeSectionProps",
          ) && (response.request().postData() ?? "").includes(inlineValue),
        { timeout: 30_000 },
      );
      await page.keyboard.press("Enter");
      const inlineResponse = await inlineSaved;
      expect(inlineResponse.ok(), await inlineResponse.text()).toBe(true);
      expect(await rawStoredProps(LOADER_ROUTE, SLOT)).toEqual({
        ...LOADER_STORED,
        subtitle: inlineValue,
      });
      expect(writes).toHaveLength(2);
      for (const body of writes) expect(body).toContain(`"${SLOT}"`);

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(loaderHeading).toHaveText(SALE, { timeout: 90_000 });
      await expect(loaderSubtitle).toHaveText(inlineValue);
    });
  }
});
