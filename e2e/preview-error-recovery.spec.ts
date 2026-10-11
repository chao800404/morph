import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  openContentTab,
  previewFrame,
  saveEditedSource,
} from "./helpers";
import { THEMES, serverFn } from "./native-acceptance";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";

/**
 * A Theme that stops compiling in the Live Preview, and comes back.
 *
 * The author deletes a component a route still imports. The canvas runs that
 * source for real, so it cannot render the page; what it owes the author is
 * an error they can see, an editor that still works, and a draft that is
 * still there — and, once the import is fixed, the page again with nothing
 * lost. A blank canvas would satisfy none of that while looking like a slow
 * load, so each is asserted on its own.
 *
 * Runs on a Theme of its own, inserted into the runner-owned database: an
 * interrupted run cannot leave the shared Theme without a component.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

let scope: ThemeScope | null = null;
let editorPath: string | null = null;
const ROUTE_PATH = "/error-recovery";
const ROUTE_FILE = "src/routes/error-recovery.tsx";
const SLOT = "error-recovery";
const DELETED = "src/components/RecoveryCard.tsx";
const KEPT = "src/components/KeptCard.tsx";

const card = (name: string, fallback: string) => `export const contentFields = {
  title: { type: "text", label: "Card title" },
} as const;

type ${name}Props = { title?: string };

export default function ${name}({ title = "${fallback}" }: ${name}Props) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{title}</h2>
    </section>
  );
}
`;

const FILES = [
  {
    path: ROUTE_FILE,
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import RecoveryCard from "../components/RecoveryCard";

export const Route = createFileRoute("${ROUTE_PATH}")({
  component: ErrorRecoveryRoute,
});

function ErrorRecoveryRoute() {
  return (
    <main>
      <RecoveryCard {...content("${SLOT}")} />
    </main>
  );
}
`,
  },
  { path: DELETED, content: card("RecoveryCard", "Recovery default") },
  { path: KEPT, content: card("KeptCard", "Kept default") },
];

async function createThrowawayTheme(): Promise<ThemeScope> {
  const created = {
    ...themeScopeFromEditorPath(EDITOR_PATH!),
    themeId: randomUUID(),
  };
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
      'error-recovery-${created.themeId}', '{"starterTemplateVersion":1}',
      '${now}', '${now}');`,
  ]);
  return created;
}

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

const cardTitle = (page: Page) =>
  previewFrame(page).locator(
    `[data-storefront-section-id="${SLOT}"] [data-storefront-field="title"]`,
  );

const titleField = (page: Page) =>
  page
    .locator('[data-slot="inspector-content-field"]')
    .filter({ hasText: "Card title" })
    .locator("input");

/** The title the Document holds for the slot, read back from the server. */
async function storedTitle(page: Page): Promise<unknown> {
  const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
    ...scope!,
  })) as {
    success: boolean;
    data?: {
      templates: Array<{
        document: {
          sections: Array<{ id: string; props?: Record<string, unknown> }>;
        };
      }>;
    };
  };
  expect(result.success, JSON.stringify(result)).toBe(true);
  const sections = result
    .data!.templates.flatMap((template) => template.document.sections)
    .filter((section) => section.id === SLOT);
  expect(sections.length).toBeLessThanOrEqual(1);
  return sections[0]?.props?.title;
}

/** The workspace's copy of a file, or null once it is gone. */
async function storedFile(page: Page, path: string): Promise<string | null> {
  const result = (await serverFn(
    page,
    "/src/server/storefront/storefront-theme-files.serverFn.ts",
    "listStorefrontThemeFiles",
    { ...scope! },
  )) as {
    success: boolean;
    data?: { files: Array<{ path: string; content: string }> };
  };
  expect(result.success, JSON.stringify(result)).toBe(true);
  return result.data!.files.find((file) => file.path === path)?.content ?? null;
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
}

async function selectCard(page: Page) {
  if (
    await page
      .getByRole("button", { name: "Enable section selection" })
      .isVisible()
      .catch(() => false)
  ) {
    await enableSelection(page);
  }
  await cardTitle(page).scrollIntoViewIfNeeded();
  expect(await clickExposedElement(page, cardTitle(page))).not.toBeNull();
  await openContentTab(page);
  await expect(titleField(page)).toBeVisible();
}

