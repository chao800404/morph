import { randomUUID } from "node:crypto";

import { expect, test, type Frame, type Page } from "@playwright/test";

import { EDITOR_PATH } from "./helpers";
import {
  editorContext,
  openEditor,
  serverFn,
  storefrontHarness,
  writeDraftField,
} from "./native-acceptance";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
} from "./native-compat";
import { astroConfig } from "../src/lib/storefront/theme-framework/astro-native-prerender.fixtures";

/**
 * docs/astro-theme-plan.md A6c: an Astro site's Live Preview in the real
 * container — `astro dev` started by the container transport, draft content
 * written into it as ticketed snapshots, each confirmed through the preview's
 * Worker before anyone may expect it, and a restart that keeps the order.
 *
 * Drafts are written through the editor's own draft write and synced
 * through the server functions, not from the canvas: L1.5 (Design on a
 * `.astro` page) is not done, and this site still carries the Starter's
 * Start files, so it says nothing about Astro Design.
 *
 * Container transport only, with `MORPH_ASTRO_THEMES=1`.
 */
const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Run through scripts/run-editor-e2e.mjs: this writes the run's own D1.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "The Astro dev server runs in the Sandbox container; run with MORPH_E2E_TRANSPORT=cloudflare-sandbox.",
);
test.skip(
  process.env.MORPH_ASTRO_THEMES !== "1",
  "Astro is previewed only where the server sets MORPH_ASTRO_THEMES=1.",
);

const scope = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
const PREVIEW = "/src/server/storefront/storefront-theme-preview-server.serverFn.ts";
const ROUTE = "/astro-live";
const READER = `export async function homeSlots(request: Request): Promise<unknown> {
  const origin = request.headers.get("x-morph-content-origin");
  if (!origin) return null;
  try {
    const response = await fetch(origin + "/_morph/content?path=%2F");
    return response.ok ? ((await response.json())?.slots ?? null) : null;
  } catch {
    return null;
  }
}
`;
const PAGE = `---
import { homeSlots } from "../morph/astro-live";
export const prerender = false;
const slots = await homeSlots(Astro.request);
---
<html><head><title>astro-live</title></head><body><main data-home-content={JSON.stringify(slots)} /></body></html>
`;
const OWN_PATHS = ["astro.config.mjs", "src/morph/astro-live.ts", `src/pages${ROUTE}.astro`];

type Answer = { success: boolean; error?: string; message?: string; data?: { ticket: number } };

/** The home page's hero heading, as the draft holds it. */
async function heroDraft(page: Page) {
  const context = await editorContext(page, scope!);
  for (const template of context.templates) {
    const hero = template.document.sections.find(
      (section) => section.id === "hero" || section.id.endsWith("-hero"),
    );
    if (hero) return { template, sectionId: hero.id, key: "heading" };
  }
  throw new Error("no template has a hero section");
}

const setDraft = async (page: Page, value: string) =>
  writeDraftField(page, scope!, await heroDraft(page), value);

const sync = (page: Page) =>
  serverFn(page, PREVIEW, "syncThemePreviewContent", scope) as Promise<Answer>;
const confirm = (page: Page, ticket: number) =>
  serverFn(page, PREVIEW, "confirmThemePreviewContent", { ...scope, ticket }) as Promise<Answer>;

/** The live preview's frame, once the editor framed it. */
async function liveFrame(page: Page): Promise<Frame> {
  const iframe = page.locator("iframe").first();
  await expect(iframe).toBeVisible({ timeout: 180_000 });
  const host = new URL((await iframe.getAttribute("src"))!).hostname;
  let frame: Frame | null = null;
  await expect
    .poll(() => (frame = page.frame({ url: (url) => url.hostname === host })), {
      timeout: 180_000,
    })
    .toBeTruthy();
  return frame!;
}

/** What the server-rendered page shows now, asked from inside the preview. */
async function shown(frame: Frame) {
  return frame.evaluate(async (route) => {
    const response = await fetch(route, { cache: "no-store" });
    return { status: response.status, body: await response.text() };
  }, ROUTE);
}

