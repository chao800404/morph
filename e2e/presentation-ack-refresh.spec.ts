import { request as httpRequest } from "node:http";
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

type PreviewReadyObservation = {
  previewDocument: string;
  hasAckCapability: boolean;
};

type PreviewAckObservation = {
  previewDocument: string;
  status: string;
  operationId: string;
};

type PreviewLifecycleSnapshot = {
  readyEvents: PreviewReadyObservation[];
  distinctDocuments: string[];
  acks: PreviewAckObservation[];
};

/**
 * Observes actual preview-bridge ready and ack envelopes on the editor window.
 * Container access redirects never emit `morph:storefront-preview-ready`, so
 * they are never mistaken for a product preview reload.
 */
async function observePreviewLifecycle(page: Page) {
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const state = {
      readyEvents: [] as Array<{
        previewDocument: string;
        hasAckCapability: boolean;
      }>,
      acks: [] as Array<{
        previewDocument: string;
        status: string;
        operationId: string;
      }>,
    };
    (
      window as unknown as {
        __morphPreviewLifecycle?: typeof state;
      }
    ).__morphPreviewLifecycle = state;
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const previewDocument =
        typeof data.previewDocument === "string" ? data.previewDocument : "";
      if (!previewDocument) return;
      if (data.type === "morph:storefront-preview-ready") {
        const capabilities = Array.isArray(data.capabilities)
          ? data.capabilities
          : [];
        state.readyEvents.push({
          previewDocument,
          hasAckCapability: capabilities.includes(
            "section-presentation-ack-v1",
          ),
        });
      } else if (
        data.type === "morph:storefront-preview-section-presentation-ack"
      ) {
        state.acks.push({
          previewDocument,
          status: typeof data.status === "string" ? data.status : "",
          operationId:
            typeof data.operationId === "string" ? data.operationId : "",
        });
      }
    });
  });

  return async (): Promise<PreviewLifecycleSnapshot> =>
    page.evaluate(() => {
      const state = (
        window as unknown as {
          __morphPreviewLifecycle?: {
            readyEvents: PreviewReadyObservation[];
            acks: PreviewAckObservation[];
          };
        }
      ).__morphPreviewLifecycle ?? { readyEvents: [], acks: [] };
      const distinctDocuments: string[] = [];
      for (const entry of state.readyEvents) {
        if (!distinctDocuments.includes(entry.previewDocument)) {
          distinctDocuments.push(entry.previewDocument);
        }
      }
      return {
        readyEvents: [...state.readyEvents],
        distinctDocuments,
        acks: [...state.acks],
      };
    });
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

async function uncachedHeaders(page: Page, request: Request) {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(await request.allHeaders())) {
    if (key.startsWith(":")) continue;
    headers[key] = value;
  }
  delete headers["if-none-match"];
  delete headers["if-modified-since"];
  delete headers["accept-encoding"];
  if (!headers["cookie"]) {
    const cookies = await page.context().cookies(request.url());
    if (cookies.length > 0) {
      headers["cookie"] = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    }
  }
  return headers;
}

type LoopbackResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

/**
 * Fetches a preview subresource over loopback (`127.0.0.1` / `::1`) while
 * preserving the original `Host` header and cookies, because Node's DNS
 * resolver does not resolve `pv-*.preview.localhost` in container runs.
 */
