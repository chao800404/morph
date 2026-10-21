import { expect, test, type Browser, type Frame, type Page } from "@playwright/test";
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
 * The preview page reloads itself, in the same iframe, while text is being
 * typed on the canvas (C5, document identity A1).
 *
 * The iframe's window stays the same; the document in it is new. What this
 * pins in a real browser:
 *
 * - Every message the page sends names the document that sent it, and a
 *   ping the editor posts to the frame's window is answered by the document
 *   active in it: before the reload by the old one, after it by the new one,
 *   never by the old one again. The editor's confirmation of a ready
 *   (option A) rests on that.
 * - The editor takes the new document: the text the old one held is gone
 *   with it, so the edit is not reported as finished, nothing typed is
 *   saved, and the new document is sent what the editor holds — the stored
 *   text — once it is on its route.
 *
 * Runtime-agnostic: run under the client-only preview (the shards) and,
 * locally, under the full Start preview.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

const shared = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
let scope: ThemeScope | null = null;
let editorPath: string | null = null;
const ROUTE_PATH = "/document-reload";
const SLOT = "reload-card";

const FILES = [
  {
    path: "src/routes/document-reload.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import ReloadCard from "../reload/ReloadCard";

export const Route = createFileRoute("${ROUTE_PATH}")({
  component: ReloadRoute,
});

function ReloadRoute() {
  return (
    <main>
      <ReloadCard {...content("${SLOT}")} />
    </main>
  );
}
`,
  },
  {
    path: "src/reload/ReloadCard.tsx",
    content: `type ReloadCardProps = { title?: string };

export default function ReloadCard({ title = "Reload default title" }: ReloadCardProps) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{title}</h2>
    </section>
  );
}
`,
  },
  {
    path: "src/reload/ReloadCard.fields.ts",
    content: `export const contentFields = {
  title: { type: "text", label: "ReloadCard title" },
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
      'document-reload-${created.themeId}', '{"starterTemplateVersion":1}',
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
    .filter({ hasText: "ReloadCard title" })
    .locator("input");
const inlineEditor = (page: Page) =>
  previewFrame(page).locator("[data-storefront-editor-inline-editing]");
const saveStatus = (page: Page) => page.locator("[data-editor-save-status]");

/** The frame in the preview iframe now. */
async function previewFrameObject(page: Page): Promise<Frame> {
  const handle = await page.locator("iframe").first().elementHandle();
  const frame = await handle?.contentFrame();
  expect(frame, "the editor has a preview frame").toBeTruthy();
  return frame!;
}

/**
 * The document id this page's own protocol module minted, read from the
 * module instance its bridge loaded (the same URL, so the same instance).
 */
async function documentIdIn(frame: Frame): Promise<string | null> {
  return frame
    .evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((name) => name.includes("/morph/preview/preview-protocol"));
      if (!url) return null;
      const protocol = (await import(/* @vite-ignore */ url)) as {
        documentPreviewIdentity?: () => string;
      };
      return protocol.documentPreviewIdentity?.() ?? null;
    })
    .catch(() => null);
}

type Seen = { type: string; previewDocument: string | null; heartbeatId: number | null; at: number };

/** Records, in the editor, every ready and pong the frame sends, in order. */
async function recordFrameMessages(page: Page) {
  await page.evaluate(() => {
    const seen: Seen[] = [];
    (window as unknown as { __c5Seen: Seen[] }).__c5Seen = seen;
    window.addEventListener("message", (event) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data.type !== "string") return;
      if (
        data.type !== "morph:storefront-preview-ready" &&
        data.type !== "morph:storefront-preview-pong"
      ) {
        return;
      }
      seen.push({
        type: data.type,
        previewDocument: typeof data.previewDocument === "string" ? data.previewDocument : null,
        heartbeatId: typeof data.heartbeatId === "number" ? data.heartbeatId : null,
        at: seen.length,
      });
    });
  });
}
const seenMessages = (page: Page) =>
  page.evaluate(() => (window as unknown as { __c5Seen: Seen[] }).__c5Seen.slice());