async function openInCode(page: Page, fileName: string) {
  await page.getByRole("button", { name: /^Code$/ }).click();
  // The Code workspace, with or without a file open: the file that was open
  // may be the one just deleted.
  await expect(
    page
      .locator(".monaco-editor")
      .first()
      .or(page.getByText("Select a file from the explorer to begin editing.")),
  ).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Control+p");
  const quickOpen = page.getByPlaceholder("Search files by name or path…");
  await quickOpen.fill(fileName);
  await quickOpen.press("Enter");
}

/**
 * Resolves when the canvas reports that the route module failed to load.
 *
 * The editor logs the frame's own load diagnostics; a page whose route module
 * Vite refused (500) reports it as a failed script naming that file. Waiting
 * for that, rather than for the card to be gone, is what makes "the canvas
 * cannot render this" a fact here: an empty frame is also what a page still
 * loading looks like. Register it before the action that breaks the page.
 */
function routeModuleFailure(page: Page) {
  return page.waitForEvent("console", {
    predicate: (message) =>
      message.text().includes("[preview-frame] script-failed") &&
      message.text().includes(ROUTE_FILE),
    timeout: 90_000,
  });
}

async function backToDesign(page: Page) {
  await page.mouse.move(0, 0);
  await page.getByRole("button", { name: /^Design$/ }).focus();
  await page.keyboard.press("Enter");
}

