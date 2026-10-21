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
  test.describe(`a component default the page overrides, in the client-only preview: ${theme.name}`, () => {
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
        console.log(`### SAVE-FEEDBACK ${JSON.stringify(feedback)}`);
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
        sections: Array<{ id: string; props?: Record<string, unknown> }>;
      };
      const sectionsBefore = (homeBefore.document as Doc).sections;
      const sectionsAfter = (homeAfter.document as Doc).sections;
      const expectedSections = sectionsBefore.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              props: { ...(section.props ?? {}), heading: newHeading },
            }
          : section,
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
          section.id === sectionId
            ? {
                ...section,
                props: { ...(section.props ?? {}), heading: newHeading },
              }
            : section,
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
