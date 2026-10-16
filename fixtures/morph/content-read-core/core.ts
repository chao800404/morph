// TEST PROTOTYPE. Not product code, not Starter code, not the Morph SDK.
//
// One framework-agnostic read core, shared by the case A fixtures
// (fixtures/morph/astro-case-a, fixtures/morph/start-case-a) through the
// platform wiring next to it (astro/, start/). docs/content-read-core-design.md
// describes it. The fixtures do not carry it: the test support hands this one
// file to every workspace as src/morph/core.ts, as an SDK would be installed.
// No product module imports it.
//
// It imports nothing: no React, no Astro, no Start, no node: module. What it
// needs from a framework is one question, answered per request by the wiring:
// where this read's content comes from (`MorphContentSource`).

/**
 * Why a page could not be read. The same closed set, in the same order, as
 * the Start Starter's `MorphContentErrorCode`.
 */
export type MorphContentErrorCode =
  | "no_content_source"
  | "invalid_content_origin"
  | "invalid_path"
  | "store_unreachable"
  | "content_not_found"
  | "store_error"
  | "redirect_refused"
  | "invalid_response"
  | "response_too_large"
  | "reserved_slot";

/**
 * The words for each code, as the Start Starter writes them: never the
 * store's answer, an address or a stack. The detail goes to the server log.
 */
const MORPH_CONTENT_MESSAGES: Record<MorphContentErrorCode, string> = {
  no_content_source:
    "No content source. Run inside Morph, or while developing set MORPH_CONTENT_ORIGIN to your store address, for example https://your-store.example.",
  invalid_content_origin: "The content source address is not usable.",
  invalid_path: "A page path starts with / and is at most 500 characters.",
  store_unreachable: "The content service could not be reached.",
  content_not_found: "The store has no content for this page.",
  store_error: "The content service reported an error.",
  redirect_refused: "The content service redirected, which is not followed.",
  invalid_response: "The content service sent a response that could not be used.",
  response_too_large: "The content service response was too large.",
  reserved_slot: "The content service sent a slot named _hidden, which is reserved.",
};

/** Raised when a page cannot be read. The caller decides what to show instead. */
export class MorphContentError extends Error {
  readonly code: MorphContentErrorCode;
  constructor(code: MorphContentErrorCode, message?: string) {
    super(message ?? MORPH_CONTENT_MESSAGES[code]);
    this.name = "MorphContentError";
    this.code = code;
  }
}

function isMorphContentErrorCode(value: unknown): value is MorphContentErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MORPH_CONTENT_MESSAGES, value);
}

/**
 * One page's content: each slot's values under its slot id, ready to spread
 * onto a section, and the sections the author hid in `_hidden`. A hidden
 * section has no values here. The Start Starter's shape.
 */
export type MorphPage = {
  readonly _hidden: readonly string[];
  readonly [slotId: string]: any;
};

/**
 * Where one read's content comes from, as the framework wiring found it for
 * the request being rendered:
 *
 * - `forwarded`: on the server. `origin` is the platform's
 *   `x-morph-content-origin` header of this request, or null when it has none;
 *   `localOrigin` is a development-only fallback the wiring may name, used
 *   only when the header is absent.
 * - `same-origin`: in a browser, the page's own `/_morph/content`.
 *
 * `undefined` means the wiring found no request to read for.
 */
export type MorphContentSource =
  | { readonly kind: "forwarded"; readonly origin: string | null; readonly localOrigin?: string | null }
  | { readonly kind: "same-origin" };

const CONTENT_TIMEOUT_MS = 15_000;

async function fetchPage(url: string, onServer: boolean): Promise<MorphPage> {
  // The detail of a failure belongs in the log of the machine that saw it,
  // never in the error, which a page may render for anyone to read.
  const note = (detail: string) => {
    if (onServer) console.warn("[morph] " + detail);
  };
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      credentials: "omit",
      signal: AbortSignal.timeout(CONTENT_TIMEOUT_MS),
    });
  } catch (error) {
    note("Could not reach " + url + ": " + (error instanceof Error ? error.message : "request failed"));
    throw new MorphContentError("store_unreachable");
  }
  if (!response.ok) {
    let named: unknown = null;
    try {
      named = ((await response.json()) as { code?: unknown } | null)?.code;
    } catch {
      named = null;
    }
    note(url + " answered " + response.status + ".");
    throw new MorphContentError(
      isMorphContentErrorCode(named)
        ? named
        : response.status === 404 ? "content_not_found" : "store_error",
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    note(url + " did not send JSON.");
    throw new MorphContentError("invalid_response");
  }
  if (!payload || typeof payload !== "object"
    || !("slots" in payload) || !payload.slots || typeof payload.slots !== "object" || Array.isArray(payload.slots)
    || !("hiddenSlots" in payload) || !Array.isArray(payload.hiddenSlots)
    || !payload.hiddenSlots.every((slot: unknown) => typeof slot === "string")) {
    note(url + " sent a payload of the wrong shape.");
    throw new MorphContentError("invalid_response");
  }
  if (Object.prototype.hasOwnProperty.call(payload.slots, "_hidden")) {
    throw new MorphContentError("reserved_slot");
  }
  return { ...(payload.slots as Record<string, unknown>), _hidden: payload.hiddenSlots as string[] };
}

function pageUrl(source: MorphContentSource | undefined, path: string): { url: string; onServer: boolean } {
  const query = "/_morph/content?path=" + encodeURIComponent(path);
  if (source === undefined) {
    // No request: no platform origin. Refused, never answered with an empty
    // page or the component defaults.
    throw new MorphContentError(
      "no_content_source",
      "No content source: morph.pages.get ran outside a request the platform wired.",
    );
  }
  if (source.kind === "same-origin") return { url: query, onServer: false };
  const local = source.origin === null ? (source.localOrigin ?? null) : null;
  const origin = source.origin ?? local;
  if (origin === null) throw new MorphContentError("no_content_source");
  // A header that is present but unusable is an error of its own: falling
  // through to another address would swap one store's content for another's.
  const label = source.origin !== null ? "The platform content origin header" : "MORPH_CONTENT_ORIGIN";
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    throw new MorphContentError("invalid_content_origin", label + " is not a valid address.");
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new MorphContentError("invalid_content_origin", label + " must be an http or https address.");
  }
  return { url: base.origin + query, onServer: true };
}

/**
 * The `morph` object every framework's pages import. `source` is asked once
 * per read, never cached: a Worker isolate serves many requests, and one
 * request's origin must not answer another's read.
 */
export function createMorph(source: () => MorphContentSource | undefined) {
  return {
    pages: {
      /**
       * const home = await morph.pages.get("/");
       * const { hero } = home;
       */
      async get(path: string): Promise<MorphPage> {
        if (typeof path !== "string" || !path.startsWith("/") || path.length > 500) {
          throw new MorphContentError("invalid_path");
        }
        const { url, onServer } = pageUrl(source(), path);
        return fetchPage(url, onServer);
      },
      /** Whether the author hid this section on the page. */
      isHidden(page: MorphPage, slotId: string): boolean {
        return page._hidden.includes(slotId);
      },
    },
  };
}
