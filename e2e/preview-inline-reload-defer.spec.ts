import {
  expect,
  test,
  type Browser,
  type Frame,
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
} from "./helpers";
import { THEMES, serverFn } from "./native-acceptance";
import {
  themeScopeFromEditorPath,
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";

/**
 * Text typed on the canvas, not yet committed, when another tab's ordinary
 * start replaces the preview's dev server.
 *
 * The text lives only in the frame until it is committed. Before this,
 * replacing the frame for the new server dropped it silently: no notice, the
 * unsaved state cleared, nothing stored. Now the frame is kept and the author
 * is told once; when they finish the text, the commit enters the ordinary
 * pending flow and only then is the frame replaced.
 *
 * Two outcomes of that pending write are followed:
 * - the other tab changed only content, so the source is as it was and the
 *   write lands;
 * - the other tab changed the source (an unrelated file), so the write is
 *   refused for its selection baseline, and the text stays with the author.
 *
 * The route's Document exists before anything is typed. Nothing the edit
 * targets is deleted. Local sidecar only: the instance is named there.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);
test.skip(
  (process.env.MORPH_E2E_TRANSPORT ?? "local-sidecar") !== "local-sidecar",
  "Only the local sidecar names its dev server instances.",
);

const shared = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
let scope: ThemeScope | null = null;
let editorPath: string | null = null;
const ROUTE_PATH = "/inline-reload-defer";
const SLOT = "defer-card";
const DEFERRED_NOTICE =
  "The preview server was updated. The canvas will reload after you finish this text.";

const FILES = [
  {
    path: "src/routes/inline-reload-defer.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import DeferCard from "../defer/DeferCard";

export const Route = createFileRoute("${ROUTE_PATH}")({
  component: DeferRoute,
});

function DeferRoute() {
  return (
    <main>
      <DeferCard {...content("${SLOT}")} />
    </main>
  );
}
`,
  },
  {
    path: "src/defer/DeferCard.tsx",
    content: `type DeferCardProps = { title?: string };

export default function DeferCard({ title = "Defer default title" }: DeferCardProps) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{title}</h2>
    </section>
  );
}
`,
  },
  {
    path: "src/defer/DeferCard.fields.ts",
    content: `export const contentFields = {
  title: { type: "text", label: "DeferCard title" },
} as const;
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
    "--env",
    "local_preview_e2e",
    "--persist-to",
    process.env.MORPH_E2E_STATE_DIR!,
    "--command",
    `INSERT INTO storefront_themes
    (id, storefront_id, name, metadata, created_at, updated_at)
    VALUES ('${created.themeId}', '${created.storefrontId}',
      'inline-reload-defer-${created.themeId}', '{"starterTemplateVersion":1}',
      '${now}', '${now}');`,
  ]);
  return created;
}

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

const routeUrl = () => {
  const url = new URL(editorPath!, "http://placeholder");
  url.searchParams.set("routePath", ROUTE_PATH);
  return `${url.pathname}${url.search}`;
};

const cardTitle = (page: Page) =>
  previewFrame(page).locator(
    `[data-storefront-section-id="${SLOT}"] [data-storefront-field="title"]`,
  );

const titleField = (page: Page) =>
  page
    .locator('[data-slot="inspector-content-field"]')
    .filter({ hasText: "DeferCard title" })
    .locator("input");

const inlineEditor = (page: Page) =>
  previewFrame(page).locator("[data-storefront-editor-inline-editing]");

const saveStatus = (page: Page) => page.locator("[data-editor-save-status]");

const previewFrameOf = (page: Page): Frame | undefined =>
  page.frames().find((frame) => frame.url().includes("__morph-theme-preview__"));

async function frameMark(page: Page): Promise<string | null> {
  const frame = previewFrameOf(page);
  if (!frame) return null;
  return frame
    .evaluate(() => String((window as { __deferMark?: string }).__deferMark ?? ""))
    .catch(() => null);
}

async function markFrame(page: Page, mark: string) {
  const frame = previewFrameOf(page);
  expect(frame, "the tab has a preview frame").toBeDefined();
  await frame!.evaluate((id) => {
    (window as { __deferMark?: string }).__deferMark = id;
  }, mark);
}

const unloadWarned = (page: Page) =>
  page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

async function storedTitle(page: Page): Promise<unknown> {
  const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
    ...scope!,
  })) as {
    data?: {
      templates: Array<{
        routePath?: string | null;
        document: { sections: Array<{ id: string; props?: Record<string, unknown> }> };
      }>;
    };
  };
  const doc = result.data?.templates.find((template) => template.routePath === ROUTE_PATH);
  return doc?.document.sections.find((section) => section.id === SLOT)?.props?.title ?? null;
}

/** Counts this tab's requests from the moment it is called. */
function watchRequests(page: Page) {
  const seen = { saves: [] as string[], starts: 0, reasons: [] as string[] };
  page.on("request", (request) => {
    const url = request.url();
    if (isServerFunctionCall(url, "updateStorefrontThemeSectionProps")) {
      seen.saves.push(request.postData() ?? "");
    }
    if (isServerFunctionCall(url, "startThemePreviewServer")) seen.starts += 1;
  });
  page.on("console", (message) => {
    if (message.text().startsWith("[preview-instance]")) seen.reasons.push(message.text());
  });
  return seen;
}

/** Opens the route, stores `base`, opens the canvas text and types `typed`. */
async function typingOnCanvas(page: Page, base: string, typed: string) {
  await page.goto(routeUrl(), { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({ timeout: 45_000 });
  await expect(cardTitle(page)).toBeVisible({ timeout: 90_000 });
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
  const saved = page.waitForResponse(
    (response) =>
      isServerFunctionCall(response.url(), "updateStorefrontThemeSectionProps") &&
      (response.request().postData() ?? "").includes(base),
    { timeout: 30_000 },
  );
  await titleField(page).fill(base);
  await titleField(page).press("Tab");
  expect((await saved).ok()).toBe(true);
  await expect(saveStatus(page)).toHaveAttribute("aria-label", /^(Unpublished|Published)$/, {
    timeout: 30_000,
  });
  const text = previewFrame(page).getByText(base, { exact: true });
  await expect(text).toBeVisible({ timeout: 30_000 });
  await expect(
    previewFrame(page).locator("html[data-storefront-editor-selection-enabled]"),
  ).toBeAttached({ timeout: 45_000 });
  const box = await text.boundingBox();
  expect(box, "no box for the canvas text").not.toBeNull();
  await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(inlineEditor(page)).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("End");
  await page.keyboard.type(typed);
  await expect(inlineEditor(page)).toContainText(`${base}${typed}`);
  await expect(saveStatus(page)).toHaveAttribute("data-save-state", "unsaved");
}

/** Another tab opens the editor on the route: its ordinary start. */
async function anotherTabStarts(browser: Browser, before?: (other: Page) => Promise<void>) {
  const other = await signedInPage(browser);
  try {
    await other.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    if (before) await before(other);
    const answered = other.waitForResponse(
      (response) => isServerFunctionCall(response.url(), "startThemePreviewServer"),
      { timeout: 180_000 },
    );
    await other.goto(routeUrl(), { waitUntil: "domcontentloaded" });
    expect((await answered).status()).toBe(200);
  } finally {
    await other.context().close();
  }
}

/** Waits, touching nothing, until the held reload is announced. */
async function heldAndTold(page: Page, mark: string, base: string, typed: string) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: DEFERRED_NOTICE })).toBeVisible({
    timeout: 150_000,
  });
  // Held: the same frame, the text still open in it, still counted unsaved.
  expect(await frameMark(page)).toBe(mark);
  await expect(inlineEditor(page)).toContainText(`${base}${typed}`);
  await expect(saveStatus(page)).toHaveAttribute("data-save-state", "unsaved");
  expect(await unloadWarned(page)).toBe(true);
}

