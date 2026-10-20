import { expect, test, type Browser, type Page } from "@playwright/test";
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
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";
import { recordedPreviewRuntimeSql } from "./helpers/recorded-preview-runtime";

/**
 * A component's source default is edited from Design only where it is what
 * the canvas shows (content binding contract, ROADMAP 1.2), in the default
 * client-only preview.
 *
 * The route renders `<CodeHero title="…" />`: the title is the page's, written
 * in code, and the description is the component's own default. Clicking the
 * title shows it as controlled by code and writes nothing — before, the
 * Inspector offered the default and saved it into `CodeHero.tsx`, and the
 * canvas never changed. Clicking the description offers its default, and the
 * edit is saved into the source and shown on the canvas.
 *
 * The Theme's root route renders into the preview's `#root` instead of owning
 * the document (no `shellComponent`), the form earlier Starters had. Only
 * there does the client-only preview give the page a root a click can fall
 * back to, and so only there was a component default offered: with a
 * document shell, as in the current Starter and in the full Start preview, a
 * click outside every section selects nothing at all (measured 2026-10-21;
 * see the full Start case in loader-data-binding.spec.ts).
 *
 * Runs on a Theme of its own, inserted into the runner-owned database, so the
 * source it rewrites never reaches the shared Theme.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

const shared = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
let scope: ThemeScope | null = null;
let editorPath: string | null = null;

const ROUTE_PATH = "/code-controlled";
const COMPONENT_PATH = "src/components/CodeHero.tsx";
const PAGE_TITLE = "Title the page passes";
const DEFAULT_TITLE = "Code hero default title";
const DEFAULT_DESC = "Code hero default desc";

const FILES = [
  {
    path: "src/routes/code-controlled.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import CodeHero from "../components/CodeHero";

export const Route = createFileRoute("${ROUTE_PATH}")({
  component: CodeControlledRoute,
});

function CodeControlledRoute() {
  return (
    <main>
      <CodeHero title="${PAGE_TITLE}" />
    </main>
  );
}
`,
  },
  {
    path: COMPONENT_PATH,
    content: `export const contentFields = {
  title: { type: "text", label: "Code title" },
  desc: { type: "text", label: "Code desc" },
} as const;

type CodeHeroProps = { title?: string; desc?: string };

export default function CodeHero({
  title = "${DEFAULT_TITLE}",
  desc = "${DEFAULT_DESC}",
}: CodeHeroProps) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-2">{desc}</p>
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
    (id, storefront_id, name, metadata, preview_runtime, created_at, updated_at)
    VALUES ('${created.themeId}', '${created.storefrontId}',
      'code-controlled-field-${created.themeId}', '{"starterTemplateVersion":1}',
      ${recordedPreviewRuntimeSql()}, '${now}', '${now}');`,
  ]);
  return created;
}

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

async function themeFile(page: Page, path: string): Promise<string> {
  const listed = (await page.evaluate(
    async ({ module, scope }) => {
      const fns = await import(/* @vite-ignore */ module);
      return fns.listStorefrontThemeFiles({ data: scope });
    },
    {
      module: "/src/server/storefront/storefront-theme-files.serverFn.ts",
      scope: scope!,
    },
  )) as {
    success: boolean;
    data?: { files: Array<{ path: string; content: string }> };
  };
  expect(listed.success, JSON.stringify(listed)).toBe(true);
  return listed.data!.files.find((file) => file.path === path)?.content ?? "";
}
const componentSource = (page: Page) => themeFile(page, COMPONENT_PATH);

const ROOT_ROUTE_PATH = "src/routes/__root.tsx";
const SHELL_OPTION = "  shellComponent: RootDocument,\n";

