import {
  expect,
  test,
  type Browser,
  type Frame,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import {
  EDITOR_CAPABILITIES,
  PREVIEW_CAPABILITIES,
} from "../src/lib/storefront/editor/preview-protocol";
import {
  EDITOR_PATH,
  clickExposedElement,
  decodeServerFnResult,
  enableSelection,
  isServerFunctionCall,
  openContentTab,
  previewFrame,
} from "./helpers";
import { execLocalD1, queryLocalD1 } from "./helpers/editor-writes-paused";
import {
  CaseRecord,
  Ledger,
  evidenceDir,
  sha256,
  startIdentity,
  writeJson,
} from "./helpers/m1-evidence";
import { THEMES, serverFn } from "./native-acceptance";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";

/**
 * M1 item 1b, case B3 (handoff 2026-11-21 m1-acceptance-plan.md §1b, Q4): the
 * three frozen older Live Preview bridges driven by today's editor under the
 * FULL TanStack Start preview, then the same page back on the current bridge.
 * preview-old-bridge.spec.ts holds the same three cases on the client-only
 * preview; this file is its full Start counterpart.
 *
 * What a bridge is under Start. The platform lays out, per preview, the
 * protocol modules (`src/morph/preview/*`), the bridge entry, the content
 * module and, for a Start preview only, the client module every page loads
 * (`__morph_preview_client.ts`); `previewBridgeIdentity` counts all four as
 * the bridge. So an older bridge under Start is all of them as its commit
 * wrote them: the bridge modules from `e2e/fixtures/old-bridges/<label>/`,
 * and the Start client module from `e2e/fixtures/old-bridge-start-client/`,
 * generated at each fixture's source commit (byte-identical at all three).
 * Serving today's client beside an old protocol module would not be an old
 * bridge: today's client imports `documentPreviewIdentity`, which two of the
 * three old protocol modules do not export, so nothing would run at all.
 * Every other module (the Theme, the content snapshot, Vite's client) and
 * the page itself, rendered on the server by workerd, come from the real
 * Start preview.
 *
 * Transport: the local sidecar, as CI's "Editor E2E full Start preview" job
 * runs it (MORPH_THEME_PREVIEW_RUNTIME=start in .dev.vars.local_preview_e2e,
 * MORPH_E2E_PREVIEW_RUNTIME=start for the spec). Nothing here builds or
 * publishes, so no container is needed.
 *
 * Full Start, three ways (Q10): the Theme records `preview_runtime = 'start'`
 * (read back from D1); every Live Preview start the editor asked for
 * answered `previewRuntime: "start"`; and the frame is the Start page (the
 * platform's client module script, no client-only bridge script, and the
 * card rendered in the HTML the server sent).
 *
 * Each case:
 * 1. The old bridge is what ran: every fixture module was answered from the
 *    fixture, at one address each, and its ready has that version's shape.
 * 2. What the editor does with it. None of the three announces
 *    `section-presentation-ack-v1`, so the editor refreshes the frame once
 *    (#399) and then stays on the cannot-confirm notice: exactly two
 *    documents loaded the old bridge, still two after a further wait, no
 *    content write sent, the field disabled, sorting off, and the draft the
 *    Document holds unchanged and shown on the canvas.
 * 3. After `unroute` and a reload the current bridge is back: today's
 *    capabilities, the editor's answer, and an Inspector edit stored.
 */
test.skip(
  !EDITOR_PATH ||
    !process.env.MORPH_E2E_STATE_DIR ||
    process.env.MORPH_E2E_PREVIEW_RUNTIME !== "start",
  "Needs the runner-owned throwaway store and the full Start preview runtime (MORPH_E2E_PREVIEW_RUNTIME=start).",
);

const FIXTURE_ROOT = join(process.cwd(), "e2e/fixtures/old-bridges");
const START_CLIENT_FIXTURE = join(
  process.cwd(),
  "e2e/fixtures/old-bridge-start-client",
);
const START_CLIENT_PATH = "__morph_preview_client.ts";
const BRIDGE_ENTRY = "src/morph/preview-bridge.ts";
const ROUTE_PATH = "/old-bridge-start-home";
const SLOT = "old-bridge-start-card";
/** How long the editor must stay on the notice without another refresh. */
const SETTLE_MS = 20_000;

const LIVE_TYPING_UNAVAILABLE =
  "Live preview typing unavailable — reload the preview to restore";
const OLDER_BRIDGE_RELOADED =
  "Preview reloaded itself on an older bridge — reload the preview";
const READY_WITHOUT_IDENTITY =
  "[preview-document] ready without identity; this frame's documents cannot be told apart";

const FILES = [
  {
    path: "src/routes/old-bridge-start-home.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import OldBridgeStartCard from "../components/OldBridgeStartCard";

export const Route = createFileRoute("${ROUTE_PATH}")({
  component: OldBridgeStartRoute,
});

function OldBridgeStartRoute() {
  return (
    <main>
      <OldBridgeStartCard {...content("${SLOT}")} />
    </main>
  );
}
`,
  },
  {
    path: "src/components/OldBridgeStartCard.tsx",
    content: `export const contentFields = {
  title: { type: "text", label: "Old bridge Start title" },
} as const;

type OldBridgeStartCardProps = { title?: string };

export default function OldBridgeStartCard({ title = "Old bridge Start default" }: OldBridgeStartCardProps) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{title}</h2>
    </section>
  );
}
`,
  },
];

type Expected = {
  label: string;
  documentId: boolean;
  capabilities: string[] | undefined;
};

const OLD_BRIDGES: Expected[] = [
  {
    label: "without-editor-capabilities",
    documentId: true,
    capabilities: ["selection-field-section"],
  },
  {
    label: "without-document-id",
    documentId: false,
    capabilities: ["selection-field-section"],
  },
  { label: "without-capabilities", documentId: false, capabilities: undefined },
];

type Manifest = {
  label: string;
  sourceCommit: string;
  sha256: string;
  files: { path: string; storedAs: string }[];
};

type StartClientManifest = {
  path: string;
  storedAs: string;
  sha256: string;
  sourceCommits: Record<string, string>;
};

function withTsExtension(code: string): string {
  return code.replace(
    /(\bfrom\s*|\bimport\s*\(?\s*)"(\.\.?\/[^"]+)"/g,
    (whole, lead: string, specifier: string) =>
      /\.[a-z]+$/.test(specifier) ? whole : `${lead}"${specifier}.ts"`,
  );
}

const transpile = (path: string, source: string) =>
  withTsExtension(
    ts.transpileModule(source, {
      fileName: path,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  );

/** The fixture's modules by workspace path, after checking its bytes. */
function loadOldBridge(label: string) {
  const dir = join(FIXTURE_ROOT, label);
  const manifest = JSON.parse(
    readFileSync(join(dir, "manifest.json"), "utf8"),
  ) as Manifest;
  const sources = manifest.files
    .map(
      (file) =>
        [file.path, readFileSync(join(dir, file.storedAs), "utf8")] as [
          string,
          string,
        ],
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  expect(
    sha256(JSON.stringify(sources)),
    `${label} is the frozen bytes its manifest names`,
  ).toBe(manifest.sha256);
  const served = new Map<string, string>();
  for (const [path, source] of sources)
    served.set(path, transpile(path, source));

  const clientManifest = JSON.parse(
    readFileSync(join(START_CLIENT_FIXTURE, "manifest.json"), "utf8"),
  ) as StartClientManifest;
  expect(clientManifest.path).toBe(START_CLIENT_PATH);
  expect(
    clientManifest.sourceCommits[label],
    `the Start client fixture was generated at ${label}'s commit`,
  ).toBe(manifest.sourceCommit);
  const client = readFileSync(
    join(START_CLIENT_FIXTURE, clientManifest.storedAs),
    "utf8",
  );
  expect(sha256(client), "the Start client is the frozen bytes").toBe(
    clientManifest.sha256,
  );
  served.set(START_CLIENT_PATH, transpile(START_CLIENT_PATH, client));
  return { manifest, served, clientSha256: clientManifest.sha256 };
}