test.describe("a Live Preview that stops compiling", () => {
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
    await page.context().close();
  });

  test.afterAll(async ({ browser }) => {
    if (!scope) return;
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const removed = await removeThemeFiles(
      page,
      scope,
      FILES.map((file) => file.path),
    );
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    await page.context().close();
  });

  test("keeps the editor and the draft, and recovers when the import is fixed", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await openRoute(page);
    await expect(cardTitle(page)).toHaveText("Recovery default", {
      timeout: 90_000,
    });

    // A draft value first: the thing that must survive what follows.
    await selectCard(page);
    const draft = `Draft before the break ${Date.now()}`;
    await titleField(page).fill(draft);
    await titleField(page).press("Tab");
    await expect.poll(() => storedTitle(page)).toBe(draft);
    await expect(cardTitle(page)).toHaveText(draft);

    // The break, as an author makes it: deleting the component in Code while
    // the route still imports it.
    await openInCode(page, "RecoveryCard.tsx");
    await page
      .locator("span.truncate", { hasText: /^RecoveryCard\.tsx$/ })
      .first()
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const failure = routeModuleFailure(page);
    const deleted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        (response.request().postData() ?? "").includes(DELETED),
      { timeout: 30_000 },
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete" })
      .click();
    expect((await deleted).ok()).toBe(true);
    await expect.poll(() => storedFile(page, DELETED)).toBeNull();

    // The canvas can no longer render the route: it says the module failed,
    // and the card is gone.
    await backToDesign(page);
    await failure;
    await expect(cardTitle(page)).toHaveCount(0);

    // The editor still works: Code opens the route, and a save goes through.
    // That save is the fix — the route imports the component that is left.
    await openInCode(page, "error-recovery.tsx");
    await saveEditedSource(page, ROUTE_FILE, (source) =>
      source
        .replace(
          'import RecoveryCard from "../components/RecoveryCard";',
          'import KeptCard from "../components/KeptCard";',
        )
        .replace("<RecoveryCard ", "<KeptCard "),
    );
    expect(await storedFile(page, ROUTE_FILE)).toContain("<KeptCard ");

    // The draft was never touched by any of it.
    expect(await storedTitle(page)).toBe(draft);

    // Refreshing the preview brings the page back, with the draft. (That it
    // should come back without being asked is the last test below.)
    await backToDesign(page);
    await page
      .getByRole("button", { name: "Refresh preview", exact: true })
      .click();
    await expect(cardTitle(page)).toHaveText(draft, { timeout: 60_000 });
    await selectCard(page);
    await expect(titleField(page)).toHaveValue(draft);

    // A fresh load agrees: nothing above was held only in this tab.
    await openRoute(page);
    await expect(cardTitle(page)).toHaveText(draft, { timeout: 90_000 });
  });

  // With the import broken, Vite answers the route module with a 500, the
  // entry script never runs, and Vite's own overlay — part of what failed to
  // load — never appears. Found by this spec as a blank canvas with nothing
  // in the editor; the editor now names the file and the missing import from
  // its own copy of the source, and the canvas shows Vite's message.
  test("tells the author why the canvas is empty", async ({ page }) => {
    // Server functions are imported by the page, which starts on about:blank.
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    test.setTimeout(240_000);
    const broken = FILES[0]!.content;
    try {
      // Broken through the workspace directly; the previous test already
      // walked the author's own path to the same state.
      const saved = await writeThemeFiles(page, scope!, [
        { path: ROUTE_FILE, content: broken },
      ]);
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      const failure = routeModuleFailure(page);
      await openRoute(page);
      await failure;
      await expect(cardTitle(page)).toHaveCount(0);

      // Somewhere the author can see it — an alert in the editor, or the
      // canvas itself — names what is missing.
      await expect
        .poll(
          async () => {
            const alerts = await page.getByRole("alert").allInnerTexts();
            const canvas = await previewFrame(page)
              .locator("body")
              .innerText()
              .catch(() => "");
            return [...alerts, canvas].join("\n");
          },
          { timeout: 60_000 },
        )
        .toContain("RecoveryCard");
    } finally {
      const restored = await writeThemeFiles(page, scope!, [
        {
          path: ROUTE_FILE,
          content: broken
            .replace(
              'import RecoveryCard from "../components/RecoveryCard";',
              'import KeptCard from "../components/KeptCard";',
            )
            .replace("<RecoveryCard ", "<KeptCard "),
        },
      ]);
      expect(restored.success, JSON.stringify(restored)).toBe(true);
    }
  });

  // The page that failed has nothing of the Theme running to take the fix as
  // an update, and nothing that reloads it when the module compiles again.
  // Found by this spec as a canvas that stayed empty until Refresh preview;
  // the editor now loads a new frame once the fix is written into the preview.
  test("comes back by itself once the import is fixed", async ({ page }) => {
    // Server functions are imported by the page, which starts on about:blank.
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    test.setTimeout(240_000);
    const fixed = (await storedFile(page, ROUTE_FILE))!;
    expect(fixed).toContain("<KeptCard ");
    try {
      // The state the first test reached: a page that loaded with the
      // import broken. (Broken while already showing is the next test.)
      const saved = await writeThemeFiles(page, scope!, [
        {
          path: ROUTE_FILE,
          content: fixed.replace(
            'import KeptCard from "../components/KeptCard";',
            'import KeptCard from "../components/RecoveryCard";',
          ),
        },
      ]);
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      const failure = routeModuleFailure(page);
      await openRoute(page);
      await failure;
      await expect(cardTitle(page)).toHaveCount(0);

      // Fixed in Code, as an author would, and nothing else: no refresh.
      await openInCode(page, "error-recovery.tsx");
      await saveEditedSource(page, ROUTE_FILE, () => fixed);
      await backToDesign(page);
      await expect(cardTitle(page)).toBeVisible({ timeout: 60_000 });
    } finally {
      const restored = await writeThemeFiles(page, scope!, [
        { path: ROUTE_FILE, content: fixed },
      ]);
      expect(restored.success, JSON.stringify(restored)).toBe(true);
    }
  });

  // Broken while the page is showing, Vite's hot update for the route fails
  // and its client keeps the previous page; its overlay, which would say so,
  // never reaches this page. Found by this spec as a canvas that went on
  // showing a version of the source that no longer existed, with nothing
  // anywhere to say so. The page now reloads when a hot update fails, so the
  // break is told the same way as a page that loaded broken.
  test("tells the author when a save breaks the page that is showing", async ({
    page,
  }) => {
    // Server functions are imported by the page, which starts on about:blank.
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    test.setTimeout(240_000);
    const fixed = (await storedFile(page, ROUTE_FILE))!;
    expect(fixed).toContain("<KeptCard ");
    try {
      await openRoute(page);
      await expect(cardTitle(page)).toBeVisible({ timeout: 90_000 });

      const failure = routeModuleFailure(page);
      await openInCode(page, "error-recovery.tsx");
      await saveEditedSource(page, ROUTE_FILE, (source) =>
        source.replace(
          'import KeptCard from "../components/KeptCard";',
          'import KeptCard from "../components/RecoveryCard";',
        ),
      );
      await backToDesign(page);
      await failure;
      await expect(cardTitle(page)).toHaveCount(0);
      await expect(
        page.getByRole("alert").filter({ hasText: "../components/RecoveryCard" }),
      ).toBeVisible({ timeout: 60_000 });
    } finally {
      const restored = await writeThemeFiles(page, scope!, [
        { path: ROUTE_FILE, content: fixed },
      ]);
      expect(restored.success, JSON.stringify(restored)).toBe(true);
    }
  });
});
