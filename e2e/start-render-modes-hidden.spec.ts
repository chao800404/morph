import { randomUUID } from "node:crypto";

import { expect, test, type Frame, type Page } from "@playwright/test";

import { queryLifecycleD1 } from "../scripts/verify-published-artifact.mjs";
import {
  RENDER_MODES,
  RENDER_MODE_RELEASE_PATH,
  RENDER_MODES_FILES,
  renderModeDefault,
  renderModePath,
  renderModeRendered,
  renderModeSlot,
  type RenderMode,
  type RenderModeKind,
} from "../src/lib/storefront/compat/render-modes-theme";
import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  isServerFunctionCall,
  previewFrame,
} from "./helpers";
import { execLocalD1 } from "./helpers/editor-writes-paused";
import {
  RECORDED_PREVIEW_RUNTIME,
  verifyRecordedThemePreviewRuntime,
} from "./helpers/recorded-preview-runtime";
import { insertThrowawayTheme } from "./helpers/throwaway-theme";
import {
  DOMAINS,
  THEMES,
  latestRelease,
  openEditor,
  publishShowingRelease,
  serverFn,
  signedInPage,
  storefrontFetcher,
  storefrontHarness,
} from "./native-acceptance";
import {
  themeScopeFromEditorPath,
  themeSourceGeneration,
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";

/**
 * Render-mode evidence (handoff/2026-11-28/start-render-modes-audit.md,
 * "Codex review — adopted", items 1 and 2). Tests only: it records how each
 * TanStack Start render mode behaves in Morph with the hidden-section rule
 * as its main assertion. A hidden section is absent from the preview's and
 * the published site's output in every mode — the raw HTML as it streams,
 * the serialized router state in it, every `/_serverFn` answer, and the
 * hydrated DOM after a direct load, a reload, a client navigation and Back —
 * while the visible sections (the controls) are there, nothing crashes and
 * no author guard refuses the hide.
 *
 * The Theme is this spec's own: Starter 32 as the editor provisions it (root
 * route, layout and content module untouched), plus the fixture in
 * src/lib/storefront/compat/render-modes-theme.ts: one route per mode
 * (`/rm-ssr` full SSR, `/rm-off` `ssr: false`, `/rm-data` `ssr:
 * "data-only"`, `/rm-fn` an `ssr()` function, on the server by default and
 * on the client for `?render=client`, and `/rm-defer` with a controlled
 * `<Await>`), each with a shown and a hidden section read through
 * `content()` and a shown and a hidden section read from the route's loader
 * (inside `<Await>` on `/rm-defer`). Every hidden section is first given an
 * author value, then hidden; the layout's Footer the same way, and the
 * Header is given a value as the layout's visible control. Sentinels: the
 * stored values (this run's), each component's own default, and the
 * attribute only a rendered section carries.
 *
 * Cases, serial, each building on the one before:
 *
 *   1. the Live Preview in a tab of its own (its own preview grant): each
 *      route's direct load and reload, the HTML read as it streams;
 *   2. in the same tab, client navigation through every route and Back,
 *      every `/_serverFn` answer recorded;
 *   3. in the editor: selection, Hide and Show on each route, and on
 *      `/rm-defer` how long the bridge is unavailable while the deferred
 *      value is held (recorded as an annotation; no threshold);
 *   4. the isolated Build Preview (`bp-` host): each route's HTML and
 *      hydrated DOM, and the build's content answers;
 *   5. publish (every route, SSR), then the public site through Core: each
 *      route's HTML, the content answers, and a visitor's direct load,
 *      reload, client navigation and Back.
 *
 * A held deferred value is released by `GET /api/rm-release` on the origin
 * that holds it; until then `/rm-defer` streams its shell and a fallback.
 *
 * Containers only, and the full Start preview only: publishing builds in
 * the Sandbox container, the preview and Build Preview hosts are fronted by
 * containers, and Starter 32 reads through `createServerFn`. It moves the
 * storefront's active release to this Theme's.
 */

const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
const PREVIEW_RUNTIME = process.env.MORPH_E2E_PREVIEW_RUNTIME;

test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Run through scripts/run-editor-e2e.mjs: this reads and writes the run's own D1 and R2.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "Builds, publishes and the pv- and bp- hosts run in containers (MORPH_E2E_TRANSPORT=cloudflare-sandbox).",
);
test.skip(
  PREVIEW_RUNTIME !== "start",
  "Render modes are TanStack Start's, which only the full Start preview runs; run with MORPH_E2E_PREVIEW_RUNTIME=start.",
);

const PREVIEW_SERVER =
  "/src/server/storefront/storefront-theme-preview-server.serverFn.ts";
const HOST = "rm-start.localhost";

const RUN = randomUUID().slice(0, 8);
const HEADER = "starter-header";
const FOOTER = "starter-footer";
const HEADER_MARKER = `rm-header-${RUN}`;
const FOOTER_MARKER = `rm-footer-${RUN}`;
/** Footer's component default (starter-theme-v3-files.ts). */
const FOOTER_DEFAULT = "© Online Store";

const SHOWN_KINDS = ["shown", "loadshown"] as const;
const HIDDEN_KINDS = ["hidden", "loadhidden"] as const;
const stored = (mode: RenderMode, kind: RenderModeKind) =>
  `rm-stored-${mode}-${kind}-${RUN}`;

/** One page a case loads: a route, and for `/rm-fn` which branch. */
type Visit = { mode: RenderMode; path: string; label: string; server: boolean };
/**
 * Every route once, and `/rm-fn` on both branches of its `ssr()` function.
 * `server`: whether the route's component renders on the server.
 */
