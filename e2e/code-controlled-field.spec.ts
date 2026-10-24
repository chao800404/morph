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
  themeSourceGeneration,
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
 * canvas never changed. Clicking the description offers its default,
 * labelled as the component's code default, and the edit is saved into the
 * source and shown on the canvas.
 *
 * Two Themes, because the click reaches the editor two ways:
 * - one whose root route renders into the preview's `#root` (no
 *   `shellComponent`), the form earlier Starters had: the page root is the
 *   click's section;
 * - the current Starter, whose root route owns the document: there is no page
 *   root, and the bridge names the field under the route the editor asked for
 *   (the page stand-in). Before the stand-in, such a click selected nothing.
 *
 * On the second, every write the frame or the server API can be asked for
 * under that route path is refused, and nothing is stored.
 *
 * Each runs on a Theme of its own, inserted into the runner-owned database, so
 * the source it rewrites never reaches the shared Theme.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

const shared = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;

/**
 * Which preview runs: the default client-only one, or the full Start preview
 * (the Worker's `MORPH_THEME_PREVIEW_RUNTIME=start`, announced to the specs as
 * `MORPH_E2E_PREVIEW_RUNTIME=start`; scripts/editor-e2e-start.mjs). A Theme
 * rendering into `#root` has no document shell, which a Start page needs, so
 * that case is defined for the client-only preview only; everything on the
 * current Starter runs in both.
 */
const PREVIEW_RUNTIME =
  process.env.MORPH_E2E_PREVIEW_RUNTIME === "start"
    ? "full Start"
    : "client-only";

const COMPONENT_PATH = "src/components/CodeHero.tsx";
const PAGE_TITLE = "Title the page passes";
const DEFAULT_TITLE = "Code hero default title";
const DEFAULT_DESC = "Code hero default desc";
const ROOT_ROUTE_PATH = "src/routes/__root.tsx";
const SHELL_OPTION = "  shellComponent: RootDocument,\n";