function isPreviewSubresource(page: Page, request: Request) {
  if (request.isNavigationRequest()) return false;
  try {
    return request.frame() !== page.mainFrame();
  } catch {
    return false;
  }
}

/** The workspace path of a bridge module the frame asks for, if it is one. */
function bridgeModulePath(url: string): string | null {
  const pathname = new URL(url).pathname;
  if (pathname.endsWith(`/${START_CLIENT_PATH}`)) return START_CLIENT_PATH;
  const match =
    /\/(src\/morph\/(?:preview-bridge|preview-content|preview\/[a-z-]+))(?:\.ts)?$/.exec(
      pathname,
    );
  return match ? `${match[1]}.ts` : null;
}

type FromFrame = {
  type: string;
  namesDocument: boolean;
  previewDocument: string | null;
  capabilities: unknown;
};
type ToFrame = {
  type: string;
  previewDocument: string | null;
  capabilities: unknown;
};
type Recorded = { fromFrame: FromFrame[]; toFrame: ToFrame[] };

function recordPreviewMessages(page: Page) {
  return page.addInitScript(() => {
    const recorded: Recorded = { fromFrame: [], toFrame: [] };
    (window as unknown as { __oldBridge: Recorded }).__oldBridge = recorded;
    const isTop = window.top === window;
    window.addEventListener("message", (event) => {
      const data = event.data as Record<string, unknown> | null;
      if (
        !data ||
        typeof data.type !== "string" ||
        !data.type.startsWith("morph:storefront-preview-")
      ) {
        return;
      }
      if (isTop && event.source !== window) {
        recorded.fromFrame.push({
          type: data.type,
          namesDocument: "previewDocument" in data,
          previewDocument:
            typeof data.previewDocument === "string"
              ? data.previewDocument
              : null,
          capabilities: data.capabilities,
        });
      } else if (!isTop) {
        recorded.toFrame.push({
          type: data.type,
          previewDocument:
            typeof data.previewDocument === "string"
              ? data.previewDocument
              : null,
          capabilities: data.capabilities,
        });
      }
    });
  });
}

