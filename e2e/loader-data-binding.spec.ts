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
import { queryLocalD1 } from "./helpers/editor-writes-paused";
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


/**
 * Explicit props in the full Start preview: the route reads its slot from the
 * loader and hands the values over one by one, `<ExplicitHero title={title}
 * desc={desc} />`. No Document section is proven (only a sole spread proves
 * one), and the full Start page has no page root for a stand-in either, so the
 * bridge resolves no section for the click and posts nothing.
 *
 * Measured on b293f3a before the editor-side fix (2026-10-21): the click is not
 * taken, the Inspector stays on "Select a component", a double click opens no
 * typing and says nothing, and nothing is written. The client-only preview of
 * a Theme whose root route owns the document (the current Starter) measured
 * the same. Only a Theme rendering into the preview's `#root` gets a page
 * stand-in and was offered the default (code-controlled-field.spec.ts). Here
 * no default is offered, so nothing misleading is saved; but the field is not
 * marked as controlled by code either.
 *
 * The Document holds the slot's values from when the route still spread it;
 * the explicit route falls back to its own text if the read returns no slot.
 *
 * Since the page stand-in (the bridge names such a field under the route the
 * editor asked for, and the editor takes it only from the confirmed current
 * document), the click is taken and the field is marked as controlled by
 * code. Still nothing is written.
 */