const files = (routePath: string, routeFile: string) => [
  {
    path: routeFile,
    content: `import { createFileRoute } from "@tanstack/react-router";
import CodeHero from "../components/CodeHero";

export const Route = createFileRoute("${routePath}")({
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

type RawTemplate = {
  id: string;
  route_path: string | null;
  draft_generation: number;
  draft_revision_id: string | null;
  /** The row's own document column. */
  document: string;
  /** The draft the row points at: where an edit is stored. */
  draft_document: string | null;
  revisions: number;
};

/**
 * The Theme's templates as the database holds them, read with no server code
 * in between: each row's document text, draft generation and draft revision,
 * the document of the draft revision it points at (an edit is stored as a new
 * revision, not in the row's own document column), and how many revisions it
 * has.
 */
async function rawTemplates(scope: ThemeScope): Promise<RawTemplate[]> {
  const { stdout } = await promisify(execFile)("npx", [
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
    `SELECT t.id, t.route_path, t.draft_generation, t.draft_revision_id, t.document,
      (SELECT r.document FROM storefront_theme_template_revisions r WHERE r.id = t.draft_revision_id) AS draft_document,
      (SELECT count(*) FROM storefront_theme_template_revisions r WHERE r.template_id = t.id) AS revisions
    FROM storefront_theme_templates t
    WHERE t.theme_id = '${scope.themeId}' AND t.deleted_at IS NULL
    ORDER BY t.id;`,
  ]);
  const parsed = JSON.parse(stdout) as Array<{ results: RawTemplate[] }>;
  return parsed[0]!.results;
}

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

async function themeFile(
  page: Page,
  scope: ThemeScope,
  path: string,
): Promise<string> {
  const listed = (await page.evaluate(
    async ({ module, scope }) => {
      const fns = await import(/* @vite-ignore */ module);
      return fns.listStorefrontThemeFiles({ data: scope });
    },
    {
      module: "/src/server/storefront/storefront-theme-files.serverFn.ts",
      scope,
    },
  )) as {
    success: boolean;
    data?: { files: Array<{ path: string; content: string }> };
  };
  expect(listed.success, JSON.stringify(listed)).toBe(true);
  return listed.data!.files.find((file) => file.path === path)?.content ?? "";
}

type EditorTemplates = Array<{
  id: string;
  type: string;
  routePath: string | null;
  draftGeneration: number;
  version: number;
  document: unknown;
}>;

/** Every template, as stored: ids, generations, versions and documents. */
async function storedTemplates(
  page: Page,
  scope: ThemeScope,
): Promise<EditorTemplates> {
  const editor = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
    ...scope,
  })) as { success: boolean; data?: { templates: EditorTemplates } };
  expect(editor.success, JSON.stringify(editor)).toBe(true);
  return editor.data!.templates.map(
    ({ id, type, routePath, draftGeneration, version, document }) => ({
      id,
      type,
      routePath,
      draftGeneration,
      version,
      document,
    }),
  );
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
const contentField = (page: Page, label: string) =>
  page
    .locator('[data-slot="inspector-content-field"]')
    .filter({ hasText: label });

for (const theme of [
  {
    name: "a Theme rendering into #root",
    routePath: "/code-controlled",
    routeFile: "src/routes/code-controlled.tsx",
    documentShell: false,
  },
  {
    name: "the current Starter, whose root route owns the document",
    routePath: "/code-controlled-shell",
    routeFile: "src/routes/code-controlled-shell.tsx",
    documentShell: true,
  },
] as const) {
  if (PREVIEW_RUNTIME === "full Start" && !theme.documentShell) continue;
  test.describe(`a component default the page overrides, in the ${PREVIEW_RUNTIME} preview: ${theme.name}`, () => {
    test.describe.configure({ mode: "serial" });

    let scope: ThemeScope | null = null;
    let editorPath: string | null = null;

    async function openRoute(page: Page) {
      const url = new URL(editorPath!, "http://placeholder");
      url.searchParams.set("routePath", theme.routePath);
      await page.goto(`${url.pathname}${url.search}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible(
        { timeout: 45_000 },
      );
      await expect(previewFrame(page).getByText(PAGE_TITLE)).toBeVisible({
        timeout: 90_000,
      });
      // Which way the click reaches the editor: a page root, or none.
      await expect(
        previewFrame(page).locator("[data-morph-route-path]"),
      ).toHaveCount(theme.documentShell ? 0 : 1);
    }

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
      const rootRoute = await themeFile(page, scope, ROOT_ROUTE_PATH);
      expect(rootRoute, "the Starter's root route owns the document").toContain(
        SHELL_OPTION,
      );
      const saved = await writeThemeFiles(page, scope, [
        ...files(theme.routePath, theme.routeFile),
        // Rendered into `#root`, as a root route without a document shell is.
        ...(theme.documentShell
          ? []
          : [
              {
                path: ROOT_ROUTE_PATH,
                content: rootRoute.replace(SHELL_OPTION, ""),
              },
            ]),
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
            isServerFunctionCall(
              request.url(),
              "saveStorefrontThemeFilesBatch",
            ))
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
      await expect(contentField(page, "Code title")).toHaveCount(0);
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
      await previewFrame(page)
        .getByText(PAGE_TITLE, { exact: true })
        .dblclick();
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
      expect(await themeFile(page, scope!, COMPONENT_PATH)).toContain(
        `title = "${DEFAULT_TITLE}"`,
      );

      // The description: the component's own default, which the canvas
      // shows, labelled as the component's code default, not this page's.
      await clickOnCanvas(page, DEFAULT_DESC);
      await expect(controlled(page, "Code desc")).toHaveCount(0);
      const field = contentField(page, "Code desc");
      await expect(field).toHaveAttribute(
        "data-content-store",
        "source-default",
      );
      await expect(
        field.locator('[data-slot="inspector-code-default-badge"]'),
      ).toHaveText("Component code default");
      const desc = field.locator("input, textarea");
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
      const source = await themeFile(page, scope!, COMPONENT_PATH);
      expect(source).toContain(`desc = "${edited}"`);
      // The title's default was not touched by that save.
      expect(source).toContain(`title = "${DEFAULT_TITLE}"`);
    });

    if (!theme.documentShell) return;

    test("a forged page stand-in is refused by every write, and nothing is stored", async ({
      page,
    }) => {
      test.setTimeout(240_000);
      const editorWrites: string[] = [];
      page.on("request", (request) => {
        if (request.method() !== "POST") return;
        for (const name of [
          "updateStorefrontThemeSectionProps",
          "reorderStorefrontThemeSections",
          "renameStorefrontThemeSection",
          "promoteStorefrontThemeText",
          "updateStorefrontThemeRenderPolicy",
          "ensureStorefrontThemeRouteTemplate",
          "saveStorefrontThemeFile",
          "saveStorefrontThemeFilesBatch",
        ]) {
          if (isServerFunctionCall(request.url(), name))
            editorWrites.push(name);
        }
      });
      await openRoute(page);
      const before = await storedTemplates(page, scope!);
      const sourceBefore = await themeFile(page, scope!, COMPONENT_PATH);
      const home = before.find((template) => template.type === "index")!;

      // The real stand-in, from the real click: the editor takes it.
      await clickOnCanvas(page, PAGE_TITLE);
      await expect(controlled(page, "Code title")).toBeVisible();

      // What the frame's own bridge stamps on its messages, read from one.
      await page.evaluate(() => {
        const captured = window as unknown as {
          __standInEnvelope?: {
            previewSession: string;
            previewDocument: string;
          };
        };
        window.addEventListener("message", (event) => {
          const data = event.data as Record<string, unknown> | null;
          if (
            data &&
            typeof data.previewSession === "string" &&
            typeof data.previewDocument === "string"
          ) {
            captured.__standInEnvelope = {
              previewSession: data.previewSession,
              previewDocument: data.previewDocument,
            };
          }
        });
      });
      await clickOnCanvas(page, PAGE_TITLE);
      const envelope = await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { __standInEnvelope?: unknown })
                .__standInEnvelope ?? null,
          ),
        )
        .not.toBeNull()
        .then(() =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  __standInEnvelope: {
                    previewSession: string;
                    previewDocument: string;
                  };
                }
              ).__standInEnvelope,
          ),
        );
      const editorOrigin = new URL(page.url()).origin;
      const frame = page
        .frames()
        .find((candidate) => candidate !== page.mainFrame())!;
      const layoutSection =
        (await previewFrame(page)
          .locator("[data-storefront-section-id]")
          .first()
          .getAttribute("data-storefront-section-id")) ?? "starter-header";

      // Forged from the current document itself, with its own envelope.
      await frame.evaluate(
        ({ messages, envelope, editorOrigin }) => {
          for (const message of messages) {
            window.parent.postMessage(
              { ...message, ...envelope },
              editorOrigin,
            );
          }
        },
        {
          editorOrigin,
          envelope,
          messages: [
            {
              type: "morph:storefront-preview-commit-inline-text",
              sectionId: theme.routePath,
              fieldKey: "title",
              fieldPath: "title",
              value: "Forged inline",
              originalValue: PAGE_TITLE,
            },
            {
              type: "morph:storefront-preview-commit-section-reorder",
              draggedSectionId: theme.routePath,
              targetSectionId: layoutSection,
            },
            {
              type: "morph:storefront-preview-commit-array-item-reorder",
              sectionId: theme.routePath,
              draggedFieldPath: "items.0",
              targetFieldPath: "items.1",
            },
          ],
        },
      );
      await page.waitForTimeout(2_500);
      expect(editorWrites).toEqual([]);

      // The server API, named with the route path as a section.
      const forged = { ...scope!, templateId: home.id };
      const answers = {
        props: await serverFn(
          page,
          THEMES,
          "updateStorefrontThemeSectionProps",
          {
            ...forged,
            sectionId: theme.routePath,
            props: { title: "Forged" },
            expectedDraftGeneration: home.draftGeneration,
            expectedSourceGeneration: 1,
            routePath: theme.routePath,
          },
        ),
        hideAndReset: await serverFn(
          page,
          THEMES,
          "updateStorefrontThemeSectionProps",
          {
            ...forged,
            sectionId: theme.routePath,
            props: { enabled: false },
            resetProps: ["title"],
            expectedDraftGeneration: home.draftGeneration,
            expectedSourceGeneration: 1,
          },
        ),
        rename: await serverFn(page, THEMES, "renameStorefrontThemeSection", {
          ...forged,
          sectionId: theme.routePath,
          name: "Forged",
          expectedDraftGeneration: home.draftGeneration,
        }),
        reorder: await serverFn(
          page,
          THEMES,
          "reorderStorefrontThemeSections",
          {
            ...forged,
            sectionIds: [theme.routePath],
            expectedDraftGeneration: home.draftGeneration,
          },
        ),
        promote: await serverFn(page, THEMES, "promoteStorefrontThemeText", {
          ...forged,
          sectionId: theme.routePath,
          componentSourcePath: COMPONENT_PATH,
          targetKey: "14:7",
          fieldName: "title",
          value: "Forged",
          expectedSourceGeneration: 1,
          expectedFileVersion: 1,
          expectedDraftGeneration: home.draftGeneration,
        }),
      };
      for (const [name, answer] of Object.entries(answers)) {
        expect(
          (answer as { success?: boolean }).success,
          `${name}: ${JSON.stringify(answer)}`,
        ).toBe(false);
      }

      // Read back: no template, generation, version or document moved, and
      // no route document was created; the component source is as it was.
      expect(await storedTemplates(page, scope!)).toEqual(before);
      expect(await themeFile(page, scope!, COMPONENT_PATH)).toBe(sourceBefore);
    });

    test("a code default and a CMS field are two writes, each landing in its own store", async ({
      page,
    }) => {
      test.setTimeout(300_000);
      const allFiles = async () => {
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
        return Object.fromEntries(
          listed.data!.files.map((file) => [file.path, file.content]),
        );
      };
      const saveFeedback = async (label: string) => {
        const status = page.locator("[data-editor-save-status]");
        const feedback = {
          label,
          status: await status.getAttribute("aria-label"),
          unpublishedReason: await status.getAttribute(
            "data-unpublished-reason",
          ),
          toasts: await page.locator("[data-sonner-toast]").allInnerTexts(),
        };
        await test.info().attach(`save-feedback-${label}`, {
          body: JSON.stringify(feedback, null, 2),
          contentType: "application/json",
        });
      };

      // 1. A component code default, edited under the page stand-in.
      await openRoute(page);
      const templatesBefore = await storedTemplates(page, scope!);
      const rawBefore = await rawTemplates(scope!);
      const filesBefore = await allFiles();
      const sourceBefore = filesBefore[COMPONENT_PATH]!;
      const currentDesc = /desc = "([^"]*)"/.exec(sourceBefore)?.[1];
      expect(currentDesc, "the component states a desc default").toBeDefined();
      await clickOnCanvas(page, currentDesc!);
      const codeDefault = contentField(page, "Code desc");
      // Named as what it is before anything is typed: the component's code
      // default, in that file, not this page's content.
      await expect(codeDefault).toHaveAttribute(
        "data-content-store",
        "source-default",
      );
      const badge = codeDefault.locator(
        '[data-slot="inspector-code-default-badge"]',
      );
      await expect(badge).toHaveText("Component code default");
      await expect(badge).toHaveAttribute(
        "title",
        new RegExp(
          `Saved into ${COMPONENT_PATH.replace(/\./g, "\\.")}\\..*It is not this page's content\\.`,
        ),
      );
      const newDefault = `Two-write default ${Date.now()}`;
      const sourceSaved = page.waitForResponse(
        (response) =>
          isServerFunctionCall(response.url(), "saveStorefrontThemeFile") &&
          (response.request().postData() ?? "").includes(newDefault),
        { timeout: 30_000 },
      );
      const descInput = codeDefault.locator("input, textarea");
      await descInput.fill(newDefault);
      await descInput.press("Tab");
      expect((await sourceSaved).ok()).toBe(true);
      await expect(previewFrame(page).getByText(newDefault)).toBeVisible({
        timeout: 30_000,
      });
      await saveFeedback("component-code-default");

      // The source holds exactly that default and nothing else changed in it;
      // no other Theme file changed.
      const filesAfterSource = await allFiles();
      expect(filesAfterSource[COMPONENT_PATH]).toBe(
        sourceBefore.replace(
          `desc = "${currentDesc}"`,
          `desc = "${newDefault}"`,
        ),
      );
      expect({ ...filesAfterSource, [COMPONENT_PATH]: "" }).toEqual({
        ...filesBefore,
        [COMPONENT_PATH]: "",
      });
      // No Document moved, read back from the server: every template's
      // document, version and draftGeneration, and no route document made.
      const templatesAfterSource = await storedTemplates(page, scope!);
      expect(templatesAfterSource).toEqual(templatesBefore);
      const rawAfterSource = await rawTemplates(scope!);
      expect(rawAfterSource).toEqual(rawBefore);
      expect(
        rawAfterSource.some((row) => row.route_path === theme.routePath),
      ).toBe(false);
      expect(
        templatesAfterSource.some(
          (template) => template.routePath === theme.routePath,
        ),
      ).toBe(false);

      // 2. A real Document field, on the home page's stored section.
      await page.goto(editorPath!, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible(
        { timeout: 45_000 },
      );
      const sectionId = "starter-introduction";
      const heading = previewFrame(page).locator(
        `[data-storefront-section-id="${sectionId}"] [data-storefront-field="heading"]`,
      );
      await expect(heading).toBeVisible({ timeout: 90_000 });
      const headingText = ((await heading.textContent()) ?? "").trim();
      if (
        await page
          .getByRole("button", { name: "Enable section selection" })
          .isVisible()
          .catch(() => false)
      ) {
        await enableSelection(page);
      }
      await heading.scrollIntoViewIfNeeded();
      expect(await clickExposedElement(page, heading)).not.toBeNull();
      await settleSelection(page);
      await openContentTab(page);
      // A field node selected shows that field alone.
      const field = page.locator('[data-slot="inspector-content-field"]');
      await expect(field).toHaveCount(1);
      await expect(field.locator("input, textarea")).toHaveValue(headingText);
      await expect(field).toHaveAttribute("data-content-store", "document");
      await expect(
        page.locator('[data-slot="inspector-code-default-badge"]'),
      ).toHaveCount(0);
      const filesBeforeCms = await allFiles();
      const templatesBeforeCms = await storedTemplates(page, scope!);
      const rawBeforeCms = await rawTemplates(scope!);
      const newHeading = `Two-write heading ${Date.now()}`;
      const contentSaved = page.waitForResponse(
        (response) =>
          isServerFunctionCall(
            response.url(),
            "updateStorefrontThemeSectionProps",
          ) && (response.request().postData() ?? "").includes(newHeading),
        { timeout: 30_000 },
      );
      const headingInput = field.locator("input, textarea");
      await headingInput.fill(newHeading);
      await headingInput.press("Tab");
      expect((await contentSaved).ok()).toBe(true);
      await expect(heading).toHaveText(newHeading, { timeout: 30_000 });
      await saveFeedback("cms-field");

      // The Document changed in that field only; the Theme source is
      // byte-identical.
      const templatesAfterCms = await storedTemplates(page, scope!);
      const homeBefore = templatesBeforeCms.find((t) => t.type === "index")!;
      const homeAfter = templatesAfterCms.find((t) => t.type === "index")!;
      type Doc = {
        sections: Array<{
          id: string;
          componentRef?: string | null;
          props?: Record<string, unknown>;
        }>;
      };
      // The edited section as the write stores it: that field changed, and
      // its component ref the one the route renders it from, which the write
      // resolves for the section it writes (a legacy ref in the seed reads
      // back as stored since #291). Nothing else in it, and no other section.
      const edited = (section: Doc["sections"][number]) => ({
        ...section,
        componentRef: `src/components/page-sections/index/${sectionId}/index.tsx`,
        props: { ...(section.props ?? {}), heading: newHeading },
      });
      const sectionsBefore = (homeBefore.document as Doc).sections;
      const sectionsAfter = (homeAfter.document as Doc).sections;
      const expectedSections = sectionsBefore.map((section) =>
        section.id === sectionId ? edited(section) : section,
      );
      expect(sectionsAfter).toEqual(expectedSections);
      expect({ ...(homeAfter.document as object), sections: [] }).toEqual({
        ...(homeBefore.document as object),
        sections: [],
      });
      expect(homeAfter.draftGeneration).toBeGreaterThan(
        homeBefore.draftGeneration,
      );
      expect(
        templatesAfterCms.filter((template) => template.id !== homeAfter.id),
      ).toEqual(
        templatesBeforeCms.filter((template) => template.id !== homeBefore.id),
      );
      // The same, in the rows themselves: only the home row moved, and in
      // its document only that field.
      const rawAfterCms = await rawTemplates(scope!);
      const homeRowBefore = rawBeforeCms.find(
        (row) => row.id === homeBefore.id,
      )!;
      const homeRowAfter = rawAfterCms.find((row) => row.id === homeBefore.id)!;
      expect(rawAfterCms.filter((row) => row.id !== homeBefore.id)).toEqual(
        rawBeforeCms.filter((row) => row.id !== homeBefore.id),
      );
      const rawDocBefore = JSON.parse(
        homeRowBefore.draft_document ?? homeRowBefore.document,
      ) as Doc;
      expect(homeRowAfter.draft_document).not.toBeNull();
      const rawDocAfter = JSON.parse(homeRowAfter.draft_document!) as Doc;
      // The stored draft is the document the server showed before, with that
      // one field changed. (A template seeded with legacy component refs has
      // them stored resolved by its first draft write; the server already
      // reads them resolved, so they are compared on that view.)
      expect(rawDocAfter).toEqual({
        ...(homeBefore.document as Doc),
        sections: (homeBefore.document as Doc).sections.map((section) =>
          section.id === sectionId ? edited(section) : section,
        ),
      });
      // The row's own document column (the seed it was created with) is not
      // where an edit goes, and stays as it was. Compared with that seed, the
      // first draft also stores what the server's read already normalizes
      // (resolved component refs, list row ids), so the field-only check is
      // the one above, against the document the server showed before.
      expect(homeRowAfter.document).toBe(homeRowBefore.document);
      expect(rawDocBefore.sections.map((section) => section.id)).toEqual(
        rawDocAfter.sections.map((section) => section.id),
      );
      expect(homeRowAfter.draft_generation).toBeGreaterThan(
        homeRowBefore.draft_generation,
      );
      expect(await allFiles()).toEqual(filesBeforeCms);
    });
  });
}

