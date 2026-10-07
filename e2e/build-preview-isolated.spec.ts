import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  clickExposedElement,
  enableSelection,
  openContentTab,
  previewFrame,
  settleSelection,
} from "./helpers";

/**
 * The isolated Build Preview, in a real container.
 *
 * Building the Theme runs in the build container; previewing the result runs
 * the build's own Worker in a `BuildPreviewSandbox` container of its own, on
 * a `bp-<token>` host, reached through Core. This is the one place that
 * chain runs for real: the transport and policy tests use a stand-in sandbox.
 *
 * What it shows, in order: a value typed into the page's content is sealed
 * with the build; the editor frames a `bp-` host rather than the static page;
 * the build's Worker answers it; Core answers `/_morph/content` there from the
 * build's content snapshot, which holds the value; and the page the Worker
 * rendered shows it, read from inside its container.
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

    // A value only this run's draft holds, so the build's content snapshot can
    // be told apart from the Theme's defaults and from any earlier run. Typed
    // into the hero's field the way publish.spec.ts does it.
    const marker = `morph-bp-${randomUUID()}`;
    const field = page
      .locator('[data-slot="inspector-content-field"] input')
      .first();
    const section = page.getByRole("button", { name: "hero", exact: true });
    if (await section.isVisible().catch(() => false)) {
      await section.click();
      await settleSelection(page);
      await openContentTab(page);
    }
    if (!(await field.isVisible().catch(() => false))) {
      const selected = await clickExposedElement(
        page,
        previewFrame(page).locator(
          "h1[data-storefront-field], h2[data-storefront-field], p[data-storefront-field]",
        ),
      );
      expect(
        selected,
        "neither the section tree nor the canvas exposed an editable text field",
      ).not.toBeNull();
      await openContentTab(page);
    }
    await expect(field).toBeVisible({ timeout: 30_000 });
    await field.fill(marker);
    await field.press("Tab");
    await expect(
      previewFrame(page).getByText(marker, { exact: false }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      "Unpublished",
      { timeout: 30_000 },
    );

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

    const isolatedFrame = () =>
      page.frame({ url: (url) => url.hostname === address.hostname });
    await expect.poll(isolatedFrame, { timeout: 120_000 }).toBeTruthy();
    const preview = isolatedFrame()!;

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

    // Core answers the content endpoint on the preview host from the build's
    // snapshot, never cached — and the snapshot is the draft sealed when the
    // build was made, so it holds this run's marker.
    const content = await preview.evaluate(async () => {
      const response = await fetch("/_morph/content?path=/");
      return {
        status: response.status,
        cacheControl: response.headers.get("cache-control"),
        body: await response.text(),
      };
    });
    expect(content.status).toBe(200);
    expect(content.cacheControl).toBe("private, no-store");
    expect(content.body).toContain(marker);
    // And the page the build's Worker rendered carries it: Theme code read
    // that content from inside its container, through the outbound policy.
    await expect(
      preview.getByText(marker, { exact: false }).first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
