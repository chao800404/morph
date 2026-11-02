import { randomUUID } from "node:crypto";

import { expect, test, type Frame, type Page } from "@playwright/test";

import { decodeServerFnResult, isServerFunctionCall } from "./helpers";
import { editHero, openEditor, savedField } from "./native-acceptance";
import { themeScopeFromEditorPath } from "./native-compat";

/**
 * A saved edit reaches a running full Start preview on the container
 * transport without the preview being started again
 * (docs/astro-theme-plan.md 6.5: Start's own server reads the snapshot it
 * holds, and shows a saved edit once `syncThemePreviewContent` applies).
 *
 * The canvas shows typed text before any save, from the editor's own
 * messages, so that is not what this checks. It checks what the preview's
 * server reads:
 * - the sync answers applied, not refused;
 * - the address probe names a newer content ticket and a running instance;
 * - the document the server renders for the page carries the edit;
 * - the frame, reloaded, shows it;
 * - and no preview start was requested after the save.
 *
 * A new tab is #214 P3's to prove (preview-access-container.spec.ts).
 */

const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
const PREVIEW_RUNTIME = process.env.MORPH_E2E_PREVIEW_RUNTIME;
const EDITOR_PATH = process.env.E2E_EDITOR_PATH;

test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Run through scripts/run-editor-e2e.mjs: this writes the run's own D1.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "The container transport's content sync; run with MORPH_E2E_TRANSPORT=cloudflare-sandbox.",
);
test.skip(
  PREVIEW_RUNTIME !== "start",
  "Only a full Start preview reads its content on its server; run with MORPH_E2E_PREVIEW_RUNTIME=start.",
);

const HERO = '[data-storefront-section-id="starter-hero"]';
/** START_PREVIEW_ADDRESS_PROBE_PATH and its headers. */
const PROBE_PATH = "/_morph/preview-health";
const TICKET_HEADER = "x-morph-content-ticket";
const INSTANCE_HEADER = "x-morph-preview-instance";

/** The editor's preview frame: the one document not on the editor's origin. */
async function previewDocument(page: Page): Promise<Frame> {
  const editorOrigin = new URL(page.url()).origin;
  let found: Frame | undefined;
  await expect
    .poll(
      () => {
        found = page.frames().find((frame) => {
          const url = frame.url();
          return url.startsWith("http") && new URL(url).origin !== editorOrigin;
        });
        return Boolean(found);
      },
      { timeout: 90_000, message: "the preview frame has loaded" },
    )
    .toBe(true);
  return found!;
}

/** What the preview's server reads now, asked from inside the frame. */
function probe(frame: Frame) {
  return frame.evaluate(
    async ({ path, ticketHeader, instanceHeader }) => {
      const response = await fetch(path, { cache: "no-store" });
      return {
        status: response.status,
        ticket: Number(response.headers.get(ticketHeader) ?? "0"),
        instance: response.headers.get(instanceHeader) ?? "",
      };
    },
    { path: PROBE_PATH, ticketHeader: TICKET_HEADER, instanceHeader: INSTANCE_HEADER },
  );
}

/** The document the preview's server renders for `path`, fetched from the frame. */
function renderedDocument(frame: Frame, path: string) {
  return frame.evaluate(async (path) => {
    const response = await fetch(path, { cache: "no-store" });
    return { status: response.status, body: await response.text() };
  }, path);
}

test.describe("Start preview content sync on the container transport", () => {
  test.setTimeout(10 * 60_000);

  test("a saved edit reaches the running preview's server without a restart", async ({
    page,
  }) => {
    const scope = themeScopeFromEditorPath(EDITOR_PATH!);
    const starts: number[] = [];
    const syncs: unknown[] = [];
    page.on("response", async (response) => {
      const url = response.url();
      if (isServerFunctionCall(url, "startThemePreviewServer")) {
        starts.push(Date.now());
      } else if (isServerFunctionCall(url, "syncThemePreviewContent")) {
        syncs.push(decodeServerFnResult(await response.text().catch(() => "")));
      }
    });

    await openEditor(page);
    const frame = await previewDocument(page);
    await expect(frame.locator(HERO)).toBeVisible({ timeout: 90_000 });
    const before = await probe(frame);
    expect(before.status, "the address probe answers").toBe(200);
    const path = new URL(frame.url()).pathname;
    const startsBefore = starts.length;

    const marker = `Start sync ${randomUUID().slice(0, 8)}`;
    await editHero(page, marker);
    await savedField(page, scope, marker);

    await expect
      .poll(() => syncs.length, {
        timeout: 60_000,
        message: "the editor synced the saved draft into the preview",
      })
      .toBeGreaterThan(0);
    // Every observation is taken before any is judged, so a failing run
    // still records how the sync's answer, the snapshot the server reads and
    // what it renders relate.
    const applied = await expect
      .poll(() => syncs.at(-1), { timeout: 60_000 })
      .toMatchObject({ success: true })
      .then(() => true)
      .catch(() => false);
    const after = await probe(frame);
    const rendered = await renderedDocument(frame, path);
    await frame.evaluate(() => location.reload());
    const reloaded = await previewDocument(page);
    const reloadShows = await expect(
      reloaded.getByText(marker, { exact: false }).first(),
    )
      .toBeVisible({ timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    const startsAfter = starts.length - startsBefore;
    test.info().annotations.push({
      type: "observed",
      description: JSON.stringify({
        before,
        after,
        syncs,
        renderedStatus: rendered.status,
        renderedHasMarker: rendered.body.includes(marker),
        reloadShows,
        startsAfter,
      }),
    });

    expect.soft(applied, "the preview applied the sync").toBe(true);
    expect.soft(after.ticket, "the server reads a newer snapshot").toBeGreaterThan(
      before.ticket,
    );
    expect.soft(after.instance, "the snapshot names the running server").not.toBe("");
    expect.soft(rendered.status).toBe(200);
    expect.soft(rendered.body, "the server renders the saved edit").toContain(marker);
    expect.soft(reloadShows, "the reloaded frame shows the saved edit").toBe(true);
    expect.soft(startsAfter, "no preview start after the save").toBe(0);
  });
});