/**
 * The two writes, measured on the stored rows themselves.
 *
 * The comparisons above read the Document back through the server, whose read
 * is derived (sections joined to the route, refs resolved). A derived read
 * that dropped stored content would agree with itself and prove nothing. So
 * here every check is against the raw stored input, through D1 directly:
 *
 * - The seed is given content the route never binds: a stored section the
 *   route does not render, a non-editable prop and section metadata.
 * - The first draft write is diffed against that raw seed, leaf by leaf. The
 *   only differences allowed are the edited field and an enumerated list of
 *   normalisations, each named by its exact path.
 * - A pre-normalised fixture is written as the draft revision of another
 *   Theme, and the two writes are measured against it byte for byte: a code
 *   default leaves every row and revision as it was; a CMS field makes one
 *   new revision whose document is the fixture with only that field changed.
 */
type RawDoc = {
  sections: Array<{
    id: string;
    type?: string;
    name?: string;
    componentRef?: string | null;
    enabled?: boolean;
    props?: Record<string, unknown>;
  }>;
} & Record<string, unknown>;
type JsonDiff = Readonly<{ path: string; before: unknown; after: unknown }>;

/** Every leaf where two JSON values differ, by path; a missing key is `undefined`. */
function jsonDiff(before: unknown, after: unknown, path = "$"): JsonDiff[] {
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  if (Array.isArray(before) && Array.isArray(after)) {
    const diffs: JsonDiff[] = [];
    for (let i = 0; i < Math.max(before.length, after.length); i += 1) {
      diffs.push(...jsonDiff(before[i], after[i], `${path}[${i}]`));
    }
    return diffs;
  }
  if (isObject(before) && isObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((key) =>
      jsonDiff(before[key], after[key], `${path}.${key}`),
    );
  }
  return Object.is(before, after) ? [] : [{ path, before, after }];
}