test.describe("text typed on the canvas when the preview server is replaced", () => {
  test.beforeEach(async ({ browser }) => {
    const page = await signedInPage(browser);
    try {
      await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
      scope = await createThrowawayTheme();
      const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
        ...scope,
      })) as { success: boolean; data?: { templates: Array<{ id: string; type: string }> } };
      expect(result.success, JSON.stringify(result)).toBe(true);
      const home = result.data!.templates.find((template) => template.type === "index");
      editorPath = `/store/${scope.storefrontId}/themes/${scope.themeId}/editor?templateId=${home!.id}`;
      const saved = await writeThemeFiles(page, scope, FILES);
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      const ensured = (await serverFn(page, THEMES, "ensureStorefrontThemeRouteTemplate", {
        ...scope,
        routePath: ROUTE_PATH,
      })) as { success: boolean };
      expect(ensured.success, JSON.stringify(ensured)).toBe(true);
    } finally {
      await page.context().close();
    }
  });

  test("keeps the frame while typing, then stores the text and reloads", async ({
    page,
    browser,
  }) => {
    test.setTimeout(360_000);
    const seen = watchRequests(page);
    const base = `Defer base ${Date.now()}`;
    const typed = " finished-after-the-update";
    await typingOnCanvas(page, base, typed);
    const savesBefore = seen.saves.length;
    const mark = randomUUID();
    await markFrame(page, mark);

    // Only content changed since this tab's start, so the other tab's start
    // lays the workspace out again without moving the source.
    await anotherTabStarts(browser);
    await heldAndTold(page, mark, base, typed);
    expect(seen.reasons.some((line) => line.startsWith("[preview-instance] reload deferred"))).toBe(
      true,
    );

    const stored = page.waitForResponse(
      (response) =>
        isServerFunctionCall(response.url(), "updateStorefrontThemeSectionProps") &&
        (response.request().postData() ?? "").includes(`${base}${typed}`),
      { timeout: 30_000 },
    );
    await page.keyboard.press("Enter");
    expect((await stored).ok()).toBe(true);
    await expect.poll(() => frameMark(page), { timeout: 30_000 }).not.toBe(mark);
    expect(seen.reasons.filter((line) => line.startsWith("[preview-instance] reload frame"))).toHaveLength(1);

    await expect(cardTitle(page)).toHaveText(`${base}${typed}`, { timeout: 30_000 });
    await expect(saveStatus(page)).toHaveAttribute("aria-label", /^(Unpublished|Published)$/, {
      timeout: 30_000,
    });
    expect(await storedTitle(page)).toBe(`${base}${typed}`);
    expect(
      seen.reasons.filter((line) => line.startsWith("[preview-instance] content replayed")),
    ).toHaveLength(1);
    expect(seen.saves.slice(savesBefore)).toHaveLength(1);
    expect(seen.starts).toBe(1);
  });

  test("keeps the text with the author when the source moved and the write is refused", async ({
    page,
    browser,
  }) => {
    test.setTimeout(360_000);
    const seen = watchRequests(page);
    const base = `Defer refused ${Date.now()}`;
    const typed = " typed-while-the-source-moved";
    await typingOnCanvas(page, base, typed);
    const savesBefore = seen.saves.length;
    const mark = randomUUID();
    await markFrame(page, mark);

    // The other tab saves an unrelated file first: the source moves.
    await anotherTabStarts(browser, async (other) => {
      const wrote = await writeThemeFiles(other, scope!, [
        { path: `src/defer/Unrelated${Date.now()}.tsx`, content: "export const unrelated = 1;\n" },
      ]);
      expect(wrote.success, JSON.stringify(wrote)).toBe(true);
    });
    await heldAndTold(page, mark, base, typed);

    const answered = page.waitForResponse(
      (response) =>
        isServerFunctionCall(response.url(), "updateStorefrontThemeSectionProps") &&
        (response.request().postData() ?? "").includes(`${base}${typed}`),
      { timeout: 30_000 },
    );
    await page.keyboard.press("Enter");
    expect(await (await answered).text()).toContain("SELECTION_SOURCE_CONFLICT");
    await expect.poll(() => frameMark(page), { timeout: 30_000 }).not.toBe(mark);

    // Not stored, not sent again, and the text still where the author can
    // take it from: the field, with the save marked failed.
    await expect(saveStatus(page)).toHaveAttribute("aria-label", /^Save failed/, {
      timeout: 15_000,
    });
    await expect(titleField(page)).toHaveValue(`${base}${typed}`);
    expect(await storedTitle(page)).toBe(base);
    // The new frame was given its content, and the refused input is not it.
    await expect
      .poll(
        () =>
          seen.reasons.filter((line) => line.startsWith("[preview-instance] content replayed"))
            .length,
        { timeout: 30_000 },
      )
      .toBe(1);
    await expect(cardTitle(page)).toHaveText(base);
    await page.waitForTimeout(5_000);
    expect(seen.saves.slice(savesBefore)).toHaveLength(1);
    expect(seen.starts).toBe(1);
  });
});
