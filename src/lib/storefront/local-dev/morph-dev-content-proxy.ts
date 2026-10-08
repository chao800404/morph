import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

/**
 * Lets a page you run on your own machine read your store's published content
 * after the first load.
 *
 * The first render happens on the dev server, which can name the store itself.
 * Every link click after that runs in the browser, which asks its own origin
 * for /_morph/content — and your dev server has no such route. This answers it
 * by asking the store on the browser's behalf.
 *
 * It is an opt-in development tool, not a part of any build or release: add it
 * to your own vite.config.ts and it does nothing for `vite build`. Nothing in
 * Morph edits that file for you.
 *
 * What it will and will not do:
 * - one route, GET /_morph/content?path=/…, and nothing else;
 * - the destination is the address you configured, never anything in a request;
 * - the request it sends is built from scratch, carrying only `accept`. Your
 *   browser's cookies, Authorization, Host and every x-morph-* header stay here;
 * - it does not follow redirects, waits a bounded time, and refuses a response
 *   larger than a page of content could be.
 *
 * Usage, in vite.config.ts:
 *
 *   import { morphDevContentProxy } from "./morph.dev-content-proxy";
 *   export default defineConfig({ plugins: [morphDevContentProxy(), ...] });
 *
 * and in your shell: MORPH_CONTENT_ORIGIN=https://your-store.example
 */

export const MORPH_CONTENT_PATH = "/_morph/content";

const DEFAULT_TIMEOUT_MS = 10_000;
/** A page of published content is a few kilobytes; this is generous, not typical. */
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_PATH_LENGTH = 500;

export type MorphDevContentProxyOptions = {
  /** The store to read. Defaults to the MORPH_CONTENT_ORIGIN environment variable. */
  origin?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** Only for tests. */
  fetch?: typeof fetch;
  log?: (message: string) => void;
};

type Next = (error?: unknown) => void;

function parseOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`MORPH_CONTENT_ORIGIN is not a valid address: ${value}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("MORPH_CONTENT_ORIGIN must be an http or https address.");
  }
  return new URL(url.origin);
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(body);
}

/**
 * The only things the browser is ever told. The reason in full (an address, a
 * status, the store's own words) goes to the dev server's log and stops there.
 */
const REFUSALS = {
  no_content_source:
    "MORPH_CONTENT_ORIGIN is not set, so there is no store to read content from.",
  invalid_path: "Invalid content path.",
  method_not_allowed: "Method not allowed.",
  store_unreachable: "The content service could not be reached.",
  content_not_found: "The store has no content for this page.",
  store_error: "The content service reported an error.",
  redirect_refused: "The content service redirected, which is not followed.",
  invalid_response: "The content service sent a response that could not be used.",
  response_too_large: "The content service response was too large.",
} as const;

type RefusalCode = keyof typeof REFUSALS;

function fail(
  res: ServerResponse,
  status: number,
  code: RefusalCode,
  headers: Record<string, string> = {},
): void {
  send(res, status, JSON.stringify({ code, message: REFUSALS[code] }), headers);
}

/** Reads at most maxBytes, cancelling the transfer as soon as it is exceeded. */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createMorphDevContentProxyHandler(
  options: MorphDevContentProxyOptions = {},
): (req: IncomingMessage, res: ServerResponse, next: Next) => Promise<void> {
  const configured = options.origin ?? process.env.MORPH_CONTENT_ORIGIN;
  // An address that is present but wrong stops the server from starting; one
  // that is absent is reported when a page asks, so the page says what is missing.
  const origin = configured ? parseOrigin(configured) : null;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const fetchImpl = options.fetch ?? fetch;
  const log = options.log ?? ((message: string) => console.warn(message));

  return async (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== MORPH_CONTENT_PATH) return next();

    if (req.method !== "GET") {
      return fail(res, 405, "method_not_allowed", { allow: "GET" });
    }
    if (!origin) {
      log(
        "[morph] A page asked for content but MORPH_CONTENT_ORIGIN is not set. Set it to your store address.",
      );
      return fail(res, 503, "no_content_source");
    }

    const keys = [...url.searchParams.keys()];
    const pathValues = url.searchParams.getAll("path");
    const path = pathValues[0] ?? "";
    if (
      keys.length !== 1 ||
      pathValues.length !== 1 ||
      !path.startsWith("/") ||
      path.length > MAX_PATH_LENGTH
    ) {
      return fail(res, 400, "invalid_path");
    }

    const upstreamUrl = new URL(MORPH_CONTENT_PATH, origin);
    upstreamUrl.searchParams.set("path", path);

    let response: Response;
    try {
      response = await fetchImpl(upstreamUrl, {
        method: "GET",
        // Built from nothing: the browser's own headers are not a starting point.
        headers: { accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "request failed";
      log(`[morph] Could not reach ${origin.origin}: ${reason}`);
      return fail(res, 502, "store_unreachable");
    }

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      log(`[morph] ${origin.origin} answered with a redirect, which is not followed.`);
      return fail(res, 502, "redirect_refused");
    }
    if (!response.ok) {
      await response.body?.cancel();
      log(`[morph] ${origin.origin} answered ${response.status} for ${path}.`);
      // A missing page is the one answer worth passing on as it is.
      return response.status === 404
        ? fail(res, 404, "content_not_found")
        : fail(res, 502, "store_error");
    }
    if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
      await response.body?.cancel();
      log(`[morph] ${origin.origin} did not send JSON for ${path}.`);
      return fail(res, 502, "invalid_response");
    }

    let body: string | null;
    try {
      body = await readCapped(response, maxBytes);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "read failed";
      log(`[morph] Could not read the response from ${origin.origin}: ${reason}`);
      return fail(res, 502, "store_unreachable");
    }
    if (body === null) {
      log(`[morph] ${origin.origin} sent more than ${maxBytes} bytes for ${path}.`);
      return fail(res, 502, "response_too_large");
    }

    send(res, 200, body);
  };
}

export function morphDevContentProxy(
  options: MorphDevContentProxyOptions = {},
): Plugin {
  return {
    name: "morph-dev-content-proxy",
    // `serve` only: a build neither starts this nor contains it.
    apply: "serve",
    configureServer(server) {
      const handler = createMorphDevContentProxyHandler({
        log: (message) => server.config.logger.warn(message),
        ...options,
      });
      // Registered directly, ahead of the framework's catch-all.
      server.middlewares.use((req, res, next) => {
        handler(req, res, next).catch(next);
      });
    },
  };
}