async function d1(command: string): Promise<Array<Record<string, unknown>>> {
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
      command,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as Array<{
    results: Array<Record<string, unknown>>;
  }>;
  return parsed.at(-1)?.results ?? [];
}
const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`;

type RawHome = {
  draft_revision_id: string | null;
  draft_generation: number;
  document: string;
  draft_document: string | null;
  draft_version: number | null;
  revisions: number;
};

/** The row and the revision it points at, raw. */
async function rawHome(templateId: string): Promise<RawHome> {
  const [row] = await d1(
    `SELECT t.draft_revision_id, t.draft_generation, t.document,
      r.document AS draft_document, r.version AS draft_version,
      (SELECT count(*) FROM storefront_theme_template_revisions x WHERE x.template_id = t.id) AS revisions
    FROM storefront_theme_templates t
    LEFT JOIN storefront_theme_template_revisions r ON r.id = t.draft_revision_id
    WHERE t.id = ${sqlText(templateId)};`,
  );
  return row as unknown as RawHome;
}
/** The document the template's content is read from: its draft, else its seed. */
const storedText = (row: RawHome) => row.draft_document ?? row.document;

const RAW_ROUTE = "/code-controlled-raw";
const RAW_SECTION = "starter-introduction";
/** Stored content no route binds, and props no field declares. */
const KEPT_UNBOUND = {
  id: "kept-unbound-note",
  type: "kept-note",
  componentRef: "src/components/KeptNote.tsx",
  name: "Kept unbound section",
  enabled: true,
  props: {
    text: "Kept unbound text",
    internal: { tier: 2, flags: ["a", "b"] },
  },
};
const KEPT_PROP = { trackingId: "kept-tracking-1", layoutHint: { span: 3 } };
const KEPT_NAME = "Kept introduction name";

/** A Theme of its own, its home template seeded with the kept content. */
type RawTheme = {
  scope: ThemeScope;
  editorPath: string;
  homeId: string;
  /** The raw seed after the kept content was added, before any draft write. */
  seedText: string;
};

async function prepareRawTheme(browser: Browser): Promise<RawTheme> {
  const page = await signedInPage(browser);
  await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
  const scope = await createThrowawayTheme();
  const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
    ...scope,
  })) as {
    success: boolean;
    data?: { templates: Array<{ id: string; type: string }> };
  };
  expect(result.success, JSON.stringify(result)).toBe(true);
  const homeId = result.data!.templates.find((t) => t.type === "index")!.id;
  const editorPath = `/store/${scope.storefrontId}/themes/${scope.themeId}/editor?templateId=${homeId}`;
  const saved = await writeThemeFiles(
    page,
    scope,
    files(RAW_ROUTE, "src/routes/code-controlled-raw.tsx"),
  );
  expect(saved.success, JSON.stringify(saved)).toBe(true);

  // Kept content, written into whatever the template's content is read
  // from, before any draft write: an unbound section at the end, a
  // non-editable prop and a name on the section that will be edited.
  const row = await rawHome(homeId);
  const seed = JSON.parse(storedText(row)) as RawDoc;
  const target = seed.sections.find((section) => section.id === RAW_SECTION);
  expect(target, "the seed stores the introduction").toBeDefined();
  target!.name = KEPT_NAME;
  target!.props = { ...(target!.props ?? {}), ...KEPT_PROP };
  seed.sections.push(KEPT_UNBOUND);
  const seedText = JSON.stringify(seed);
  await d1(
    row.draft_revision_id
      ? `UPDATE storefront_theme_template_revisions SET document = ${sqlText(seedText)} WHERE id = ${sqlText(row.draft_revision_id)};`
      : `UPDATE storefront_theme_templates SET document = ${sqlText(seedText)} WHERE id = ${sqlText(homeId)};`,
  );
  expect(storedText(await rawHome(homeId))).toBe(seedText);
  await page.context().close();
  return { scope, editorPath, homeId, seedText };
}

async function listAllFiles(page: Page, scope: ThemeScope) {
  const listed = (await page.evaluate(
    async ({ module, scope }) => {
      const fns = await import(/* @vite-ignore */ module);
      return fns.listStorefrontThemeFiles({ data: scope });
    },
    {
      module: "/src/server/storefront/storefront-theme-files.serverFn.ts",
      scope,
    },
  )) as {
    success: boolean;
    data?: { files: Array<{ path: string; content: string }> };
  };
  expect(listed.success, JSON.stringify(listed)).toBe(true);
  return Object.fromEntries(
    listed.data!.files.map((file) => [file.path, file.content]),
  );
}

/** Edits the home page's introduction heading through the Inspector. */
async function editHeading(page: Page, editorPath: string, value: string) {
  await page.goto(editorPath, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  const heading = previewFrame(page).locator(
    `[data-storefront-section-id="${RAW_SECTION}"] [data-storefront-field="heading"]`,
  );
  await expect(heading).toBeVisible({ timeout: 90_000 });
  if (
    await page
      .getByRole("button", { name: "Enable section selection" })
      .isVisible()
      .catch(() => false)
  ) {
    await enableSelection(page);
  }
  await heading.scrollIntoViewIfNeeded();
  expect(await clickExposedElement(page, heading)).not.toBeNull();
  await settleSelection(page);
  await openContentTab(page);
  const field = page.locator('[data-slot="inspector-content-field"]');
  await expect(field).toHaveCount(1);
  await expect(field).toHaveAttribute("data-content-store", "document");
  await expect(
    page.locator('[data-slot="inspector-code-default-badge"]'),
  ).toHaveCount(0);
  const saved = page.waitForResponse(
    (response) =>
      isServerFunctionCall(
        response.url(),
        "updateStorefrontThemeSectionProps",
      ) && (response.request().postData() ?? "").includes(value),
    { timeout: 30_000 },
  );
  const input = field.locator("input, textarea");
  await input.fill(value);
  await input.press("Tab");
  expect((await saved).ok()).toBe(true);
  await expect(heading).toHaveText(value, { timeout: 30_000 });
}

test.describe(`the first draft write on the raw stored Document, in the ${PREVIEW_RUNTIME} preview`, () => {
  let raw: RawTheme | null = null;
  test.beforeAll(async ({ browser }) => {
    raw = await prepareRawTheme(browser);
  });

  test("keeps every stored value but the field and the named normalisations", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const { editorPath, homeId, seedText } = raw!;
    const seed = JSON.parse(seedText) as RawDoc;
    const before = await rawHome(homeId);
    const newHeading = `First-write heading ${Date.now()}`;
    await editHeading(page, editorPath, newHeading);
    const after = await rawHome(homeId);

    // A new draft revision; the row's own seed column untouched when the
    // seed was there.
    expect(after.draft_revision_id).not.toBeNull();
    expect(after.draft_revision_id).not.toBe(before.draft_revision_id);
    expect(after.revisions).toBe(before.revisions + 1);
    expect(after.draft_generation).toBeGreaterThan(before.draft_generation);
    if (before.draft_revision_id === null) {
      expect(after.document).toBe(before.document);
    }

    const stored = JSON.parse(after.draft_document!) as RawDoc;
    const index = seed.sections.findIndex((s) => s.id === RAW_SECTION);
    // The allowed differences, each by exact path:
    // - the edited field;
    // - a Starter section's legacy component ref, resolved to the file the
    //   route renders it from (`src/components/page-sections/index/<id>/index.tsx`);
    // - a generated row id (`morph-mig-<16 hex>`) on a list row that had none.
    const allowed = new Map<
      string,
      (before: unknown, after: unknown) => boolean
    >();
    allowed.set(
      `$.sections[${index}].props.heading`,
      (_b, a) => a === newHeading,
    );
    seed.sections.forEach((section, i) => {
      if (
        section.id.startsWith("starter-") &&
        typeof section.componentRef === "string" &&
        !section.componentRef.startsWith("src/components/page-sections/")
      ) {
        allowed.set(
          `$.sections[${i}].componentRef`,
          (_b, a) =>
            a === `src/components/page-sections/index/${section.id}/index.tsx`,
        );
      }
      const items = section.props?.items;
      if (Array.isArray(items)) {
        items.forEach((item, j) => {
          if (
            item &&
            typeof item === "object" &&
            !("id" in (item as Record<string, unknown>))
          ) {
            allowed.set(
              `$.sections[${i}].props.items[${j}].id`,
              (b, a) =>
                b === undefined &&
                typeof a === "string" &&
                /^morph-mig-[0-9a-f]{16}$/.test(a),
            );
          }
        });
      }
    });
    const diffs = jsonDiff(seed, stored);
    await test.info().attach("first-write-diff", {
      body: JSON.stringify({ allowed: [...allowed.keys()], diffs }, null, 2),
      contentType: "application/json",
    });
    const unexplained = diffs.filter(
      (diff) => !allowed.get(diff.path)?.(diff.before, diff.after),
    );
    expect(unexplained).toEqual([]);
    expect(diffs.map((diff) => diff.path)).toContain(
      `$.sections[${index}].props.heading`,
    );
    // Said once more, plainly: the kept content is there, in place.
    expect(stored.sections.map((s) => s.id)).toEqual(
      seed.sections.map((s) => s.id),
    );
    expect(stored.sections.at(-1)).toEqual(KEPT_UNBOUND);
    expect(stored.sections[index]!.name).toBe(KEPT_NAME);
    expect(stored.sections[index]!.props).toMatchObject(KEPT_PROP);
  });
});

test.describe(`two writes on a pre-normalised raw Document, in the ${PREVIEW_RUNTIME} preview`, () => {
  let raw: RawTheme | null = null;
  /** The fixture as written: the draft revision's document text and id. */
  let fixtureText: string | null = null;
  let fixtureRevision: string | null = null;

  test.beforeAll(async ({ browser }) => {
    raw = await prepareRawTheme(browser);
    const { scope, homeId } = raw;
    // One draft write through the server, so the template has a draft
    // revision the server has already normalised.
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const editor = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
      ...scope,
    })) as {
      success: boolean;
      data?: { templates: Array<{ id: string; draftGeneration: number }> };
    };
    expect(editor.success, JSON.stringify(editor)).toBe(true);
    const home = editor.data!.templates.find((t) => t.id === homeId)!;
    const primed = (await serverFn(
      page,
      THEMES,
      "updateStorefrontThemeSectionProps",
      {
        ...scope,
        templateId: homeId,
        sectionId: RAW_SECTION,
        props: { heading: "Primed heading" },
        expectedDraftGeneration: home.draftGeneration,
        expectedSourceGeneration: await themeSourceGeneration(page, scope),
      },
    )) as { success: boolean };
    expect(primed.success, JSON.stringify(primed)).toBe(true);
    await page.context().close();

    // The fixture: that normalised draft, holding the kept content (put
    // back if the write lost it, so this test measures the next writes on
    // it either way), one more non-editable prop on another section, written
    // as a new draft revision.
    const current = await rawHome(homeId);
    expect(current.draft_revision_id).not.toBeNull();
    const fixture = JSON.parse(current.draft_document!) as RawDoc;
    if (!fixture.sections.some((s) => s.id === KEPT_UNBOUND.id)) {
      fixture.sections.push(KEPT_UNBOUND);
    }
    const story = fixture.sections.find((s) => s.id === "starter-story");
    expect(story, "the fixture stores the story section").toBeDefined();
    story!.props = { ...(story!.props ?? {}), internalNote: "kept-note-2" };
    fixtureText = JSON.stringify(fixture);
    fixtureRevision = randomUUID();
    await d1(
      `INSERT INTO storefront_theme_template_revisions (id, template_id, version, document, created_by, created_at)
        SELECT ${sqlText(fixtureRevision)}, ${sqlText(homeId)},
          (SELECT max(version) + 1 FROM storefront_theme_template_revisions WHERE template_id = ${sqlText(homeId)}),
          ${sqlText(fixtureText)}, created_by, ${sqlText(new Date().toISOString())}
        FROM storefront_theme_template_revisions WHERE id = ${sqlText(current.draft_revision_id!)};
      UPDATE storefront_theme_templates
        SET draft_revision_id = ${sqlText(fixtureRevision)}, draft_generation = draft_generation + 1
        WHERE id = ${sqlText(homeId)};`,
    );
    const seeded = await rawHome(homeId);
    expect(seeded.draft_revision_id).toBe(fixtureRevision);
    expect(seeded.draft_document).toBe(fixtureText);
  });

  test("a code default and a CMS field each write only their own store, byte for byte", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const { scope, editorPath, homeId } = raw!;
    const fixture = JSON.parse(fixtureText!) as RawDoc;
    const seeded = await rawHome(homeId);
    expect(seeded.draft_revision_id).toBe(fixtureRevision);

    // 1. The component code default, under the page stand-in.
    const url = new URL(editorPath, "http://placeholder");
    url.searchParams.set("routePath", RAW_ROUTE);
    await page.goto(`${url.pathname}${url.search}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    await expect(previewFrame(page).getByText(DEFAULT_DESC)).toBeVisible({
      timeout: 90_000,
    });
    const filesBefore = await listAllFiles(page, scope);
    await clickOnCanvas(page, DEFAULT_DESC);
    const codeDefault = contentField(page, "Code desc");
    await expect(codeDefault).toHaveAttribute(
      "data-content-store",
      "source-default",
    );
    const badge = codeDefault.locator(
      '[data-slot="inspector-code-default-badge"]',
    );
    await expect(badge).toHaveText("Component code default");
    await expect(badge).toHaveAttribute(
      "title",
      new RegExp(
        `Saved into ${COMPONENT_PATH.replace(/\./g, "\\.")}\\..*It is not this page's content\\.`,
      ),
    );
    const newDefault = `Raw default ${Date.now()}`;
    const sourceSaved = page.waitForResponse(
      (response) =>
        isServerFunctionCall(response.url(), "saveStorefrontThemeFile") &&
        (response.request().postData() ?? "").includes(newDefault),
      { timeout: 30_000 },
    );
    await codeDefault.locator("input, textarea").fill(newDefault);
    await codeDefault.locator("input, textarea").press("Tab");
    expect((await sourceSaved).ok()).toBe(true);
    await expect(previewFrame(page).getByText(newDefault)).toBeVisible({
      timeout: 30_000,
    });
    // The row, its revision pointer, its revisions and the revision's
    // document text are exactly as seeded.
    expect(await rawHome(homeId)).toEqual(seeded);
    const filesAfterSource = await listAllFiles(page, scope);
    expect(filesAfterSource[COMPONENT_PATH]).toBe(
      filesBefore[COMPONENT_PATH]!.replace(
        `desc = "${DEFAULT_DESC}"`,
        `desc = "${newDefault}"`,
      ),
    );
    expect({ ...filesAfterSource, [COMPONENT_PATH]: "" }).toEqual({
      ...filesBefore,
      [COMPONENT_PATH]: "",
    });
    const routeRows = await d1(
      `SELECT id FROM storefront_theme_templates WHERE theme_id = ${sqlText(scope.themeId)} AND route_path = ${sqlText(RAW_ROUTE)};`,
    );
    expect(routeRows).toEqual([]);

    // 2. The CMS field on the home page's stored section.
    const filesBeforeCms = await listAllFiles(page, scope);
    const index = fixture.sections.findIndex((s) => s.id === RAW_SECTION);
    const previousHeading = (fixture.sections[index]!.props ?? {}).heading;
    const newHeading = `Raw heading ${Date.now()}`;
    await editHeading(page, editorPath, newHeading);
    const after = await rawHome(homeId);
    // The fixture is an unpublished draft, which the writer rewrites in
    // place (`prepareTemplateDocumentWrite`: an active draft no publication
    // references is updated, not branched): same revision, same version, no
    // new revision row, one generation further. The branch to a new revision
    // is the first write's, measured in the test above.
    expect(after.draft_revision_id).toBe(fixtureRevision);
    expect(after.revisions).toBe(seeded.revisions);
    expect(after.draft_version).toBe(seeded.draft_version);
    expect(after.draft_generation).toBe(seeded.draft_generation + 1);
    expect(after.document).toBe(seeded.document);
    // The new revision is the fixture with that one field changed: as a
    // value tree, and as the stored text.
    expect(jsonDiff(fixture, JSON.parse(after.draft_document!))).toEqual([
      {
        path: `$.sections[${index}].props.heading`,
        before: previousHeading,
        after: newHeading,
      },
    ]);
    expect(after.draft_document).toBe(
      fixtureText!.replace(
        `"heading":${JSON.stringify(previousHeading)}`,
        `"heading":${JSON.stringify(newHeading)}`,
      ),
    );
    // The Theme source is byte-identical.
    expect(await listAllFiles(page, scope)).toEqual(filesBeforeCms);
  });
});

