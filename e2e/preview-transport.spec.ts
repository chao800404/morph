import { expect, test, type Page } from "@playwright/test";
import { EDITOR_PATH, openEditor, previewFrame } from "./helpers";

/**
 * How long the warm-up below may take, and why that much.
 *
 * Measured from every run log of 2026-11-21 and 2026-11-22 (27 container runs,
 * 101 sidecar runs): the first editor open of a container run took 20.8 s to
 * 62.5 s, median 43.5 s, and four of the sixteen on 11-22 ran out the 60 s
 * test timeout, so the transport check failed before it could look at the
 * transport. Its "preview frame" stage alone reached 45.1 s, one retry past
 * the 45 s ceiling every spec's `openEditor` uses. About twice the slowest
 * measured first open, so a slow machine is not a failure but a preview that
 * never comes up still is.
 */
const WARMUP_BUDGET_MS = 120_000;
/** Context creation and close, outside the budget so its message wins. */
const WARMUP_TEARDOWN_MS = 15_000;

/**
 * Starts the preview once and waits until it is ready, before the transport
 * check opens the editor for itself.
 *
 * The first open of a run pays for everything cold at once: the dev server
 * compiling the editor, the container being created, its Vite starting and
 * transforming the Theme for the first time. None of that is what the
 * precondition is about, and together it is most of a 60 s test. Reopening
 * a preview whose container is still running reuses it and its Vite: the
 * server's start took a median 0.7 s over the 631 such reopens in the same
 * logs, against 11.0 s for a run's first start.
 *
 * This proves nothing about the transport and asserts nothing about it: it
 * waits only for the product's own signs of a ready preview — the editor's
 * `[preview-server] ready` report, which it prints only for a started or
 * reused preview, the frame, a rendered section in it, and the structure the
 * preview reports back — each within what is left of its own budget, and it
 * fails with `PREVIEW_WARMUP_FAILED` naming the stage that did not arrive.
 * The check below then opens the editor in a page of its own, through the same
 * `openEditor` and the same 60 s and 45 s limits as before, and reads the
 * transport from that page's frame.
 */
async function warmPreview(page: Page) {
  const startedAt = Date.now();
  const deadline = startedAt + WARMUP_BUDGET_MS;
  const server: { line: string | null } = { line: null };
  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("[preview-server]")) server.line = text;
  });
  const done: string[] = [];
  const stage = async (
    name: string,
    run: (timeout: number) => Promise<unknown>,
  ) => {
    const stageStartedAt = Date.now();
    try {
      await test.step(`preview warm-up: ${name}`, async () => {
        await run(Math.max(1, deadline - Date.now()));
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `PREVIEW_WARMUP_FAILED: stalled at "${name}" after ${Date.now() - stageStartedAt}ms, ` +
          `${Date.now() - startedAt}ms into its ${WARMUP_BUDGET_MS}ms budget. ` +
          `The transport check did not run.\n` +
          `Completed: ${done.join(", ") || "none"}.\n` +
          `Preview server: ${server.line ?? "said nothing yet"}.\n\n` +
          reason,
      );
    }
    done.push(`${name} ${Date.now() - stageStartedAt}ms`);
  };

  await stage("document", (timeout) =>
    page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded", timeout }),
  );
  await stage("editor chrome", (timeout) =>
    expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout,
    }),
  );
  await stage("preview server ready", (timeout) =>
    expect
      .poll(() => server.line ?? "", { timeout })
      .toMatch(/^\[preview-server\] ready in /),
  );
  await stage("preview frame", (timeout) =>
    expect(page.locator("iframe").first()).toBeAttached({ timeout }),
  );
  await stage("theme rendered", (timeout) =>
    expect(
      previewFrame(page).locator("[data-storefront-section-id]").first(),
    ).toBeAttached({ timeout }),
  );
  await stage("structure reported", (timeout) =>
    expect(page.locator("[data-editor-tree-sortable]").first()).toBeAttached({
      timeout,
    }),
  );

  console.log(
    `[preview-warmup] ready in ${Date.now() - startedAt}ms of a ${WARMUP_BUDGET_MS}ms budget: ` +
      `${done.join(", ")}\n${server.line}`,
  );
}

// A hook rather than a test or a project of its own: it keeps the precondition
// one test with one title, which is what the report checks count, and a hook
// has its own timeout, so the budget above is not taken from the check's.
// Nothing to warm when the check is going to skip itself.
test.beforeAll(async ({ browser }) => {
  if (!process.env.E2E_EXPECT_PREVIEW_TRANSPORT || !EDITOR_PATH) return;
  test.setTimeout(WARMUP_BUDGET_MS + WARMUP_TEARDOWN_MS);
  const { baseURL, storageState, viewport } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState, viewport });
  try {
    await warmPreview(await context.newPage());
  } finally {
    await context.close();
  }
});

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

  if (process.env.MORPH_E2E_SIDECAR_SWAP === "1") {
    // The runner's sidecar swap mode (never CI): the first sidecar serves an
    // older bridge, which cannot acknowledge, so the editor pauses edits and
    // never makes its section tree sortable, and `openEditor` would wait for
    // that forever. The transport is read the same way, from the frame's
    // source, as soon as the frame is there.
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    await expect(page.locator("iframe").first()).toBeAttached({ timeout: 90_000 });
  } else {
    await openEditor(page);
  }
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
