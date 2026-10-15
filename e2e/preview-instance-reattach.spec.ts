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
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";

/**
 * A preview frame whose dev server another tab replaced on the same address.
 *
 * The order is forced rather than hoped for: another tab's preview start is
 * held in the browser until a declaration it reads has been deleted, so the
 * start lays the workspace out again without it and restarts Vite where this
 * tab's frame points. That frame still runs the modules the old instance
 * served, and the new instance has no hot update for a file written before
 * it started; this tab's next sync of that file is `unchanged`. Before the
 * frame was compared with the instance serving, the canvas kept the deleted
 * field for good (`content-fields-sidecar.spec.ts`, CI run 38557821587).
 *
 * What has to hold: this tab replaces its frame — and only its frame, with
 * no start of its own — once its sync names a later instance, and then
 * stays on the new one. The ready messages are read as the editor received
 * them: the first frame and the new one each name the instance that served
 * them, and the reload names exactly that difference. An edit waiting on the
 * server across the replacement stays one request and keeps its text. Once
 * released it is refused by the source version guard — the other tab changed
 * the source it was made against — without being sent again or rewriting the
 * stored field. The route's Document is made before the edit, so the held
 * edit is not also the write that creates it.
 * Local sidecar only: the instance is named there.
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
const DEFAULT_TITLE = "Reattach default title";
const ROUTE_PATH = "/preview-instance-reattach";
const RETURN_SLOT = "reattach-return";
const RETURN_SIDECAR = "src/reattach/ReattachReturn.fields.ts";
const KEPT_SLOT = "reattach-kept";

const component = (name: string) => [
  {
    path: `src/reattach/${name}.tsx`,
    content: `type ${name}Props = { title?: string };

export default function ${name}({ title = "${DEFAULT_TITLE}" }: ${name}Props) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{title}</h2>
    </section>
  );
}
`,
  },
  {
    path: `src/reattach/${name}.fields.ts`,
    content: `export const contentFields = {
  title: { type: "text", label: "${name} title" },
} as const;
`,
  },
];

const FILES = [
  {
    path: "src/routes/preview-instance-reattach.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import ReattachReturn from "../reattach/ReattachReturn";
import ReattachKept from "../reattach/ReattachKept";

export const Route = createFileRoute("${ROUTE_PATH}")({
  component: ReattachRoute,
});

function ReattachRoute() {
  return (
    <main>
      <ReattachReturn {...content("${RETURN_SLOT}")} />
      <ReattachKept {...content("${KEPT_SLOT}")} />
    </main>
  );
}
`,
  },
  ...component("ReattachReturn"),
  ...component("ReattachKept"),
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
      'preview-instance-reattach-${created.themeId}', '{"starterTemplateVersion":1}',
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

const cardTitle = (page: Page, slot: string) =>
  previewFrame(page).locator(
    `[data-storefront-section-id="${slot}"] [data-storefront-field="title"]`,
  );

const previewFrameOf = (page: Page): Frame | undefined =>
  page
    .frames()
    .find((frame) => frame.url().includes("__morph-theme-preview__"));

/** A mark set in the frame's own window: gone once the frame is replaced. */
async function frameMark(page: Page): Promise<string | null> {
  const frame = previewFrameOf(page);
  if (!frame) return null;
  return frame
    .evaluate(() =>
      String((window as { __reattachMark?: string }).__reattachMark ?? ""),
    )
    .catch(() => null);
}

async function markFrame(page: Page, mark: string) {
  const frame = previewFrameOf(page);
  expect(frame, "the tab has a preview frame").toBeDefined();
  await frame!.evaluate((id) => {
    (window as { __reattachMark?: string }).__reattachMark = id;
  }, mark);
}

const titleField = (page: Page, label: string) =>
  page
    .locator('[data-slot="inspector-content-field"]')
    .filter({ hasText: label })
    .locator("input");

type ReadyReport = {
  kind: string;
  instance?: { session: string; serial: number };
} | null;

/**
 * Runs in every document of the page; records, in the editor's own window
 * only, each ready message a preview frame posts to it, with what it says
 * about the instance that served it. Observation only: nothing is changed
 * about how the editor receives or checks the message.
 */
function recordReadyMessages() {
  if (window.top !== window) return;
  const reports: unknown[] = [];
  (window as unknown as { __readyReports: unknown[] }).__readyReports = reports;
  window.addEventListener("message", (event) => {
    const data = event.data as { type?: string; servedInstance?: unknown };
    if (data?.type === "morph:storefront-preview-ready") {
      reports.push(data.servedInstance ?? null);
    }
  });
}

const readyReports = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __readyReports?: ReadyReport[] }).__readyReports ??
      [],
  );