const recordedIn = (target: Page | Frame) =>
  target
    .evaluate(() => {
      const recorded = (window as unknown as { __oldBridge?: Recorded })
        .__oldBridge;
      return recorded
        ? { fromFrame: [...recorded.fromFrame], toFrame: [...recorded.toFrame] }
        : { fromFrame: [], toFrame: [] };
    })
    .catch(() => ({ fromFrame: [], toFrame: [] }) as Recorded);

const READY = "morph:storefront-preview-ready";
const DIAGNOSTIC = "morph:storefront-preview-diagnostic";
const EDITOR_CAPABILITIES_MESSAGE =
  "morph:storefront-preview-editor-capabilities";

async function previewFrameObject(page: Page): Promise<Frame> {
  const handle = await page.locator("iframe").first().elementHandle();
  const frame = await handle?.contentFrame();
  expect(frame, "the editor has a preview frame").toBeTruthy();
  return frame!;
}

async function readies(page: Page) {
  return (await recordedIn(page)).fromFrame.filter(
    (message) => message.type === READY,
  );
}

let scope: ThemeScope | null = null;
let editorPath: string | null = null;

/** A Theme of this spec's own, recorded as full Start and read back. */
function createThrowawayTheme(): ThemeScope {
  const created = {
    ...themeScopeFromEditorPath(EDITOR_PATH!),
    themeId: randomUUID(),
  };
  const now = new Date().toISOString();
  execLocalD1(`INSERT INTO storefront_themes
    (id, storefront_id, name, metadata, preview_runtime, created_at, updated_at)
    VALUES ('${created.themeId}', '${created.storefrontId}',
      'old-bridge-start-${created.themeId}', '{"starterTemplateVersion":1}',
      'start', '${now}', '${now}');`);
  expect(storedPreviewRuntime(created)).toBe("start");
  return created;
}