/**
 * Per field on one component in a bound section (`cms-field` + `code-default`),
 * rendered across two instances on the same route, in the ${PREVIEW_RUNTIME}
 * preview.
 *
 * `DualDefaultHero` declares `title` and `desc` with defaults in
 * `src/components/DualDefaultHero.tsx`. The route renders two bound section
 * instances (`heroA` and `heroB`), passing `title={...}` from the Document on
 * both and leaving `desc` out on both.
 *
 * The stored Document holds `title` AND `desc` on both `heroA` and `heroB`
 * (including `heroA.props.desc === DEFAULT_DUAL_DESC` to exercise the
 * equal-text inline guard).
 *
 * Verifies:
 * 1. Canvas selection of `heroA`'s `title` (`cms-field`) -> Inspector shows
 *    `data-content-store="document"`, saves via
 *    `updateStorefrontThemeSectionProps`, updates only `heroA.props.title` in
 *    raw D1, leaves `DualDefaultHero.tsx` byte-identical.
 * 2. Canvas selection of `heroA`'s `desc` (`code-default`) -> double-click inline
 *    editing on canvas is refused with the code-default toast and writes
 *    nothing; Inspector shows `data-content-store="source-default"` and the
 *    `Component code default` badge, saves via `saveStorefrontThemeFile` with
 *    `operation: "code-default"` and `codeDefault` proof, and never calls
 *    `updateStorefrontThemeSectionProps`.
 * 3. Raw D1 template row and draft revision are byte-identical before and after
 *    the `code-default` save.
 * 4. Exact source diff: `DualDefaultHero.tsx` differs only on the `desc = "..."`
 *    default literal; `title = "..."` and all other Theme files are
 *    byte-identical.
 * 5. Second instance (`heroB`) on the canvas updates to the new `desc` default
 *    while keeping its own `title`, and after `page.reload()` both instances
 *    and the Inspector still agree.
 */
