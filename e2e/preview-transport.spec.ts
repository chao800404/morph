import { expect, test } from "@playwright/test";
import { EDITOR_PATH, openEditor } from "./helpers";

/**
 * Which preview transport the editor actually got.
 *
 * The editor specs cannot tell. They wait for a preview to render and then
 * drive it, and a preview is a preview whichever process produced it — so a run
 * meant to exercise the loopback sidecar would pass just as well after
 * silently falling back to the container, and the green would mean nothing
 * about the thing it was set up to prove. Wrangler even suggests the change
 * that would cause it: the `local_preview_e2e` environment omits `containers`
 * on purpose, and Wrangler warns that it "exists at the top level but not on
 * this environment".
 *
 * So this runs as a precondition rather than as a test. If the transport is
 * not the one the run asked for, nothing else runs at all.
 *
 * The check is the preview's own origin, which needs nothing added to the
 * application to observe: the sidecar serves from loopback, and the container
 * is reached through a rewritten `<id>.preview.localhost` host. The two cannot
 * be confused for each other.
 */
test("the preview comes from the expected transport", async ({ page }) => {
  const expected = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
  test.skip(
    !expected,
    "Set E2E_EXPECT_PREVIEW_TRANSPORT to assert which transport served the preview.",
  );
  test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to open the editor.");

  await openEditor(page);
  const source = await page.locator("iframe").first().getAttribute("src");
  expect(source, "the preview frame should have a source").toBeTruthy();
  const host = new URL(source!).hostname;

  // Loopback by literal, not by name: `preview.localhost` also ends in
  // `localhost`, and that is the container's host, so a suffix test would
  // accept exactly the case this exists to reject.
  const isLoopback = host === "127.0.0.1" || host === "localhost";

  if (expected === "local-sidecar") {
    expect(
      isLoopback,
      `expected the loopback sidecar to serve the preview, got "${host}". A container binding in this environment takes precedence over the local transport, so the run is exercising the sandbox instead.`,
    ).toBe(true);
  } else if (expected === "cloudflare-sandbox") {
    expect(
      isLoopback,
      `expected the sandbox container to serve the preview, got the loopback host "${host}".`,
    ).toBe(false);
  } else {
    throw new Error(
      `E2E_EXPECT_PREVIEW_TRANSPORT must be "local-sidecar" or "cloudflare-sandbox", not "${expected}".`,
    );
  }
});