function storedPreviewRuntime(theme: ThemeScope) {
  const rows = queryLocalD1<{ preview_runtime: string | null }>(
    `SELECT preview_runtime FROM storefront_themes WHERE id = '${theme.themeId}' AND storefront_id = '${theme.storefrontId}'`,
  );
  expect(rows.length).toBe(1);
  return rows[0]!.preview_runtime;
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
    .filter({ hasText: "Old bridge Start title" })
    .locator("input");
const notice = (page: Page, text: string) =>
  page.getByRole("status").filter({ hasText: text });

type StoredSlot = {
  title: unknown;
  templateId: string | null;
  draftGeneration: number | null;
};

/** The slot's title as the Document holds it, read back from the server. */
async function storedSlot(page: Page): Promise<StoredSlot> {
  const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
    ...scope!,
  })) as {
    success: boolean;
    data?: {
      templates: Array<{
        id: string;
        draftGeneration: number;
        document: {
          sections: Array<{ id: string; props?: Record<string, unknown> }>;
        };
      }>;
    };
  };
  expect(result.success, JSON.stringify(result)).toBe(true);
  const holding = result.data!.templates.filter((template) =>
    template.document.sections.some((section) => section.id === SLOT),
  );
  expect(holding.length).toBeLessThanOrEqual(1);
  const template = holding[0];
  return {
    title: template?.document.sections.find((s) => s.id === SLOT)?.props?.title,
    templateId: template?.id ?? null,
    draftGeneration: template?.draftGeneration ?? null,
  };
}

async function selectCardTitle(page: Page) {
  await enableSelection(page);
  await cardTitle(page).scrollIntoViewIfNeeded();
  expect(
    await clickExposedElement(page, cardTitle(page)),
    "a click on the canvas reached the card title",
  ).not.toBeNull();
  await expect(
    page.locator('[data-editor-tree-node-selected="true"]').first(),
  ).toBeVisible({ timeout: 10_000 });
  await openContentTab(page);
  await expect(titleField(page)).toBeVisible({ timeout: 10_000 });
}

/** Records what every Live Preview start answered for the runtime. */
function recordStarts(page: Page) {
  const starts: Array<string | null> = [];
  page.on("response", async (response) => {
    if (!isServerFunctionCall(response.url(), "startThemePreviewServer"))
      return;
    try {
      const decoded = decodeServerFnResult(await response.text()) as {
        success?: boolean;
        data?: { previewRuntime?: string };
      };
      starts.push(
        decoded?.success ? (decoded.data?.previewRuntime ?? "client") : null,
      );
    } catch {
      starts.push(null);
    }
  });
  return starts;
}

/** The HTML the server sent for each preview document, as it arrived. */
function recordPreviewDocuments(page: Page) {
  const documents: Promise<string | null>[] = [];
  page.on("response", (response) => {
    const request = response.request();
    if (!request.isNavigationRequest()) return;
    try {
      if (request.frame() === page.mainFrame()) return;
    } catch {
      return;
    }
    // Every preview document. The frame opens at the preview's root (its
    // query carries the editor's channel) and the editor then routes inside
    // the page to ROUTE_PATH (dev run 2026-11-21: two "/" documents, the
    // first and the one refresh), so the HTML the server sent is the root
    // route's, not the card's.
    documents.push(response.text().catch(() => null));
  });
  return documents;
}

/**
 * The frame is the full Start page: its client module, no client-only
 * bridge tag, and HTML the server rendered (workerd's SSR, with the
 * platform's client module script and rendered sections in it) rather than
 * a client-only shell.
 */
async function expectStartPage(
  page: Page,
  documents: Promise<string | null>[],
  title: string,
) {
  await expect(
    previewFrame(page).locator(
      `script[type="module"][src$="/${START_CLIENT_PATH}"]`,
    ),
    "the full Start preview's client module",
  ).toHaveCount(1);
  await expect(
    previewFrame(page).locator(
      `script[type="module"][src$="/${BRIDGE_ENTRY}"]`,
    ),
    "no client-only bridge script",
  ).toHaveCount(0);
  const htmls = (await Promise.all(documents)).filter(
    (html): html is string => typeof html === "string",
  );
  expect(htmls.length, "the preview document's HTML was read").toBeGreaterThan(
    0,
  );
  const html = htmls[htmls.length - 1]!;
  expect(html, "the server sent the platform's Start client module").toContain(
    `src="/${START_CLIENT_PATH}"`,
  );
  expect(html, "the server rendered sections into the HTML").toContain(
    "data-storefront-section-id",
  );
  // The route the editor routed to, rendered in the page.
  await expect(cardTitle(page)).toHaveText(title);
}