const VISITS: readonly Visit[] = [
  { mode: "ssr", path: "/rm-ssr", label: "full SSR", server: true },
  { mode: "off", path: "/rm-off", label: "ssr: false", server: false },
  { mode: "data", path: "/rm-data", label: "ssr: data-only", server: false },
  { mode: "fn", path: "/rm-fn", label: "ssr() → true", server: true },
  {
    mode: "fn",
    path: "/rm-fn?render=client",
    label: "ssr() → false",
    server: false,
  },
  { mode: "defer", path: "/rm-defer", label: "deferred <Await>", server: true },
];

/** Every sentinel a hidden section of `mode`, or the hidden Footer, could leave. */
function hiddenSentinels(mode: RenderMode): string[] {
  return [
    ...HIDDEN_KINDS.flatMap((kind) => [
      stored(mode, kind),
      renderModeDefault(mode, kind),
      renderModeRendered(mode, kind),
    ]),
    FOOTER_MARKER,
    FOOTER_DEFAULT,
    "<footer",
  ];
}

/** Text of an answer that must hold no hidden sentinel of any route. */
function expectNoHiddenSentinel(text: string, where: string) {
  for (const mode of RENDER_MODES) {
    for (const sentinel of hiddenSentinels(mode)) {
      expect(text, `${where}: no ${sentinel}`).not.toContain(sentinel);
    }
  }
}

/**
 * A route's whole HTML document. Hidden: no sentinel anywhere, the
 * serialized router state included. Shown: the stored values are in the
 * serialized state (the root's content, and the loader's data when the
 * loader ran on the server); a server-rendered route also renders them.
 */
function expectRouteHtml(html: string, visit: Visit, where: string) {
  expectNoHiddenSentinel(html, where);
  expect(html, `${where}: the serialized router state`).toContain("$_TSR");
  expect(html, `${where}: the layout's shown Header value`).toContain(
    HEADER_MARKER,
  );
  expect(html, `${where}: the shown content() value`).toContain(
    stored(visit.mode, "shown"),
  );
  for (const kind of SHOWN_KINDS) {
    expect(html, `${where}: not the shown ${kind} default`).not.toContain(
      renderModeDefault(visit.mode, kind),
    );
  }
  if (visit.server) {
    expect(html, `${where}: the shown section is server-rendered`).toContain(
      renderModeRendered(visit.mode, "shown"),
    );
  } else {
    // Rendered in the browser: no section markup in the server's HTML.
    expect(html, `${where}: rendered in the browser`).not.toContain(
      renderModeRendered(visit.mode, "shown"),
    );
  }
}

/** The same, in the hydrated DOM. */
async function expectRouteDom(target: Page | Frame, visit: Visit) {
  const where = `${visit.label} DOM`;
  await expect(
    target.locator(`main[data-rm-page="${visit.mode}"]`),
    where,
  ).toBeVisible({ timeout: 90_000 });
  for (const kind of SHOWN_KINDS) {
    await expect(
      target.locator(`[${renderModeRendered(visit.mode, kind)}]`),
      `${where}: ${kind} rendered`,
    ).toHaveCount(1, { timeout: 60_000 });
    await expect(
      target.getByText(stored(visit.mode, kind)).first(),
      `${where}: ${kind} stored value`,
    ).toBeVisible();
    await expect(target.getByText(renderModeDefault(visit.mode, kind))).toHaveCount(0);
  }
  for (const kind of HIDDEN_KINDS) {
    await expect(
      target.locator(`[${renderModeRendered(visit.mode, kind)}]`),
      `${where}: ${kind} not rendered`,
    ).toHaveCount(0);
    await expect(target.getByText(stored(visit.mode, kind))).toHaveCount(0);
    await expect(target.getByText(renderModeDefault(visit.mode, kind))).toHaveCount(0);
  }
  await expect(target.getByText(HEADER_MARKER).first(), `${where}: Header`).toBeVisible();
  await expect(target.locator("footer"), `${where}: no Footer`).toHaveCount(0);
  await expect(target.getByText(FOOTER_DEFAULT)).toHaveCount(0);
  await expect(target.getByText(FOOTER_MARKER)).toHaveCount(0);
  const text = await target.locator("body").innerText();
  expectNoHiddenSentinel(text, `${where} text`);
}

type Streamed = {
  status: number;
  chunks: string[];
  /** Index of the first chunk read after the release; -1 if none was needed. */
  releasedAt: number;
};

/**
 * Reads `path` from inside `target` (its origin, its cookies) chunk by
 * chunk. When a chunk shows the deferred fallback, the held value is
 * released before the next read, so what streamed before is known.
 */
async function streamedIn(target: Page | Frame, path: string): Promise<Streamed> {
  return target.evaluate(
    async ({ path, releasePath }) => {
      const response = await fetch(path, { cache: "no-store" });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];
      let releasedAt = -1;
      for (;;) {
        if (releasedAt < 0 && chunks.join("").includes("rm-defer-pending")) {
          for (let attempt = 0; attempt < 50; attempt += 1) {
            const answer = (await (
              await fetch(releasePath, { cache: "no-store" })
            ).json()) as { released: number };
            if (answer.released > 0) break;
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
          releasedAt = chunks.length;
        }
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value, { stream: true }));
      }
      return { status: response.status, chunks, releasedAt };
    },
    { path, releasePath: RENDER_MODE_RELEASE_PATH },
  );
}

/** The streamed document, held to the route's sentinels chunk by chunk. */
function expectStreamed(streamed: Streamed, visit: Visit, where: string) {
  expect(streamed.status, `${where}: status`).toBe(200);
  for (const [index, chunk] of streamed.chunks.entries()) {
    expectNoHiddenSentinel(chunk, `${where} chunk ${index}`);
  }
  const html = streamed.chunks.join("");
  expectRouteHtml(html, visit, where);
  if (visit.mode === "defer") {
    // The shell and the fallback streamed before the release; the deferred
    // sections only after it.
    expect(streamed.releasedAt, `${where}: the value was held`).toBeGreaterThan(0);
    const before = streamed.chunks.slice(0, streamed.releasedAt).join("");
    expect(before, `${where}: shell before release`).toContain("rm-defer-shell");
    expect(before, `${where}: no deferred section before release`).not.toContain(
      renderModeRendered("defer", "loadshown"),
    );
    expect(html, `${where}: the deferred shown section after release`).toContain(
      renderModeRendered("defer", "loadshown"),
    );
  } else {
    expect(streamed.releasedAt, `${where}: nothing was held`).toBe(-1);
  }
}

