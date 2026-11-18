import {
  expect,
  test,
  type Browser,
  type Frame,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  isServerFunctionCall,
  openContentTab,
  openEditor,
  previewFrame,
} from "./helpers";
import {
  MARKER,
  execLocalD1,
  heroContentField,
} from "./helpers/editor-writes-paused";
import { isSidecarSwapRun, requestSidecarSwap } from "./helpers/sidecar-swap";
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
  execLocalD1(`INSERT INTO storefront_themes
    (id, storefront_id, name, metadata, created_at, updated_at)
    VALUES ('${created.themeId}', '${created.storefrontId}',
      'preview-instance-reattach-${created.themeId}', '{"starterTemplateVersion":1}',
      '${now}', '${now}');`);
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

/**
 * The frame in the editor's preview iframe now: the element `previewFrame`
 * reads, found the way the other preview specs find it. Not by URL, which
 * differs by runtime (the client dev server's base path is not Start's).
 */
async function previewFrameOf(page: Page): Promise<Frame | undefined> {
  const handle = await page.locator("iframe").first().elementHandle();
  return (await handle?.contentFrame()) ?? undefined;
}

/** A mark set in the frame's own window: gone once the frame is replaced. */
async function frameMark(page: Page): Promise<string | null> {
  const frame = await previewFrameOf(page);
  if (!frame) return null;
  return frame
    .evaluate(() =>
      String((window as { __reattachMark?: string }).__reattachMark ?? ""),
    )
    .catch(() => null);
}

async function markFrame(page: Page, mark: string) {
  const frame = await previewFrameOf(page);
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

type SwapReady = {
  at: number;
  previewDocument: string;
  ack: boolean;
  served: string;
};
type SwapAck = { at: number; previewDocument: string; status: string };

/**
 * Records, in the editor's own window only, each ready and acknowledgement
 * a preview frame posts to it. Observation only.
 */
function recordSwapMessages() {
  if (window.top !== window) return;
  const state = { readies: [] as SwapReady[], acks: [] as SwapAck[] };
  (window as unknown as { __swapMessages: typeof state }).__swapMessages = state;
  window.addEventListener("message", (event) => {
    const data = event.data as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return;
    const previewDocument =
      typeof data.previewDocument === "string" ? data.previewDocument : "";
    if (data.type === "morph:storefront-preview-ready") {
      const served = data.servedInstance as
        | { kind?: string; instance?: { session?: string; serial?: number } }
        | null
        | undefined;
      state.readies.push({
        at: Date.now(),
        previewDocument,
        ack:
          Array.isArray(data.capabilities) &&
          data.capabilities.includes("section-presentation-ack-v1"),
        served:
          served?.kind === "known"
            ? `known:${served.instance?.session}.${served.instance?.serial}`
            : (served?.kind ?? (served === null ? "null" : "none")),
      });
    } else if (data.type === "morph:storefront-preview-section-presentation-ack") {
      state.acks.push({
        at: Date.now(),
        previewDocument,
        status: typeof data.status === "string" ? data.status : "",
      });
    }
  });
}

const swapMessages = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __swapMessages?: { readies: SwapReady[]; acks: SwapAck[] } })
        .__swapMessages ?? { readies: [], acks: [] },
  );

/** The server function a request calls, read from its id; null for others. */
function serverFunctionName(url: string): string | null {
  const id = url.split("/_serverFn/")[1]?.split(/[/?]/)[0];
  if (!id) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { export?: string };
    return (decoded.export ?? "").replace(/_createServerFn_handler$/, "") || null;
  } catch {
    return null;
  }
}

/**
 * A numeric field of a server function's serialized body, wherever it is:
 * the body is a tree of `{ p: { k: [...keys], v: [...values] } }` nodes.
 */
