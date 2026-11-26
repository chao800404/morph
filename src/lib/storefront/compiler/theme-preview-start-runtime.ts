import { themePreviewContentModuleSource } from "./theme-preview-content";
import {
  THEME_PREVIEW_MODULE_FAILED_EVENT,
  themePreviewDiagnosticScriptSource,
} from "./theme-preview-diagnostic-script";
import { THEME_PREVIEW_BRIDGE_PATH } from "./theme-preview-bridge-entry";
import {
  PREVIEW_ADDRESS_PROBE_BODY,
  START_PREVIEW_ADDRESS_PROBE_PATH,
  START_PREVIEW_ID_HEADER,
} from "../service/preview-address-probe";
import {
  THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH,
  THEME_PREVIEW_CONTENT_MODULE_PATH,
  THEME_PREVIEW_CONTENT_PATH,
  THEME_PREVIEW_CONTENT_UNREADABLE_BODY,
  THEME_PREVIEW_CONTENT_UNREADABLE_STATUS,
} from "./theme-preview-content";

/** The address probe's header naming the content snapshot the Worker reads. */
export const PREVIEW_CONTENT_TICKET_HEADER = "x-morph-content-ticket";
/** The address probe's header naming the dev server the Worker belongs to. */
export const PREVIEW_INSTANCE_HEADER = "x-morph-preview-instance";

/**
 * The Live Preview that runs TanStack Start itself (PROTOTYPE).
 *
 * The client-only preview builds the Theme for the browser with no Start
 * server, so a loader calling a server function, a server route, a cookie
 * helper or request middleware cannot run there. This variant serves the same
 * workspace through the Start and Cloudflare Vite plugins, the way the
 * runtime build does, so SSR and every server API run in workerd inside the
 * preview's own container — the same runtime the published Theme Worker uses.
 *
 * Morph adds two platform files, never authored and never shipped:
 *
 * - a Worker entry that wraps Start's own `server-entry`. It is the one place
 *   the platform decides what Theme server code can reach: the draft content
 *   it may read, the outbound requests it may make, and the editor scripts
 *   added to each page.
 * - a client module the entry adds to every page, which loads the editor
 *   bridge once React has hydrated the server's HTML.
 *
 * Paths are platform-owned (see `isPlatformOwnedThemeBuildPath`), so an
 * author cannot write either one.
 */

/** Platform-owned Worker entry of a Start Live Preview. */
export const THEME_PREVIEW_START_WORKER_PATH = "__morph_preview_worker.ts";

/** Platform-owned browser module every Start Live Preview page loads. */
export const THEME_PREVIEW_START_CLIENT_PATH = "__morph_preview_client.ts";

/**
 * Origin Theme server code is told to read draft content from.
 *
 * `.invalid` can never resolve (RFC 2606), so nothing but the preview Worker
 * entry can answer it: a request that escaped the entry would fail rather
 * than reach some other host.
 */
export const THEME_PREVIEW_START_CONTENT_ORIGIN =
  "http://morph-preview-content.invalid";

/**
 * Outbound requests Theme server code may make from the Live Preview.
 *
 * Deny first. Everything a hostname can say about being internal is refused:
 * loopback, private, link-local (cloud metadata) and carrier-grade NAT
 * addresses, every IPv6 literal, and names that only resolve inside a
 * machine or a platform. Anything else is a public host and is passed on.
 *
 * This is a JavaScript-level check, so it cannot see where a public name
 * resolves: a name pointing at a private address passes it. It is the first
 * layer only. The container's own egress policy (Cloudflare Containers
 * `enableInternet` / `allowedHosts` / outbound handlers) is where that is
 * enforced, and the design note lists what is still open.
 *
 * Self-contained: embedded in the generated Worker entry through `toString()`.
 */
export function previewOutboundRefusal(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "invalid-url";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "protocol";
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") || host.includes(":")) return "ipv6-literal";
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host.endsWith(".invalid") ||
    host.endsWith(".test") ||
    host === "metadata" ||
    host === "metadata.google.internal"
  ) {
    return "internal-name";
  }
  if (!host.includes(".")) return "single-label-name";
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (/^[0-9.]+$/.test(host) && !ipv4) return "ip-literal";
  if (/^0x|\.0x/i.test(host) || /^\d+$/.test(host)) return "ip-literal";
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    ) {
      return "private-address";
    }
  }
  return null;
}

