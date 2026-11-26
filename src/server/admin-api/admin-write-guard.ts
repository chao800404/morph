import {
  hasRequestBody,
  isJsonContentType,
  isStateChangingMethod,
  originOf,
  refuseCrossOriginWrite,
} from "@/server/same-origin-write";

/**
 * What every `/api/admin/*` request passes before it is routed.
 *
 * - A write authenticated by the browser's session cookie must come from the
 *   CMS's own origin (`refuseCrossOriginWrite`). A request that authenticates
 *   with a Basic secret API key is exempt: `authorize` never reads a cookie
 *   for it, and a browser cannot attach that header cross-origin without a
 *   preflight this API does not answer.
 * - A write that carries a body must say it is JSON (415 otherwise), so a
 *   cross-site `text/plain` or untyped body is never parsed as one. The CSV
 *   import is the one write whose body is not JSON; it requires `text/csv`
 *   itself.
 *
 * `adminOrigin` is the CMS's configured origin (`resolveAuthBaseURL`).
 * Returns `null` when the request may proceed.
 */
export async function refuseUnsafeAdminWrite(
  request: Request,
  path: string,
  adminOrigin: string,
): Promise<Response | null> {
  if (!isStateChangingMethod(request.method)) return null;

  const basicKey = /^Basic\s/i.test(request.headers.get("authorization") ?? "");
  if (!basicKey) {
    const refused = await refuseCrossOriginWrite(request, originOf(adminOrigin));
    if (refused) return refused;
  }

  if (path === "products/import") return null;
  if (
    hasRequestBody(request) &&
    !isJsonContentType(request.headers.get("content-type"))
  ) {
    return new Response(
      JSON.stringify({
        error: "UNSUPPORTED_MEDIA_TYPE",
        message: "Send the request body as application/json",
      }),
      {
        status: 415,
        headers: {
          "cache-control": "private, no-store",
          "content-type": "application/json; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }
  return null;
}