const DUAL_ROUTE = "/code-controlled-dual";
const DUAL_ROUTE_FILE = "src/routes/code-controlled-dual.tsx";
const DUAL_COMPONENT_PATH = "src/components/DualDefaultHero.tsx";
const DEFAULT_DUAL_TITLE = "Dual default title";
const DEFAULT_DUAL_DESC = "Dual default desc";
const STORED_HERO_A = {
  title: "Stored heroA title",
  desc: DEFAULT_DUAL_DESC,
};
const STORED_HERO_B = {
  title: "Stored heroB title",
  desc: "Unused stored heroB desc",
};

function dualRouteContent(
  mode: "seed" | "per-field",
  runtime: typeof PREVIEW_RUNTIME,
) {
  const callA =
    mode === "seed"
      ? runtime === "full Start"
        ? `<DualDefaultHero {...heroA} />`
        : `<DualDefaultHero {...content("heroA")} />`
      : `<DualDefaultHero title={heroA.title} />`;
  const callB =
    mode === "seed"
      ? runtime === "full Start"
        ? `<DualDefaultHero {...heroB} />`
        : `<DualDefaultHero {...content("heroB")} />`
      : `<DualDefaultHero title={heroB.title} />`;

  if (runtime === "full Start") {
    return `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import DualDefaultHero from "../components/DualDefaultHero";

const getPage = createServerFn().handler(() => morph.pages.get("${DUAL_ROUTE}"));

export const Route = createFileRoute("${DUAL_ROUTE}")({
  loader: () => getPage(),
  component: DualDefaultRoute,
});

function DualDefaultRoute() {
  const { heroA, heroB } = Route.useLoaderData();
  return (
    <main>
      ${callA}
      ${callB}
    </main>
  );
}
`;
  }

  return `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import DualDefaultHero from "../components/DualDefaultHero";

export const Route = createFileRoute("${DUAL_ROUTE}")({
  component: DualDefaultRoute,
});

function DualDefaultRoute() {
  const heroA = content("heroA");
  const heroB = content("heroB");
  return (
    <main>
      ${callA}
      ${callB}
    </main>
  );
}
`;
}