async function openRoute(page: Page) {
  const url = new URL(editorPath!, "http://placeholder");
  url.searchParams.set("routePath", ROUTE_PATH);
  await page.goto(`${url.pathname}${url.search}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  await expect(previewFrame(page).getByText(PAGE_TITLE)).toBeVisible({
    timeout: 90_000,
  });
}

async function clickOnCanvas(page: Page, text: string) {
  if (
    await page
      .getByRole("button", { name: "Enable section selection" })
      .isVisible()
      .catch(() => false)
  ) {
    await enableSelection(page);
  }
  const target = previewFrame(page).getByText(text, { exact: true });
  await target.scrollIntoViewIfNeeded();
  expect(
    await clickExposedElement(page, target),
    `"${text}" was not exposed on the canvas`,
  ).not.toBeNull();
  await settleSelection(page);
  await openContentTab(page);
}

const controlled = (page: Page, label: string) =>
  page
    .locator('[data-slot="inspector-code-controlled-field"]')
    .filter({ hasText: label });
const fieldInput = (page: Page, label: string) =>
  page
    .locator('[data-slot="inspector-content-field"]')
    .filter({ hasText: label })
    .locator("input, textarea");

test.describe("a component default the page overrides, in the client-only preview", () => {
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
    const rootRoute = await themeFile(page, ROOT_ROUTE_PATH);
    expect(rootRoute, "the Starter's root route owns the document").toContain(
      SHELL_OPTION,
    );
    const saved = await writeThemeFiles(page, scope, [
      ...FILES,
      // Rendered into `#root`, as a root route without a document shell is.
      { path: ROOT_ROUTE_PATH, content: rootRoute.replace(SHELL_OPTION, "") },
    ]);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await page.context().close();
  });

  test("the passed title is controlled by code; the default description is edited in the source", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const sourceSaves: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        (isServerFunctionCall(request.url(), "saveStorefrontThemeFile") ||
          isServerFunctionCall(request.url(), "saveStorefrontThemeFilesBatch"))
      ) {
        sourceSaves.push(request.postData() ?? "");
      }
    });
    await openRoute(page);
    await expect(previewFrame(page).getByText(DEFAULT_DESC)).toBeVisible();

    // The title: the page's value, shown as controlled by code.
    await clickOnCanvas(page, PAGE_TITLE);
    await expect(controlled(page, "Code title")).toContainText(
      /controlled by code/i,
    );
    await expect(fieldInput(page, "Code title")).toHaveCount(0);
    // No box anywhere in the panel offers the default the page overrides.
    expect(
      await page
        .locator(
          "[data-editor-inspector-panel] input, [data-editor-inspector-panel] textarea",
        )
        .evaluateAll((elements) =>
          elements.map((element) => (element as HTMLInputElement).value),
        ),
    ).not.toContain(DEFAULT_TITLE);

    // Typing on the canvas is refused, and the editor does not send the
    // author to a field it does not offer.
    await previewFrame(page).getByText(PAGE_TITLE, { exact: true }).dblclick();
    const refusal = page.locator("[data-sonner-toast]").filter({
      hasText: /controlled by code/i,
    });
    await expect(refusal).toBeVisible({ timeout: 10_000 });
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: /content fields on the right/i }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    expect(sourceSaves).toEqual([]);
    expect(await componentSource(page)).toContain(`title = "${DEFAULT_TITLE}"`);

    // The description: the component's own default, which the canvas shows.
    await clickOnCanvas(page, DEFAULT_DESC);
    await expect(controlled(page, "Code desc")).toHaveCount(0);
    const desc = fieldInput(page, "Code desc");
    await expect(desc).toHaveValue(DEFAULT_DESC);
    const edited = `Edited default ${Date.now()}`;
    const saved = page.waitForResponse(
      (response) =>
        isServerFunctionCall(response.url(), "saveStorefrontThemeFile") &&
        (response.request().postData() ?? "").includes(edited),
      { timeout: 30_000 },
    );
    await desc.fill(edited);
    await desc.press("Tab");
    expect((await saved).ok()).toBe(true);
    await expect(previewFrame(page).getByText(edited)).toBeVisible({
      timeout: 30_000,
    });
    const source = await componentSource(page);
    expect(source).toContain(`desc = "${edited}"`);
    // The title's default was not touched by that save.
    expect(source).toContain(`title = "${DEFAULT_TITLE}"`);
  });
});