/**
 * Lets a held `/rm-defer` document go from a second tab on the same origin
 * (the first is still loading it). Waits until a held value was released.
 */
async function releaseFromSecondTab(target: Page, origin: string) {
  const helper = await target.context().newPage();
  try {
    await expect
      .poll(
        async () => {
          const response = await helper.goto(`${origin}${RENDER_MODE_RELEASE_PATH}`);
          return ((await response!.json()) as { released: number }).released;
        },
        { timeout: 60_000, message: "a held deferred value was released" },
      )
      .toBeGreaterThan(0);
  } finally {
    await helper.close();
  }
}

/** One `/_serverFn` exchange a page made, as the browser saw it. */
type ServerFnCall = { url: string; method: string; status: number; body: string };

function recordReads(target: Page, origin: () => string | null) {
  const calls: ServerFnCall[] = [];
  const errors: string[] = [];
  target.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.origin !== origin() || !url.pathname.startsWith("/_serverFn")) return;
    calls.push({
      url: response.url(),
      method: response.request().method(),
      status: response.status(),
      body: await response.text().catch(() => ""),
    });
  });
  target.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  target.on("pageerror", (error) => errors.push(error.message));
  return { calls, errors };
}

function expectNoCrash(errors: readonly string[], where: string) {
  expect(
    errors.filter((text) =>
      /hydrat|did not match|mismatch|MorphContentError|invalid_content_origin|no_content_source|store_error|No StartEvent/i.test(
        text,
      ),
    ),
    `${where}: ${errors.join("\n")}`,
  ).toEqual([]);
}

async function waitForRouter(target: Page | Frame) {
  await expect
    .poll(
      () =>
        target.evaluate(
          () =>
            Boolean((window as unknown as { __TSR_ROUTER__?: unknown }).__TSR_ROUTER__) &&
            document.readyState === "complete",
        ),
      { timeout: 90_000, message: "Start's client router is running" },
    )
    .toBe(true);
}

async function markDocument(target: Page): Promise<string> {
  const token = randomUUID();
  await target.evaluate((token) => {
    (window as unknown as { __rmDocument?: string }).__rmDocument = token;
  }, token);
  return token;
}

async function sameDocument(target: Page, token: string) {
  return (
    (await target.evaluate(
      () => (window as unknown as { __rmDocument?: string }).__rmDocument,
    )) === token
  );
}

/** Navigates in-site with Start's own router, as a `<Link>` does. */
async function navigateInSite(target: Page, to: string) {
  const url = new URL(to, "http://placeholder");
  await target.evaluate(
    async ({ pathname, search }) => {
      const router = (
        window as unknown as {
          __TSR_ROUTER__: {
            navigate: (options: { to: string; search?: unknown }) => Promise<void>;
          };
        }
      ).__TSR_ROUTER__;
      // Not awaited: a deferred route's navigation settles only once its
      // held value is released, which the caller does.
      void router.navigate({ to: pathname, search });
    },
    { pathname: url.pathname, search: Object.fromEntries(url.searchParams) },
  );
}

/**
 * Loads `visit` as a document in `target` and returns its HTML; a held
 * deferred value is released from a second tab.
 */
async function loadDocument(target: Page, origin: string, visit: Visit, reload = false) {
  const loading = reload
    ? target.reload({ waitUntil: "commit" })
    : target.goto(`${origin}${visit.path}`, { waitUntil: "commit" });
  const response = await loading;
  expect(response, `a response for ${visit.path}`).not.toBeNull();
  expect(response!.status()).toBe(200);
  if (visit.mode === "defer") {
    await expect(target.locator("[data-rm-defer-shell]")).toBeAttached({
      timeout: 90_000,
    });
    await releaseFromSecondTab(target, origin);
  }
  return response!.text();
}

/** The editor's preview frame once it has come back from the access flow. */
async function previewDocument(page: Page): Promise<Frame> {
  let found: Frame | undefined;
  await expect
    .poll(
      () => {
        found = page.frames().find((frame) => {
          const url = new URL(frame.url() || "about:blank");
          return (
            url.hostname.startsWith("pv-") &&
            !url.pathname.startsWith("/__morph/preview-auth/")
          );
        });
        return Boolean(found);
      },
      { timeout: 90_000, message: "the preview frame lands on its pv- host" },
    )
    .toBe(true);
  return found!;
}