const DUAL_COMPONENT_FILE = {
  path: DUAL_COMPONENT_PATH,
  content: `export const contentFields = {
  title: { type: "text", label: "Dual title" },
  desc: { type: "text", label: "Dual desc" },
} as const;

type DualDefaultHeroProps = { title?: string; desc?: string };

export default function DualDefaultHero({
  title = "${DEFAULT_DUAL_TITLE}",
  desc = "${DEFAULT_DUAL_DESC}",
}: DualDefaultHeroProps) {
  return (
    <section data-dual-hero="" className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-2">{desc}</p>
    </section>
  );
}
`,
};

async function rawRouteRow(
  scope: ThemeScope,
  routePath: string,
): Promise<RawHome> {
  const [row] = await d1(
    `SELECT t.draft_revision_id, t.draft_generation, t.document,
      r.document AS draft_document, r.version AS draft_version,
      (SELECT count(*) FROM storefront_theme_template_revisions x WHERE x.template_id = t.id) AS revisions
    FROM storefront_theme_templates t
    LEFT JOIN storefront_theme_template_revisions r ON r.id = t.draft_revision_id
    WHERE t.theme_id = ${sqlText(scope.themeId)}
      AND t.route_path = ${sqlText(routePath)}
      AND t.deleted_at IS NULL;`,
  );
  expect(row, `expected one route template row for ${routePath}`).toBeDefined();
  return row as unknown as RawHome;
}