test.describe("explicit props in the full Start preview", () => {
  test.describe.configure({ mode: "serial" });

  const EXPLICIT_ROUTE = "/loader-explicit";
  const EXPLICIT_TITLE = "Explicit stored title";
  const EXPLICIT_DESC = "Explicit stored desc";
  let explicitScope: ThemeScope | null = null;
  let explicitEditorPath: string | null = null;

  const explicitRoute = (body: string) => ({
    path: "src/routes/loader-explicit.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import ExplicitHero from "../components/ExplicitHero";

const getPage = createServerFn().handler(() => morph.pages.get("${EXPLICIT_ROUTE}"));

export const Route = createFileRoute("${EXPLICIT_ROUTE}")({
  loader: () => getPage(),
  component: ExplicitRoute,
});

function ExplicitRoute() {
${body}
}
`,
  });
  const EXPLICIT_HERO = {
    path: "src/components/ExplicitHero.tsx",
    content: `export const contentFields = {
  title: { type: "text", label: "Explicit title" },
  desc: { type: "text", label: "Explicit desc" },
} as const;

type ExplicitHeroProps = { title?: string; desc?: string };

export default function ExplicitHero({
  title = "Explicit default title",
  desc = "Explicit default desc",
}: ExplicitHeroProps) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p>{desc}</p>
    </section>
  );
}
`,
  };

  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    explicitScope = await createThrowawayTheme();
    const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
      ...explicitScope,
    })) as {
      success: boolean;
      data?: { templates: Array<{ id: string; type: string }> };
    };
    expect(result.success, JSON.stringify(result)).toBe(true);
    const home = result.data!.templates.find(
      (template) => template.type === "index",
    );
    expect(home).toBeDefined();
    explicitEditorPath = `/store/${explicitScope.storefrontId}/themes/${explicitScope.themeId}/editor?templateId=${home!.id}`;
    // Spread first, so the server confirms the slot and accepts its values.
    let saved = await writeThemeFiles(page, explicitScope, [
      explicitRoute(`  const { hero } = Route.useLoaderData();
  return <main><ExplicitHero {...hero} /></main>;`),
      EXPLICIT_HERO,
    ]);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    const ensured = (await serverFn(
      page,
      THEMES,
      "ensureStorefrontThemeRouteTemplate",
      { ...explicitScope, routePath: EXPLICIT_ROUTE },
    )) as { success: boolean; data?: { id: string; draftGeneration: number } };
    expect(ensured.success, JSON.stringify(ensured)).toBe(true);
    const stored = (await serverFn(
      page,
      THEMES,
      "updateStorefrontThemeSectionProps",
      {
        ...explicitScope,
        templateId: ensured.data!.id,
        sectionId: SLOT,
        props: { title: EXPLICIT_TITLE, desc: EXPLICIT_DESC },
        expectedDraftGeneration: ensured.data!.draftGeneration,
        expectedSourceGeneration: await themeSourceGeneration(
          page,
          explicitScope,
        ),
        routePath: EXPLICIT_ROUTE,
      },
    )) as { success: boolean };
    expect(stored.success, JSON.stringify(stored)).toBe(true);
    saved = await writeThemeFiles(page, explicitScope, [
      explicitRoute(`  const { hero } = Route.useLoaderData();
  const { title, desc } = hero ?? {};
  return (
    <main>
      <ExplicitHero
        title={title ?? "Explicit page title"}
        desc={desc ?? "Explicit page desc"}
      />
    </main>
  );`),
    ]);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await page.context().close();
  });

  test("a click on a field the route passes marks it controlled by code and writes nothing", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      for (const name of [
        "updateStorefrontThemeSectionProps",
        "saveStorefrontThemeFile",
        "saveStorefrontThemeFilesBatch",
      ]) {
        if (isServerFunctionCall(request.url(), name)) writes.push(name);
      }
    });
    const url = new URL(explicitEditorPath!, "http://placeholder");
    url.searchParams.set("routePath", EXPLICIT_ROUTE);
    await page.goto(`${url.pathname}${url.search}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    const title = previewFrame(page).locator(
      '[data-morph-source-file="src/components/ExplicitHero.tsx"] h2',
    );
    await expect(title).toBeVisible({ timeout: 90_000 });
    // What the page shows is the route's value, never the component default.
    await expect(title).not.toHaveText("Explicit default title");
    await test.info().attach("explicit-title-text", {
      body: (await title.textContent()) ?? "",
      contentType: "text/plain",
    });
    // No section and no page root for the click to resolve to.
    await expect(
      previewFrame(page).locator("[data-morph-route-path]"),
    ).toHaveCount(0);
    await expect(
      previewFrame(page).locator(`[data-storefront-section-id="${SLOT}"]`),
    ).toHaveCount(0);

    if (
      await page
        .getByRole("button", { name: "Enable section selection" })
        .isVisible()
        .catch(() => false)
    ) {
      await enableSelection(page);
    }
    await title.scrollIntoViewIfNeeded();
    expect(
      await clickExposedElement(page, title),
      "the title was not exposed on the canvas",
    ).not.toBeNull();
    await settleSelection(page);
    await openContentTab(page);
    // Taken as the page stand-in: selected, and the field it shows is
    // marked as controlled by code — the route passes it.
    await expect(title).toHaveAttribute(
      "data-storefront-editor-selected",
      "true",
    );
    await expect(
      page
        .locator('[data-slot="inspector-code-controlled-field"]')
        .filter({ hasText: "Explicit title" }),
    ).toContainText(/controlled by code/i);
    // No default is offered for a value the route passes.
    expect(
      await page
        .locator(
          "[data-editor-inspector-panel] input, [data-editor-inspector-panel] textarea",
        )
        .evaluateAll((elements) =>
          elements.map((element) => (element as HTMLInputElement).value),
        ),
    ).not.toContain("Explicit default title");

    await title.dblclick();
    // Typing on the canvas is refused, and the editor says why without
    // pointing to a field it does not offer.
    await expect(
      page.locator("[data-sonner-toast]").filter({
        hasText: /controlled by code/i,
      }),
    ).toBeVisible({ timeout: 10_000 });
    await page.keyboard.type(" typed");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1_500);
    expect(writes).toEqual([]);
  });
});

/**
 * The structure lock on a loader route, from the Sections panel through the
 * save path. Each slot element carries `className`, the shape the name-based
 * slot check used to miss: B1 still proves both sections are spread from the
 * loader, so structure edits must be refused. A refused edit sends no write
 * and leaves the source, the Document, both generations and the revision
 * list as they were.
 *
 * This is a safe refusal, not structure editing on loader routes.
 */
