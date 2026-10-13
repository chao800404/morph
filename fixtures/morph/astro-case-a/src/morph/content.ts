// TEST FIXTURE STAND-IN. Not product code, not Starter code, not the Astro
// content read module.
//
// docs/astro-content-read-module-design.md proposes that module; it does not
// exist yet. This is the smallest reader the case A fixture needs to render:
// it mirrors the Start Starter's `morph.pages.get` (page shape, error codes
// and their words), reading the content origin from the request Astro hands
// the middleware below. Nothing outside fixtures/morph/astro-case-a may
// import it.

import { AsyncLocalStorage } from "node:async_hooks";

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

/** One page's published content, the Start Starter's shape. */
export type MorphPage = {
  readonly _hidden: readonly string[];
  readonly [slotId: string]: any;
};

const CONTENT_TIMEOUT_MS = 15_000;

/**
 * The request being rendered. Frontmatter has `Astro.request`, but a module
 * it calls does not; the middleware puts the request here for the length of
 * one render. Never a module-level variable: a Worker isolate serves many
 * requests, and one request's origin must not answer another's read.
 */
const currentRequest = new AsyncLocalStorage<Request>();

/** Astro middleware; src/middleware.ts re-exports it. */
export const onRequest = (
  context: { request: Request },
  next: () => Promise<Response>,
): Promise<Response> => currentRequest.run(context.request, next);

async function fetchPage(url: string): Promise<MorphPage> {
  const note = (detail: string) => console.warn("[morph] " + detail);
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

async function getPage(path: string): Promise<MorphPage> {
  const request = currentRequest.getStore();
  if (request === undefined) {
    // Not inside the middleware: no request, so no platform origin. Refused,
    // never answered with an empty page.
    throw new MorphContentError(
      "no_content_source",
      "No content source: morph.pages.get ran outside a request. Export onRequest from src/morph/content in src/middleware.ts.",
    );
  }
  const forwarded = request.headers.get("x-morph-content-origin");
  if (forwarded === null) throw new MorphContentError("no_content_source");
  let base: URL;
  try {
    base = new URL(forwarded);
  } catch {
    throw new MorphContentError("invalid_content_origin", "The platform content origin header is not a valid address.");
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new MorphContentError("invalid_content_origin", "The platform content origin header must be an http or https address.");
  }
  return fetchPage(base.origin + "/_morph/content?path=" + encodeURIComponent(path));
}

export const morph = {
  pages: {
    /**
     * const home = await morph.pages.get("/");
     * const { hero } = home;
     * <Hero {...hero} />
     */
    get(path: string): Promise<MorphPage> {
      if (typeof path !== "string" || !path.startsWith("/") || path.length > 500) {
        return Promise.reject(new MorphContentError("invalid_path"));
      }
      return getPage(path);
    },
    /** Whether the author hid this section on the page. */
    isHidden(page: MorphPage, slotId: string): boolean {
      return page._hidden.includes(slotId);
    },
  },
};