function serializedNumber(body: string, key: string): number | null {
  let found: number | null = null;
  const visit = (node: unknown) => {
    if (found !== null || !node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const props = record.p as { k?: unknown[]; v?: unknown[] } | undefined;
    if (props && Array.isArray(props.k) && Array.isArray(props.v)) {
      const index = props.k.indexOf(key);
      if (index >= 0) {
        const value = props.v[index] as { s?: unknown } | number | undefined;
        if (typeof value === "number") found = value;
        else if (value && typeof value.s === "number") found = value.s;
        else if (value && typeof value.s === "string" && /^\d+$/.test(value.s)) found = Number(value.s);
      }
    }
    for (const value of Object.values(record)) visit(value);
  };
  try {
    visit(JSON.parse(body));
  } catch {
    const match = new RegExp(`"${key}"\\D{0,12}(\\d+)`).exec(body);
    if (match) found = Number(match[1]);
  }
  return found;
}

/**
 * The real swap: the run's first sidecar comes from another checkout (main),
 * whose bridge cannot acknowledge and whose service reports no serving
 * bridge; mid-test the runner replaces it with this checkout's. Nothing is
 * routed or rewritten and no tab is opened: the editor stays on one page and
 * what it, the frame and Vite say is only listened to.
 *
 * Before the swap the author changes a field and leaves it, so the change is
 * a committed edit the old frame cannot acknowledge. After the swap the run
 * waits, without acting, for whatever reloads the frame; if nothing does,
 * the author presses the editor's own Reload button, and that is recorded
 * as what recovered the frame. The case is judged on what the trace shows:
 * one reload, a new frame that acknowledges, the text kept, the edit
 * written at most once.
 *
 * Runs only in the runner's swap mode; every other run, CI's included,
 * skips it.
 */
test.describe("a real sidecar swap under an open editor", () => {
  test.skip(
    !isSidecarSwapRun(),
    "Only in the e2e runner's sidecar swap mode (MORPH_E2E_SIDECAR_SWAP_FROM), which CI never sets.",
  );

  test("after the old sidecar is replaced, the frame reloads once, acknowledges, and the author's edit is kept and written once", async ({
    page,
  }) => {
    test.setTimeout(480_000);
    const t0 = Date.now();
    const rel = (at: number) => `+${at - t0}ms`;
    const timeline: string[] = [];
    const note = (line: string) => {
      const entry = `${rel(Date.now())} ${line}`;
      timeline.push(entry);
      console.log(`[real swap] ${entry}`);
    };
    let swappedAt = Number.POSITIVE_INFINITY;
    const lines: Array<{ at: number; text: string; from: string }> = [];
    page.on("console", (message) => {
      const text = message.text();
      if (!text.startsWith("[preview-") && !text.includes("[vite]")) return;
      let from = "?";
      try {
        from = new URL(message.location().url).host || "?";
      } catch {
        /* No location. */
      }
      lines.push({ at: Date.now(), text, from });
      note(`console from ${from}: ${text}`);
    });
    const navigations: Array<{ at: number; url: string }> = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        note(`editor page navigated ${frame.url()}`);
        return;
      }
      navigations.push({ at: Date.now(), url: frame.url() });
      note(`frame navigated ${frame.url()}`);
    });
    const startAnswers: Array<{ at: number; servingBridge: boolean }> = [];
    let marker = "";
    const writes: Array<{
      at: number;
      name: string;
      carriesMarker: boolean;
      expectedDraftGeneration: number | null;
    }> = [];
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      const name = serverFunctionName(request.url());
      if (!name) return;
      if (/^(save|update|publish|delete|create|restore|write|reset|remove|rename|move|upload|promote|apply|set|ensure)[A-Z]/.test(name)) {
        const body = request.postData() ?? "";
        const entry = {
          at: Date.now(),
          name,
          carriesMarker: marker !== "" && body.includes(marker),
          expectedDraftGeneration: serializedNumber(body, "expectedDraftGeneration"),
        };
        writes.push(entry);
        note(`write sent ${JSON.stringify(entry)}`);
      } else if (name === "startThemePreviewServer" || name === "touchThemePreviewServer") {
        note(`${name} sent`);
      }
    });
    page.on("response", (response) => {
      const name = serverFunctionName(response.url());
      if (!name) return;
      if (name === "startThemePreviewServer" || name === "touchThemePreviewServer") {
        void response.text().then(
          (body) => {
            const servingBridge = body.includes("servingBridge");
            if (name === "startThemePreviewServer") startAnswers.push({ at: Date.now(), servingBridge });
            note(
              `${name} answered ${response.status()}: servingBridge ${servingBridge}, ack capability ${body.includes("section-presentation-ack-v1")}, servedInstance ${body.includes("servedInstance")}`,
            );
          },
          () => note(`${name} answered ${response.status()}, body unreadable`),
        );
      } else if (writes.some((write) => write.name === name)) {
        void response.text().then(
          (body) => note(`${name} answered ${response.status()}: ${body.slice(0, 300)}`),
          () => note(`${name} answered ${response.status()}`),
        );
      }
    });
    await page.addInitScript(recordSwapMessages);

    // The editor on the old sidecar.
    await openEditor(page);
    await expect
      .poll(async () => (await swapMessages(page)).readies.length, { timeout: 120_000 })
      .toBeGreaterThan(0);
    await expect
      .poll(() => lines.filter((line) => line.text.startsWith("[preview-bridge]")).length, {
        timeout: 60_000,
      })
      .toBeGreaterThan(0)
      .catch(() => note("the editor said nothing about the old frame's bridge"));
    const before = await swapMessages(page);
    note(`before the swap: readies ${JSON.stringify(before.readies.map((r) => ({ ...r, at: rel(r.at) })))}`);
    expect(before.readies.every((ready) => !ready.ack), "the old bridge cannot acknowledge").toBe(true);
    expect(startAnswers.length).toBeGreaterThan(0);
    expect(
      startAnswers.every((answer) => !answer.servingBridge),
      "the old service reports no serving bridge",
    ).toBe(true);

    // The author's edit, committed by leaving the field.
    const field = await heroContentField(page, 0);
    const original = await field.inputValue();
    marker = `${MARKER} real swap ${Date.now()}`;
    await field.fill(marker);
    await field.press("Tab");
    await expect(field).toHaveValue(marker);
    note(`edited and left the field; writes so far ${JSON.stringify(writes)}`);
    const frameBefore = await page.locator("iframe").first().elementHandle();
    expect(frameBefore, "the editor shows a preview frame").not.toBeNull();
    const pausedBefore = await page
      .getByText(/Content writes are paused/)
      .first()
      .isVisible()
      .catch(() => false);
    note(`writes-paused notice before the swap: ${pausedBefore}`);

    // The runner swaps the sidecar.
    note("requesting the swap");
    const done = await requestSidecarSwap();
    swappedAt = Date.now();
    note(`swap done: ${JSON.stringify(done)}`);

    // Whatever reloads the frame, on its own.
    const newReadies = async () =>
      (await swapMessages(page)).readies.filter((ready) => ready.at > swappedAt);
    let authorReloaded = false;
    try {
      await expect.poll(async () => (await newReadies()).length, { timeout: 150_000 }).toBeGreaterThan(0);
    } catch {
      note("no new frame within 150 s of the swap; the author presses the editor's Reload button");
      const alert = page.getByTestId("preview-presentation-unconfirmable");
      const button = alert.getByRole("button");
      note(
        `alert visible ${await alert.isVisible().catch(() => false)}, button ${await button.textContent().catch(() => null)}`,
      );
      authorReloaded = true;
      note("author clicks Reload");
      await button.click();
      await expect.poll(async () => (await newReadies()).length, { timeout: 150_000 }).toBeGreaterThan(0);
    }
    await expect
      .poll(async () => (await newReadies()).some((ready) => ready.ack), { timeout: 120_000 })
      .toBe(true);
    const newDocument = (await newReadies()).find((ready) => ready.ack)!.previewDocument;
    // The edit continues on the new frame, if it was waiting for one.
    await expect
      .poll(() => writes.filter((write) => write.carriesMarker).length, { timeout: 45_000 })
      .toBeGreaterThan(0)
      .catch(() => note("no write of the edit within 45 s of the new frame"));
    await expect
      .poll(
        async () =>
          (await swapMessages(page)).acks.some(
            (ack) => ack.previewDocument === newDocument && ack.status === "applied",
          ),
        { timeout: 45_000 },
      )
      .toBe(true)
      .catch(() => note("no applied acknowledgement from the new frame within 45 s"));
    await expect(field).toHaveValue(marker);

    const sameElement = await page
      .evaluate((element) => element === document.querySelector("iframe"), frameBefore!)
      .catch(() => false);
    const originalConnected = await frameBefore!
      .evaluate((element) => element.isConnected)
      .catch(() => false);
    const final = await swapMessages(page);
    const after = final.readies.filter((ready) => ready.at > swappedAt);
    const firstNew = after[0];
    const markerWrites = writes.filter((write) => write.carriesMarker);
    const appliedOnNew = final.acks.filter(
      (ack) => ack.previewDocument === newDocument && ack.status === "applied",
    );
    const summary = {
      swap: done,
      authorReloaded,
      firstNewReadyAt: firstNew ? rel(firstNew.at) : null,
      linesFromSwapToFirstNewReady: lines
        .filter((line) => line.at > swappedAt && (!firstNew || line.at <= firstNew.at))
        .map((line) => `${rel(line.at)} ${line.from} ${line.text}`),
      frameNavigationsAfterSwap: navigations
        .filter((navigation) => navigation.at > swappedAt)
        .map((navigation) => `${rel(navigation.at)} ${navigation.url}`),
      readies: final.readies.map((ready) => ({ ...ready, at: rel(ready.at) })),
      newDocumentsAfterSwap: [...new Set(after.map((ready) => ready.previewDocument))],
      acksOnNewDocument: appliedOnNew.map((ack) => rel(ack.at)),
      markerWrites: markerWrites.map((write) => ({ ...write, at: rel(write.at) })),
      writes: writes.map((write) => ({ ...write, at: rel(write.at) })),
      writesPausedBeforeSwap: pausedBefore,
      sameFrameElement: sameElement,
      originalElementConnected: originalConnected,
    };
    console.log(`[real swap] summary ${JSON.stringify(summary)}`);
    test.info().annotations.push(
      { type: "real swap summary", description: JSON.stringify(summary) },
      { type: "real swap timeline", description: timeline.join("\n") },
    );

    // Put the field back, as the other cases do.
    await field.fill(original);
    await field.press("Tab");
    await expect(field).toHaveValue(original);

    // Judged on the trace: one new frame, which acknowledges; the author's
    // text kept; the edit written at most once, and acknowledged on the new
    // frame when it was written after it.
    expect(summary.newDocumentsAfterSwap, "the frame reloaded exactly once").toHaveLength(1);
    expect(after.some((ready) => ready.ack), "the new frame can acknowledge").toBe(true);
    expect(markerWrites.length, "the edit was never sent twice").toBeLessThanOrEqual(1);
    if (markerWrites.length === 1 && firstNew && markerWrites[0].at > firstNew.at) {
      expect(appliedOnNew.length, "the new frame acknowledged the edit").toBeGreaterThan(0);
    }
  });
});
