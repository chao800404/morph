import { expect, test, type Page, type Request } from "@playwright/test";
import { EDITOR_PATH, enableSelection } from "./helpers";

/**
 * A full Start preview whose bridge the proxy's interruption refused.
 *
 * The Start runtime loads its bridge with `import()` after hydration. When the
 * proxy gives up on an interruption (503 PREVIEW_RUNTIME_INTERRUPTED), that
 * import fails and the page never announces itself — and, unlike a module
 * script, a failed `import()` fires no `error` on any element, so the editor
 * used to hear nothing and wait out its load watchdog: almost a minute of
 * "Loading", while the preview server itself answered every probe as serving.
 * The runtime now names the module it could not import, and the editor
 * reconnects at once through the same bounded recovery as a refused module
 * script (preview-frame-load.spec.ts covers that for the client-only preview).
 *
 * The bridge request is answered from inside the frame's network, so the
 * preview server stays healthy and its address probe keeps saying "serving",
 * which is the state #302's container run was in.
 */
const RUNTIME = process.env.MORPH_E2E_PREVIEW_RUNTIME;
const BRIDGE = "/src/morph/preview-bridge.ts";
/** The load watchdog's no-progress window: recovery must not be waiting on it. */
const WATCHDOG_WINDOW_MS = 45_000;

function isPreviewSubresource(page: Page, request: Request) {
  if (request.isNavigationRequest()) return false;
  try {
    return request.frame() !== page.mainFrame();
  } catch {
    return false;
  }
}

/** Every document the preview frame loads: one per attempt to show it. */
function countFrameDocuments(page: Page) {
  const documents: number[] = [];
  page.on("request", (request) => {
    if (!request.isNavigationRequest()) return;
    if (request.frame() === page.mainFrame()) return;
    documents.push(Date.now());
  });
  return documents;
}

function interruptedModule() {
  return {
    status: 503,
    contentType: "application/json",
    headers: { "Cache-Control": "no-store" },
    body: JSON.stringify({
      error:
        "Live Preview's runtime was interrupted while serving this module. Reload the preview.",
      code: "PREVIEW_RUNTIME_INTERRUPTED",
    }),
  };
}

function collectLifecycle(page: Page) {
  const lines: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("[preview-lifecycle]")) lines.push(text);
  });
  return lines;
}

/**
 * The server functions the editor called, by exported name, and those that
 * write. Recovering a frame reconnects the preview and nothing else: no
 * change is sent again because the frame had to be loaded again.
 */
const WRITE_FUNCTION =
  /^(save|update|publish|delete|create|restore|write|reset|remove|rename|move|upload|promote|apply|set)[A-Z]/;
function collectServerFunctions(page: Page) {
  const called: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const id = request.url().split("/_serverFn/")[1]?.split(/[/?]/)[0];
    if (!id) return;
    try {
      const decoded = JSON.parse(
        Buffer.from(
          id.replace(/-/g, "+").replace(/_/g, "/"),
          "base64",
        ).toString("utf8"),
      ) as { export?: string };
      called.push(
        (decoded.export ?? "?").replace(/_createServerFn_handler$/, ""),
      );
    } catch {
      called.push("?");
    }
  });
  return {
    called,
    writes: () => called.filter((name) => WRITE_FUNCTION.test(name)),
  };
}

test.describe("a full Start preview whose bridge an interruption refused", () => {
  test.skip(
    RUNTIME !== "start",
    "Start preview only: it imports the bridge with import().",
  );
  test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to open the editor.");

  test("is reconnected at once, without waiting for the load watchdog", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const documents = countFrameDocuments(page);
    const lifecycle = collectLifecycle(page);
    const serverFunctions = collectServerFunctions(page);
    let refused = 0;

    // Only the first document's bridge is refused, as an interruption that
    // has ended by the time the frame is loaded again.
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (!isPreviewSubresource(page, request)) return route.fallback();
      if (
        documents.length === 1 &&
        new URL(request.url()).pathname.endsWith(BRIDGE)
      ) {
        refused += 1;
        return route.fulfill(interruptedModule());
      }
      await route.fallback();
    });

    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    await expect
      .poll(() => documents.length, { timeout: 180_000 })
      .toBeGreaterThanOrEqual(2);
    await enableSelection(page);

    expect(refused, "the first document asked for the bridge").toBe(1);
    expect(documents, "one reconnect, to a new document").toHaveLength(2);
    // Reconnected because the page said why, not because it fell silent.
    expect(documents[1] - documents[0]).toBeLessThan(WATCHDOG_WINDOW_MS);
    expect(lifecycle).toContainEqual(
      expect.stringMatching(
        /^\[preview-lifecycle\] reconnecting recoveries=1 \| Live Preview was interrupted while loading/,
      ),
    );
    expect(lifecycle).not.toContainEqual(
      expect.stringMatching(/loading timed out/),
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(
      serverFunctions.writes(),
      `no write was sent while recovering (called: ${serverFunctions.called.join(", ")})`,
    ).toEqual([]);
  });

  test("is given up on after one reconnect if the interruption goes on, and asks for Retry", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const documents = countFrameDocuments(page);
    const serverFunctions = collectServerFunctions(page);
    let retried = false;

    await page.route("**/*", async (route) => {
      const request = route.request();
      if (!isPreviewSubresource(page, request)) return route.fallback();
      if (!retried && new URL(request.url()).pathname.endsWith(BRIDGE)) {
        return route.fulfill(interruptedModule());
      }
      await route.fallback();
    });

    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const alert = page.getByRole("alert").filter({
      hasText: "Live Preview was interrupted while loading",
    });
    await expect(alert).toBeVisible({ timeout: 180_000 });
    expect(
      documents,
      "one automatic reconnect, then no more attempts",
    ).toHaveLength(2);
    expect(documents[1] - documents[0]).toBeLessThan(WATCHDOG_WINDOW_MS);
    expect(
      serverFunctions.writes(),
      `no write was sent while recovering (called: ${serverFunctions.called.join(", ")})`,
    ).toEqual([]);

    retried = true;
    await alert.getByRole("button", { name: "Retry Preview" }).click();
    await expect
      .poll(() => documents.length, { timeout: 120_000 })
      .toBeGreaterThan(2);
    await enableSelection(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});
