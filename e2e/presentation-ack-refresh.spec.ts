import { expect, test, type Page, type Request } from "@playwright/test";
import { EDITOR_PATH, openEditor } from "./helpers";
import {
  heroContentField,
  isServerFn,
  MARKER,
  restoreHero,
  restoreHeroAfterFailure,
  sharedEditor,
} from "./helpers/editor-writes-paused";

const BRIDGE_PATH = "/src/morph/preview-bridge.ts";
const WRITE_FUNCTION =
  /^(save|update|publish|delete|create|restore|write|reset|remove|rename|move|upload|promote|apply|set)[A-Z]/;

function isPreviewSubresource(page: Page, request: Request) {
  if (request.isNavigationRequest()) return false;
  try {
    return request.frame() !== page.mainFrame();
  } catch {
    return false;
  }
}

function countFrameDocuments(page: Page) {
  const documents: number[] = [];
  page.on("request", (request) => {
    if (!request.isNavigationRequest()) return;
    if (request.frame() === page.mainFrame()) return;
    documents.push(Date.now());
  });
  return documents;
}

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

function isStartThemePreviewServer(url: string) {
  return isServerFn(url, "startThemePreviewServer");
}

function uncachedHeaders(request: Request) {
  const headers = { ...request.headers() };
  delete headers["if-none-match"];
  delete headers["if-modified-since"];
  return headers;
}

async function fulfillUncachedBridge(
  route: Parameters<Parameters<Page["route"]>[1]>[0],
  response: Awaited<ReturnType<typeof route.fetch>>,
  body: string,
) {
  const headers = { ...response.headers() };
  delete headers["etag"];
  delete headers["last-modified"];
  headers["cache-control"] = "no-store";
  return route.fulfill({ response, headers, body });
}

function stripCapabilityFromBody(body: string) {
  return body.replaceAll(
    "section-presentation-ack-v1",
    "selection-field-section",
  );
}

function markOldFingerprintInBody(body: string) {
  return stripCapabilityFromBody(body).replace(/"[0-9a-f]{64}"/, `"${"0".repeat(64)}"`);
}