async function fetchBridgeThroughLoopback(
  page: Page,
  request: Request,
): Promise<LoopbackResponse> {
  const url = new URL(request.url());
  const headers = await uncachedHeaders(page, request);
  const targetHost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1"
      ? url.hostname
      : "127.0.0.1";
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));

  const send = (host: string) =>
    new Promise<LoopbackResponse>((resolve, reject) => {
      const outgoing = httpRequest(
        {
          host,
          port,
          method: request.method(),
          path: url.pathname + url.search,
          headers: { ...headers, host: url.host },
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
          incoming.on("end", () => {
            const outHeaders: Record<string, string> = {};
            for (const [name, value] of Object.entries(incoming.headers)) {
              if (value === undefined) continue;
              outHeaders[name] = Array.isArray(value)
                ? value.join(", ")
                : value;
            }
            resolve({
              status: incoming.statusCode ?? 200,
              headers: outHeaders,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );
      outgoing.on("error", reject);
      outgoing.end();
    });

  return send(targetHost).catch((err: NodeJS.ErrnoException) => {
    if (err?.code === "ECONNREFUSED" && targetHost === "127.0.0.1") {
      return send("::1");
    }
    throw err;
  });
}

async function fulfillUncachedBridge(
  route: Parameters<Parameters<Page["route"]>[1]>[0],
  response: LoopbackResponse,
  body: string,
) {
  const headers = { ...response.headers };
  delete headers["etag"];
  delete headers["last-modified"];
  delete headers["content-encoding"];
  delete headers["content-length"];
  headers["cache-control"] = "no-store";
  return route.fulfill({ status: response.status, headers, body });
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
    const readLifecycle = await observePreviewLifecycle(page);
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
        strippedInitialBridge === 0 &&
        new URL(request.url()).pathname.endsWith(BRIDGE_PATH)
      ) {
        strippedInitialBridge += 1;
        const response = await fetchBridgeThroughLoopback(page, request);
        const body = stripCapabilityFromBody(response.body);
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
        .poll(
          async () => {
            const snap = await readLifecycle();
            const lastReady = snap.readyEvents.at(-1);
            return (
              snap.distinctDocuments.length === 2 &&
              Boolean(lastReady?.hasAckCapability)
            );
          },
          {
            timeout: 60_000,
            message:
              "expected bounded single auto-refresh to a new preview document with ack capability",
          },
        )
        .toBe(true);
      await expect(
        page.locator("[data-editor-tree-sortable]").first(),
      ).toBeAttached({ timeout: 45_000 });

      const afterRefresh = await readLifecycle();
      expect(strippedInitialBridge).toBe(1);
      expect(startCalls).toBeGreaterThanOrEqual(2);
      expect(afterRefresh.distinctDocuments).toHaveLength(2);
      expect(
        afterRefresh.readyEvents.some(
          (event) =>
            event.previewDocument === afterRefresh.distinctDocuments[0] &&
            !event.hasAckCapability,
        ),
        "initial preview document must have loaded the stripped bridge",
      ).toBe(true);
      expect(
        serverFunctions.writes(),
        `no write should run during unsupported bridge auto-refresh (called: ${serverFunctions.called.join(", ")})`,
      ).toEqual([]);
      await expect(
        page.getByText("Could not update the preview."),
      ).toHaveCount(0);

      // Verify the reloaded bridge supports ack cleanly on a real edit.
      const refreshedDoc = afterRefresh.distinctDocuments[1];
      const field = await heroContentField(page, 0);
      const original = await field.inputValue();
      const updated = `${MARKER} swap ${Date.now()}`;
      await field.fill(updated);
      await expect(field).toHaveValue(updated);
      await expect
        .poll(
          async () => {
            const snap = await readLifecycle();
            return snap.acks.some(
              (ack) =>
                ack.previewDocument === refreshedDoc &&
                ack.status === "applied",
            );
          },
          { timeout: 20_000 },
        )
        .toBe(true);
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
    const readLifecycle = await observePreviewLifecycle(page);
    let allowSupportedService = false;
    let strippedBridgeCount = 0;
    let startCalls = 0;

    await page.route("**/*", async (route) => {
      const request = route.request();
      if (
        !allowSupportedService &&
        isPreviewSubresource(page, request) &&
        new URL(request.url()).pathname.endsWith(BRIDGE_PATH)
      ) {
        strippedBridgeCount += 1;
        const response = await fetchBridgeThroughLoopback(page, request);
        const body = stripCapabilityFromBody(response.body);
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
      const beforeManualReload = await readLifecycle();
      expect(strippedBridgeCount).toBeGreaterThanOrEqual(1);
      expect(beforeManualReload.distinctDocuments).toHaveLength(1);
      expect(startCalls).toBeGreaterThanOrEqual(2);

      // Manual recovery once service supports the new bridge.
      allowSupportedService = true;
      await reloadButton.click();
      await expect
        .poll(
          async () => {
            const snap = await readLifecycle();
            const lastReady = snap.readyEvents.at(-1);
            return (
              snap.distinctDocuments.length === 2 &&
              Boolean(lastReady?.hasAckCapability)
            );
          },
          { timeout: 30_000 },
        )
        .toBe(true);
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
    const readLifecycle = await observePreviewLifecycle(page);
    let strippedInitialBridge = 0;
    let startCalls = 0;

    await page.route("**/*", async (route) => {
      const request = route.request();
      if (
        isPreviewSubresource(page, request) &&
        strippedInitialBridge === 0 &&
        new URL(request.url()).pathname.endsWith(BRIDGE_PATH)
      ) {
        strippedInitialBridge += 1;
        const response = await fetchBridgeThroughLoopback(page, request);
        const body = stripCapabilityFromBody(response.body);
        return fulfillUncachedBridge(route, response, body);
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
      const snap = await readLifecycle();
      expect(strippedInitialBridge).toBe(1);
      expect(
        snap.distinctDocuments,
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
    const readLifecycle = await observePreviewLifecycle(page);
    const serverFunctions = collectServerFunctions(page);
    let stripBridge = false;
    let strippedBridgeCount = 0;
    let startCalls = 0;
    let releaseBackgroundStart: (() => void) | null = null;

    await page.route("**/*", async (route) => {
      const request = route.request();
      if (
        stripBridge &&
        isPreviewSubresource(page, request) &&
        new URL(request.url()).pathname.endsWith(BRIDGE_PATH)
      ) {
        strippedBridgeCount += 1;
        const response = await fetchBridgeThroughLoopback(page, request);
        const body = stripCapabilityFromBody(response.body);
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
      const beforeReload = await readLifecycle();
      expect(beforeReload.distinctDocuments).toHaveLength(1);

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
      // Reload the active frame document itself (not `iframe.src`, which in
      // container runs holds a one-time `/__morph/preview-auth/begin` URL).
      stripBridge = true;
      const previewFrame = await page
        .locator("iframe")
        .first()
        .contentFrame();
      expect(previewFrame, "preview iframe must have a contentFrame").not.toBeNull();
      await previewFrame!.evaluate(() => window.location.reload());
      await expect
        .poll(
          async () => {
            const snap = await readLifecycle();
            return (
              strippedBridgeCount >= 1 &&
              snap.distinctDocuments.length === 2 &&
              releaseBackgroundStart !== null
            );
          },
          { timeout: 30_000 },
        )
        .toBe(true);

      // Now let the background check confirm the new bridge while still composing.
      stripBridge = false;
      releaseBackgroundStart!();
      await page.waitForTimeout(1_500);

      // Must NOT have reloaded while composing; caret and draft text stay intact.
      const whileComposing = await readLifecycle();
      expect(whileComposing.distinctDocuments).toHaveLength(2);
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
        .poll(
          async () => {
            const snap = await readLifecycle();
            const lastReady = snap.readyEvents.at(-1);
            return (
              snap.distinctDocuments.length === 3 &&
              Boolean(lastReady?.hasAckCapability)
            );
          },
          { timeout: 30_000 },
        )
        .toBe(true);
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
