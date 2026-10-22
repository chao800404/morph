import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  openContentTab,
  isServerFunctionCall,
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
import { unboundSectionsFixture, UNBOUND_TITLE } from "./helpers/unbound-sections";

/**
 * Case B of the content binding contract, in the full Start preview: content
 * read by a server function, returned by the route's loader and destructured
 * from `Route.useLoaderData()`, edited from the canvas.
 *
 *   click the heading → the `hero` section's `title` is selected
 *   → edit it in the Inspector → the canvas shows it
 *   → the Document stores exactly what was typed → a fresh load agrees
 *
 * The server function runs on the preview's Start server, which is not the
 * default preview: it needs the Worker's `MORPH_THEME_PREVIEW_RUNTIME=start`,
 * announced to this spec as `MORPH_E2E_PREVIEW_RUNTIME=start`. Without it the
 * page cannot run at all (client-only preview), so the spec is skipped there
 * rather than asserting anything about that mode.
 *
 * Runs on a Theme of its own, inserted into the runner-owned database, so the
 * route Document it creates never reaches the shared Theme.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);
test.skip(
  process.env.MORPH_E2E_PREVIEW_RUNTIME !== "start",
  "Case B runs a server function: only the full Start preview can run it (MORPH_E2E_PREVIEW_RUNTIME=start).",
);

const shared = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;

test("explicit props read stored hero before and after another section's edit", async ({ page }) => {
  test.setTimeout(240_000);
  const fixture = await unboundSectionsFixture(page);
  await page.goto(fixture.editorPath, { waitUntil: "domcontentloaded" });
  await expect(previewFrame(page).getByRole("heading", { name: UNBOUND_TITLE, exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(previewFrame(page).locator("main[data-hidden-slots]")).toHaveAttribute("data-hidden-slots", "hidden");
  await fixture.editOtherSection();
  // Reload exercises the real Start server function and loader on the saved
  // revision, not a value kept alive in the previous browser render.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(previewFrame(page).getByRole("heading", { name: UNBOUND_TITLE, exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(previewFrame(page).getByRole("heading", { name: "Other section edited", exact: true })).toBeVisible();
});
let scope: ThemeScope | null = null;
let editorPath: string | null = null;

const ROUTE_PATH = "/loader-binding";
const SLOT = "hero";
const DEFAULT_TITLE = "Loader binding default title";
// Stored before the editor opens, and unlike the component's default: seeing
// it proves the server function read the Document, not the default.
const STORED_TITLE = "Loader binding stored title";

const FILES = [
  {
    path: "src/routes/loader-binding.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import LoaderHero from "../components/LoaderHero";

const getPage = createServerFn().handler(() => morph.pages.get("${ROUTE_PATH}"));

export const Route = createFileRoute("${ROUTE_PATH}")({
  loader: () => getPage(),
  component: LoaderBindingRoute,
});

function LoaderBindingRoute() {
  const { ${SLOT} } = Route.useLoaderData();
  return (
    <main>
      <LoaderHero {...${SLOT}} />
    </main>
  );
}
`,
  },
  {
    path: "src/components/LoaderHero.tsx",
    content: `export const contentFields = {
  title: { type: "text", label: "Loader title" },
} as const;

type LoaderHeroProps = { title?: string };

export default function LoaderHero({ title = "${DEFAULT_TITLE}" }: LoaderHeroProps) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{title}</h2>
    </section>
  );
}
`,
  },
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
    // Records the run's preview runtime, if it names one (unset in CI:
    // none, so the deployment's runtime applies as before).
    `INSERT INTO storefront_themes
    (id, storefront_id, name, metadata, preview_runtime, created_at, updated_at)
    VALUES ('${created.themeId}', '${created.storefrontId}',
      'loader-data-binding-${created.themeId}', '{"starterTemplateVersion":1}',
      ${recordedPreviewRuntimeSql()}, '${now}', '${now}');`,
  ]);
  return created;
}

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

const heading = (page: Page) =>
  previewFrame(page).locator(
    `[data-storefront-section-id="${SLOT}"] [data-storefront-field="title"]`,
  );

async function openRoute(page: Page) {
  const url = new URL(editorPath!, "http://placeholder");
  url.searchParams.set("routePath", ROUTE_PATH);
  await page.goto(`${url.pathname}${url.search}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  await expect(heading(page)).toBeVisible({ timeout: 90_000 });
}

const titleField = (page: Page) =>
  page
    .locator('[data-slot="inspector-content-field"]')
    .filter({ hasText: "Loader title" })
    .locator("input");

/**
 * Selects the heading on the canvas and opens the Content tab. A load leaves
 * section selection off, so it is turned on first whenever it is off.
 */