test.describe("presentation ack and unsupported bridge refresh", () => {
  test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to open the editor.");
  restoreHeroAfterFailure();

  test("normal edit receives accepted section-presentation-ack without validation rejection", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const { context, page } = await sharedEditor(browser);
    const rejectedAcks: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (
        text.includes("rejected by validation") &&
        text.includes("section-presentation-ack")
      ) {
        rejectedAcks.push(text);
      }
    });

    try {
      const field = await heroContentField(page, 0);
      const original = await field.inputValue();
      const updated = `${MARKER} ack ${Date.now()}`;

      await field.fill(updated);
      await expect(field).toHaveValue(updated);
      await expect(
        page.getByText("Preview syncing. Content writes are paused."),
      ).toHaveCount(0, { timeout: 20_000 });
      expect(rejectedAcks).toEqual([]);

      await field.fill(original);
      await expect(field).toHaveValue(original);
    } finally {
      await context.close();
      await restoreHero(browser);
    }
  });

  test("simulated swap: unsupported bridge auto-refreshes once to new bridge and ack takes effect", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const documents = countFrameDocuments(page);
    const serverFunctions = collectServerFunctions(page);
    const rejectedAcks: string[] = [];
    let strippedInitialBridge = 0;
    let startCalls = 0;

    page.on("console", (msg) => {
      const text = msg.text();
      if (
        text.includes("rejected by validation") &&
        text.includes("section-presentation-ack")
      ) {
        rejectedAcks.push(text);
      }
    });

    await page.route("**/*", async (route) => {
      const request = route.request();
      if (
        isPreviewSubresource(page, request) &&
        documents.length === 1 &&
        new URL(request.url()).pathname.endsWith(BRIDGE_PATH)
      ) {
        strippedInitialBridge += 1;
        const response = await route.fetch({ headers: uncachedHeaders(request) });
        const body = stripCapabilityFromBody(await response.text());
        return fulfillUncachedBridge(route, response, body);
      }
      if (
        request.method() === "POST" &&
        isStartThemePreviewServer(request.url())
      ) {
        startCalls += 1;
        if (startCalls === 1) {
          const response = await route.fetch();
          const body = markOldFingerprintInBody(await response.text());
          return route.fulfill({ response, body });
        }
      }
      return route.fallback();
    });

    try {
      await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
      await expect
        .poll(() => documents.length, {
          timeout: 60_000,
          message: "expected bounded single auto-refresh to new bridge",
        })
        .toBe(2);
      await expect(
        page.locator("[data-editor-tree-sortable]").first(),
      ).toBeAttached({ timeout: 45_000 });

      expect(strippedInitialBridge).toBe(1);
      expect(startCalls).toBeGreaterThanOrEqual(2);
      expect(
        serverFunctions.writes(),
        `no write should run during unsupported bridge auto-refresh (called: ${serverFunctions.called.join(", ")})`,
      ).toEqual([]);
      await expect(
        page.getByText("Could not update the preview."),
      ).toHaveCount(0);

      // Verify the reloaded bridge supports ack cleanly on a real edit.
      const field = await heroContentField(page, 0);
      const original = await field.inputValue();
      const updated = `${MARKER} swap ${Date.now()}`;
      await field.fill(updated);
      await expect(field).toHaveValue(updated);
      await field.fill(original);
      expect(rejectedAcks).toEqual([]);
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });

  test("still-unsupported service stops without looping and shows Reload preview button", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const documents = countFrameDocuments(page);
    let allowSupportedService = false;
    let startCalls = 0;

    await page.route("**/*", async (route) => {
      const request = route.request();
      if (
        !allowSupportedService &&
        isPreviewSubresource(page, request) &&
        new URL(request.url()).pathname.endsWith(BRIDGE_PATH)
      ) {
        const response = await route.fetch({ headers: uncachedHeaders(request) });
        const body = stripCapabilityFromBody(await response.text());
        return fulfillUncachedBridge(route, response, body);
      }
      if (
        !allowSupportedService &&
        request.method() === "POST" &&
        isStartThemePreviewServer(request.url())
      ) {
        startCalls += 1;
        const response = await route.fetch();
        const body = stripCapabilityFromBody(await response.text());
        return route.fulfill({ response, body });
      }
      return route.fallback();
    });

    try {
      await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
      await expect(
        page.getByText("Could not update the preview."),
      ).toBeVisible({ timeout: 60_000 });
      const reloadButton = page.getByRole("button", { name: "Reload preview" });
      await expect(reloadButton).toBeVisible();
      expect(documents).toHaveLength(1);
      expect(startCalls).toBeGreaterThanOrEqual(2);

      // Manual recovery once service supports the new bridge.
      allowSupportedService = true;
      await reloadButton.click();
      await expect
        .poll(() => documents.length, { timeout: 30_000 })
        .toBe(2);
      await expect(
        page.getByText("Could not update the preview."),
      ).toHaveCount(0);
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });

  test("auth or server failure during background bridge check does not auto-refresh", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const documents = countFrameDocuments(page);
    let startCalls = 0;

    await page.route("**/*", async (route) => {
      const request = route.request();
      if (
        isPreviewSubresource(page, request) &&
        documents.length === 1 &&
        new URL(request.url()).pathname.endsWith(BRIDGE_PATH)
      ) {
        const response = await route.fetch({ headers: uncachedHeaders(request) });
        const body = stripCapabilityFromBody(await response.text());
        return route.fulfill({ response, body });
      }
      if (
        request.method() === "POST" &&
        isStartThemePreviewServer(request.url())
      ) {
        startCalls += 1;
        if (startCalls >= 2) {
          return route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({ error: "Unauthorized" }),
          });
        }
      }
      return route.fallback();
    });

    try {
      await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
      await expect
        .poll(() => startCalls, { timeout: 45_000 })
        .toBeGreaterThanOrEqual(2);
      await page.waitForTimeout(2_000);
      expect(
        documents,
        "failed background check must not trigger an automatic reload",
      ).toHaveLength(1);
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });

  test("IME composing defers unsupported bridge refresh while preserving focus, caret, and text", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const documents = countFrameDocuments(page);
    const serverFunctions = collectServerFunctions(page);
    let stripBridge = false;
    let startCalls = 0;
    let releaseBackgroundStart: (() => void) | null = null;

    await page.route("**/*", async (route) => {
      const request = route.request();
      if (
        stripBridge &&
        isPreviewSubresource(page, request) &&
        new URL(request.url()).pathname.endsWith(BRIDGE_PATH)
      ) {
        const response = await route.fetch({ headers: uncachedHeaders(request) });
        const body = stripCapabilityFromBody(await response.text());
        return fulfillUncachedBridge(route, response, body);
      }
      if (
        request.method() === "POST" &&
        isStartThemePreviewServer(request.url())
      ) {
        startCalls += 1;
        if (startCalls === 1) {
          const response = await route.fetch();
          const body = markOldFingerprintInBody(await response.text());
          return route.fulfill({ response, body });
        }
        if (stripBridge) {
          await new Promise<void>((resolve) => {
            releaseBackgroundStart = resolve;
          });
        }
      }
      return route.fallback();
    });

    try {
      await openEditor(page);
      const field = await heroContentField(page, 0);
      const draft = `${MARKER} ime`;

      await field.click();
      await field.fill(draft);
      await expect(field).toBeFocused();
      await field.evaluate((el) => {
        const input = el as HTMLInputElement;
        input.setSelectionRange(2, 2);
        input.dispatchEvent(
          new CompositionEvent("compositionstart", {
            bubbles: true,
            data: "あ",
          }),
        );
      });

      // Reload the iframe once with an unsupported bridge while composing is active.
      stripBridge = true;
      await page.evaluate(() => {
        const iframe = document.querySelector("iframe");
        if (iframe) iframe.src = iframe.src;
      });
      await expect
        .poll(() => documents.length, { timeout: 30_000 })
        .toBe(2);
      await expect
        .poll(() => releaseBackgroundStart !== null, { timeout: 30_000 })
        .toBe(true);

      // Now let the background check confirm the new bridge while still composing.
      stripBridge = false;
      releaseBackgroundStart!();
      await page.waitForTimeout(1_500);

      // Must NOT have reloaded while composing; caret and draft text stay intact.
      expect(documents).toHaveLength(2);
      const state = await field.evaluate((el) => {
        const input = el as HTMLInputElement;
        return {
          value: input.value,
          selectionStart: input.selectionStart,
        };
      });
      expect(state.value).toBe(draft);
      expect(state.selectionStart).toBe(2);

      // End composition: deferred refresh must now run once.
      const writesBeforeEnd = serverFunctions.writes().length;
      await field.evaluate((el) => {
        el.dispatchEvent(
          new CompositionEvent("compositionend", { bubbles: true, data: "あ" }),
        );
      });
      await expect
        .poll(() => documents.length, { timeout: 30_000 })
        .toBe(3);
      expect(serverFunctions.writes().length).toBe(writesBeforeEnd);

      await expect(
        page.locator("[data-editor-tree-sortable]").first(),
      ).toBeAttached({ timeout: 45_000 });
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await restoreHero(browser);
    }
  });

  test("late or unknown presentation ack is ignored and real write + reload succeeds", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const { context, page } = await sharedEditor(browser);
    try {
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "morph:storefront-preview-section-presentation-ack",
            operationId: "late-unknown-op-id",
            token: {
              operationId: "late-unknown-op-id",
              sectionId: "starter-hero",
              routePath: "/",
              revision: 999999,
            },
            status: "applied",
          },
          window.location.origin,
        );
      });

      const field = await heroContentField(page, 0);
      const updated = `${MARKER} late-ack ${Date.now()}`;
      await field.fill(updated);
      await expect(field).toHaveValue(updated);
      await page.waitForTimeout(1_500);

      await page.reload({ waitUntil: "domcontentloaded" });
      await openEditor(page);
      const reloadedField = await heroContentField(page, 0);
      await expect(reloadedField).toHaveValue(updated);
    } finally {
      await context.close();
      await restoreHero(browser);
    }
  });
});