test.describe("the loader structure lock from the Sections panel", () => {
  test.describe.configure({ mode: "serial" });

  const LOCK_ROUTE = "/loader-lock";
  const LOCK_TITLE = "Loader lock stored title";
  const LOCKED_REASON =
    "This page reads its content through its route loader. Add, move or remove its sections in Code; their content can still be edited here.";
  const FILES_MODULE =
    "/src/server/storefront/storefront-theme-files.serverFn.ts";
  const WRITE_FUNCTIONS = [
    "saveStorefrontThemeFile",
    "saveStorefrontThemeFilesBatch",
    "updateStorefrontThemeSectionProps",
    "reorderStorefrontThemeSections",
    "renameStorefrontThemeSection",
    "createStorefrontThemeRevision",
  ];
  const lockComponent = (name: string) => `export const contentFields = {
  title: { type: "text", label: "${name} title" },
} as const;

export default function ${name}({ title = "${name} default", className }: { title?: string; className?: string }) {
  return (
    <section className={className}>
      <h2>{title}</h2>
    </section>
  );
}
`;
  const LOCK_ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import LockHero from "../components/sections/LockHero";
import LockPromo from "../components/sections/LockPromo";
import LockBanner from "../components/sections/LockBanner";

const getPage = createServerFn().handler(() => morph.pages.get("${LOCK_ROUTE}"));

export const Route = createFileRoute("${LOCK_ROUTE}")({
  loader: () => getPage(),
  component: LoaderLockRoute,
});

function LoaderLockRoute() {
  const { hero, promo } = Route.useLoaderData();
  return (
    <main>
      <LockHero {...hero} className="px-6" />
      <LockPromo {...promo} className="px-6" />
      <LockBanner />
    </main>
  );
}
`;
  const LOCK_FILES = [
    {
      path: "src/components/sections/LockHero.tsx",
      content: lockComponent("LockHero"),
    },
    {
      path: "src/components/sections/LockPromo.tsx",
      content: lockComponent("LockPromo"),
    },
    {
      path: "src/components/sections/LockBanner.tsx",
      content: lockComponent("LockBanner"),
    },
    { path: "src/routes/loader-lock.tsx", content: LOCK_ROUTE_SOURCE },
  ];

  let lockScope: ThemeScope | null = null;
  let lockEditorPath: string | null = null;

  /** Everything a refused structure edit must leave as it was. */
  async function lockState(page: Page) {
    return page.evaluate(
      async ({ scope, filesModule, routePath }) => {
        const themesModule =
          "/src/server/storefront/storefront-themes.serverFn.ts";
        const themes = await import(/* @vite-ignore */ themesModule);
        const files = await import(/* @vite-ignore */ filesModule);
        const listed = await files.listStorefrontThemeFiles({ data: scope });
        if (!listed.success) throw new Error(listed.message);
        const editor = await themes.getStorefrontThemeEditor({ data: scope });
        if (!editor.success) throw new Error(editor.message);
        const revisions = await files.listStorefrontThemeRevisions({
          data: { ...scope, limit: 50, offset: 0 },
        });
        if (!revisions.success) throw new Error(revisions.message);
        const template = editor.data.templates.find(
          (candidate: { routePath: string | null }) =>
            candidate.routePath === routePath,
        );
        return {
          sourceGeneration: listed.data.sourceGeneration,
          files: listed.data.files.map(
            (file: {
              path: string;
              id: string;
              version: number;
              content: string;
            }) => ({
              path: file.path,
              id: file.id,
              version: file.version,
              content: file.content,
            }),
          ),
          template: template
            ? {
                id: template.id,
                version: template.version,
                draftGeneration: template.draftGeneration,
                draftRevisionId: template.draftRevisionId ?? null,
                document: template.document,
              }
            : null,
          revisions: revisions.data,
        };
      },
      { scope: lockScope!, filesModule: FILES_MODULE, routePath: LOCK_ROUTE },
    );
  }

  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    lockScope = await createThrowawayTheme();
    const initialized = (await serverFn(
      page,
      THEMES,
      "getStorefrontThemeEditor",
      { ...lockScope },
    )) as { success: boolean };
    expect(initialized.success, JSON.stringify(initialized)).toBe(true);
    const saved = await writeThemeFiles(page, lockScope, LOCK_FILES);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    const ensured = (await serverFn(
      page,
      THEMES,
      "ensureStorefrontThemeRouteTemplate",
      { ...lockScope, routePath: LOCK_ROUTE },
    )) as { success: boolean; data?: { id: string; draftGeneration: number } };
    expect(ensured.success, JSON.stringify(ensured)).toBe(true);
    // A stored value, so the Document holds content the check can compare.
    const stored = (await serverFn(
      page,
      THEMES,
      "updateStorefrontThemeSectionProps",
      {
        ...lockScope,
        templateId: ensured.data!.id,
        sectionId: "hero",
        props: { title: LOCK_TITLE },
        expectedDraftGeneration: ensured.data!.draftGeneration,
        expectedSourceGeneration: await themeSourceGeneration(page, lockScope),
        routePath: LOCK_ROUTE,
      },
    )) as { success: boolean };
    expect(stored.success, JSON.stringify(stored)).toBe(true);
    lockEditorPath = `/store/${lockScope.storefrontId}/themes/${lockScope.themeId}/editor?templateId=${ensured.data!.id}&routePath=${LOCK_ROUTE}`;
    await page.context().close();
  });

  test("refuses Bind and Delete from the panel with the reason, and sends and changes nothing", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto(lockEditorPath!, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    await expect(
      previewFrame(page).getByRole("heading", {
        name: LOCK_TITLE,
        exact: true,
      }),
    ).toBeVisible({ timeout: 90_000 });
    // The baseline: nothing held, nothing sent and unanswered.
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "data-save-state",
      "saved",
      { timeout: 30_000 },
    );
    const before = await lockState(page);
    expect(
      before.template?.document.sections.map(
        (section: { id: string }) => section.id,
      ),
    ).toContain("hero");

    const writes: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (WRITE_FUNCTIONS.some((name) => isServerFunctionCall(url, name))) {
        writes.push(url);
      }
    });
    const reasons = page.getByText(LOCKED_REASON, { exact: true });

    // Bind: the panel still offers LockBanner, a library section, as a
    // candidate; binding it would write `{...content("x")}` into the loader
    // route.
    const bind = page.getByRole("button", {
      name: "Bind LockBanner",
      exact: true,
    });
    await expect(bind).toBeEnabled({ timeout: 30_000 });
    await bind.click();
    await expect(reasons).toHaveCount(1, { timeout: 30_000 });

    // Delete a loader section from its row, named after its component.
    await page
      .getByRole("button", { name: /^lock-promo( section)?$/ })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(reasons).toHaveCount(2, { timeout: 30_000 });
    await dialog.getByRole("button", { name: "Cancel" }).click();

    expect(writes).toEqual([]);
    const after = await lockState(page);
    expect(after).toEqual(before);
    expect(
      after.files.find(
        (file: { path: string }) => file.path === "src/routes/loader-lock.tsx",
      )?.content,
    ).toBe(LOCK_ROUTE_SOURCE);
  });
});

/**
 * A Design structure edit that meets a conflict, and what happens when it is
 * tried again (`handoff/2026-10-28/conflict-refusal-repro-plan.md`).
 *
 * Three cases are kept apart:
 *
 * 1. The author's unsaved edit is kept after a refusal: intended behaviour.
 * 2. Trying the Design edit again: is the rewrite, and the lock and B1 proof
 *    behind it, the one computed against the outdated source?
 *    - 2A: another tab changed the same route file, so the file version OCC
 *      is the line that has to hold.
 *    - 2B: the route file's version is unchanged; another tab changed only
 *      the module the route's loader reads, which turns this route into a
 *      loader route (see theme-route-structure-dependency-lock.test.ts). On
 *      the newest Theme the same reorder is refused by the structure lock.
 * 3. The author explicitly overwriting the route in Code: a separate path,
 *    which must not be blocked.
 *
 * Each case reads the newest stored source, the save request actually sent,
 * the raw D1 row, the Sections panel and the preview.
 */
test.describe("a Design structure edit that meets a conflict", () => {
  // Each case builds its own Theme, so one failing does not skip the rest.
  const RETRY_ROUTE = "/conflict-retry";
  const RETRY_ROUTE_FILE = "src/routes/conflict-retry.tsx";
  const RETRY_DATA_FILE = "src/server/conflict-retry.ts";
  const LOCKED_REASON = /reads its content through its route loader/;
  const SAVE_FUNCTIONS = [
    "saveStorefrontThemeFile",
    "saveStorefrontThemeFilesBatch",
  ];
  const retryComponent = (name: string) => `export const contentFields = {
  title: { type: "text", label: "${name} title" },
} as const;

export default function ${name}({ title = "${name} default" }: { title?: string }) {
  return (
    <section>
      <h2>{title}</h2>
    </section>
  );
}
`;
  const RETRY_ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import RetryHero from "../components/sections/RetryHero";
import RetryBanner from "../components/sections/RetryBanner";
import RetryPromo from "../components/sections/RetryPromo";
import { getRetryPage } from "../server/conflict-retry";

export const Route = createFileRoute("${RETRY_ROUTE}")({
  loader: () => getRetryPage(),
  component: ConflictRetryRoute,
});

function ConflictRetryRoute() {
  const page = Route.useLoaderData();
  return (
    <main>
      <RetryHero {...content("hero")} />
      <RetryBanner {...content("banner")} />
      <RetryPromo {...page.promo} />
    </main>
  );
}
`;
  /** The loader's module before: not this page's content. */
  const DATA_PLAIN = `import { createServerFn } from "@tanstack/react-start";

export const getRetryPage = createServerFn().handler(() => ({
  promo: { title: "Static promo" },
}));
`;
  /** After another tab's save: this page's content, as B1 proves it. */
  const DATA_PAGE = `import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";

export const getRetryPage = createServerFn().handler(() =>
  morph.pages.get("${RETRY_ROUTE}"),
);
`;
  const RETRY_FILES = [
    {
      path: "src/components/sections/RetryHero.tsx",
      content: retryComponent("RetryHero"),
    },
    {
      path: "src/components/sections/RetryBanner.tsx",
      content: retryComponent("RetryBanner"),
    },
    {
      path: "src/components/sections/RetryPromo.tsx",
      content: retryComponent("RetryPromo"),
    },
    { path: RETRY_DATA_FILE, content: DATA_PLAIN },
    { path: RETRY_ROUTE_FILE, content: RETRY_ROUTE_SOURCE },
  ];

  /** The route file's row as D1 holds it, read past every server function. */
  async function rawRouteRow(scope: ThemeScope) {
    const rows = queryLocalD1<{ content: string; version: number }>(
      `SELECT content, version FROM storefront_theme_files
       WHERE theme_id = '${scope.themeId}' AND path = '${RETRY_ROUTE_FILE}'
         AND deleted_at IS NULL;`,
    );
    expect(rows, "exactly one live route row").toHaveLength(1);
    return rows[0]!;
  }

  /** Writes one file from a separate signed-in tab, as another author would. */
  async function saveFromAnotherTab(
    browser: Browser,
    scope: ThemeScope,
    path: string,
    content: string,
  ) {
    const other = await signedInPage(browser);
    try {
      await other.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
      const saved = await writeThemeFiles(other, scope, [{ path, content }]);
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      return await themeSourceGeneration(other, scope);
    } finally {
      await other.context().close();
    }
  }

  const sectionRows = (page: Page) =>
    page.locator(
      '[data-sidebar="menu-item"] button:has([data-editor-tree-icon="section"])',
    );
  const sortableSectionRows = (page: Page) =>
    page.locator(
      '[data-editor-tree-sortable="true"] button:has([data-editor-tree-icon="section"])',
    );
  const sectionOrder = async (page: Page) =>
    (await sectionRows(page).allInnerTexts())
      .map((text) => text.split("\n")[0]?.trim() ?? "")
      .filter((text) => text.length > 0);

  /** One pointer drag of the first section row onto the second. */
  async function dragFirstOntoSecond(page: Page) {
    await expect(sortableSectionRows(page).nth(0)).toHaveAttribute(
      "aria-roledescription",
      "draggable",
      { timeout: 15_000 },
    );
    const before = await sectionOrder(page);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const from = await sortableSectionRows(page).nth(0).boundingBox();
      const to = await sortableSectionRows(page).nth(1).boundingBox();
      if (!from || !to) throw new Error("section rows are not laid out");
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        from.x + from.width / 2,
        from.y + from.height / 2 + 10,
        { steps: 5 },
      );
      const started = await sortableSectionRows(page)
        .nth(0)
        .getAttribute("aria-grabbed")
        .then((value) => value === "true")
        .catch(() => false);
      if (!started) {
        await page.mouse.up();
        await page.waitForTimeout(500);
        continue;
      }
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + 4, {
        steps: 12,
      });
      await page.mouse.up();
      const landed = await expect
        .poll(() => sectionOrder(page), { timeout: 8_000 })
        .not.toEqual(before)
        .then(() => true)
        .catch(() => false);
      if (landed) return;
    }
    throw new Error("the drag never changed the section order");
  }

  /** The route's sections, in order, as the stored source writes them. */
  const storedOrder = (source: string) =>
    [...source.matchAll(/content\("([a-z]+)"\)/g)].map((match) => match[1]);

  /** Either conflict notice: the Theme's, or the route file's own. */
  async function expectConflictNotice(page: Page) {
    const theme = page.getByText(
      "Remote source changes detected in this theme",
    );
    const file = page.getByText(/^Server conflict \(v\d+\)/);
    await expect
      .poll(async () => (await theme.isVisible()) || (await file.isVisible()), {
        timeout: 30_000,
        message: "a conflict notice",
      })
      .toBe(true);
  }

  type Sent = { name: string; body: string };

  async function openRetryEditor(page: Page, path: string) {
    const sent: Sent[] = [];
    page.on("request", (request) => {
      const name = SAVE_FUNCTIONS.find((candidate) =>
        isServerFunctionCall(request.url(), candidate),
      );
      if (name) sent.push({ name, body: request.postData() ?? "" });
    });
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "data-save-state",
      "saved",
      { timeout: 30_000 },
    );
    await expect
      .poll(() => sectionOrder(page), { timeout: 60_000 })
      .toEqual(expect.arrayContaining(["retry-hero", "retry-banner"]));
    return sent;
  }

  async function freshRetryTheme(browser: Browser) {
    const page = await signedInPage(browser);
    try {
      await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
      const retryScope = await createThrowawayTheme();
      const initialized = (await serverFn(
        page,
        THEMES,
        "getStorefrontThemeEditor",
        { ...retryScope },
      )) as { success: boolean };
      expect(initialized.success, JSON.stringify(initialized)).toBe(true);
      const saved = await writeThemeFiles(page, retryScope, RETRY_FILES);
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      const ensured = (await serverFn(
        page,
        THEMES,
        "ensureStorefrontThemeRouteTemplate",
        { ...retryScope, routePath: RETRY_ROUTE },
      )) as { success: boolean; data?: { id: string } };
      expect(ensured.success, JSON.stringify(ensured)).toBe(true);
      return {
        scope: retryScope,
        path: `/store/${retryScope.storefrontId}/themes/${retryScope.themeId}/editor?templateId=${ensured.data!.id}&routePath=${RETRY_ROUTE}`,
      };
    } finally {
      await page.context().close();
    }
  }

  test("2B: only the loader's module changed elsewhere; retrying the reorder must not write a rewrite the newest Theme refuses", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const { scope: retryScope, path } = await freshRetryTheme(browser);
    const sent = await openRetryEditor(page, path);
    const before = await rawRouteRow(retryScope);
    expect(storedOrder(before.content)).toEqual(["hero", "banner"]);

    // Another tab changes only the loader's module. The route file is
    // untouched, and on the newest Theme the route is a loader route.
    await saveFromAnotherTab(browser, retryScope, RETRY_DATA_FILE, DATA_PAGE);
    expect(await rawRouteRow(retryScope)).toEqual(before);

    // This tab has not looked again, and reorders.
    await dragFirstOntoSecond(page);

    // Case 1: refused, and the author's edit is kept, unsaved.
    await expectConflictNotice(page);
    // The panel names rows after their components.
    expect(
      (await sectionOrder(page)).filter((row) => row !== "retry-promo"),
    ).toEqual(["retry-banner", "retry-hero"]);
    expect(await rawRouteRow(retryScope), "nothing landed on refusal").toEqual(
      before,
    );
    const refusedSends = sent.length;
    expect(refusedSends, "the reorder was sent once").toBeGreaterThan(0);

    // Case 2B: the author presses "Save my changes".
    await page.getByRole("button", { name: "Save my changes" }).click();
    // Asked again on the newest Theme, the lock refuses it, and says so.
    const lockedToast = page
      .locator("[data-sonner-toast]")
      .filter({ hasText: LOCKED_REASON });
    const lockedReasonShown = await lockedToast
      .first()
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(3_000);
    const after = await rawRouteRow(retryScope);
    test.info().annotations.push({
      type: "2B result",
      description: JSON.stringify({
        storedOrderAfter: storedOrder(after.content),
        versionBefore: before.version,
        versionAfter: after.version,
        sentAfterRetry: sent.slice(refusedSends).map((entry) => ({
          name: entry.name,
          reorderedInBody:
            entry.body.indexOf('content(\\"banner\\")') >= 0 &&
            entry.body.indexOf('content(\\"banner\\")') <
              entry.body.indexOf('content(\\"hero\\")'),
        })),
        lockedReasonShown,
      }),
    });
    // On the newest Theme this reorder is refused by the structure lock, so
    // the stored route must still be in its original order.
    expect(
      storedOrder(after.content),
      "a retried Design reorder wrote a rewrite the newest Theme refuses",
    ).toEqual(["hero", "banner"]);
    expect(after).toEqual(before);
    expect(sent.slice(refusedSends), "no save was sent on retry").toEqual([]);
    expect(lockedReasonShown, "the lock's reason was shown").toBe(true);
    // Not discarded: still here, unsaved and marked, for the author.
    await expectConflictNotice(page);
    expect(
      (await sectionOrder(page)).filter((row) => row !== "retry-promo"),
    ).toEqual(["retry-banner", "retry-hero"]);
  });

  test("2A: another tab changed the route file itself; the file version holds", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const { scope: retryScope, path } = await freshRetryTheme(browser);
    const sent = await openRetryEditor(page, path);
    const theirs = `${RETRY_ROUTE_SOURCE}\n// saved from another tab\n`;
    await saveFromAnotherTab(browser, retryScope, RETRY_ROUTE_FILE, theirs);
    const stored = await rawRouteRow(retryScope);
    expect(stored.content).toBe(theirs);

    await dragFirstOntoSecond(page);
    await expectConflictNotice(page);
    const refusedSends = sent.length;
    const retry = page.getByRole("button", { name: "Save my changes" });
    if (await retry.isVisible().catch(() => false)) await retry.click();
    await page.waitForTimeout(5_000);
    test.info().annotations.push({
      type: "2A result",
      description: JSON.stringify({
        sendsAfterRetry: sent.length - refusedSends,
        retryOffered: await retry.isVisible().catch(() => false),
      }),
    });
    // Whatever the tab sends, it is against the version it last saw, so the
    // other tab's save stays.
    expect(await rawRouteRow(retryScope)).toEqual(stored);
  });

  test("3: the author overwriting the route in Code is not blocked", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const { scope: retryScope, path } = await freshRetryTheme(browser);
    await saveFromAnotherTab(browser, retryScope, RETRY_DATA_FILE, DATA_PAGE);
    await openRetryEditor(page, path);
    const current = await rawRouteRow(retryScope);
    // Design refuses this route's structure now; the author writes it in
    // Code, which is their explicit choice.
    const mine = current.content.replace(
      '      <RetryHero {...content("hero")} />\n      <RetryBanner {...content("banner")} />',
      '      <RetryBanner {...content("banner")} />\n      <RetryHero {...content("hero")} />',
    );
    expect(mine).not.toBe(current.content);
    const saved = await writeThemeFiles(page, retryScope, [
      { path: RETRY_ROUTE_FILE, content: mine },
    ]);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    expect(storedOrder((await rawRouteRow(retryScope)).content)).toEqual([
      "banner",
      "hero",
    ]);
  });
});