async function selectHeading(page: Page) {
  await clickHeading(page);
  await openContentTab(page);
}

/** Clicks the heading on the canvas, turning section selection on first. */
async function clickHeading(page: Page) {
  if (
    await page
      .getByRole("button", { name: "Enable section selection" })
      .isVisible()
      .catch(() => false)
  ) {
    await enableSelection(page);
  }
  await heading(page).scrollIntoViewIfNeeded();
  expect(
    await clickExposedElement(page, heading(page)),
    "the heading was not exposed on the canvas",
  ).not.toBeNull();
}

/** The route Document's stored props for the slot, as the server holds them. */
async function storedProps(page: Page): Promise<Record<string, unknown> | null> {
  const editor = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
    ...scope!,
  })) as {
    success: boolean;
    data?: {
      templates: Array<{
        routePath: string | null;
        document: { sections: Array<{ id: string; props?: Record<string, unknown> }> };
      }>;
    };
  };
  expect(editor.success, JSON.stringify(editor)).toBe(true);
  const template = editor.data!.templates.find(
    (candidate) => candidate.routePath === ROUTE_PATH,
  );
  return (
    template?.document.sections.find((section) => section.id === SLOT)?.props ??
    null
  );
}

/** Hides or shows the slot's section, through the write the Sections panel makes. */
async function setSectionEnabled(page: Page, enabled: boolean) {
  const ensured = (await serverFn(
    page,
    THEMES,
    "ensureStorefrontThemeRouteTemplate",
    { ...scope!, routePath: ROUTE_PATH },
  )) as { success: boolean; data?: { id: string; draftGeneration: number } };
  expect(ensured.success, JSON.stringify(ensured)).toBe(true);
  const written = (await serverFn(
    page,
    THEMES,
    "updateStorefrontThemeSectionProps",
    {
      ...scope!,
      templateId: ensured.data!.id,
      sectionId: SLOT,
      props: { enabled },
      expectedDraftGeneration: ensured.data!.draftGeneration,
      expectedSourceGeneration: await themeSourceGeneration(page, scope!),
      routePath: ROUTE_PATH,
    },
  )) as { success: boolean };
  expect(written.success, JSON.stringify(written)).toBe(true);
}

const sectionWrapper = (page: Page) =>
  previewFrame(page).locator(`[data-storefront-section-id="${SLOT}"]`);

