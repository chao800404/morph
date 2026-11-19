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
  /** What the ready said served the page: `known:<instance>`, `mixed`, `missing` or `none`. */
  servedInstance: string;
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
 *
 * In each preview document it also keeps the section posts the editor sent
 * it with a presentation token (`presentationOperationsCarrying`), so an ack
 * can be tied to the write it answers by its operation id.
 */
async function observePreviewLifecycle(page: Page) {
  await page.addInitScript(() => {
    if (window.top !== window) {
      if (window.parent !== window.top) return;
      const posts: Array<{ operationId: string; props: string }> = [];
      (
        window as unknown as {
          __morphPresentationPosts?: typeof posts;
        }
      ).__morphPresentationPosts = posts;
      window.addEventListener("message", (event) => {
        if (event.source !== window.parent) return;
        const data = event.data;
        if (
          !data ||
          typeof data !== "object" ||
          data.type !== "morph:storefront-preview-update-section-props"
        ) {
          return;
        }
        const operationId = data.presentationToken?.operationId;
        if (typeof operationId !== "string" || !operationId) return;
        posts.push({ operationId, props: JSON.stringify(data.props ?? null) });
      });
      return;
    }
    const state = {
      readyEvents: [] as Array<{
        previewDocument: string;
        hasAckCapability: boolean;
        servedInstance: string;
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
        const served = data.servedInstance as
          | { kind?: unknown; instance?: { session?: unknown; serial?: unknown } }
          | undefined;
        state.readyEvents.push({
          previewDocument,
          hasAckCapability: capabilities.includes(
            "section-presentation-ack-v1",
          ),
          servedInstance:
            served?.kind === "known"
              ? `known:${String(served.instance?.session)}.${String(served.instance?.serial)}`
              : typeof served?.kind === "string"
                ? served.kind
                : "none",
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

/**
 * The operation ids of the presentation posts any preview document received
 * whose props carry `value`: the posts of the one write that typed it.
 */
async function presentationOperationsCarrying(
  page: Page,
  value: string,
): Promise<string[]> {
  const operations: string[] = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const posts = await frame
      .evaluate(
        () =>
          (
            window as unknown as {
              __morphPresentationPosts?: Array<{
                operationId: string;
                props: string;
              }>;
            }
          ).__morphPresentationPosts ?? [],
      )
      .catch(() => []);
    for (const post of posts) {
      if (post.props.includes(value)) operations.push(post.operationId);
    }
  }
  return operations;
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

/**
 * The first start's answer, made to look like an older service's: no
 * acknowledging capability, and another first digest. Stripping the
 * capability names "selection-field-section" twice in the serving report's
 * list, which the editor cannot read, so the report counts as absent — as
 * from a service that reports no serving bridge — and the frame it laid out
 * has no known version. Simulated: no real bridge or service changes.
 */
function markOldFingerprintInBody(body: string) {
  return stripCapabilityFromBody(body).replace(/"[0-9a-f]{64}"/, `"${"0".repeat(64)}"`);
}

/**
 * The first start's answer, made to look like an older service's: one that
 * reports no serving bridge at all. Its `servingBridge` is left out, and with
 * it `bridgeCapabilities`, which is only ever read from that report; its first
 * digest is another one. Nothing then says which bridge laid out the frame
 * that answer framed, so the frame's previous version is unknown to the
 * editor. Simulated: no real bridge or service changes.
 *
 * The answer is the server function's serialized tree; the two keys are taken
 * out of the object that holds them, with their values. If something else in
 * the answer refers to a value taken out, the answer is refused instead.
 */
function asOlderServiceAnswer(body: string): string {
  type Props = { k: unknown[]; v: unknown[] };
  const tree = JSON.parse(body) as unknown;
  const removedIds = new Set<number>();
  let omitted = 0;
  let digest = false;
  const idsIn = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (!Array.isArray(node) && typeof record.i === "number") {
      removedIds.add(record.i);
    }
    for (const value of Object.values(record)) idsIn(value);
  };
  const omit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const props = record.p as Partial<Props> | undefined;
    if (props && Array.isArray(props.k) && Array.isArray(props.v)) {
      for (let index = props.k.length - 1; index >= 0; index -= 1) {
        const key = props.k[index];
        if (key === "servingBridge" || key === "bridgeCapabilities") {
          idsIn(props.v[index]);
          props.k.splice(index, 1);
          props.v.splice(index, 1);
          if (key === "servingBridge") omitted += 1;
        } else if (key === "workspaceFingerprint") {
          const value = props.v[index] as { t?: unknown; s?: unknown };
          if (value?.t === 1 && typeof value.s === "string") {
            value.s = "0".repeat(64);
            digest = true;
          }
        }
      }
    }
    for (const value of Object.values(record)) omit(value);
  };
  const refersToRemoved = (node: unknown): boolean => {
    if (!node || typeof node !== "object") return false;
    const record = node as Record<string, unknown>;
    // An indexed value (t 4) names an earlier node by its id.
    if (
      record.t === 4 &&
      typeof record.i === "number" &&
      removedIds.has(record.i)
    ) {
      return true;
    }
    return Object.values(record).some(refersToRemoved);
  };
  omit(tree);
  if (omitted !== 1 || !digest || refersToRemoved(tree)) {
    throw new Error(
      `could not make an older service's answer (servingBridge omitted ${omitted}, digest ${digest})`,
    );
  }
  const out = JSON.stringify(tree);
  if (out.includes("servingBridge") || out.includes("bridgeCapabilities")) {
    throw new Error("the older service's answer still names a serving bridge");
  }
  return out;
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

      // The frame's acknowledgements from the edit on, read in the editor's
      // own window. Observation only.
      await page.evaluate(() => {
        const acks: Array<{ status: string }> = [];
        (window as unknown as { __normalEditAcks: typeof acks }).__normalEditAcks = acks;
        window.addEventListener("message", (event) => {
          const data = event.data as { type?: unknown; status?: unknown } | null;
          if (data?.type === "morph:storefront-preview-section-presentation-ack") {
            acks.push({ status: typeof data.status === "string" ? data.status : "" });
          }
        });
      });
      await field.fill(updated);
      await expect(field).toHaveValue(updated);
      // Leaving the field commits the edit; the frame acknowledges a
      // committed edit, not keystrokes still being typed.
      await field.press("Tab");
      // The edit is acknowledged as applied by the frame.
      await expect
        .poll(
          () =>
            page.evaluate(() =>
              (
                (window as unknown as { __normalEditAcks?: Array<{ status: string }> })
                  .__normalEditAcks ?? []
              ).some((ack) => ack.status === "applied"),
            ),
          { timeout: 20_000 },
        )
        .toBe(true);
      await expect(
        page.getByText("Preview syncing. Content writes are paused."),
      ).toHaveCount(0, { timeout: 20_000 });
      expect(rejectedAcks).toEqual([]);

      await field.fill(original);
      await field.press("Tab");
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
    /** What the first start's answer was made into; null until it is. */
    let olderServiceAnswer: string | null = null;
    // The editor's own account of each decision about the frame's bridge.
    const bridgeDecisions: string[] = [];

    page.on("console", (msg) => {
      const text = msg.text();
      if (text.startsWith("[preview-bridge]")) bridgeDecisions.push(text);
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
          // The service that framed the first page is an older one: it
          // says nothing about the bridge it serves.
          const response = await route.fetch();
          try {
            const body = asOlderServiceAnswer(await response.text());
            olderServiceAnswer = "no serving report";
            return route.fulfill({ response, body });
          } catch (error) {
            olderServiceAnswer = String(error);
            return route.abort();
          }
        }
      }
      return route.fallback();
    });

    try {
      await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
      await expect.poll(() => olderServiceAnswer, { timeout: 45_000 }).not.toBeNull();
      expect(
        olderServiceAnswer,
        "the first start answered as an older service, with no serving report",
      ).toBe("no serving report");
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
      const servedBy = afterRefresh.readyEvents
        .map((event) => `${event.hasAckCapability ? "ack" : "no-ack"}:${event.servedInstance}`)
        .join(" ");
      test.info().annotations.push(
        { type: "ready served instances", description: servedBy },
        { type: "bridge decisions", description: bridgeDecisions.join(" | ") },
      );
      console.log(`[simulated swap] ready served instances: ${servedBy}`);
      console.log(
        `[simulated swap] bridge decisions: ${bridgeDecisions.join(" | ")}`,
      );
      // The refresh is the bounded one, decided on a confirmed service and
      // an unknown previous version, and made once.
      expect(
        bridgeDecisions.filter((line) =>
          line.includes("previous version unknown: refreshing once"),
        ),
      ).toHaveLength(1);
      expect(
        bridgeDecisions.filter((line) => line.includes("not refreshing")),
      ).toEqual([]);
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
      // Leaving the field commits the edit; the frame acknowledges a
      // committed edit, not keystrokes still being typed.
      await field.press("Tab");
      // Only an acknowledgement of this edit's own write counts: one whose
      // operation id is a presentation post carrying the value just typed.
      // The refreshed frame also acknowledges what it presents on load, and
      // such an ack may arrive after the edit has begun.
      await expect
        .poll(
          async () => {
            const editOperations = await presentationOperationsCarrying(
              page,
              updated,
            );
            if (editOperations.length === 0) return false;
            const snap = await readLifecycle();
            return snap.acks.some(
              (ack) =>
                editOperations.includes(ack.operationId) &&
                ack.previewDocument === refreshedDoc &&
                ack.status === "applied",
            );
          },
          { timeout: 20_000 },
        )
        .toBe(true);
      await field.fill(original);
      await field.press("Tab");
      await expect(field).toHaveValue(original);
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
    let lastPreviewUrl = "";
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) return;
      const url = frame.url();
      if (url.includes("editorOrigin=")) {
        lastPreviewUrl = url;
      }
    });
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
      // Navigate to `lastPreviewUrl` (which keeps `editorOrigin` & `previewSession`
      // before client routing normalizes `window.location`, and avoids re-hitting
      // the one-time `/__morph/preview-auth/begin` URL in container runs).
      stripBridge = true;
      expect(lastPreviewUrl, "preview frame must have navigated with editorOrigin").toContain("editorOrigin=");
      const iframeHandle = await page.locator("iframe").first().elementHandle();
      const previewFrame = await iframeHandle?.contentFrame();
      expect(previewFrame, "preview iframe must have a contentFrame").toBeTruthy();
      await previewFrame!.evaluate((url) => {
        window.location.replace(url);
      }, lastPreviewUrl);
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
      const writeResponse = page.waitForResponse(
        (response) =>
          isServerFn(response.url(), "updateStorefrontThemeSectionProps") &&
          response.ok(),
        { timeout: 20_000 },
      );
      await field.fill(updated);
      await expect(field).toHaveValue(updated);
      await field.press("Tab");
      await writeResponse;

      const ids = new URL(page.url()).pathname.match(
        /\/store\/([^/]+)\/themes\/([^/]+)\/editor/,
      );
      expect(ids).toBeTruthy();
      await expect
        .poll(
          async () =>
            page.evaluate(
              async ([modulePath, storefrontId, themeId]) => {
                const fns = await import(/* @vite-ignore */ modulePath);
                const res = await fns.getStorefrontThemeEditor({
                  data: { storefrontId, themeId },
                });
                const templates = res?.data?.templates ?? [];
                for (const template of templates) {
                  for (const section of template?.document?.sections ?? []) {
                    if (section?.id === "starter-hero") {
                      return section?.props?.eyebrow;
                    }
                  }
                }
                return undefined;
              },
              [
                "/src/server/storefront/storefront-themes.serverFn.ts",
                ids![1],
                ids![2],
              ] as const,
            ),
          { timeout: 20_000 },
        )
        .toBe(updated);

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
