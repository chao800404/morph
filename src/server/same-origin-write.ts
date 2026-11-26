import { isCsrfRequestAllowed } from "@tanstack/react-start";

/**
 * The cross-origin write check for Morph's own HTTP routes (`/api/admin/*`,
 * the Theme binary upload, cookie-carrying `/api/store/*` writes).
 *
 * Server functions already have one: Start's CSRF middleware (`src/start.ts`).
 * These routes are server routes, which that middleware is filtered away from,
 * so they get the same rule here — by calling Start's own check
 * (`isCsrfRequestAllowed`, what `createCsrfMiddleware` runs) rather than a
 * second policy written beside it:
 *
 * - a request carrying `Sec-Fetch-Site` is allowed only when it says
 *   `same-origin`;
 * - otherwise it is allowed only when `Origin` is exactly the allowed origin;
 * - a request with neither is refused. Start would fall back to `Referer`;
 *   that fallback is off here, since every browser sends `Origin` on a
 *   non-GET request.
 *
 * SameSite cookies do not cover this: a storefront and the CMS can be
 * subdomains of one site (`stg.example` and `admin-stg.example`), and then the
 * storefront's pages send the CMS cookie with any request they make.
 *
 * Only state-changing methods are checked. GET, HEAD and OPTIONS change
 * nothing on these routes.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isStateChangingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Whether a state-changing request came from the allowed origin.
 *
 * `allowedOrigin` is the configured origin the request must come from; `null`
 * means none could be determined, and then only `Sec-Fetch-Site: same-origin`
 * is accepted. Leaving it `undefined` means the request's own origin, which is
 * Start's default.
 */
export async function isSameOriginWrite(
  request: Request,
  allowedOrigin?: string | null,
): Promise<boolean> {
  return isCsrfRequestAllowed(
    {
      referer: false,
      ...(allowedOrigin === undefined
        ? {}
        : allowedOrigin === null
          ? { origin: () => false }
          : { origin: allowedOrigin }),
    },
    // Start's check reads only `ctx.request`.
    { request } as never,
  );
}

/**
 * `null` when the request may proceed, or the 403 to answer it with.
 *
 * A request with a safe method always proceeds.
 */
export async function refuseCrossOriginWrite(
  request: Request,
  allowedOrigin?: string | null,
): Promise<Response | null> {
  if (!isStateChangingMethod(request.method)) return null;
  if (await isSameOriginWrite(request, allowedOrigin)) return null;
  return new Response(
    JSON.stringify({
      error: "CROSS_ORIGIN_REQUEST",
      message: "This request must come from the application's own origin",
    }),
    {
      status: 403,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

/** The canonical origin of a configured URL, or `null` if it does not parse. */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Whether a request carries a body, whatever its headers claim the body is.
 *
 * A browser can send a body with no `Content-Type` at all (a `Blob` without a
 * type), so the type alone does not say whether there is one.
 */
export function hasRequestBody(request: Request): boolean {
  const length = request.headers.get("content-length");
  if (length !== null) return Number(length) !== 0;
  if (request.headers.has("transfer-encoding")) return true;
  return request.body !== null;
}

/** Whether a `Content-Type` is JSON (`application/json`, any parameters). */
export function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return (
    contentType.split(";")[0]!.trim().toLowerCase() === "application/json"
  );
}