test.describe("case B in the full Start preview", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
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

    // The route's Document, with a stored title, through the same writes the
    // editor makes: the server confirms the `hero` section from the route's
    // loader before it accepts the value.
    const ensured = (await serverFn(
      page,
      THEMES,
      "ensureStorefrontThemeRouteTemplate",
      { ...scope, routePath: ROUTE_PATH },
    )) as {
      success: boolean;
      data?: { id: string; draftGeneration: number };
    };
    expect(ensured.success, JSON.stringify(ensured)).toBe(true);
    const stored = (await serverFn(
      page,
      THEMES,
      "updateStorefrontThemeSectionProps",
      {
        ...scope,
        templateId: ensured.data!.id,
        sectionId: SLOT,
        props: { title: STORED_TITLE },
        expectedDraftGeneration: ensured.data!.draftGeneration,
        expectedSourceGeneration: await themeSourceGeneration(page,scope),
        routePath: ROUTE_PATH,
      },
    )) as { success: boolean };
    expect(stored.success, JSON.stringify(stored)).toBe(true);
    expect(await storedProps(page)).toEqual({ title: STORED_TITLE });
    await page.context().close();
  });

  test("click, Inspector, the stored value and a reload agree", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openRoute(page);
    // The section wrapper itself is the editor naming the slot the loader
    // read, and the text is the Document's, not the component's default.
    await expect(heading(page)).toHaveText(STORED_TITLE);
    // The Theme calls a server function, and this preview runs it: the
    // client-only notice (shown on the default preview) is not here.
    await expect(
      page.locator('[data-slot="preview-client-only-notice"]'),
    ).toHaveCount(0);

    await selectHeading(page);
    const field = titleField(page);
    await expect(field).toBeVisible();
    await expect(field).toHaveValue(STORED_TITLE);

    const edited = `Loader edited ${Date.now()}`;
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).origin === new URL(page.url()).origin &&
        (response.request().postData() ?? "").includes(edited),
      { timeout: 30_000 },
    );
    await field.fill(edited);
    await field.press("Tab");
    expect((await saved).ok()).toBe(true);
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      /^(Unpublished|Published)$/,
    );

    // The Document holds exactly what was typed, under the slot the loader read.
    expect(await storedProps(page)).toEqual({ title: edited });

    // A fresh load — the server function and loader run again — agrees.
    await openRoute(page);
    await expect(heading(page)).toHaveText(edited);
    await selectHeading(page);
    await expect(titleField(page)).toHaveValue(edited);
  });

  // Content a page reads on the server reaches a running preview only through
  // `syncThemePreviewContent`: the editor syncs the drafts after the save and
  // refreshes the canvas once the preview confirms it reads them (A6b-2,
  // docs/astro-theme-plan.md 6.5). Before that was wired, the preview re-ran
  // the server function on the snapshot it started with and the canvas kept
  // the old value until a reload (confirmed from a trace on 2026-10-12).
  test("the canvas shows an Inspector edit without a reload", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openRoute(page);
    await selectHeading(page);
    const field = titleField(page);
    await expect(field).toBeVisible();
    const edited = `Loader live ${Date.now()}`;
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).origin === new URL(page.url()).origin &&
        (response.request().postData() ?? "").includes(edited),
      { timeout: 30_000 },
    );
    await field.fill(edited);
    await field.press("Tab");
    expect((await saved).ok()).toBe(true);
    expect(await storedProps(page)).toEqual({ title: edited });
    await expect(heading(page)).toHaveText(edited, { timeout: 15_000 });
  });

  test("a delayed save from an old selection is refused after another Code source write", async ({page}) => {
    test.setTimeout(240_000);
    await openRoute(page);
    await selectHeading(page);
    const field = titleField(page);
    await expect(field).toBeVisible();
    const before = await storedProps(page);
    const sourceBefore = await themeSourceGeneration(page,scope!);
    const edited = `Held stale selection ${Date.now()}`;
    let release!: () => void;
    let observed!: () => void;
    const held = new Promise<void>(resolve => {release=resolve;});
    const observedRequest = new Promise<void>(resolve => {observed=resolve;});
    let writes = 0;
    const handler = async (route: import("@playwright/test").Route) => {
      if (isServerFunctionCall(route.request().url(),"updateStorefrontThemeSectionProps") && (route.request().postData() ?? "").includes(edited)) {
        writes += 1;
        expect(route.request().postData()).toContain("expectedSourceGeneration");
        observed();
        await held;
      }
      await route.continue();
    };
    await page.route("**/_serverFn/**",handler);
    try {
      await field.fill(edited);
      await field.press("Tab");
      await observedRequest;
      // The same save function Code uses; an unrelated file changes too.
      // First version invalidates every source change, not only related files.
      const changed = await writeThemeFiles(page,scope!, [{path:"src/selection-baseline-note.ts",content:"export const note = 1;\n"}]);
      expect(changed.success,JSON.stringify(changed)).toBe(true);
      expect(await themeSourceGeneration(page,scope!)).toBe(sourceBefore+1);
      const response = page.waitForResponse(r=>isServerFunctionCall(r.url(),"updateStorefrontThemeSectionProps") && (r.request().postData() ?? "").includes(edited));
      release();
      expect(await (await response).text()).toContain("SELECTION_SOURCE_CONFLICT");
      await expect(page.getByText(/The source code has changed\. Select the field again/)).toBeVisible();
      expect(await storedProps(page)).toEqual(before);
      await expect(field).toHaveValue(edited);
      await expect(field).toBeVisible();
      expect(writes).toBe(1);
    } finally {
      release();
      await page.unroute("**/_serverFn/**",handler);
    }
  });

  // A hidden section is not selectable (content binding contract §6). The
  // route spreads `{...hero}` with no guard of its own, so a hidden section
  // still renders, with the component's default. The preview marks it from
  // the `_hidden` the server function returned, and a click on it selects
  // nothing; shown again, the same heading selects `hero.title` again.
  test("a hidden section shows its default and selects nothing, and is selectable once shown", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openRoute(page);
    const storedTitle = (await storedProps(page))?.title;
    expect(storedTitle).toEqual(expect.any(String));
    const stored = storedTitle as string;

    try {
      await setSectionEnabled(page, false);
      await openRoute(page);
      // The server function read the Document and left the hidden slot out.
      await expect(heading(page)).toHaveText(DEFAULT_TITLE);
      await expect(sectionWrapper(page)).toHaveAttribute(
        "data-morph-section-hidden",
        "",
      );
      await clickHeading(page);
      await settleSelection(page);
      await expect(heading(page)).not.toHaveAttribute(
        "data-storefront-editor-selected",
        "true",
      );
      await expect(titleField(page)).toHaveCount(0);
    } finally {
      await setSectionEnabled(page, true);
    }

    await openRoute(page);
    await expect(heading(page)).toHaveText(stored);
    await expect(sectionWrapper(page)).not.toHaveAttribute(
      "data-morph-section-hidden",
    );
    await selectHeading(page);
    await expect(heading(page)).toHaveAttribute(
      "data-storefront-editor-selected",
      "true",
    );
    await expect(titleField(page)).toHaveValue(stored);
  });

  // The same rule while the editor stays open: the author hides the section
  // from the Sections panel, the editor saves, syncs the drafts into the
  // running preview and refreshes it (A6b-2) — no reload of the editor or of
  // the preview. The bridge also hides the wrapper at once, so the heading
  // cannot be reached by pointer; the click is dispatched on it, which is the
  // event the bridge's own capture listener reads.
  test("hiding and showing from the Sections panel, without a reload, takes and gives back the selection", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const treeNodes = page.locator(`[data-editor-tree-node-id^="${SLOT}:"]`);
    await openRoute(page);
    const storedTitle = (await storedProps(page))?.title;
    expect(storedTitle).toEqual(expect.any(String));
    const stored = storedTitle as string;
    await expect(heading(page)).toHaveText(stored);
    await selectHeading(page);
    await expect(titleField(page)).toHaveValue(stored);
    await expect(treeNodes.first()).toBeAttached();

    // Neither document may be replaced while this runs.
    await page.evaluate(() => {
      (window as unknown as { __hsNoReload?: boolean }).__hsNoReload = true;
    });
    await previewFrame(page)
      .locator("html")
      .evaluate(() => {
        (window as unknown as { __hsNoReload?: boolean }).__hsNoReload = true;
      });
    const noReload = async () => {
      expect(
        await page.evaluate(
          () => (window as unknown as { __hsNoReload?: boolean }).__hsNoReload,
        ),
        "the editor reloaded",
      ).toBe(true);
      expect(
        await previewFrame(page)
          .locator("html")
          .evaluate(
            () =>
              (window as unknown as { __hsNoReload?: boolean }).__hsNoReload,
          ),
        "the preview reloaded",
      ).toBe(true);
    };

    const hide = treeNodes
      .first()
      .getByRole("button", { name: /^Hide section / });
    const sectionType = ((await hide.getAttribute("aria-label")) ?? "").replace(
      /^Hide section /,
      "",
    );
    expect(sectionType).not.toBe("");
    const show = page.getByRole("button", {
      name: `Show section ${sectionType}`,
    });
    await treeNodes.first().hover();
    await hide.click();
    try {
      // Applied once the preview's server reads the synced draft: the loader
      // runs again and returns the slot as hidden.
      await expect(sectionWrapper(page)).toHaveAttribute(
        "data-morph-section-hidden",
        "",
        { timeout: 30_000 },
      );
      await expect(heading(page)).toHaveText(DEFAULT_TITLE);
      await expect(show).toBeVisible();

      await heading(page).dispatchEvent("click");
      await settleSelection(page);
      await expect(heading(page)).not.toHaveAttribute(
        "data-storefront-editor-selected",
        "true",
      );
      await expect(titleField(page)).toHaveCount(0);
      await expect(treeNodes).toHaveCount(0);

      // The hidden section's own row still selects it, and opens no content.
      const row = page.getByRole("button", { name: sectionType, exact: true });
      await row.click();
      await expect(row).toHaveAttribute("data-active", "true");
      await openContentTab(page);
      await expect(
        page.getByRole("button", { name: "Content", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(titleField(page)).toHaveCount(0);
      await expect(show).toBeVisible();
      await noReload();
    } finally {
      if (await show.isVisible().catch(() => false)) await show.click();
    }

    await expect(sectionWrapper(page)).not.toHaveAttribute(
      "data-morph-section-hidden",
      { timeout: 30_000 },
    );
    await expect(heading(page)).toHaveText(stored);
    await expect(heading(page)).toBeVisible();
    await expect(treeNodes.first()).toBeAttached();
    await selectHeading(page);
    await expect(heading(page)).toHaveAttribute(
      "data-storefront-editor-selected",
      "true",
    );
    await expect(titleField(page)).toHaveValue(stored);

    // Reselected explicitly, it saves at the current baseline.
    const edited = `Shown again ${Date.now()}`;
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
    expect(await (await saved).text()).not.toContain("SELECTION_SOURCE_CONFLICT");
    await expect.poll(async () => (await storedProps(page))?.title).toBe(edited);
    await noReload();
  });
});