/**
 * The `Server-Timing` description naming the content snapshot a page was
 * rendered from: `morph-content;desc="<ticket>.<instance>"`, the metric
 * `PREVIEW_SERVED_CONTENT_TIMING` (preview-protocol.ts; tested equal, as this
 * runs in the Worker and names no import). Null for a snapshot that names no
 * usable ticket or instance: nothing is stamped then.
 *
 * Narrowing evidence only (handoff/2026-11-24/astro-presentation-ack-options.md,
 * option B): the page runs author code and can forge it, so the editor accepts
 * an acknowledgement only when it equals what Core itself confirmed, and Core
 * never reads it.
 *
 * Self-contained: embedded in the generated Worker entry through `toString()`.
 */
export function previewServedContentTiming(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const ticket = (snapshot as { contentTicket?: unknown }).contentTicket;
  const instance = (snapshot as { previewInstance?: unknown }).previewInstance;
  if (
    typeof ticket !== "number" ||
    !Number.isSafeInteger(ticket) ||
    ticket < 1
  ) {
    return null;
  }
  if (typeof instance !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(instance)) {
    return null;
  }
  return 'morph-content;desc="' + ticket + "." + instance + '"';
}

/**
 * Runs one request with ONE content snapshot, read at its entry (option 1 of
 * handoff/2026-11-24/astro-basis-ack-prereq.md). `load` reads the snapshot;
 * a read that fails pins `{ ok: false }`, so the request's content reads are
 * refused rather than served from another read. The pinned value is held in
 * `storage` for the request's whole async extent, including what renders
 * while its body streams, and handed to `handler`.
 *
 * Self-contained: embedded in the generated Worker entry through `toString()`.
 */
export function runWithPinnedSnapshot<T>(
  storage: {
    run<R>(store: unknown, callback: () => R): R;
  },
  load: () => Promise<unknown>,
  handler: (pinned: { ok: boolean; snapshot: unknown }) => Promise<T>,
): Promise<T> {
  return Promise.resolve()
    .then(load)
    .then(
      (snapshot) => ({ ok: true, snapshot }),
      () => ({ ok: false, snapshot: null }),
    )
    .then((pinned) => storage.run(pinned, () => handler(pinned)));
}

/**
 * The snapshot a content read inside a pinned request is answered from, or
 * why it is refused: no pinned request around it (the read escaped the
 * request's async context), or its entry read failed. Never a live read.
 *
 * Self-contained: embedded in the generated Worker entry through `toString()`.
 */
export function pinnedSnapshotForRead(storage: {
  getStore(): unknown;
}): { snapshot: unknown } | { refusal: string } {
  const pinned = storage.getStore() as
    | { ok?: unknown; snapshot?: unknown }
    | undefined;
  if (!pinned || typeof pinned !== "object") {
    return { refusal: "no-request-snapshot" };
  }
  if (pinned.ok !== true) return { refusal: "snapshot-unreadable" };
  return { snapshot: pinned.snapshot };
}

/** Options of `themePreviewStartWorkerSource`. Off unless named. */
export type ThemePreviewWorkerOptions = Readonly<{
  /**
   * Astro Live Preview only: pin one content snapshot per request and stamp
   * it on the page (`runWithPinnedSnapshot`, `previewServedContentTiming`).
   * A Start preview never sets it; its Worker is unchanged byte for byte.
   */
  pinRequestSnapshot?: boolean;
}>;

/** The page path of a Start preview, exactly as it was before the option. */
const START_PAGE_BLOCK = `    const headers = new Headers(request.headers);
    headers.set("x-morph-content-origin", CONTENT_ORIGIN);
    const response = await startEntry.fetch(new Request(request, { headers }), env, ctx);
    const type = response.headers.get("content-type") || "";
    if (!type.toLowerCase().startsWith("text/html")) return response;
    // First in <head>; a document written without one (Astro adds none)
    // gets them first in <body>, and one with neither at its end. Once per
    // response either way.
    let injected = false;
    const first = {
      element(element) {
        if (injected) return;
        injected = true;
        element.prepend(HEAD_SCRIPTS, { html: true });
      },
    };
    return new HTMLRewriter()
      .on("head", first)
      .on("body", first)
      .onDocument({
        end(end) {
          if (injected) return;
          injected = true;
          end.append(HEAD_SCRIPTS, { html: true });
        },
      })
      .transform(response);
`;