test.describe("an Astro site's Live Preview in the container (A6c)", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(30 * 60_000);
  test.use({ actionTimeout: 60_000 });

  const harness = STATE_DIR ? storefrontHarness({ scope: scope!, stateDir: STATE_DIR }) : null;

  test.afterAll(async ({ browser }) => {
    await harness?.writeD1(
      "UPDATE storefront_themes SET framework = NULL WHERE id = ?1 AND storefront_id = ?2",
      scope!.themeId,
      scope!.storefrontId,
    );
    await harness?.dispose();
    const page = await browser.newPage();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await serverFn(page, PREVIEW, "stopThemePreviewServer", scope).catch(() => {});
    await removeThemeFiles(page, scope!, OWN_PATHS);
    await page.close();
  });

  test("serves the draft, takes newer snapshots in order, and confirms only what its server reads", async ({
    page,
  }) => {
    const marker = (name: string) => `a6c-${name}-${randomUUID()}`;
    const a = marker("a");
    const b = marker("b");
    const c = marker("c");
    const d = marker("d");
    const e = marker("e");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(
      await harness!.writeD1(
        "UPDATE storefront_themes SET framework = 'astro' WHERE id = ?1 AND storefront_id = ?2",
        scope!.themeId,
        scope!.storefrontId,
      ),
    ).toBe(1);
    await removeThemeFiles(page, scope!, OWN_PATHS);
    const saved = await writeThemeFiles(page, scope!, [
      { path: "astro.config.mjs", content: astroConfig() },
      { path: "src/morph/astro-live.ts", content: READER },
      { path: `src/pages${ROUTE}.astro`, content: PAGE },
    ]);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await setDraft(page, a);

    // 1. The editor starts the Live Preview: astro dev in the container,
    //    serving the draft it was started with.
    await openEditor(page);
    let frame = await liveFrame(page);
    await expect.poll(async () => (await shown(frame)).body, { timeout: 120_000 }).toContain(a);

    // 2. B, written and synced: confirmed by the Worker, and then shown.
    await setDraft(page, b);
    const synced = await sync(page);
    expect(synced, JSON.stringify(synced)).toMatchObject({ success: true });
    const ticketB = synced.data!.ticket;
    const afterB = await shown(frame);
    expect(afterB.body).toContain(b);
    expect(afterB.body).not.toContain(a);

    // 3. The confirmation alone: what it reads, yes; what it does not, no.
    expect(await confirm(page, ticketB)).toMatchObject({
      success: true,
      data: { ticket: ticketB },
    });
    expect(await confirm(page, ticketB + 1000)).toMatchObject({
      success: false,
      error: "PREVIEW_CONTENT_NOT_CONFIRMED",
    });

    // 4. C, then D: the preview ends on D. One after the other, as one
    //    editor tab sends them. Two syncs at once end on the higher ticket
    //    too (preview-write-fence-sandbox.test.ts), but here the next page
    //    request was then interrupted by the platform in 2 of 2 runs (0 of 2
    //    one after the other); docs/astro-theme-plan.md 6.7, not located.
    await setDraft(page, c);
    const resultC = await sync(page);
    await setDraft(page, d);
    const resultD = await sync(page);
    expect(resultD, JSON.stringify(resultD)).toMatchObject({ success: true });
    expect(
      resultC.success || resultC.error === "PREVIEW_CONTENT_SUPERSEDED",
      JSON.stringify(resultC),
    ).toBe(true);
    for (let reload = 0; reload < 3; reload++) {
      const body = (await shown(frame)).body;
      expect(body).toContain(d);
      expect(body).not.toContain(c);
    }

    // 5. The preview stopped and started again: a new dev server, the
    //    latest draft, and tickets that keep counting.
    await setDraft(page, e);
    const stopped = (await serverFn(page, PREVIEW, "stopThemePreviewServer", scope)) as Answer;
    expect(stopped.success, JSON.stringify(stopped)).toBe(true);
    await openEditor(page);
    frame = await liveFrame(page);
    await expect.poll(async () => (await shown(frame)).body, { timeout: 120_000 }).toContain(e);
    const afterRestart = await sync(page);
    expect(afterRestart, JSON.stringify(afterRestart)).toMatchObject({ success: true });
    expect(afterRestart.data!.ticket).toBeGreaterThan(resultD.data!.ticket);
    expect((await shown(frame)).body).toContain(e);
  });
});