/**
 * Case B's two full-write acceptances, on a Theme and route of their own: the
 * selection-level tests above and in `loader-data-binding.live.test.ts` show
 * what is selected; these show what a real Inspector edit then writes.
 *
 * - Two instances of one component, each spread from its own slot the loader
 *   returned: an edit to one is stored under that slot only, and a reload
 *   agrees.
 * - An element whose hand-written `data-storefront-field` names a declared
 *   field other than the one it shows: nothing is written from it, by the
 *   Inspector or by typing on the canvas.
 */
test.describe("case B full writes in the full Start preview", () => {
  test.describe.configure({ mode: "serial" });

  const TWO_ROUTE = "/loader-binding-two";
  const MARKED_ROUTE = "/loader-binding-marked";
  const FIRST = "hero";
  const SECOND = "promo";
  const FIRST_TITLE = "First instance stored title";
  const SECOND_TITLE = "Second instance stored title";
  const MARKED_TITLE = "Marked stored title";
  const MARKED_SUBTITLE = "Marked stored subtitle";

  let writeScope: ThemeScope | null = null;
  let writeEditorPath: string | null = null;

  const WRITE_FILES = [
    {
      path: "src/routes/loader-binding-two.tsx",
      content: `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import LoaderHero from "../components/LoaderHero";

const getPage = createServerFn().handler(() => morph.pages.get("${TWO_ROUTE}"));

export const Route = createFileRoute("${TWO_ROUTE}")({
  loader: () => getPage(),
  component: TwoInstancesRoute,
});

function TwoInstancesRoute() {
  const { ${FIRST}, ${SECOND} } = Route.useLoaderData();
  return (
    <main>
      <LoaderHero {...${FIRST}} />
      <LoaderHero {...${SECOND}} />
    </main>
  );
}
`,
    },
    {
      path: "src/routes/loader-binding-marked.tsx",
      content: `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import MarkedHero from "../components/MarkedHero";

const getPage = createServerFn().handler(() => morph.pages.get("${MARKED_ROUTE}"));

export const Route = createFileRoute("${MARKED_ROUTE}")({
  loader: () => getPage(),
  component: MarkedRoute,
});

function MarkedRoute() {
  const { ${FIRST} } = Route.useLoaderData();
  return (
    <main>
      <MarkedHero {...${FIRST}} />
    </main>
  );
}
`,
    },
    FILES[1]!,
    {
      path: "src/components/MarkedHero.tsx",
      content: `export const contentFields = {
  title: { type: "text", label: "Marked title" },
  subtitle: { type: "text", label: "Marked subtitle" },
} as const;

type MarkedHeroProps = { title?: string; subtitle?: string };

export default function MarkedHero({
  title = "Marked default title",
  subtitle = "Marked default subtitle",
}: MarkedHeroProps) {
  return (
    <section className="px-6 py-10">
      <h2 data-storefront-field="subtitle" className="text-2xl font-semibold">
        {title}
      </h2>
      <p className="mt-2">{subtitle}</p>
    </section>
  );
}
`,
    },
  ];

  async function storeSlot(
    page: Page,
    routePath: string,
    sectionId: string,
    props: Record<string, unknown>,
  ) {
    const ensured = (await serverFn(
      page,
      THEMES,
      "ensureStorefrontThemeRouteTemplate",
      { ...writeScope!, routePath },
    )) as { success: boolean; data?: { id: string; draftGeneration: number } };
    expect(ensured.success, JSON.stringify(ensured)).toBe(true);
    const stored = (await serverFn(
      page,
      THEMES,
      "updateStorefrontThemeSectionProps",
      {
        ...writeScope!,
        templateId: ensured.data!.id,
        sectionId,
        props,
        expectedDraftGeneration: ensured.data!.draftGeneration,
        expectedSourceGeneration: await themeSourceGeneration(
          page,
          writeScope!,
        ),
        routePath,
      },
    )) as { success: boolean };
    expect(stored.success, JSON.stringify(stored)).toBe(true);
  }

  async function storedSections(page: Page, routePath: string) {
    const editor = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
      ...writeScope!,
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
    return Object.fromEntries(
      (template?.document.sections ?? []).map((section) => [
        section.id,
        section.props ?? null,
      ]),
    );
  }

  async function openWriteRoute(page: Page, routePath: string, text: string) {
    const url = new URL(writeEditorPath!, "http://placeholder");
    url.searchParams.set("routePath", routePath);
    await page.goto(`${url.pathname}${url.search}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    await expect(previewFrame(page).getByText(text)).toBeVisible({
      timeout: 90_000,
    });
  }

  async function clickOnCanvas(
    page: Page,
    target: ReturnType<Page["locator"]>,
  ) {
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

  const sectionTitle = (page: Page, sectionId: string) =>
    previewFrame(page).locator(
      `[data-storefront-section-id="${sectionId}"] [data-storefront-field="title"]`,
    );

  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    writeScope = await createThrowawayTheme();
    const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
      ...writeScope,
    })) as {
      success: boolean;
      data?: { templates: Array<{ id: string; type: string }> };
    };
    expect(result.success, JSON.stringify(result)).toBe(true);
    const home = result.data!.templates.find(
      (template) => template.type === "index",
    );
    expect(home).toBeDefined();
    writeEditorPath = `/store/${writeScope.storefrontId}/themes/${writeScope.themeId}/editor?templateId=${home!.id}`;
    const saved = await writeThemeFiles(page, writeScope, WRITE_FILES);
    expect(saved.success, JSON.stringify(saved)).toBe(true);

    await storeSlot(page, TWO_ROUTE, FIRST, { title: FIRST_TITLE });
    await storeSlot(page, TWO_ROUTE, SECOND, { title: SECOND_TITLE });
    await storeSlot(page, MARKED_ROUTE, FIRST, {
      title: MARKED_TITLE,
      subtitle: MARKED_SUBTITLE,
    });
    expect(await storedSections(page, TWO_ROUTE)).toEqual({
      [FIRST]: { title: FIRST_TITLE },
      [SECOND]: { title: SECOND_TITLE },
    });
    await page.context().close();
  });

  test("an edit to one of two instances is stored under its own slot only, and a reload agrees", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openWriteRoute(page, TWO_ROUTE, SECOND_TITLE);
    await expect(sectionTitle(page, FIRST)).toHaveText(FIRST_TITLE);
    await expect(sectionTitle(page, SECOND)).toHaveText(SECOND_TITLE);

    await clickOnCanvas(page, sectionTitle(page, SECOND));
    await openContentTab(page);
    const field = titleField(page);
    await expect(field).toBeVisible();
    await expect(field).toHaveValue(SECOND_TITLE);

    const edited = `Second instance edited ${Date.now()}`;
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).origin === new URL(page.url()).origin &&
        (response.request().postData() ?? "").includes(edited),
      { timeout: 30_000 },
    );
    await field.fill(edited);
    await field.press("Tab");
    expect((await saved).ok()).toBe(true);

    expect(await storedSections(page, TWO_ROUTE)).toEqual({
      [FIRST]: { title: FIRST_TITLE },
      [SECOND]: { title: edited },
    });

    await openWriteRoute(page, TWO_ROUTE, edited);
    await expect(sectionTitle(page, FIRST)).toHaveText(FIRST_TITLE);
    await expect(sectionTitle(page, SECOND)).toHaveText(edited);
    await clickOnCanvas(page, sectionTitle(page, FIRST));
    await openContentTab(page);
    await expect(titleField(page)).toHaveValue(FIRST_TITLE);
  });

  test("an element whose hand-written marker names another declared field writes nothing", async ({
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
    await openWriteRoute(page, MARKED_ROUTE, MARKED_TITLE);
    const marked = previewFrame(page).locator(
      `[data-storefront-section-id="${FIRST}"] h2`,
    );
    await expect(marked).toHaveText(MARKED_TITLE);
    await expect(marked).toHaveAttribute(
      "data-morph-field-refused",
      "conflict",
    );

    await clickOnCanvas(page, marked);
    await openContentTab(page);
    // How the refusal shows is checked softly: the claim under test is the
    // write boundary below, which every path is then tried against.
    await expect
      .soft(
        page.getByText("names one field, but it shows another", {
          exact: false,
        }),
      )
      .toBeVisible();
    const offered = page
      .locator('[data-slot="inspector-content-field"]')
      .filter({ hasText: /Marked (title|subtitle)/ })
      .locator("input");
    await expect.soft(offered).toHaveCount(0);

    // Every field the panel does offer for this element is edited anyway:
    // were the refusal ever to stop holding, this is the edit that would land.
    for (const input of await offered.all()) {
      await input.fill(`Leaked through the panel ${Date.now()}`);
      await input.press("Tab");
    }
    // And typing on the canvas.
    await marked.dblclick();
    await page.keyboard.type(" typed");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1_500);

    expect(writes).toEqual([]);
    expect(await storedSections(page, MARKED_ROUTE)).toEqual({
      [FIRST]: { title: MARKED_TITLE, subtitle: MARKED_SUBTITLE },
    });
    await openWriteRoute(page, MARKED_ROUTE, MARKED_TITLE);
    await expect(marked).toHaveText(MARKED_TITLE);
  });
});