/**
 * The page path with a pinned snapshot: the same request, scripts and
 * rewriting, run inside one pinned snapshot, and the page response stamped
 * with it beside whatever Server-Timing the response already names.
 */
const PINNED_PAGE_BLOCK = `    return runWithPinnedSnapshot(requestSnapshots, loadSnapshot, async (pinned) => {
      const headers = new Headers(request.headers);
      headers.set("x-morph-content-origin", CONTENT_ORIGIN);
      const response = await startEntry.fetch(new Request(request, { headers }), env, ctx);
      const type = response.headers.get("content-type") || "";
      if (!type.toLowerCase().startsWith("text/html")) return response;
      // First in <head>; a document written without one (Astro adds none)
      // gets them first in <body>, and one with neither at its end. Once per
      // response either way.
      let injected = false;
      const first = {
        element(element) {
          if (injected) return;
          injected = true;
          element.prepend(HEAD_SCRIPTS, { html: true });
        },
      };
      const rewritten = new HTMLRewriter()
        .on("head", first)
        .on("body", first)
        .onDocument({
          end(end) {
            if (injected) return;
            injected = true;
            end.append(HEAD_SCRIPTS, { html: true });
          },
        })
        .transform(response);
      // The snapshot every content read of this request was answered from,
      // fixed before the page started rendering: a header sent before the
      // body streams still names what the whole page read.
      const stamp = pinned.ok ? previewServedContentTiming(pinned.snapshot) : null;
      if (!stamp) return rewritten;
      const stamped = new Response(rewritten.body, rewritten);
      stamped.headers.append("Server-Timing", stamp);
      return stamped;
    });
`;

/**
 * The resolver the content endpoint uses, lifted out of the browser module so
 * the Worker answers a path exactly as the page and the dev server do.
 */
function contentResolverSource(): string {
  const source = themePreviewContentModuleSource();
  const bodyStart = source.indexOf("function templateTypeForPath");
  const bodyEnd = source.indexOf("export function updatePreviewContent");
  if (bodyStart < 0 || bodyEnd < 0) {
    throw new Error("PREVIEW_CONTENT_RESOLVER_CONTRACT_CHANGED");
  }
  return source
    .slice(bodyStart, bodyEnd)
    .replace(
      "export function previewContentForPath",
      "function previewContentForPath",
    );
}

/**
 * Source of the preview Worker entry.
 *
 * Start's own `server-entry` handles every request; this only decides what
 * surrounds it:
 *
 * - The request gains `x-morph-content-origin`, the header the published
 *   runtime uses to tell Theme server code where content comes from. Here it
 *   names an origin only this entry answers, from the draft snapshot laid out
 *   with the workspace: render-only values, never a store capability.
 * - `fetch` from Theme server code goes through `previewOutboundRefusal`.
 * - An HTML page gains the diagnostic script and the client module, first in
 *   `<head>`, so they run before the Theme's own scripts as the client-only
 *   preview's document ordered them; first in `<body>` for a document with
 *   no `<head>`, and at the end of one with neither.
 *
 * The Worker is given no bindings: there is nothing in `env` to reach.
 *
 * `options.pinRequestSnapshot` (Astro only) answers every content read of a
 * request from one snapshot read at its entry, and stamps that snapshot on
 * the page (`ThemePreviewWorkerOptions`). Without it the output is exactly
 * what it was before the option existed (tested against a frozen copy).
 */
