/**
 * A frozen copy of `themePreviewStartWorkerSource` as it was before the
 * Astro-only `pinRequestSnapshot` option (feat/astro-basis-ack, base 5343b71),
 * extracted verbatim from that file. The Start preview Worker must stay byte
 * for byte what it was: the option is off for every Start preview, and
 * `theme-preview-start-runtime.pinned-snapshot.test.ts` compares the current
 * generator's output with this copy. Change it only together with a reviewed,
 * intended change to the Start Worker.
 */
import { themePreviewContentModuleSource } from "./theme-preview-content";
import { themePreviewDiagnosticScriptSource } from "./theme-preview-diagnostic-script";
import {
  PREVIEW_ADDRESS_PROBE_BODY,
  START_PREVIEW_ADDRESS_PROBE_PATH,
  START_PREVIEW_ID_HEADER,
} from "../service/preview-address-probe";
import {
  THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH,
  THEME_PREVIEW_CONTENT_PATH,
} from "./theme-preview-content";
import {
  PREVIEW_CONTENT_TICKET_HEADER,
  PREVIEW_INSTANCE_HEADER,
  THEME_PREVIEW_START_CLIENT_PATH,
  THEME_PREVIEW_START_CONTENT_ORIGIN,
  previewOutboundRefusal,
} from "./theme-preview-start-runtime";

function legacyContentResolverSource(): string {
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

export function legacyStartWorkerSource(
  previewId = "",
  serverEntry = "@tanstack/react-start/server-entry",
): string {
  return `import startEntry from ${JSON.stringify(serverEntry)};

const CONTENT_ORIGIN = ${JSON.stringify(THEME_PREVIEW_START_CONTENT_ORIGIN)};
const CONTENT_PATH = ${JSON.stringify(THEME_PREVIEW_CONTENT_PATH)};
const previewOutboundRefusal = ${previewOutboundRefusal.toString()};

let snapshot = { templates: {}, pages: {} };
${legacyContentResolverSource()}

async function readSnapshot() {
  // The data file itself, the one the dev server's content endpoint reads
  // too, re-imported on each read: a newer snapshot written by a start or a
  // content sync is picked up by the module runner without a restart, and
  // the two readers never disagree about which one is current.
  const module = await import("./${THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH}");
  const read = module.default ?? { templates: {}, pages: {} };
  // Nothing orders two imports: one started before a sync rewrote the file
  // can settle after one started later. Its older snapshot never replaces a
  // newer one; an equal ticket (the same content, restamped for the server
  // now running) or a higher one does.
  if (snapshotTicket(read) < snapshotTicket(snapshot)) return;
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
      // The ticket of the snapshot this Worker reads now, and which dev
      // server this Worker belongs to: what a content sync waits for before
      // the page may reload, from the server it wrote to and no other.
      let ticket = 0;
      let instance = "";
      try {
        await readSnapshot();
        ticket = Number.isSafeInteger(snapshot.contentTicket) ? snapshot.contentTicket : 0;
        instance = typeof snapshot.previewInstance === "string" ? snapshot.previewInstance : "";
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
