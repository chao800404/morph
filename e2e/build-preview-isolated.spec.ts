import { expect, test } from "@playwright/test";

import { enableSelection } from "./helpers";

/**
 * The isolated Build Preview, in a real container.
 *
 * Building the Theme runs in the build container; previewing the result runs
 * the build's own Worker in a `BuildPreviewSandbox` container of its own, on
 * a `bp-<token>` host, reached through Core. This is the one place that
 * chain runs for real: the transport and policy tests use a stand-in sandbox.
 *
 * What it shows, in order: the editor frames a `bp-` host rather than the
 * static page; the build's Worker answers it; Core answers `/_morph/content`
 * there from the build's content snapshot.
 *
 * Requests to the preview host are made from inside the frame. Chromium
 * resolves `*.localhost` itself; Node, where Playwright's own request client
 * runs, does not.
 */
const EDITOR_PATH = process.env.E2E_EDITOR_PATH;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;

test.skip(
  !EDITOR_PATH,
  "Set E2E_EDITOR_PATH, or run through scripts/run-editor-e2e.mjs.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "The isolated Build Preview runs in containers; run with MORPH_E2E_TRANSPORT=cloudflare-sandbox.",
);

test.describe("isolated Build Preview", () => {
  // A build compiles the whole workspace in a container, and the preview
  // then starts a second one: minutes, not seconds.
  test.setTimeout(12 * 60_000);

  test("runs the build's own Worker on a host of its own, with the build's content", async ({
    page,
  }) => {
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    // The toolbar renders before the page hydrates; a click in that window
    // reaches nothing.
    await page.waitForTimeout(4_000);

    // A control that answers proves the editor has hydrated. Clicking Build
    // before that is received by nothing: the first run of this spec waited
    // ten minutes for a build that never started.
    await enableSelection(page);
    // Addressed by its stable attribute: the same control becomes the build's
    // cancel action while it runs.
    const build = page.locator("button[data-editor-build-action]");
    await expect(build).toBeEnabled({ timeout: 30_000 });
    await build.click();
    await expect(build).toHaveAttribute("data-build-pending", "true", {
      timeout: 30_000,
    });
    await expect(build).toHaveAttribute("data-build-pending", "false", {
      timeout: 9 * 60_000,
    });

    const frameElement = page.locator('iframe[data-build-preview="isolated"]');
    await expect(frameElement).toBeVisible({ timeout: 60_000 });
    const src = await frameElement.getAttribute("src");
    expect(src).toBeTruthy();
    const address = new URL(src!);
    expect(address.hostname).toMatch(/^bp-[0-9a-f]{40}\./);
    expect(address.origin).not.toBe(new URL(page.url()).origin);
    // Cross-origin, so the frame may have an origin of its own.
    expect(await frameElement.getAttribute("sandbox")).toBe(
      "allow-same-origin allow-scripts",
    );

    const previewFrame = () =>
      page.frame({ url: (url) => url.hostname === address.hostname });
    await expect.poll(previewFrame, { timeout: 120_000 }).toBeTruthy();
    const preview = previewFrame()!;

    // The build's Worker answered the document.
    await expect(preview.locator("body")).not.toBeEmpty({ timeout: 120_000 });

    // The Worker answers its own host: a document, not Core's refusal or an
    // executor error.
    const document = await preview.evaluate(async () => {
      const response = await fetch("/");
      return {
        status: response.status,
        type: response.headers.get("content-type"),
      };
    });
    expect(document.status).toBe(200);
    expect(document.type).toContain("text/html");

    // Core answers the content endpoint on the preview host, from the
    // build's snapshot, never cached. A build started from the toolbar has
    // no snapshot of its own yet, so what it holds is not asserted here; that
    // the container's own request for it reached the outbound policy is read
    // from the server's `[build-preview-egress]` line after the run.
    const content = await preview.evaluate(async () => {
      const response = await fetch("/_morph/content?path=/");
      return {
        status: response.status,
        cacheControl: response.headers.get("cache-control"),
        type: response.headers.get("content-type"),
      };
    });
    expect(content.status).toBe(200);
    expect(content.cacheControl).toBe("private, no-store");
    expect(content.type).toContain("application/json");
  });
});