export function themePreviewStartWorkerSource(
  previewId = "",
  serverEntry = "@tanstack/react-start/server-entry",
  options: ThemePreviewWorkerOptions = {},
): string {
  const pin = options.pinRequestSnapshot === true;
  const pinImports = pin
    ? 'import { AsyncLocalStorage } from "node:async_hooks";\n'
    : "";
  const pinHelpers = pin
    ? `
// One snapshot per request (Astro): read once at the request's entry, and
// every content read made while it runs is answered from it, never from a
// newer one written mid-render or from another request's.
// One store for every evaluation of this module: the dev server evaluates it
// again after a full reload, and the newest evaluation's fetch (the global
// one) must find a snapshot pinned by a request still running through an
// earlier evaluation's entry.
const requestSnapshots = (globalThis[Symbol.for("morph.preview.requestSnapshots")] ??= new AsyncLocalStorage());
const runWithPinnedSnapshot = ${runWithPinnedSnapshot.toString()};
const pinnedSnapshotForRead = ${pinnedSnapshotForRead.toString()};
const previewServedContentTiming = ${previewServedContentTiming.toString()};

// Through readSnapshot, so a request pins the newest snapshot this Worker
// has read: an import settling with an older module never becomes one, and
// a page loaded after the probe named a ticket renders at least that one.
async function loadSnapshot() {
  await readSnapshot();
  // Nothing readable kept: none is pinned, and every content read of the
  // request is refused as an unreadable live read is.
  return snapshot === null ? null : JSON.parse(JSON.stringify(snapshot));
}
`
    : "";
  const contentRead = pin
    ? `    // Refused exactly as an unreadable live read is: no request pinned one
    // around it, or its entry read found nothing readable.
    const read = pinnedSnapshotForRead(requestSnapshots);
    if (read.refusal) {
      console.warn("[morph-preview] content read refused (" + read.refusal + ")");
      return new Response(JSON.stringify(${JSON.stringify(THEME_PREVIEW_CONTENT_UNREADABLE_BODY)}), {
        status: ${THEME_PREVIEW_CONTENT_UNREADABLE_STATUS},
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
    // Answered from the pinned snapshot, synchronously: nothing can replace
    // it between. The Worker's own newest read, the one the probe names, is
    // put back after, so a request pinned to an older one never lowers it.
    const live = snapshot;
    snapshot = read.snapshot;
    let content = null;
    try {
      content = previewContentForPath(url.searchParams.get("path") || "/");
    } catch {
      content = null;
    } finally {
      snapshot = live;
    }
    return new Response(
      JSON.stringify(content || ${JSON.stringify(THEME_PREVIEW_CONTENT_UNREADABLE_BODY)}),
      {
        status: content ? 200 : ${THEME_PREVIEW_CONTENT_UNREADABLE_STATUS},
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      },
    );
`
    : `    // A data file that is missing or not JSON fails its import, and a
    // snapshot without this path's entry resolves to null: either way the
    // read is refused, never answered with empty content.
    let content = null;
    try {
      await readSnapshot();
      content = previewContentForPath(url.searchParams.get("path") || "/");
    } catch {
      content = null;
    }
    return new Response(
      JSON.stringify(content || ${JSON.stringify(THEME_PREVIEW_CONTENT_UNREADABLE_BODY)}),
      {
        status: content ? 200 : ${THEME_PREVIEW_CONTENT_UNREADABLE_STATUS},
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      },
    );
`;
  return `import startEntry from ${JSON.stringify(serverEntry)};
${pinImports}
const CONTENT_ORIGIN = ${JSON.stringify(THEME_PREVIEW_START_CONTENT_ORIGIN)};
const CONTENT_PATH = ${JSON.stringify(THEME_PREVIEW_CONTENT_PATH)};
const previewOutboundRefusal = ${previewOutboundRefusal.toString()};

// None until one is read: a path is never answered from a snapshot this
// Worker has not read (THEME_PREVIEW_CONTENT_UNREADABLE_BODY).
let snapshot = null;
${contentResolverSource()}${pinHelpers}

async function readSnapshot() {
  // The data file itself, the one the dev server's content endpoint reads
  // too, re-imported on each read: a newer snapshot written by a start or a
  // content sync is picked up by the module runner without a restart, and
  // the two readers never disagree about which one is current.
  //
  // Only a snapshot that passes \`isReadablePreviewSnapshot\` is ever kept,
  // so only such a snapshot sets the ticket later reads are ordered by. A
  // file that fails to import, or that is anything else (null, no default,
  // malformed under any ticket, or valid but with no ticket after one that
  // had one), drops what was kept: the file now says nothing readable, and
  // an earlier answer would be a stale one.
  let read;
  try {
    const module = await import("./${THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH}");
    read = module ? module.default : undefined;
  } catch (error) {
    snapshot = null;
    throw error;
  }
  if (!isReadablePreviewSnapshot(read)) {
    snapshot = null;
    return;
  }
  const ticket = snapshotTicket(read);
  if (ticket === 0 && snapshotTicket(snapshot) > 0) {
    snapshot = null;
    return;
  }
  // Nothing orders two imports: one started before a sync rewrote the file
  // can settle after one started later. Its older snapshot never replaces a
  // newer one; an equal ticket (the same content, restamped for the server
  // now running) or a higher one does.
  if (ticket < snapshotTicket(snapshot)) return;
  snapshot = JSON.parse(JSON.stringify(read));
}

function snapshotTicket(value) {
  const ticket = value && value.contentTicket;
  return Number.isSafeInteger(ticket) && ticket > 0 ? ticket : 0;
}

const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async function morphPreviewFetch(input, init) {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === CONTENT_ORIGIN) {
    if (url.pathname !== CONTENT_PATH || request.method !== "GET") {
      return new Response("Not Found", { status: 404 });
    }
${contentRead}  }
  const refusal = previewOutboundRefusal(request.url);
  if (refusal) {
    console.warn("[morph-preview] outbound request refused (" + refusal + "): " + url.protocol + "//" + url.hostname);
    throw new TypeError("Live Preview refused an outbound request to " + url.hostname + " (" + refusal + ").");
  }
  return nativeFetch(request);
};

const HEAD_SCRIPTS =
  "<script>" + ${JSON.stringify(themePreviewDiagnosticScriptSource())} + "</script>" +
  '<script type="module" src="/${THEME_PREVIEW_START_CLIENT_PATH}"></script>';

export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === ${JSON.stringify(START_PREVIEW_ADDRESS_PROBE_PATH)}) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response(null, { status: 405, headers: { Allow: "GET, HEAD", "cache-control": "no-store" } });
      }
      // The ticket of the snapshot this Worker reads now, and which dev
      // server this Worker belongs to: what a content sync waits for before
      // the page may reload, from the server it wrote to and no other.
      let ticket = 0;
      let instance = "";
      try {
        await readSnapshot();
        // Only a snapshot every content read can be answered from is named:
        // a corrupt file that keeps its ticket must not confirm a sync.
        if (isReadablePreviewSnapshot(snapshot)) {
          ticket = snapshotTicket(snapshot);
          instance = typeof snapshot.previewInstance === "string" ? snapshot.previewInstance : "";
        }
      } catch {
        // Unreadable: the probe still answers, naming no snapshot.
      }
      // A body, never an empty 204; see PREVIEW_ADDRESS_PROBE_BODY.
      return new Response(request.method === "GET" ? ${JSON.stringify(PREVIEW_ADDRESS_PROBE_BODY)} : null, {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
          ${JSON.stringify(START_PREVIEW_ID_HEADER)}: ${JSON.stringify(previewId)},
          ${JSON.stringify(PREVIEW_CONTENT_TICKET_HEADER)}: String(ticket),
          ${JSON.stringify(PREVIEW_INSTANCE_HEADER)}: instance,
        },
      });
    }
${pin ? PINNED_PAGE_BLOCK : START_PAGE_BLOCK}  },
};
`;
}

