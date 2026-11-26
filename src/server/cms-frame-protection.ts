/**
 * Clickjacking protection for the CMS's own pages.
 *
 * Every HTML document the platform host serves (dashboard, editor, sign-in)
 * may be framed only by the CMS itself: `frame-ancestors 'self'`, and
 * `X-Frame-Options: SAMEORIGIN` for browsers that predate it. A storefront
 * on the same site as the CMS is a different origin, so it cannot frame a
 * signed-in CMS page under a decoy.
 *
 * `'self'` rather than `'none'`: the editor frames same-origin pages of its
 * own (`/preview-build/…`, the release preview).
 *
 * A response that already states a framing policy (any
 * `Content-Security-Policy` or `X-Frame-Options`) keeps its own: the build
 * and release previews set theirs, with a sandbox, and adding a second CSP to
 * a sandboxed document would change what it is allowed rather than only who
 * may frame it.
 */
export const CMS_FRAME_ANCESTORS = "frame-ancestors 'self'";
export const CMS_FRAME_OPTIONS = "SAMEORIGIN";

function isHtml(response: Response): boolean {
  const type = response.headers.get("content-type");
  return (
    type !== null &&
    type.split(";")[0]!.trim().toLowerCase() === "text/html"
  );
}

export function withCmsFrameProtection(response: Response): Response {
  if (!isHtml(response)) return response;
  if (
    response.headers.has("content-security-policy") ||
    response.headers.has("x-frame-options")
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", CMS_FRAME_ANCESTORS);
  headers.set("x-frame-options", CMS_FRAME_OPTIONS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