test.describe("the preview page reloading itself while text is typed on the canvas", () => {
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

  test("the new document is the one that answers, the typed text goes with the old one, and the stored text is shown", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const saves: string[] = [];
    const replays: string[] = [];
    page.on("request", (request) => {
      if (isServerFunctionCall(request.url(), "updateStorefrontThemeSectionProps")) {
        saves.push(request.postData() ?? "");
      }
    });
    page.on("console", (message) => {
      if (message.text().startsWith("[preview-instance] content replayed")) {
        replays.push(message.text());
      }
    });

    // Every document, the frame's included, keeps all its resource entries:
    // a full Start page loads more modules than the default 250, and the
    // protocol module's address is read from them (`documentIdIn`).
    await page.addInitScript(() => performance.setResourceTimingBufferSize(10_000));
    await page.goto(routeUrl(), { waitUntil: "domcontentloaded" });
    await recordFrameMessages(page);
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({ timeout: 45_000 });
    await expect(cardTitle(page)).toBeVisible({ timeout: 120_000 });
    if (
      await page
        .getByRole("button", { name: "Enable section selection" })
        .isVisible()
        .catch(() => false)
    ) {
      await enableSelection(page);
    }

    // Store a title through the Inspector, so the stored text differs from
    // the snapshot the preview started from.
    const base = `Reload base ${Date.now()}`;
    await cardTitle(page).scrollIntoViewIfNeeded();
    expect(await clickExposedElement(page, cardTitle(page))).not.toBeNull();
    await openContentTab(page);
    const stored = page.waitForResponse(
      (response) =>
        isServerFunctionCall(response.url(), "updateStorefrontThemeSectionProps") &&
        (response.request().postData() ?? "").includes(base),
      { timeout: 30_000 },
    );
    await titleField(page).fill(base);
    await titleField(page).press("Tab");
    expect((await stored).ok()).toBe(true);
    await expect(saveStatus(page)).toHaveAttribute("aria-label", /^(Unpublished|Published)$/, {
      timeout: 30_000,
    });
    const text = previewFrame(page).getByText(base, { exact: true });
    await expect(text).toBeVisible({ timeout: 30_000 });

    // The document on screen, and its answers to the editor's pings.
    const frame = await previewFrameObject(page);
    const before = await documentIdIn(frame);
    expect(before, "the page's protocol module mints an id").toMatch(/^[0-9a-f]{32}$/);
    await expect
      .poll(
        async () =>
          (await seenMessages(page)).filter(
            (message) =>
              message.type === "morph:storefront-preview-pong" && message.previewDocument === before,
          ).length,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    // Typing on the canvas: the text lives only in this document.
    await expect(
      previewFrame(page).locator("html[data-storefront-editor-selection-enabled]"),
    ).toBeAttached({ timeout: 45_000 });
    const box = await text.boundingBox();
    expect(box, "no box for the canvas text").not.toBeNull();
    await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(inlineEditor(page)).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("End");
    const typed = " typed-before-the-reload";
    await page.keyboard.type(typed);
    await expect(inlineEditor(page)).toContainText(`${base}${typed}`);
    await expect(saveStatus(page)).toHaveAttribute("data-save-state", "unsaved");
    const savesBefore = saves.length;
    const seenBefore = (await seenMessages(page)).length;

    // The page reloads itself, in the same iframe.
    await frame.evaluate(() => window.location.reload()).catch(() => undefined);

    // A new document said it is ready, and it is the one now in the frame.
    await expect
      .poll(
        async () =>
          (await seenMessages(page))
            .slice(seenBefore)
            .find(
              (message) =>
                message.type === "morph:storefront-preview-ready" &&
                message.previewDocument !== null &&
                message.previewDocument !== before,
            )?.previewDocument ?? null,
        { timeout: 120_000 },
      )
      .not.toBeNull();
    const readyAfter = (await seenMessages(page))
      .slice(seenBefore)
      .find((message) => message.type === "morph:storefront-preview-ready" && message.previewDocument !== before)!;
    const after = readyAfter.previewDocument!;
    // Read from the frame now in the iframe: a cross-origin reload may hand
    // the iframe a new frame (a new renderer), so the old handle is gone.
    await expect
      .poll(async () => documentIdIn(await previewFrameObject(page)), { timeout: 60_000 })
      .toBe(after);

    // Every ping answered since the new document's ready is answered by it,
    // never by the old one.
    await expect
      .poll(
        async () =>
          (await seenMessages(page))
            .slice(readyAfter.at + 1)
            .filter((message) => message.type === "morph:storefront-preview-pong").length,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
    const pongsAfter = (await seenMessages(page))
      .slice(readyAfter.at + 1)
      .filter((message) => message.type === "morph:storefront-preview-pong");
    expect(pongsAfter.map((message) => message.previewDocument)).toEqual(
      pongsAfter.map(() => after),
    );

    // The typed text went with the old document: not saved, not reported as
    // finished, and the editor no longer counts an open edit.
    await expect(saveStatus(page)).toHaveAttribute("aria-label", /^(Unpublished|Published)$/, {
      timeout: 30_000,
    });
    await expect(inlineEditor(page)).toHaveCount(0);
    // The new document is shown what the editor holds: the stored title.
    await expect(cardTitle(page)).toHaveText(base, { timeout: 60_000 });
    await page.waitForTimeout(3_000);
    expect(saves.slice(savesBefore).filter((body) => body.includes(typed))).toEqual([]);
    expect(replays.length).toBeLessThanOrEqual(1);
  });
});
