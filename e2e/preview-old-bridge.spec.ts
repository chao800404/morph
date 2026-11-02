import {
  expect,
  test,
  type Browser,
  type Frame,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import ts from "typescript";
import {
  EDITOR_CAPABILITIES,
  PREVIEW_CAPABILITIES,
} from "../src/lib/storefront/editor/preview-protocol";
import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
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
 * The current editor driving a preview page that runs a real OLDER Live
 * Preview bridge, and the same page back on the current bridge.
 *
 * The bridges are the frozen bytes under `e2e/fixtures/old-bridges/<label>/`
 * (each manifest names its source commit and hashes). Every module of the
 * bridge the preview frame asks for — the entry, `preview-content.ts` and
 * `src/morph/preview/*` — is answered from the fixture, transpiled here with
 * `typescript.transpileModule`; everything else (the Theme, the content
 * snapshot, Vite's client) comes from the real preview server. The page
 * therefore runs exactly what a workspace written at that commit ran, beside
 * today's Theme runtime and today's editor.
 *
 * Each case shows three things, kept apart:
 * 1. The old bridge was what ran: its modules were answered from the fixture,
 *    and the messages the frame posts have that version's shape.
 * 2. What the editor does with it, through the author's own controls.
 * 3. After `unroute` and a reload, the current bridge is back: it announces
 *    today's capabilities, the editor answers with its own, and the fixture
 *    route is not hit again.
 *
 * Client-only Live Preview only: the Start runtime loads the bridge itself
 * and expects the runtime contract of its own commit, which a current
 * workspace does not have. Runs on a Theme of its own, as `selection-field-
 * frame-navigated.spec.ts` does, which records the client-only runtime
 * (`storefront_themes.preview_runtime`), so the deployment's
 * `MORPH_THEME_PREVIEW_RUNTIME` does not decide it; each case checks that the
 * frame really is the client-only page.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

const FIXTURE_ROOT = join(process.cwd(), "e2e/fixtures/old-bridges");
const ROUTE_PATH = "/old-bridge-home";
const SLOT = "old-bridge-card";

const LIVE_TYPING_UNAVAILABLE =
  "Live preview typing unavailable — reload the preview to restore";
const OLDER_BRIDGE_RELOADED =
  "Preview reloaded itself on an older bridge — reload the preview";
const READY_WITHOUT_IDENTITY =
  "[preview-document] ready without identity; this frame's documents cannot be told apart";

const FILES = [
  {
    path: "src/routes/old-bridge-home.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import OldBridgeCard from "../components/OldBridgeCard";

export const Route = createFileRoute("${ROUTE_PATH}")({
  component: OldBridgeRoute,
});

function OldBridgeRoute() {
  return (
    <main>
      <OldBridgeCard {...content("${SLOT}")} />
    </main>
  );
}
`,
  },
  {
    path: "src/components/OldBridgeCard.tsx",
    content: `export const contentFields = {
  title: { type: "text", label: "Old bridge title" },
} as const;

type OldBridgeCardProps = { title?: string };

export default function OldBridgeCard({ title = "Old bridge default" }: OldBridgeCardProps) {
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
  /** Its envelope names its document. */
  documentId: boolean;
  /** What its ready announces; undefined when it announces nothing. */
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

/** Adds `.ts` to a relative, extensionless specifier, as Vite's URLs have. */
function withTsExtension(code: string): string {
  return code.replace(
    /(\bfrom\s*|\bimport\s*)"(\.\.?\/[^"]+)"/g,
    (whole, lead: string, specifier: string) =>
      /\.[a-z]+$/.test(specifier) ? whole : `${lead}"${specifier}.ts"`,
  );
}

/**
 * The fixture's modules as the browser is served them, by workspace path,
 * after checking its bytes against its manifest.
 */
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
  const digest = createHash("sha256")
    .update(JSON.stringify(sources))
    .digest("hex");
  expect(digest, `${label} is the frozen bytes its manifest names`).toBe(
    manifest.sha256,
  );
  const served = new Map<string, string>();
  for (const [path, source] of sources) {
    const output = ts.transpileModule(source, {
      fileName: path,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    served.set(path, withTsExtension(output));
  }
  return { manifest, served };
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
  const match =
    /\/(src\/morph\/(?:preview-bridge|preview-content|preview\/[a-z-]+))(?:\.ts)?$/.exec(
      new URL(url).pathname,
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

/**
 * In every document: the editor's window records what frames post to it, and
 * a frame records what is posted to it. Both only for preview messages.
 */
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

/** The frame in the preview iframe now. */
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
    (id, storefront_id, name, metadata, preview_runtime, created_at, updated_at)
    VALUES ('${created.themeId}', '${created.storefrontId}',
      'old-bridge-${created.themeId}', '{"starterTemplateVersion":1}',
      'client', '${now}', '${now}');`,
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
    .filter({ hasText: "Old bridge title" })
    .locator("input");
const notice = (page: Page, text: string) =>
  page.getByRole("status").filter({ hasText: text });

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

/** Selects the card's title and opens its field. */
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

test.describe("the editor on a preview page running an older bridge", () => {
  test.describe.configure({ mode: "serial" });

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
    // Whatever happened in the test, no fixture route outlives it.
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  for (const expected of OLD_BRIDGES) {
    test(`${expected.label}: loaded, driven by the editor, then replaced by the current bridge`, async ({
      page,
    }) => {
      test.setTimeout(420_000);
      const { manifest, served } = loadOldBridge(expected.label);
      const consoleLines: string[] = [];
      page.on("console", (message) => consoleLines.push(message.text()));
      await recordPreviewMessages(page);

      // Every bridge module the frame asks for is answered from the fixture.
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
        await page.goto(routeUrl(), { waitUntil: "domcontentloaded" });
        await expect(
          page.getByRole("button", { name: /^Publish$/ }),
        ).toBeVisible({ timeout: 45_000 });
        await expect(cardTitle(page)).toBeVisible({ timeout: 120_000 });

        // 1. The old bridge is what ran.
        await expect
          .poll(async () => (await readies(page)).length, {
            message: "the old bridge said it is ready",
            timeout: 60_000,
          })
          .toBeGreaterThan(0);
        const hitPaths = new Set(hits.map((hit) => hit.path));
        expect(
          [...served.keys()].filter((path) => !hitPaths.has(path)),
          `every module of ${manifest.sourceCommit} was answered from the fixture`,
        ).toEqual([]);
        // Client-only Live Preview: its index.html loads the bridge entry
        // with a module script; the full Start preview imports it from its
        // runtime script instead and has no such tag.
        await expect(
          previewFrame(page).locator(
            'script[type="module"][src$="/src/morph/preview-bridge.ts"]',
          ),
          "client-only Live Preview",
        ).toHaveCount(1);
        // One address per module, so one instance of each in the page.
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
        // The shape of that version, which the current bridge does not post.
        expect(ready.capabilities, "what the old ready announces").toEqual(
          expected.capabilities,
        );
        expect(ready.capabilities).not.toEqual([...PREVIEW_CAPABILITIES]);
        // The bridge's own posts; the inline diagnostic script in index.html
        // is today's and is not the bridge.
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

        // 2. What the editor does with it.
        await expect(
          page.locator("[data-editor-tree-sortable]").first(),
          "the structure the old bridge reported is in the sidebar",
        ).toBeAttached({ timeout: 45_000 });
        const frameOld = await previewFrameObject(page);
        // The editor answers a ready with its own capabilities only when the
        // ready names `code-default-selection` and a document; none does.
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

        await selectCardTitle(page);
        const shownBefore = (await cardTitle(page).textContent()) ?? "";
        const sentBeforeTyping = (await recordedIn(frameOld)).toFrame.length;
        const live = `old ${expected.label} ${Date.now()}`;
        await titleField(page).fill(live);
        const liveTyping = expected.capabilities?.includes(
          "selection-field-section",
        );
        if (liveTyping) {
          // The canvas follows the Inspector as the author types.
          await expect(cardTitle(page)).toHaveText(live, { timeout: 15_000 });
          await expect(notice(page, LIVE_TYPING_UNAVAILABLE)).toHaveCount(0);
        } else {
          // A bridge that did not say it reads the section a post names gets
          // no live post, and the author is told.
          await expect(notice(page, LIVE_TYPING_UNAVAILABLE)).toBeVisible({
            timeout: 15_000,
          });
          await page.waitForTimeout(1_000);
          await expect(cardTitle(page)).toHaveText(shownBefore);
        }
        await titleField(page).press("Tab");
        await expect
          .poll(() => storedTitle(page), { timeout: 30_000 })
          .toBe(live);
        // What reached the frame for this edit, typing and save together.
        const contentPosts = async () =>
          (await recordedIn(frameOld)).toFrame
            .slice(sentBeforeTyping)
            .map((message) => message.type)
            .filter(
              (type) =>
                type === "morph:storefront-preview-update-selection-field" ||
                type === "morph:storefront-preview-update-section-props",
            );
        if (liveTyping) {
          await expect(cardTitle(page)).toHaveText(live, { timeout: 30_000 });
          expect(await contentPosts()).toContain(
            "morph:storefront-preview-update-selection-field",
          );
        } else {
          // Observed 2026-10-29, recorded rather than fixed here: the saved
          // value does not reach this canvas. An Inspector text field
          // previews only through `update-selection-field`
          // (`skipPreviewSync`), which this bridge is not sent, and the save
          // posts no section content either; the comment on
          // LIVE_TYPING_UNAVAILABLE_MESSAGE says the canvas shows the value
          // once saved. The canvas keeps what it showed, and the notice
          // stays.
          await page.waitForTimeout(5_000);
          expect(await contentPosts()).toEqual([]);
          await expect(cardTitle(page)).toHaveText(shownBefore);
          await expect(notice(page, LIVE_TYPING_UNAVAILABLE)).toBeVisible();
        }
        await expect(page.getByRole("alert")).toHaveCount(0);

        // The page reloads itself, in the same iframe, still on the old
        // bridge (the route still answers).
        const hitsBeforeSelfReload = hits.length;
        const readiesBeforeSelfReload = (await readies(page)).length;
        await expect(notice(page, OLDER_BRIDGE_RELOADED)).toHaveCount(0);
        await frameOld
          .evaluate(() => window.location.reload())
          .catch(() => undefined);
        await expect
          .poll(async () => (await readies(page)).length, { timeout: 120_000 })
          .toBeGreaterThan(readiesBeforeSelfReload);
        expect(
          hits.length,
          "the reloaded document asked for the old bridge again",
        ).toBeGreaterThan(hitsBeforeSelfReload);
        if (expected.documentId) {
          // A new document, by its id: the editor confirms it and takes it.
          const ids = (await readies(page)).map(
            (message) => message.previewDocument,
          );
          expect(ids.at(-1), "the reloaded document names a new id").not.toBe(
            ids[0],
          );
          expect(ids.at(-1)).toMatch(/^[0-9a-f]{32}$/);
          await expect(
            previewFrame(page).locator(
              "html[data-storefront-editor-selection-enabled]",
            ),
            "the editor restored its tool in the new document",
          ).toBeAttached({ timeout: 45_000 });
          await page.waitForTimeout(1_000);
          await expect(notice(page, OLDER_BRIDGE_RELOADED)).toHaveCount(0);
        } else {
          // The same frame ready again with no id: the editor cannot confirm
          // which document it is, takes nothing from it, and asks for a
          // reload.
          await expect(notice(page, OLDER_BRIDGE_RELOADED)).toBeVisible({
            timeout: 30_000,
          });
        }
      } finally {
        await page.unroute("**/*", serveOldBridge);
      }

      // 3. The current bridge is back.
      const hitsAtUnroute = hits.length;
      const currentProtocolBodies: Promise<string | null>[] = [];
      const bridgeRequestsAfter: string[] = [];
      page.on("request", (request) => {
        if (!isPreviewSubresource(page, request)) return;
        if (bridgeModulePath(request.url())) {
          bridgeRequestsAfter.push(request.url());
        }
      });
      page.on("response", (response) => {
        if (
          bridgeModulePath(response.url()) ===
          "src/morph/preview/preview-protocol.ts"
        ) {
          currentProtocolBodies.push(response.text().catch(() => null));
        }
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(cardTitle(page)).toBeVisible({ timeout: 120_000 });
      await expect
        .poll(async () => (await readies(page)).length, {
          message: "the current bridge said it is ready",
          timeout: 60_000,
        })
        .toBeGreaterThan(0);
      const currentReady = (await readies(page))[0];
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
            message: "the editor announced its capabilities to this document",
            timeout: 30_000,
          },
        )
        .toEqual({
          type: EDITOR_CAPABILITIES_MESSAGE,
          previewDocument: currentReady.previewDocument,
          capabilities: [...EDITOR_CAPABILITIES],
        });
      expect(hits.length, "the fixture route was not hit after unroute").toBe(
        hitsAtUnroute,
      );
      expect(
        bridgeRequestsAfter.length,
        "the bridge was asked for again, from the real server",
      ).toBeGreaterThan(0);
      const bodies = await Promise.all(currentProtocolBodies);
      expect(
        bodies.some((body) => body?.includes(EDITOR_CAPABILITIES_MESSAGE)),
        "the protocol module served now is the current one",
      ).toBe(true);

      await selectCardTitle(page);
      const restored = `current after ${expected.label} ${Date.now()}`;
      await titleField(page).fill(restored);
      await expect(cardTitle(page)).toHaveText(restored, { timeout: 15_000 });
      await expect(notice(page, LIVE_TYPING_UNAVAILABLE)).toHaveCount(0);
      await expect(notice(page, OLDER_BRIDGE_RELOADED)).toHaveCount(0);
      await titleField(page).press("Tab");
      await expect
        .poll(() => storedTitle(page), { timeout: 30_000 })
        .toBe(restored);
      await expect(page.getByRole("alert")).toHaveCount(0);
      console.log(
        `[old-bridge] ${expected.label} (${manifest.sourceCommit}): ${hitsAtUnroute} fixture responses (entry ${hits.find((hit) => hit.path === "src/morph/preview-bridge.ts")?.url}), ${bridgeRequestsAfter.length} current bridge requests after unroute`,
      );
    });
  }
});
