/**
 * A frozen copy of `themePreviewStartWorkerSource` as it was before the
 * Astro-only `pinRequestSnapshot` option, extracted verbatim from main at
 * eebfd22 (#479, the fail-closed snapshot). The Start preview Worker must stay byte
 * for byte what it was: the option is off for every Start preview, and
 * `theme-preview-start-runtime.pinned-snapshot.test.ts` compares the current
 * generator's output with this copy. Change it only together with a reviewed,
 * intended change to the Start Worker.
 *
 * Changed once since, intentionally: the content read answers through
 * `previewContentForQuery` (the SDK's scoped reads, storefront-content-read.ts)
 * in place of `previewContentForPath`, for the Start and the Astro Worker
 * alike. A read without `scope` is answered exactly as before.
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
  THEME_PREVIEW_CONTENT_UNREADABLE_BODY,
  THEME_PREVIEW_CONTENT_UNREADABLE_STATUS,
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

// None until one is read: a path is never answered from a snapshot this
// Worker has not read (THEME_PREVIEW_CONTENT_UNREADABLE_BODY).
let snapshot = null;
${legacyContentResolverSource()}

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
    // A data file that is missing or not JSON fails its import, and a
    // snapshot without this path's entry resolves to null: either way the
    // read is refused, never answered with empty content.
    let content = null;
    try {
      await readSnapshot();
      content = previewContentForQuery(url.searchParams);
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