const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`;

type Template = {
  id: string;
  type: string;
  routePath?: string | null;
  draftGeneration: number;
  document: {
    sections: Array<{
      id: string;
      enabled?: boolean;
      props?: Record<string, unknown> | null;
    }>;
  };
};

test.describe("Start render modes keep hidden sections out", () => {
  test.describe.configure({ mode: "serial", timeout: 30 * 60_000 });
  test.use({ actionTimeout: 60_000 });

  let shared: Page | null = null;
  let scope: ThemeScope | null = null;
  let layoutTemplateId = "";
  const routeTemplateIds = new Map<RenderMode, string>();
  let harness: ReturnType<typeof storefrontHarness> | null = null;
  const domainIds: string[] = [];
  let previewOrigin: string | null = null;
  let tab: Page | null = null;
  let tabReads: ReturnType<typeof recordReads> | null = null;
  let visitor: Page | null = null;

  const queryD1 = (sql: string, ...params: unknown[]) =>
    queryLifecycleD1(STATE_DIR!, sql, ...params);
  const recordedRuntime = () =>
    (
      queryD1(
        "SELECT preview_runtime FROM storefront_themes WHERE id = ?1 AND storefront_id = ?2",
        scope!.themeId,
        scope!.storefrontId,
      )[0] as { preview_runtime: string | null } | undefined
    )?.preview_runtime ?? null;
  const publicOrigin = () =>
    `http://${HOST}:${new URL(test.info().project.use.baseURL!).port}`;
  const editorPathFor = (mode: RenderMode) =>
    `/store/${scope!.storefrontId}/themes/${scope!.themeId}/editor?templateId=${routeTemplateIds.get(mode)}&routePath=${renderModePath(mode)}`;

  async function templates(page: Page): Promise<Template[]> {
    const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
      ...scope!,
    })) as { success: boolean; message?: string; data?: { templates: Template[] } };
    expect(result.success, result.message).toBe(true);
    return result.data!.templates;
  }

  async function storedSection(page: Page, templateId: string, sectionId: string) {
    return (await templates(page))
      .find((item) => item.id === templateId)
      ?.document.sections.find((section) => section.id === sectionId);
  }

  /** One Design write, the way the editor's fields and section toggle send it. */
  async function writeSection(
    page: Page,
    templateId: string,
    sectionId: string,
    props: Record<string, unknown>,
    routePath?: string,
  ) {
    const current = (await templates(page)).find((item) => item.id === templateId)!;
    const written = (await serverFn(page, THEMES, "updateStorefrontThemeSectionProps", {
      ...scope!,
      templateId,
      sectionId,
      props,
      expectedDraftGeneration: current.draftGeneration,
      expectedSourceGeneration: await themeSourceGeneration(page, scope!),
      ...(routePath ? { routePath } : {}),
    })) as { success: boolean; message?: string; error?: string };
    expect(
      written.success,
      `${sectionId} ${JSON.stringify(props)}: ${written.error ?? ""} ${written.message ?? ""}`,
    ).toBe(true);
  }

  async function valueThenHide(
    page: Page,
    templateId: string,
    sectionId: string,
    props: Record<string, unknown>,
    routePath?: string,
  ) {
    await writeSection(page, templateId, sectionId, props, routePath);
    await writeSection(page, templateId, sectionId, { enabled: false }, routePath);
    const section = await storedSection(page, templateId, sectionId);
    expect(section?.enabled, `${sectionId} is hidden in its Document`).toBe(false);
  }

  test.beforeAll(async ({ browser }) => {
    expect(RECORDED_PREVIEW_RUNTIME, "not a client record-mode run").not.toBe("client");
    const page = await signedInPage(browser);
    shared = page;
    const created: ThemeScope = {
      storefrontId: themeScopeFromEditorPath(EDITOR_PATH!).storefrontId,
      themeId: randomUUID(),
    };
    scope = created;
    // As starter-v32-full-start-acceptance.spec.ts: an empty row, then full
    // Start through the editor's compare-and-set, then the editor's first
    // read provisions Starter 32.
    insertThrowawayTheme({
      storefrontId: created.storefrontId,
      themeId: created.themeId,
      name: `render-modes-${created.themeId}`,
      previewRuntime: null,
      rowOnly: true,
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const saved = (await serverFn(page, PREVIEW_SERVER, "setThemePreviewRuntime", {
      ...created,
      previewRuntime: "start",
      expectedPreviewRuntime: recordedRuntime(),
    })) as { success: boolean; message?: string; error?: string };
    expect(saved.success, `record full Start: ${saved.error ?? saved.message}`).toBe(true);
    expect(recordedRuntime()).toBe("start");
    verifyRecordedThemePreviewRuntime(created);

    const provisioned = await templates(page);
    const layout = provisioned.find((item) => item.type === "layout");
    expect(layout, "the editor created the layout template").toBeDefined();
    layoutTemplateId = layout!.id;

    const written = await writeThemeFiles(page, created, RENDER_MODES_FILES);
    expect(written.success, JSON.stringify(written)).toBe(true);
    expect(recordedRuntime(), "still full Start after the fixture files").toBe("start");

    for (const mode of RENDER_MODES) {
      const routePath = renderModePath(mode);
      const ensured = (await serverFn(page, THEMES, "ensureStorefrontThemeRouteTemplate", {
        ...created,
        routePath,
      })) as { success: boolean; message?: string; data?: { id: string } };
      expect(ensured.success, `${routePath}: ${ensured.message}`).toBe(true);
      const templateId = ensured.data!.id;
      routeTemplateIds.set(mode, templateId);
      for (const kind of SHOWN_KINDS) {
        await writeSection(
          page,
          templateId,
          renderModeSlot(mode, kind),
          { heading: stored(mode, kind) },
          routePath,
        );
      }
      for (const kind of HIDDEN_KINDS) {
        await valueThenHide(
          page,
          templateId,
          renderModeSlot(mode, kind),
          { heading: stored(mode, kind) },
          routePath,
        );
      }
    }
    await writeSection(page, layoutTemplateId, HEADER, { storeName: HEADER_MARKER });
    await valueThenHide(page, layoutTemplateId, FOOTER, { copyrightText: FOOTER_MARKER });
    harness = storefrontHarness({ scope: created, stateDir: STATE_DIR! });
  });

  test.afterAll(async () => {
    const failures: string[] = [];
    try {
      if (shared) {
        for (const domainId of domainIds.splice(0)) {
          try {
            execLocalD1(
              `UPDATE storefront_domains SET is_primary = 0, cloudflare_domain_id = NULL WHERE id = ${sqlText(domainId)};`,
            );
            const deleted = (await serverFn(shared, DOMAINS, "deleteStorefrontDomains", {
              ids: [domainId],
            })) as { success: boolean; message?: string };
            if (!deleted.success) failures.push(`domain ${domainId}: ${deleted.message}`);
          } catch (error) {
            failures.push(`domain ${domainId}: ${String(error)}`);
          }
        }
      }
    } finally {
      await visitor?.context().close();
      await tab?.close().catch(() => {});
      await shared?.context().close();
      await harness?.dispose();
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("Live Preview: each mode's direct load and reload stream no hidden section, and hydrate without one", async () => {
    const page = shared!;
    await openEditor(page, editorPathFor("ssr"));
    const frame = await previewDocument(page);
    await expect(
      frame.getByText(stored("ssr", "shown")).first(),
      "the editor's preview shows the route's Document",
    ).toBeVisible({ timeout: 180_000 });
    previewOrigin = new URL(frame.url()).origin;
    const [opened] = await Promise.all([
      page.context().waitForEvent("page"),
      page.getByRole("button", { name: "Open preview in new tab" }).click(),
    ]);
    await opened.waitForURL(
      (url) =>
        url.origin === previewOrigin && !url.pathname.startsWith("/__morph/preview-auth/"),
      { timeout: 90_000 },
    );
    tab = opened;
    tabReads = recordReads(tab, () => previewOrigin);
    await waitForRouter(tab);

    for (const visit of VISITS) {
      const where = `preview ${visit.label}`;
      expectStreamed(await streamedIn(tab, visit.path), visit, `${where} (streamed)`);
      expectRouteHtml(await loadDocument(tab, previewOrigin, visit), visit, `${where} (load)`);
      await waitForRouter(tab);
      await expectRouteDom(tab, visit);
      expectRouteHtml(
        await loadDocument(tab, previewOrigin, visit, true),
        visit,
        `${where} (reload)`,
      );
      await waitForRouter(tab);
      await expectRouteDom(tab, visit);
    }
    expectNoCrash(tabReads.errors, "preview loads");
  });

  test("Live Preview: client navigation through every mode and Back reads no hidden section through /_serverFn", async () => {
    const target = tab!;
    const reads = tabReads!;
    await loadDocument(target, previewOrigin!, VISITS[0]!);
    await waitForRouter(target);
    const token = await markDocument(target);
    const before = reads.calls.length;
    let previous = VISITS[0]!;
    for (const visit of VISITS.slice(1)) {
      await navigateInSite(target, visit.path);
      if (visit.mode === "defer") {
        await expect(target.locator("[data-rm-defer-shell]")).toBeVisible({
          timeout: 60_000,
        });
        await releaseFromSecondTab(target, previewOrigin!);
      }
      await expectRouteDom(target, visit);
      expect(await sameDocument(target, token), `${visit.label}: client navigation`).toBe(true);
      // Back to the previous route, then forward again by navigation.
      await target.goBack({ waitUntil: "commit" });
      if (previous.mode === "defer") await releaseFromSecondTab(target, previewOrigin!);
      await expectRouteDom(target, previous);
      expect(await sameDocument(target, token), `Back to ${previous.label}`).toBe(true);
      await target.goForward({ waitUntil: "commit" });
      if (visit.mode === "defer") await releaseFromSecondTab(target, previewOrigin!);
      await expectRouteDom(target, visit);
      previous = visit;
    }
    const calls = reads.calls.slice(before);
    expect(calls.length, "the navigations read through /_serverFn").toBeGreaterThan(0);
    for (const call of calls) {
      expectNoHiddenSentinel(call.body, `/_serverFn ${call.method} ${call.url}`);
    }
    // The shown values came through those reads, per route.
    for (const mode of ["off", "data", "fn", "defer"] as const) {
      expect(
        calls.some((call) => call.status === 200 && call.body.includes(stored(mode, "shown"))),
        `a /_serverFn read carried /rm-${mode}'s shown value`,
      ).toBe(true);
    }
    expectNoCrash(reads.errors, "preview navigation");
  });

  test("editor: selection, Hide and Show work on the full SSR, ssr: false, data-only and ssr() routes; the bridge's wait on a held deferred value is recorded", async () => {
    const page = shared!;
    const errors = recordReads(page, () => null).errors;
    // /rm-defer has a case of its own below (KNOWN GAP).
    for (const mode of RENDER_MODES.filter((each) => each !== "defer")) {
      await openEditor(page, editorPathFor(mode));
      const canvas = previewFrame(page);
      const shownSlot = renderModeSlot(mode, "shown");
      const section = canvas.locator(`[data-storefront-section-id="${shownSlot}"]`);
      await expect(section, `${mode}: the shown section in the canvas`).toHaveCount(1, {
        timeout: 180_000,
      });
      for (const kind of HIDDEN_KINDS) {
        await expect(
          canvas.locator(`[data-storefront-section-id="${renderModeSlot(mode, kind)}"]`),
        ).toHaveCount(0);
      }
      // Selection: a canvas click selects the section in the tree.
      await enableSelection(page);
      // The click has to land on an element itself (clickExposedElement):
      // the section's heading or the section, scrolled into the canvas.
      await section.scrollIntoViewIfNeeded();
      const picked = await clickExposedElement(
        page,
        canvas.locator(
          `[data-storefront-section-id="${shownSlot}"] h2, [data-storefront-section-id="${shownSlot}"]`,
        ),
      );
      expect(picked, `${mode}: the shown section could be clicked`).not.toBeNull();
      await expect(
        page.locator(
          `[data-editor-tree-node-id^="${shownSlot}:"][data-editor-tree-node-selected="true"]`,
        ),
        `${mode}: selected in the tree`,
      ).toHaveCount(1, { timeout: 20_000 });
      // Hide, then Show, from the Sections panel; no author guard.
      const node = page.locator(`[data-editor-tree-node-id^="${shownSlot}:"]`).first();
      await node.hover();
      const hide = node.getByRole("button", { name: /^Hide section / });
      // The panel names the section by its type, as the Hide control says.
      const sectionType = ((await hide.getAttribute("aria-label")) ?? "").replace(
        /^Hide section /,
        "",
      );
      expect(sectionType, `${mode}: the Hide control names the section`).not.toBe("");
      const hideAnswer = page.waitForResponse(
        (response) =>
          isServerFunctionCall(response.url(), "updateStorefrontThemeSectionProps"),
        { timeout: 30_000 },
      );
      await hide.click();
      try {
        const answer = await (await hideAnswer).text();
        expect(answer, `${mode}: Hide is not refused`).not.toContain("SECTION_HIDE_UNSUPPORTED");
        await expect(section, `${mode}: hidden in the canvas`).toHaveCount(0, {
          timeout: 20_000,
        });
        await expect(canvas.getByText(stored(mode, "shown"))).toHaveCount(0);
        await expect(canvas.getByText(renderModeDefault(mode, "shown"))).toHaveCount(0);
      } finally {
        const show = page
          .getByRole("button", { name: `Show section ${sectionType}` })
          .first();
        await node.hover().catch(() => {});
        if (await show.isVisible().catch(() => false)) {
          await expect(show).toBeEnabled({ timeout: 60_000 });
          await show.click();
        }
      }
      await expect(section, `${mode}: shown again`).toHaveCount(1, { timeout: 20_000 });
      await expect(canvas.getByText(stored(mode, "shown")).first()).toBeVisible();
      expect(
        (await storedSection(page, routeTemplateIds.get(mode)!, shownSlot))?.enabled,
        `${mode}: the Document shows it again`,
      ).not.toBe(false);
    }

    // The bridge on a document whose deferred value is held: the frame is
    // reloaded on /rm-defer, the value held for HOLD_MS, then released.
    const HOLD_MS = 10_000;
    await openEditor(page, editorPathFor("defer"));
    await releaseFromSecondTab(page, previewOrigin!).catch(() => {});
    await expect(
      previewFrame(page).locator(`[data-storefront-section-id="${renderModeSlot("defer", "shown")}"]`),
    ).toHaveCount(1, { timeout: 180_000 });
    const lines: Array<{ at: number; text: string }> = [];
    page.on("console", (message) => {
      if (message.text().startsWith("[preview-frame]")) {
        lines.push({ at: Date.now(), text: message.text() });
      }
    });
    const frame = await previewDocument(page);
    const reloaded = Date.now();
    await frame.evaluate(() => location.reload());
    const shell = previewFrame(page).locator("[data-rm-defer-shell]");
    await expect(shell).toBeAttached({ timeout: 90_000 });
    const shellAt = Date.now();
    await page.waitForTimeout(HOLD_MS);
    const bridgeBeforeRelease = lines.some(
      (line) => line.at >= reloaded && line.text.includes("bridge loaded"),
    );
    await releaseFromSecondTab(page, previewOrigin!);
    const releasedAt = Date.now();
    await expect
      .poll(
        () => lines.some((line) => line.at >= reloaded && line.text.includes("bridge loaded")),
        { timeout: 60_000, message: "the bridge loaded after the release" },
      )
      .toBe(true);
    const bridge = lines.find((line) => line.at >= reloaded && line.text.includes("bridge loaded"))!;
    const hydration = lines.find(
      (line) => line.at >= reloaded && line.text.includes("frame hydration"),
    );
    // Once loaded, the bridge may re-run the route's loader (an invalidate),
    // which holds a new deferred value. Recorded, then released.
    const heldAgain = await releaseFromSecondTab(page, previewOrigin!).then(
      () => true,
      () => false,
    );
    test.info().annotations.push({
      type: "bridge-unavailable-while-held",
      description: JSON.stringify({
        holdMs: HOLD_MS,
        shellVisibleAfterReloadMs: shellAt - reloaded,
        bridgeLoadedBeforeRelease: bridgeBeforeRelease,
        bridgeLoadedAfterReleaseMs: bridge.at - releasedAt,
        bridgeUnavailableSinceShellMs: bridge.at - shellAt,
        hydrationLine: hydration?.text ?? null,
        heldAgainAfterBridgeLoaded: heldAgain,
      }),
    });
    await expectRouteDom(await previewDocument(page), {
      mode: "defer",
      path: "/rm-defer",
      label: "editor canvas after the held reload",
      server: true,
    });
    expectNoCrash(errors, "editor");
  });

  // Seen on the Mac container lane (runs rm-evidence-4 and -5, 2026-11-28):
  // on /rm-defer, Hide takes the section out of the canvas, but the Sections
  // panel then keeps its Show control disabled and does not let it go after
  // the held value is released either. Run rm-evidence-7's preview lines name
  // the cause: the hidden section inside `<Await>` (rmdeferloadhidden) is
  // answered `not-applied reason=section-missing cause=not-rendered`, the
  // editor's ack wait expires on it ("cannot confirm sections="), and the
  // panel says "This preview cannot confirm what it shows, so content edits
  // are paused." The hidden sections outside `<Await>` on the same route are
  // acknowledged. Asserted as it is, so this fails once
  // the gap closes and has to become an ordinary Show assertion; the panel's
  // status text and the preview's own lines are recorded for diagnosis. The
  // Document is put back through the same write the Show control sends.
  test("KNOWN GAP: on the deferred <Await> route, Show stays disabled after Hide, even once the held value is released", async () => {
    const page = shared!;
    const mode = "defer" as const;
    const shownSlot = renderModeSlot(mode, "shown");
    const templateId = routeTemplateIds.get(mode)!;
    const lines: string[] = [];
    page.on("console", (message) => {
      if (/^\[preview-|^\[editor-|presentation/i.test(message.text())) {
        lines.push(message.text().slice(0, 300));
      }
    });
    await openEditor(page, editorPathFor(mode));
    await releaseFromSecondTab(page, previewOrigin!).catch(() => {});
    const canvas = previewFrame(page);
    const section = canvas.locator(`[data-storefront-section-id="${shownSlot}"]`);
    await expect(section).toHaveCount(1, { timeout: 180_000 });
    const node = page.locator(`[data-editor-tree-node-id^="${shownSlot}:"]`).first();
    await node.hover();
    const hide = node.getByRole("button", { name: /^Hide section / });
    const sectionType = ((await hide.getAttribute("aria-label")) ?? "").replace(
      /^Hide section /,
      "",
    );
    const hideAnswer = page.waitForResponse(
      (response) => isServerFunctionCall(response.url(), "updateStorefrontThemeSectionProps"),
      { timeout: 30_000 },
    );
    await hide.click();
    try {
      expect(await (await hideAnswer).text(), "Hide is not refused").not.toContain(
        "SECTION_HIDE_UNSUPPORTED",
      );
      // Hide itself works: gone from the canvas, nothing left behind.
      await expect(section, "hidden in the canvas").toHaveCount(0, { timeout: 20_000 });
      await expect(canvas.getByText(stored(mode, "shown"))).toHaveCount(0);
      await expect(canvas.getByText(renderModeDefault(mode, "shown"))).toHaveCount(0);
      expect((await storedSection(page, templateId, shownSlot))?.enabled).toBe(false);

      const show = page.getByRole("button", { name: `Show section ${sectionType}` }).first();
      await node.hover().catch(() => {});
      await expect(show).toBeVisible({ timeout: 20_000 });
      const disabledAfterHide = await show.isDisabled();
      const released = await releaseFromSecondTab(page, previewOrigin!).then(
        () => true,
        () => false,
      );
      // Bounded wait for the control to come back.
      const enabledWithin60s = await expect(show)
        .toBeEnabled({ timeout: 60_000 })
        .then(
          () => true,
          () => false,
        );
      const status = await page
        .getByRole("status")
        .filter({ hasText: /Preview syncing|paused/i })
        .first()
        .textContent({ timeout: 5_000 })
        .catch(() => null);
      test.info().annotations.push({
        type: "defer-show-after-hide",
        description: JSON.stringify({
          disabledAfterHide,
          releasedAHeldValue: released,
          enabledWithin60sOfRelease: enabledWithin60s,
          panelStatus: status,
          lines: lines.slice(-40),
        }),
      });
      expect(disabledAfterHide, "KNOWN GAP: Show is disabled right after Hide").toBe(true);
      expect(enabledWithin60s, "KNOWN GAP: Show is still disabled 60 s after the release").toBe(
        false,
      );
    } finally {
      // Put the Document back through the write the Show control sends.
      if ((await storedSection(page, templateId, shownSlot))?.enabled === false) {
        await writeSection(page, templateId, shownSlot, { enabled: true }, renderModePath(mode));
      }
    }
    expect((await storedSection(page, templateId, shownSlot))?.enabled).not.toBe(false);
  });

  // A Build Preview seals the page it is built from (and the layout): on
  // the Mac lane (run rm-evidence-7) a build made from /rm-ssr answered
  // /_morph/content for /rm-off with the layout's slots only. So each route
  // is built from its own page here; what the first build serves for another
  // route is recorded (annotation), not asserted.
  test("Build Preview: each mode's route, built from its own page, carries no hidden section in its HTML or hydrated DOM on the bp- host", async () => {
    const page = shared!;
    for (const mode of RENDER_MODES) {
      await openEditor(page, editorPathFor(mode));
      await enableSelection(page);
      const build = page.locator("button[data-editor-build-action]");
      await expect(build).toBeEnabled({ timeout: 30_000 });
      await build.click();
      await expect(build).toHaveAttribute("data-build-pending", "true", { timeout: 30_000 });
      await expect(build).toHaveAttribute("data-build-pending", "false", {
        timeout: 9 * 60_000,
      });
      const frameElement = page.locator('iframe[data-build-preview="isolated"]');
      await expect(frameElement).toBeVisible({ timeout: 60_000 });
      const address = new URL((await frameElement.getAttribute("src"))!);
      expect(address.hostname).toMatch(/^bp-[0-9a-f]{40}\./);
      const isolated = () => page.frame({ url: (url) => url.hostname === address.hostname });
      await expect.poll(isolated, { timeout: 120_000 }).toBeTruthy();
      const contentOf = (path: string) =>
        isolated()!.evaluate(async (path) => {
          const response = await fetch(`/_morph/content?path=${encodeURIComponent(path)}`, {
            cache: "no-store",
          });
          return { status: response.status, body: await response.text() };
        }, path);
      const answer = await contentOf(renderModePath(mode));
      expect(answer.status, `bp ${mode} content`).toBe(200);
      expectNoHiddenSentinel(answer.body, `bp /_morph/content ${mode}`);
      expect(answer.body, `bp ${mode}: the sealed page`).toContain(stored(mode, "shown"));
      expect(
        (JSON.parse(answer.body) as { hiddenSlots: string[] }).hiddenSlots,
        `bp ${mode}: the hidden list`,
      ).toEqual(
        expect.arrayContaining([...HIDDEN_KINDS.map((kind) => renderModeSlot(mode, kind)), FOOTER]),
      );
      if (mode === "ssr") {
        // Recorded: another route on a build made from /rm-ssr.
        const other = await contentOf(renderModePath("off"));
        const otherHtml = await isolated()!.evaluate(async (path) => {
          const response = await fetch(path, { cache: "no-store" });
          return { status: response.status, html: await response.text() };
        }, renderModePath("off"));
        test.info().annotations.push({
          type: "build-preview-other-route",
          description: JSON.stringify({
            content: { status: other.status, body: other.body.slice(0, 600) },
            html: {
              status: otherHtml.status,
              hiddenDefault: otherHtml.html.includes(renderModeDefault("off", "hidden")),
              hiddenLoaderDefault: otherHtml.html.includes(renderModeDefault("off", "loadhidden")),
              shownDefault: otherHtml.html.includes(renderModeDefault("off", "shown")),
              hiddenStored: otherHtml.html.includes(stored("off", "hidden")),
            },
          }),
        });
      }
      for (const visit of VISITS.filter((each) => each.mode === mode)) {
        const where = `Build Preview ${visit.label}`;
        expectStreamed(await streamedIn(isolated()!, visit.path), visit, `${where} (streamed)`);
        const frame = isolated()!;
        const navigated = frame.goto(`${address.origin}${visit.path}`, { waitUntil: "commit" });
        if (visit.mode === "defer") {
          await expect(frame.locator("[data-rm-defer-shell]")).toBeAttached({ timeout: 90_000 });
          await expect
            .poll(
              async () =>
                page
                  .frame({ url: (url) => url.hostname === address.hostname })!
                  .evaluate(async (path) => {
                    const response = await fetch(path, { cache: "no-store" });
                    return ((await response.json()) as { released: number }).released;
                  }, RENDER_MODE_RELEASE_PATH)
                  .catch(() => 0),
              { timeout: 60_000 },
            )
            .toBeGreaterThan(0);
        }
        await navigated;
        const current = page.frame({ url: (url) => url.hostname === address.hostname })!;
        await waitForRouter(current);
        await expectRouteDom(current, visit);
      }
      await page.keyboard.press("Escape");
      await expect(frameElement).toBeHidden({ timeout: 30_000 }).catch(() => {});
    }
  });

  test("published on SSR: each mode on the public site carries no hidden section, through load, reload, navigation and Back", async ({
    browser,
  }) => {
    const page = shared!;
    const domain = (await serverFn(page, DOMAINS, "createStorefrontDomain", {
      storefrontId: scope!.storefrontId,
      hostname: HOST,
    })) as { success: boolean; message?: string; data?: { id: string } };
    expect(domain.success, domain.message).toBe(true);
    domainIds.push(domain.data!.id);

    // Publishing is per page, with the layout: every route is published.
    let release = "";
    for (const mode of RENDER_MODES) {
      await openEditor(page, editorPathFor(mode));
      await (await publishShowingRelease(page)).close();
      release = await latestRelease(page, scope!);
      const [made] = queryD1(
        "SELECT theme_id FROM storefront_releases WHERE id = ?1",
        release,
      );
      expect(made?.theme_id, `${mode}: the release is this spec's Theme's`).toBe(scope!.themeId);
    }
    await harness!.serveActiveRelease(stored("ssr", "shown"), release, publicOrigin());

    const storefront = storefrontFetcher(publicOrigin());
    for (const mode of RENDER_MODES) {
      const answer = await storefront(
        `/_morph/content?path=${encodeURIComponent(renderModePath(mode))}`,
      );
      expect(answer.status, `public ${mode} content`).toBe(200);
      expectNoHiddenSentinel(answer.body, `public /_morph/content ${mode}`);
      const parsed = JSON.parse(answer.body) as {
        slots: Record<string, unknown>;
        hiddenSlots: string[];
      };
      expect(parsed.hiddenSlots).toEqual(
        expect.arrayContaining(HIDDEN_KINDS.map((kind) => renderModeSlot(mode, kind))),
      );
      for (const kind of HIDDEN_KINDS) {
        expect(Object.keys(parsed.slots)).not.toContain(renderModeSlot(mode, kind));
      }
    }

    const context = await browser.newContext();
    visitor = await context.newPage();
    const reads = recordReads(visitor, publicOrigin);
    const landed = await visitor.goto(`${publicOrigin()}/rm-ssr`, { waitUntil: "commit" });
    expect(landed!.status()).toBe(200);
    await waitForRouter(visitor);
    for (const visit of VISITS) {
      const where = `public ${visit.label}`;
      expectStreamed(await streamedIn(visitor, visit.path), visit, `${where} (streamed)`);
      expectRouteHtml(await loadDocument(visitor, publicOrigin(), visit), visit, `${where} (load)`);
      await waitForRouter(visitor);
      await expectRouteDom(visitor, visit);
      expectRouteHtml(
        await loadDocument(visitor, publicOrigin(), visit, true),
        visit,
        `${where} (reload)`,
      );
      await waitForRouter(visitor);
      await expectRouteDom(visitor, visit);
    }

    await loadDocument(visitor, publicOrigin(), VISITS[0]!);
    await waitForRouter(visitor);
    const token = await markDocument(visitor);
    const before = reads.calls.length;
    let previous = VISITS[0]!;
    for (const visit of VISITS.slice(1)) {
      await navigateInSite(visitor, visit.path);
      if (visit.mode === "defer") {
        await expect(visitor.locator("[data-rm-defer-shell]")).toBeVisible({ timeout: 60_000 });
        await releaseFromSecondTab(visitor, publicOrigin());
      }
      await expectRouteDom(visitor, visit);
      expect(await sameDocument(visitor, token), `public ${visit.label}: client navigation`).toBe(
        true,
      );
      await visitor.goBack({ waitUntil: "commit" });
      if (previous.mode === "defer") await releaseFromSecondTab(visitor, publicOrigin());
      await expectRouteDom(visitor, previous);
      await visitor.goForward({ waitUntil: "commit" });
      if (visit.mode === "defer") await releaseFromSecondTab(visitor, publicOrigin());
      await expectRouteDom(visitor, visit);
      previous = visit;
    }
    const calls = reads.calls.slice(before);
    expect(calls.length, "the public navigations read through /_serverFn").toBeGreaterThan(0);
    for (const call of calls) {
      expectNoHiddenSentinel(call.body, `public /_serverFn ${call.method} ${call.url}`);
    }
    expectNoCrash(reads.errors, "public site");
  });
});