/**
 * Source of the client module every Start Live Preview page loads.
 *
 * The bridge reads DOM the Theme renders and marks the page root. Run before
 * React hydrates the server's HTML, those marks would be differences between
 * the HTML and the first client render. So it waits for the router Start
 * created (the bridge navigates with it) and for the document to finish
 * loading, then two frames, and only then loads the content module and the
 * bridge.
 */
export function themePreviewStartClientSource(): string {
  return `import { documentPreviewIdentity, documentPreviewRuntimeChannel, parseEditorToPreviewWindowEvent } from "/src/morph/preview/preview-protocol.ts";

// Read before anything can navigate: Start uses browser history, and the
// first navigation drops the query the editor's channel is carried in.
documentPreviewRuntimeChannel();

// SSR can paint the editor's selectable sections before React has hydrated.
// Keep those early, authenticated edits in the existing content snapshot,
// without touching the SSR DOM. The bridge takes over after hydration.
const contentModule = import("/${THEME_PREVIEW_CONTENT_MODULE_PATH}");
let contentChangedBeforeBridge = false;

// Starter 32's client loader reads through a server function, which answers
// from the saved drafts only. Where its build says it runs in this preview
// (__MORPH_START_LIVE_PREVIEW__), it lays the edits this page received over
// that answer, read through this accessor: read-only, over the page's own
// preview content, and only in a framed page the editor's channel opened.
if (window.parent !== window && documentPreviewRuntimeChannel()) {
  void contentModule.then(({ livePreviewContentOverlay }) => {
    if (typeof livePreviewContentOverlay !== "function") return;
    Object.defineProperty(window, "__morphLivePreviewContent", {
      value: Object.freeze({
        overlay: (pathname, base) => livePreviewContentOverlay(pathname, base),
      }),
      configurable: false,
      enumerable: false,
      writable: false,
    });
  }, () => {}); // The awaited module below reports an import failure once.
}
const earlyPresentationQueue = (window.__morphEarlyPresentationQueue =
  window.__morphEarlyPresentationQueue || []);
const receiveEarlyContent = (event) => {
  const message = parseEditorToPreviewWindowEvent(event);
  if (message?.type !== "morph:storefront-preview-update-section-props") return;
  if (message.presentationToken) {
    for (const queued of earlyPresentationQueue) {
      if (queued.sectionId === message.sectionId && !queued.superseded) {
        queued.superseded = true;
      }
    }
    earlyPresentationQueue.push({
      sectionId: message.sectionId,
      enabled: message.enabled,
      presentationToken: message.presentationToken,
      superseded: false,
    });
  }
  void contentModule.then(({ updatePreviewContent }) => {
    updatePreviewContent(message.sectionId, message.props, message.enabled, message.resetKeys);
    contentChangedBeforeBridge = true;
  }, () => {}); // The awaited module below reports an import failure once.
};
window.addEventListener("message", receiveEarlyContent);

const HYDRATION_WAIT_LIMIT_MS = 30_000;

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
}

async function whenHydrated() {
  const started = performance.now();
  let timedOut = false;
  while (!window.__TSR_ROUTER__ || document.readyState !== "complete") {
    if (performance.now() - started > HYDRATION_WAIT_LIMIT_MS) {
      timedOut = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await nextFrame();
  await nextFrame();
  return {
    timedOut,
    router: Boolean(window.__TSR_ROUTER__),
    readyState: document.readyState,
    waitedMs: Math.round(performance.now() - started),
  };
}

// One [preview-frame] line about this page's start, read beside the
// bridge's and the editor's lines by the document id's first 8 hex. Once per
// page load; no content, no session.
function traceFrameStart(text) {
  if (typeof console === "undefined" || typeof console.info !== "function") return;
  const doc =
    typeof documentPreviewIdentity === "function"
      ? String(documentPreviewIdentity()).slice(0, 8)
      : "none";
  console.info("[preview-frame] frame " + text + " doc=" + doc);
}

// The bridge navigates with the router the preview hands it. Start creates
// its own, so the name the bridge reads points at it.
Object.defineProperty(window, "__morphPreviewRouter", {
  configurable: true,
  get() {
    return window.__TSR_ROUTER__;
  },
});

// An import that fails stops this page before the bridge can tell the editor.
// No script element reports a failed import(), so name the module to the
// page's first script, which tells the editor now rather than after its load
// watchdog's silence. The failure itself is rethrown, unchanged.
function reportFailedImport(path) {
  return (error) => {
    window.dispatchEvent(
      new CustomEvent("${THEME_PREVIEW_MODULE_FAILED_EVENT}", { detail: { path } }),
    );
    throw error;
  };
}

const hydration = await whenHydrated();
traceFrameStart(
  "hydration " +
    (hydration.timedOut ? "timed-out" : "waited") +
    " router=" + (hydration.router ? "yes" : "no") +
    " readyState=" + hydration.readyState +
    " waitedMs=" + hydration.waitedMs +
    " earlyTokens=" + earlyPresentationQueue.length,
);
await contentModule.catch(reportFailedImport("/${THEME_PREVIEW_CONTENT_MODULE_PATH}"));
await import("/${THEME_PREVIEW_BRIDGE_PATH}").catch(reportFailedImport("/${THEME_PREVIEW_BRIDGE_PATH}"));
window.removeEventListener("message", receiveEarlyContent);
if (contentChangedBeforeBridge && window.__morphPreviewRouter) {
  await window.__morphPreviewRouter.invalidate({ sync: true });
}
await window.__morphFlushEarlyPresentation?.();
traceFrameStart(
  "bridge loaded contentBeforeBridge=" + (contentChangedBeforeBridge ? "yes" : "no"),
);
`;
}