test.describe("the editor on a full Start preview page running an older bridge", () => {
  test.describe.configure({ mode: "serial" });

  const dir = () => evidenceDir("1b-b3");
  let ledger: Ledger | null = null;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await signedInPage(browser);
    try {
      await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
      scope = createThrowawayTheme();
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
      const ensured = (await serverFn(
        page,
        THEMES,
        "ensureStorefrontThemeRouteTemplate",
        { ...scope, routePath: ROUTE_PATH },
      )) as { success: boolean };
      expect(ensured.success, JSON.stringify(ensured)).toBe(true);
    } finally {
      await page.context().close();
    }
  });

  test.afterAll(async ({ browser }) => {
    ledger?.write();
    if (!scope) return;
    const page = await signedInPage(browser);
    try {
      await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
      const removed = await removeThemeFiles(
        page,
        scope,
        FILES.map((file) => file.path),
      );
      expect(removed.success, JSON.stringify(removed)).toBe(true);
    } finally {
      await page.context().close();
    }
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  for (const expected of OLD_BRIDGES) {
    test(`${expected.label}: loaded under full Start, refreshed once, held on the notice keeping the draft, then replaced by the current bridge`, async ({
      page,
    }) => {
      test.setTimeout(480_000);
      ledger ??= new Ledger(dir());
      const caseDir = evidenceDir(`1b-b3/${expected.label}`);
      const identity = startIdentity(`1b/b3/${expected.label}`);
      identity.themeId = scope!.themeId;
      identity.previewMode = storedPreviewRuntime(scope!);
      const record = new CaseRecord(
        caseDir,
        `1b/b3/${expected.label}`,
        identity,
      );
      const { manifest, served, clientSha256 } = loadOldBridge(expected.label);
      record.fact("oldBridge", {
        label: expected.label,
        sourceCommit: manifest.sourceCommit,
        sha256: manifest.sha256,
        startClientSha256: clientSha256,
      });
      const consoleLines: string[] = [];
      page.on("console", (message) => consoleLines.push(message.text()));
      const starts = recordStarts(page);
      const documents = recordPreviewDocuments(page);
      await recordPreviewMessages(page);

      const hits: { path: string; url: string }[] = [];
      const serveOldBridge = async (route: Route) => {
        const request = route.request();
        if (!isPreviewSubresource(page, request)) return route.fallback();
        const path = bridgeModulePath(request.url());
        const body = path ? served.get(path) : undefined;
        if (!path || body === undefined) return route.fallback();
        hits.push({ path, url: request.url() });
        return route.fulfill({
          status: 200,
          contentType: "text/javascript",
          headers: { "Cache-Control": "no-store" },
          body,
        });
      };
      await page.route("**/*", serveOldBridge);

      try {
        const draftBefore = await record.step("the draft before", async () => {
          await page.goto(routeUrl(), { waitUntil: "domcontentloaded" });
          await expect(
            page.getByRole("button", { name: /^Publish$/ }),
          ).toBeVisible({ timeout: 45_000 });
          const stored = await storedSlot(page);
          record.fact("draftBefore", stored);
          return stored;
        });
        const shownTitle =
          typeof draftBefore.title === "string" && draftBefore.title
            ? draftBefore.title
            : "Old bridge Start default";

        await record.step("old bridge loaded under full Start", async () => {
          await expect(cardTitle(page)).toBeVisible({ timeout: 180_000 });
          await expect
            .poll(async () => (await readies(page)).length, {
              message: "the old bridge said it is ready",
              timeout: 90_000,
            })
            .toBeGreaterThan(0);
          const hitPaths = new Set(hits.map((hit) => hit.path));
          expect(
            [...served.keys()].filter((path) => !hitPaths.has(path)),
            `every module of ${manifest.sourceCommit} was answered from the fixture`,
          ).toEqual([]);
          await expectStartPage(page, documents, shownTitle);
          const urlsPerPath = new Map<string, Set<string>>();
          for (const hit of hits) {
            urlsPerPath.set(
              hit.path,
              (urlsPerPath.get(hit.path) ?? new Set()).add(hit.url),
            );
          }
          for (const [path, urls] of urlsPerPath) {
            expect(
              [...urls],
              `${path} was asked for at one address`,
            ).toHaveLength(1);
          }
          const recordedOld = await recordedIn(page);
          const ready = recordedOld.fromFrame.find(
            (message) => message.type === READY,
          )!;
          expect(ready.capabilities, "what the old ready announces").toEqual(
            expected.capabilities,
          );
          expect(ready.capabilities).not.toEqual([...PREVIEW_CAPABILITIES]);
          const bridgePosts = recordedOld.fromFrame.filter(
            (message) => message.type !== DIAGNOSTIC,
          );
          expect(bridgePosts.length).toBeGreaterThan(1);
          for (const message of bridgePosts) {
            expect(
              message.namesDocument,
              `${message.type} names its document`,
            ).toBe(expected.documentId);
            if (expected.documentId) {
              expect(message.previewDocument).toMatch(/^[0-9a-f]{32}$/);
            }
          }
          await expect(cardTitle(page)).toHaveText(shownTitle);
        });

        const writesWhileOld: string[] = [];
        const recordWrite = (request: { url(): string }) => {
          if (request.url().includes("updateStorefrontThemeSectionProps")) {
            writesWhileOld.push(request.url());
          }
        };
        page.on("request", recordWrite);
        try {
          await record.step(
            "refreshed once, then held on the notice",
            async () => {
              await expect(
                page.getByTestId("preview-presentation-unconfirmable"),
                "missing section-presentation-ack-v1 pauses editing after the bounded check",
              ).toBeVisible({ timeout: 60_000 });
              await expect(
                page.getByRole("button", { name: "Reload preview" }),
              ).toBeVisible();
              const entryLoads = () =>
                hits.filter((hit) => hit.path === BRIDGE_ENTRY).length;
              expect(
                entryLoads(),
                "two documents loaded the old bridge: the first and the one refresh",
              ).toBe(2);
              await page.waitForTimeout(SETTLE_MS);
              expect(
                entryLoads(),
                "no further refresh while the notice is shown",
              ).toBe(2);
              await expect(
                page.getByTestId("preview-presentation-unconfirmable"),
              ).toBeVisible();
              record.fact("oldBridgeDocuments", entryLoads());
            },
          );

          await record.step(
            "driven by the editor, nothing written, draft kept",
            async () => {
              const frameOld = await previewFrameObject(page);
              expect(
                (await recordedIn(frameOld)).toFrame.filter(
                  (message) => message.type === EDITOR_CAPABILITIES_MESSAGE,
                ),
                "the editor did not announce its capabilities to an old bridge",
              ).toEqual([]);
              expect(
                consoleLines.includes(READY_WITHOUT_IDENTITY),
                "the editor logged a ready it cannot tell apart",
              ).toBe(!expected.documentId);
              await expect(
                page.locator("[data-editor-tree-sortable]"),
                "sorting is disabled while presentation is unconfirmable",
              ).toHaveCount(0);
              await selectCardTitle(page);
              await expect(
                titleField(page),
                "content field is disabled while the bridge lacks section-presentation-ack-v1",
              ).toBeDisabled({ timeout: 15_000 });
              expect(
                writesWhileOld,
                "no content writes were sent while paused",
              ).toEqual([]);
              const after = await storedSlot(page);
              expect(after, "the draft is unchanged").toEqual(draftBefore);
              await expect(cardTitle(page)).toHaveText(shownTitle);
              await page
                .locator("iframe")
                .first()
                .screenshot({ path: join(caseDir, "old-bridge-canvas.png") })
                .catch(() => undefined);
              await page.screenshot({
                path: join(caseDir, "old-bridge-editor.png"),
              });
            },
          );
        } finally {
          page.off("request", recordWrite);
        }
      } finally {
        await page.unroute("**/*", serveOldBridge);
        identity.endedAt = new Date().toISOString();
        record.write();
      }

      const hitsAtUnroute = hits.length;
      const currentProtocolBodies: Promise<string | null>[] = [];
      const bridgeRequestsAfter: string[] = [];
      page.on("request", (request) => {
        if (!isPreviewSubresource(page, request)) return;
        if (bridgeModulePath(request.url()))
          bridgeRequestsAfter.push(request.url());
      });
      page.on("response", (response) => {
        if (
          bridgeModulePath(response.url()) ===
          "src/morph/preview/preview-protocol.ts"
        ) {
          currentProtocolBodies.push(response.text().catch(() => null));
        }
      });

      try {
        await record.step("current bridge back under full Start", async () => {
          documents.length = 0;
          await page.reload({ waitUntil: "domcontentloaded" });
          await expect(cardTitle(page)).toBeVisible({ timeout: 180_000 });
          await expect
            .poll(async () => (await readies(page)).length, {
              message: "the current bridge said it is ready",
              timeout: 90_000,
            })
            .toBeGreaterThan(0);
          const currentReady = (await readies(page))[0]!;
          expect(currentReady.capabilities).toEqual([...PREVIEW_CAPABILITIES]);
          expect(currentReady.previewDocument).toMatch(/^[0-9a-f]{32}$/);
          const frameNow = await previewFrameObject(page);
          await expect
            .poll(
              async () =>
                (await recordedIn(frameNow)).toFrame.find(
                  (message) => message.type === EDITOR_CAPABILITIES_MESSAGE,
                ) ?? null,
              {
                message:
                  "the editor announced its capabilities to this document",
                timeout: 30_000,
              },
            )
            .toEqual({
              type: EDITOR_CAPABILITIES_MESSAGE,
              previewDocument: currentReady.previewDocument,
              capabilities: [...EDITOR_CAPABILITIES],
            });
          expect(
            hits.length,
            "the fixture route was not hit after unroute",
          ).toBe(hitsAtUnroute);
          expect(
            bridgeRequestsAfter.length,
            "the bridge was asked for again, from the real server",
          ).toBeGreaterThan(0);
          const bodies = await Promise.all(currentProtocolBodies);
          expect(
            bodies.some((body) => body?.includes(EDITOR_CAPABILITIES_MESSAGE)),
            "the protocol module served now is the current one",
          ).toBe(true);
          await expectStartPage(
            page,
            documents,
            shownTitleNow(await storedSlot(page)),
          );
        });

        await record.step(
          "an edit on the current bridge is stored",
          async () => {
            await selectCardTitle(page);
            const restored = `current after ${expected.label} ${Date.now()}`;
            await titleField(page).fill(restored);
            await expect(cardTitle(page)).toHaveText(restored, {
              timeout: 15_000,
            });
            await expect(notice(page, LIVE_TYPING_UNAVAILABLE)).toHaveCount(0);
            await expect(notice(page, OLDER_BRIDGE_RELOADED)).toHaveCount(0);
            await titleField(page).press("Tab");
            await expect
              .poll(async () => (await storedSlot(page)).title, {
                timeout: 30_000,
              })
              .toBe(restored);
            await expect(page.getByRole("alert")).toHaveCount(0);
            const stored = await storedSlot(page);
            ledger!.add({
              step: `1b/b3/${expected.label}`,
              action: "Inspector write on the current bridge",
              themeId: scope!.themeId,
              sourceRevisionId: null,
              templateDraftGeneration: stored.draftGeneration,
              buildId: null,
              buildReused: null,
              contentPublicationId: null,
              releaseId: null,
              activeRelease: { before: null, after: null },
              expectedActiveReleaseId: null,
              evidence: [`${expected.label}/result.json`],
            });
          },
        );

        await record.step("full Start", async () => {
          record.fact("previewStarts", starts);
          expect(
            starts.length,
            "the editor started a Live Preview",
          ).toBeGreaterThan(0);
          expect(
            starts.filter((runtime) => runtime !== "start"),
            "every Live Preview start answered previewRuntime start",
          ).toEqual([]);
          expect(storedPreviewRuntime(scope!)).toBe("start");
        });
      } finally {
        identity.endedAt = new Date().toISOString();
        record.write();
        writeJson(caseDir, "hits.json", {
          hitsAtUnroute,
          hits,
          bridgeRequestsAfter,
        });
      }
    });
  }
});

/** The title the canvas shows for a stored slot: its value, or the component default. */
function shownTitleNow(stored: StoredSlot): string {
  return typeof stored.title === "string" && stored.title
    ? stored.title
    : "Old bridge Start default";
}
