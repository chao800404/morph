import { themePreviewContentModuleSource } from "./theme-preview-content";
import { themePreviewDiagnosticScriptSource } from "./theme-preview-diagnostic-script";
import { THEME_PREVIEW_BRIDGE_PATH } from "./theme-preview-bridge-entry";
import {
  START_PREVIEW_ADDRESS_PROBE_PATH,
  START_PREVIEW_ID_HEADER,
} from "../service/preview-address-probe";
import {
  THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH,
  THEME_PREVIEW_CONTENT_MODULE_PATH,
  THEME_PREVIEW_CONTENT_PATH,
} from "./theme-preview-content";

/** The address probe's header naming the content snapshot the Worker reads. */
export const PREVIEW_CONTENT_TICKET_HEADER = "x-morph-content-ticket";

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
 */
export function themePreviewStartWorkerSource(
  previewId = "",
  serverEntry = "@tanstack/react-start/server-entry",
): string {
  return `import startEntry from ${JSON.stringify(serverEntry)};

const CONTENT_ORIGIN = ${JSON.stringify(THEME_PREVIEW_START_CONTENT_ORIGIN)};
const CONTENT_PATH = ${JSON.stringify(THEME_PREVIEW_CONTENT_PATH)};
const previewOutboundRefusal = ${previewOutboundRefusal.toString()};

let snapshot = { templates: {}, pages: {} };
${contentResolverSource()}

async function readSnapshot() {
  // The data file itself, the one the dev server's content endpoint reads
  // too, re-imported on each read: a newer snapshot written by a start or a
  // content sync is picked up by the module runner without a restart, and
  // the two readers never disagree about which one is current.
  const module = await import("./${THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH}");
  snapshot = JSON.parse(JSON.stringify(module.default ?? { templates: {}, pages: {} }));
}

const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async function morphPreviewFetch(input, init) {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === CONTENT_ORIGIN) {
    if (url.pathname !== CONTENT_PATH || request.method !== "GET") {
      return new Response("Not Found", { status: 404 });
    }
    await readSnapshot();
    return new Response(
      JSON.stringify(previewContentForPath(url.searchParams.get("path") || "/")),
      { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } },
    );
  }
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
      // The ticket of the snapshot this Worker reads now: what a content
      // sync waits for before the page may reload.
      let ticket = 0;
      try {
        await readSnapshot();
        ticket = Number.isSafeInteger(snapshot.contentTicket) ? snapshot.contentTicket : 0;
      } catch {
        // Unreadable: the probe still answers, naming no snapshot.
      }
      return new Response(null, {
        status: 204,
        headers: {
          "cache-control": "no-store",
          ${JSON.stringify(START_PREVIEW_ID_HEADER)}: ${JSON.stringify(previewId)},
          ${JSON.stringify(PREVIEW_CONTENT_TICKET_HEADER)}: String(ticket),
        },
      });
    }
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
  },
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
  return `import { documentPreviewRuntimeChannel, parseEditorToPreviewWindowEvent } from "/src/morph/preview/preview-protocol.ts";

// Read before anything can navigate: Start uses browser history, and the
// first navigation drops the query the editor's channel is carried in.
documentPreviewRuntimeChannel();

// SSR can paint the editor's selectable sections before React has hydrated.
// Keep those early, authenticated edits in the existing content snapshot,
// without touching the SSR DOM. The bridge takes over after hydration.
const contentModule = import("/${THEME_PREVIEW_CONTENT_MODULE_PATH}");
let contentChangedBeforeBridge = false;
const receiveEarlyContent = (event) => {
  const message = parseEditorToPreviewWindowEvent(event);
  if (message?.type !== "morph:storefront-preview-update-section-props") return;
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
  while (!window.__TSR_ROUTER__ || document.readyState !== "complete") {
    if (performance.now() - started > HYDRATION_WAIT_LIMIT_MS) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await nextFrame();
  await nextFrame();
}

// The bridge navigates with the router the preview hands it. Start creates
// its own, so the name the bridge reads points at it.
Object.defineProperty(window, "__morphPreviewRouter", {
  configurable: true,
  get() {
    return window.__TSR_ROUTER__;
  },
});

await whenHydrated();
await contentModule;
await import("/${THEME_PREVIEW_BRIDGE_PATH}");
window.removeEventListener("message", receiveEarlyContent);
if (contentChangedBeforeBridge && window.__morphPreviewRouter) {
  await window.__morphPreviewRouter.invalidate({ sync: true });
}
`;
}