test.describe(`per-field CMS and code-default routing across two instances, in the ${PREVIEW_RUNTIME} preview`, () => {
  let scope: ThemeScope | null = null;
  let editorPath: string | null = null;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
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
    const home = result.data!.templates.find((t) => t.type === "index")!;
    editorPath = `/store/${scope.storefrontId}/themes/${scope.themeId}/editor?templateId=${home.id}`;

    // Write the spread seed route first so both title and desc can be stored
    // on heroA and heroB, then switch the route to pass only `title={...}`
    // while leaving `desc` to the component's default.
    const seedSaved = await writeThemeFiles(page, scope, [
      DUAL_COMPONENT_FILE,
      {
        path: DUAL_ROUTE_FILE,
        content: dualRouteContent("seed", PREVIEW_RUNTIME),
      },
    ]);
    expect(seedSaved.success, JSON.stringify(seedSaved)).toBe(true);

    const ensured = (await serverFn(
      page,
      THEMES,
      "ensureStorefrontThemeRouteTemplate",
      { ...scope, routePath: DUAL_ROUTE },
    )) as { success: boolean; data?: { id: string; draftGeneration: number } };
    expect(ensured.success, JSON.stringify(ensured)).toBe(true);

    const storedA = (await serverFn(
      page,
      THEMES,
      "updateStorefrontThemeSectionProps",
      {
        ...scope,
        templateId: ensured.data!.id,
        sectionId: "heroA",
        props: STORED_HERO_A,
        expectedDraftGeneration: ensured.data!.draftGeneration,
        expectedSourceGeneration: await themeSourceGeneration(page, scope),
        routePath: DUAL_ROUTE,
      },
    )) as {
      success: boolean;
      data?: { draftGeneration: number };
    };
    expect(storedA.success, JSON.stringify(storedA)).toBe(true);

    const storedB = (await serverFn(
      page,
      THEMES,
      "updateStorefrontThemeSectionProps",
      {
        ...scope,
        templateId: ensured.data!.id,
        sectionId: "heroB",
        props: STORED_HERO_B,
        expectedDraftGeneration: storedA.data!.draftGeneration,
        expectedSourceGeneration: await themeSourceGeneration(page, scope),
        routePath: DUAL_ROUTE,
      },
    )) as { success: boolean };
    expect(storedB.success, JSON.stringify(storedB)).toBe(true);

    const perFieldSaved = await writeThemeFiles(page, scope, [
      {
        path: DUAL_ROUTE_FILE,
        content: dualRouteContent("per-field", PREVIEW_RUNTIME),
      },
    ]);
    expect(perFieldSaved.success, JSON.stringify(perFieldSaved)).toBe(true);
    await page.context().close();
  });

  test("routes title to Document and desc to source default with proof, updates both instances, and survives reload", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const url = new URL(editorPath!, "http://placeholder");
    url.searchParams.set("routePath", DUAL_ROUTE);
    await page.goto(`${url.pathname}${url.search}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });

    const heroATitle = previewFrame(page).locator(
      '[data-storefront-section-id="heroA"] [data-dual-hero] h2',
    );
    const heroADesc = previewFrame(page).locator(
      '[data-storefront-section-id="heroA"] [data-dual-hero] p',
    );
    const heroBTitle = previewFrame(page).locator(
      '[data-storefront-section-id="heroB"] [data-dual-hero] h2',
    );
    const heroBDesc = previewFrame(page).locator(
      '[data-storefront-section-id="heroB"] [data-dual-hero] p',
    );

    await expect(heroATitle).toHaveText(STORED_HERO_A.title, {
      timeout: 90_000,
    });
    await expect(heroBTitle).toHaveText(STORED_HERO_B.title);
    await expect(heroADesc).toHaveText(DEFAULT_DUAL_DESC);
    await expect(heroBDesc).toHaveText(DEFAULT_DUAL_DESC);

    // 1. Select heroA's title (`cms-field`) -> writes Document only, leaves
    //    `DualDefaultHero.tsx` untouched.
    const filesBeforeTitle = await listAllFiles(page, scope!);
    const rawBeforeTitle = await rawRouteRow(scope!, DUAL_ROUTE);

    if (
      await page
        .getByRole("button", { name: "Enable section selection" })
        .isVisible()
        .catch(() => false)
    ) {
      await enableSelection(page);
    }
    await heroATitle.scrollIntoViewIfNeeded();
    expect(await clickExposedElement(page, heroATitle)).not.toBeNull();
    await settleSelection(page);
    await openContentTab(page);

    const titleField = contentField(page, "Dual title");
    await expect(titleField).toHaveAttribute("data-content-store", "document");
    await expect(
      titleField.locator('[data-slot="inspector-code-default-badge"]'),
    ).toHaveCount(0);
    const titleInput = titleField.locator("input, textarea");
    await expect(titleInput).toHaveValue(STORED_HERO_A.title);

    const newHeroATitle = `Edited heroA title ${Date.now()}`;
    const titleSaved = page.waitForResponse(
      (response) =>
        isServerFunctionCall(
          response.url(),
          "updateStorefrontThemeSectionProps",
        ) && (response.request().postData() ?? "").includes(newHeroATitle),
      { timeout: 30_000 },
    );
    await titleInput.fill(newHeroATitle);
    await titleInput.press("Tab");
    expect((await titleSaved).ok()).toBe(true);
    await expect(heroATitle).toHaveText(newHeroATitle, { timeout: 30_000 });
    await expect(heroBTitle).toHaveText(STORED_HERO_B.title);

    const rawAfterTitle = await rawRouteRow(scope!, DUAL_ROUTE);
    expect(rawAfterTitle.draft_generation).toBe(
      rawBeforeTitle.draft_generation + 1,
    );
    const docBeforeTitle = JSON.parse(storedText(rawBeforeTitle)) as RawDoc;
    const docAfterTitle = JSON.parse(storedText(rawAfterTitle)) as RawDoc;
    const heroAIndex = docBeforeTitle.sections.findIndex(
      (s) => s.id === "heroA",
    );
    expect(jsonDiff(docBeforeTitle, docAfterTitle)).toEqual([
      {
        path: `$.sections[${heroAIndex}].props.title`,
        before: STORED_HERO_A.title,
        after: newHeroATitle,
      },
    ]);
    expect(await listAllFiles(page, scope!)).toEqual(filesBeforeTitle);

    // 2. Select heroA's desc (`code-default`) -> double-click inline editing
    //    on canvas is refused even though `heroA.props.desc` holds equal text;
    //    Inspector shows `source-default` + `Component code default` badge,
    //    saves via `saveStorefrontThemeFile` with `operation: "code-default"`
    //    and `codeDefault` proof, and leaves raw D1 byte-identical.
    const docWritesDuringDesc: string[] = [];
    const fileWritesDuringDesc: string[] = [];
    const onRequest = (request: { method: () => string; url: () => string; postData: () => string | null }) => {
      if (request.method() !== "POST") return;
      if (
        isServerFunctionCall(request.url(), "updateStorefrontThemeSectionProps")
      ) {
        docWritesDuringDesc.push(request.postData() ?? "");
      }
      if (isServerFunctionCall(request.url(), "saveStorefrontThemeFile")) {
        fileWritesDuringDesc.push(request.postData() ?? "");
      }
    };
    page.on("request", onRequest);

    await heroADesc.scrollIntoViewIfNeeded();
    expect(await clickExposedElement(page, heroADesc)).not.toBeNull();
    await settleSelection(page);
    await openContentTab(page);

    // Inline double-click on the `code-default` element is refused and opens
    // no inline editor.
    await heroADesc.dblclick();
    await expect(
      previewFrame(page).locator("[data-storefront-editor-inline-editing]"),
    ).toHaveCount(0);
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: /content fields on the right/i }),
    ).toBeVisible({ timeout: 10_000 });
    expect(docWritesDuringDesc).toEqual([]);
    expect(fileWritesDuringDesc).toEqual([]);

    const descField = contentField(page, "Dual desc");
    await expect(descField).toHaveAttribute(
      "data-content-store",
      "source-default",
    );
    const badge = descField.locator(
      '[data-slot="inspector-code-default-badge"]',
    );
    await expect(badge).toHaveText("Component code default");
    const descInput = descField.locator("input, textarea");
    await expect(descInput).toHaveValue(DEFAULT_DUAL_DESC);

    const filesBeforeDesc = await listAllFiles(page, scope!);
    const rawBeforeDesc = await rawRouteRow(scope!, DUAL_ROUTE);
    const allTemplatesBeforeDesc = await rawTemplates(scope!);

    const newDualDesc = `Edited dual default desc ${Date.now()}`;
    const descSaved = page.waitForResponse(
      (response) =>
        isServerFunctionCall(response.url(), "saveStorefrontThemeFile") &&
        (response.request().postData() ?? "").includes(newDualDesc),
      { timeout: 30_000 },
    );
    await descInput.fill(newDualDesc);
    await descInput.press("Tab");
    const descResponse = await descSaved;
    expect(descResponse.ok()).toBe(true);
    page.off("request", onRequest);

    // Sent as an explicit `operation: "code-default"` write with proof, and
    // never wrote the Document.
    expect(docWritesDuringDesc).toEqual([]);
    expect(fileWritesDuringDesc.length).toBeGreaterThan(0);
    for (const payload of fileWritesDuringDesc) {
      expect(payload).toContain('"operation"');
      expect(payload).toContain('"code-default"');
      expect(payload).toContain('"codeDefault"');
      expect(payload).toContain(`"${DUAL_COMPONENT_PATH}"`);
      expect(payload).toContain('"DualDefaultHero"');
      expect(payload).toContain('"expectedCurrentDefault"');
    }

    // Both instances on the canvas update to the new component default while
    // keeping their respective Document titles.
    await expect(heroADesc).toHaveText(newDualDesc, { timeout: 30_000 });
    await expect(heroBDesc).toHaveText(newDualDesc, { timeout: 30_000 });
    await expect(heroATitle).toHaveText(newHeroATitle);
    await expect(heroBTitle).toHaveText(STORED_HERO_B.title);

    // Raw D1 is byte-identical before and after the code-default save.
    expect(await rawRouteRow(scope!, DUAL_ROUTE)).toEqual(rawBeforeDesc);
    expect(await rawTemplates(scope!)).toEqual(allTemplatesBeforeDesc);

    // Exact source diff: only `desc = "..."` in `DualDefaultHero.tsx` changed.
    const filesAfterDesc = await listAllFiles(page, scope!);
    expect(filesAfterDesc[DUAL_COMPONENT_PATH]).toBe(
      filesBeforeDesc[DUAL_COMPONENT_PATH]!.replace(
        `desc = "${DEFAULT_DUAL_DESC}"`,
        `desc = "${newDualDesc}"`,
      ),
    );
    expect(filesAfterDesc[DUAL_COMPONENT_PATH]).toContain(
      `title = "${DEFAULT_DUAL_TITLE}"`,
    );
    expect({ ...filesAfterDesc, [DUAL_COMPONENT_PATH]: "" }).toEqual({
      ...filesBeforeDesc,
      [DUAL_COMPONENT_PATH]: "",
    });

    // Reload: both instances and the Inspector read back the updated source
    // default and the stored Document titles.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(heroATitle).toHaveText(newHeroATitle, { timeout: 90_000 });
    await expect(heroBTitle).toHaveText(STORED_HERO_B.title);
    await expect(heroADesc).toHaveText(newDualDesc);
    await expect(heroBDesc).toHaveText(newDualDesc);

    if (
      await page
        .getByRole("button", { name: "Enable section selection" })
        .isVisible()
        .catch(() => false)
    ) {
      await enableSelection(page);
    }
    await heroBDesc.scrollIntoViewIfNeeded();
    expect(await clickExposedElement(page, heroBDesc)).not.toBeNull();
    await settleSelection(page);
    await openContentTab(page);
    const reloadedDescField = contentField(page, "Dual desc");
    await expect(reloadedDescField).toHaveAttribute(
      "data-content-store",
      "source-default",
    );
    await expect(reloadedDescField.locator("input, textarea")).toHaveValue(
      newDualDesc,
    );
  });
});
