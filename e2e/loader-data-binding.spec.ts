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
    `INSERT INTO storefront_themes
    (id, storefront_id, name, metadata, created_at, updated_at)
    VALUES ('${created.themeId}', '${created.storefrontId}',
      'loader-data-binding-${created.themeId}', '{"starterTemplateVersion":1}',
      '${now}', '${now}');`,
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
});