/** What the browser fires when the author switches back to this tab. */
async function returnToTab(page: Page) {
  await page.evaluate(() => {
    for (const state of ["hidden", "visible"]) {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => state,
      });
      window.dispatchEvent(new Event("visibilitychange"));
    }
  });
}

let routeDocumentId: string | null = null;

/** The stored editor read of this Theme, as the server answers it now. */
async function storedEditor(page: Page) {
  const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
    ...scope!,
  })) as {
    success: boolean;
    data?: {
      templates: Array<{
        id: string;
        routePath?: string | null;
        document: { sections: Array<{ id: string; props?: Record<string, unknown> }> };
      }>;
    };
  };
  expect(result.success, JSON.stringify(result)).toBe(true);
  return result.data!;
}

async function storedRouteDocumentId(page: Page) {
  const editor = await storedEditor(page);
  return (
    editor.templates.find((template) => template.routePath === ROUTE_PATH)?.id ??
    null
  );
}

test.describe("a preview frame whose server another tab replaced", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    try {
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
      // The route's own Document, made and read back before any edit: the
      // held edit below must not be the write that creates it, which changes
      // the Inspector's template under the typed text (tracked separately).
      const ensured = (await serverFn(
        page,
        THEMES,
        "ensureStorefrontThemeRouteTemplate",
        { ...scope, routePath: ROUTE_PATH },
      )) as { success: boolean; data?: { id: string } };
      expect(ensured.success, JSON.stringify(ensured)).toBe(true);
      routeDocumentId = ensured.data!.id;
      expect(await storedRouteDocumentId(page)).toBe(routeDocumentId);
    } finally {
      await page.context().close();
    }
  });

  test("reloads only its frame, once, and shows what the new server serves", async ({
    page,
    browser,
  }) => {
    test.setTimeout(360_000);
    const starts: string[] = [];
    page.on("request", (request) => {
      if (isServerFunctionCall(request.url(), "startThemePreviewServer")) {
        starts.push(request.url());
      }
    });
    const reloads: string[] = [];
    page.on("console", (message) => {
      if (message.text().startsWith("[preview-instance] reload frame")) {
        reloads.push(message.text());
      }
    });

    // Preparation is counted apart from the held edit: before the hold,
    // nothing may be waiting or on its way, and no write may create the
    // route's Document at any point.
    let preparing = true;
    const preparationSaves: string[] = [];
    const routeDocumentCreations: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (isServerFunctionCall(url, "ensureStorefrontThemeRouteTemplate")) {
        routeDocumentCreations.push(url);
      }
      if (
        preparing &&
        isServerFunctionCall(url, "updateStorefrontThemeSectionProps")
      ) {
        preparationSaves.push(url);
      }
    });

    // What each frame's page said served it, as the editor received it.
    await page.addInitScript(recordReadyMessages);

    await page.goto(routeUrl(), { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    await expect(cardTitle(page, RETURN_SLOT)).toBeVisible({ timeout: 90_000 });
    if (
      await page
        .getByRole("button", { name: "Enable section selection" })
        .isVisible()
        .catch(() => false)
    ) {
      await enableSelection(page);
    }
    const target = cardTitle(page, KEPT_SLOT);
    await target.scrollIntoViewIfNeeded();
    expect(await clickExposedElement(page, target)).not.toBeNull();
    await openContentTab(page);
    const firstMark = randomUUID();
    await markFrame(page, firstMark);
    expect(starts).toHaveLength(1);
    const [firstReady] = await readyReports(page);
    expect(firstReady, "the first frame named the instance that served it").toMatchObject({
      kind: "known",
    });
    const servedFirst = firstReady!.instance!;

    // Settled before the hold: no edit waiting or in flight, and the route's
    // Document the one made and read back above.
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      /^(Unpublished|Published)$/,
    );
    expect(preparationSaves).toEqual([]);
    expect(await storedRouteDocumentId(page)).toBe(routeDocumentId);
    preparing = false;

    // An edit of the field that keeps its declaration, waiting on the server
    // across the replacement: held here, released once the frame is new.
    const pending = `Pending across the reload ${Date.now()}`;
    const contentSaves: string[] = [];
    const heldTargets: boolean[] = [];
    let saveHeld!: () => void;
    const saveIsHeld = new Promise<void>((resolve) => (saveHeld = resolve));
    let releaseSave!: () => void;
    const saveReleased = new Promise<void>((resolve) => (releaseSave = resolve));
    await page.route("**/_serverFn/**", async (route) => {
      const request = route.request();
      if (
        !isServerFunctionCall(request.url(), "updateStorefrontThemeSectionProps") ||
        !(request.postData() ?? "").includes(pending)
      ) {
        return route.fallback();
      }
      contentSaves.push(request.url());
      heldTargets.push((request.postData() ?? "").includes(routeDocumentId!));
      saveHeld();
      await saveReleased;
      return route.continue();
    });
    const field = titleField(page, "ReattachKept title");
    await expect(field).toBeVisible();
    await field.fill(pending);
    await field.press("Tab");
    await saveIsHeld;
    // Sent to the route's existing Document, not through a placeholder.
    expect(heldTargets).toEqual([true]);
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      "Saving…",
    );
    await expect(field).toHaveValue(pending);

    // The other tab: its preview start is held until the delete has landed.
    const other = await signedInPage(browser);
    try {
      let held!: () => void;
      const startHeld = new Promise<void>((resolve) => (held = resolve));
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      await other.route("**/_serverFn/**", async (route) => {
        if (
          !isServerFunctionCall(route.request().url(), "startThemePreviewServer")
        ) {
          return route.fallback();
        }
        held();
        await released;
        return route.continue();
      });
      await other.goto(routeUrl(), { waitUntil: "domcontentloaded" });
      await Promise.race([
        startHeld,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("the other tab sent no preview start")),
            60_000,
          ),
        ),
      ]);

      const removed = await removeThemeFiles(other, scope!, [RETURN_SIDECAR]);
      expect(removed.success, JSON.stringify(removed)).toBe(true);

      const answered = other.waitForResponse(
        (response) =>
          isServerFunctionCall(response.url(), "startThemePreviewServer"),
        { timeout: 120_000 },
      );
      release();
      expect((await answered).status()).toBe(200);
    } finally {
      await other.context().close();
    }

    // Back on this tab, its sync reaches the replaced server: the frame is
    // replaced and shows the component without its deleted declaration.
    await expect(async () => {
      await returnToTab(page);
      await expect(cardTitle(page, RETURN_SLOT)).toHaveCount(0, {
        timeout: 5_000,
      });
    }).toPass({ timeout: 120_000, intervals: [5_000] });
    expect(await frameMark(page)).not.toBe(firstMark);
    await expect(cardTitle(page, KEPT_SLOT)).toHaveCount(1);
    // The author's text is in the field across the replacement, the edit is
    // still the one request, waiting, and nothing was started.
    await expect(field).toHaveValue(pending);
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      "Saving…",
    );
    expect(contentSaves).toHaveLength(1);
    expect(starts).toHaveLength(1);

    // The new frame was served by the new instance — a later start of the
    // same sidecar — and the reload says it was that difference.
    await expect.poll(async () => (await readyReports(page)).length).toBe(2);
    const [, secondReady] = await readyReports(page);
    expect(secondReady, "the new frame named the instance that served it").toMatchObject({
      kind: "known",
      instance: { session: servedFirst.session },
    });
    const servedSecond = secondReady!.instance!;
    expect(servedSecond.serial).toBeGreaterThan(servedFirst.serial);
    expect(reloads).toEqual([
      `[preview-instance] reload frame | served by ${servedFirst.session}.${servedFirst.serial}, serving ${servedSecond.session}.${servedSecond.serial}`,
    ]);
    // Still so once the new frame has reported.
    expect(starts).toHaveLength(1);
    expect(contentSaves).toHaveLength(1);
    await expect(field).toHaveValue(pending);

    // Released, it is refused: it was made against the source the other
    // tab has since changed. The text stays, nothing is sent again, and
    // the stored field is not rewritten.
    const answered = page.waitForResponse(
      (response) =>
        isServerFunctionCall(response.url(), "updateStorefrontThemeSectionProps") &&
        (response.request().postData() ?? "").includes(pending),
      { timeout: 30_000 },
    );
    releaseSave();
    expect(await (await answered).text()).toContain("SELECTION_SOURCE_CONFLICT");
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      /^Save failed/,
    );
    await expect(
      page
        .getByText(/The source code has changed\. Select the field again/)
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(field).toHaveValue(pending);
    expect(contentSaves).toHaveLength(1);
    const stored = await storedEditor(page);
    const keptStored = stored.templates
      .find((template) => template.id === routeDocumentId)
      ?.document.sections.find((section) => section.id === KEPT_SLOT);
    expect(keptStored?.props?.title).not.toBe(pending);
    expect(JSON.stringify(stored)).not.toContain(pending);

    // And it stays there: no second reload, and no start from this tab.
    const secondMark = randomUUID();
    await markFrame(page, secondMark);
    await returnToTab(page);
    await page.waitForTimeout(20_000);
    expect(await frameMark(page)).toBe(secondMark);
    expect(reloads).toHaveLength(1);
    expect(await readyReports(page)).toHaveLength(2);
    expect(starts).toHaveLength(1);
    expect(contentSaves).toHaveLength(1);
    await expect(field).toHaveValue(pending);
    expect(routeDocumentCreations).toEqual([]);
  });
});
