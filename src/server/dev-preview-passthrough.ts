/**
 * Local development only: carries a Live Preview request past Morph's own
 * Vite dev server to the Worker, unchanged.
 *
 * In `pnpm dev` the Morph app and every preview hostname enter through one
 * Vite process. A Theme served at the root path asks its preview host for
 * `/src/router.tsx`, `/@vite/client` or `/node_modules/...`, and Morph's Vite
 * answers those itself — with Morph's own modules — before the Worker, which
 * would have proxied them to the container, ever sees them. That is why the
 * client-only preview lives under `/__morph-theme-preview__/`. A Start
 * preview is served at the root, as a published storefront is, so in dev the
 * request is parked on a path Vite does not own and restored in the Worker.
 *
 * Deployed Workers have no Vite in front of them and never see the parked
 * path; the Worker restores it only in dev builds (see src/server.ts).
 */

/** Path a preview-host request is parked on while it crosses Morph's Vite. */
export const DEV_PREVIEW_PASSTHROUGH_PATH =
  "/__morph_dev_preview_passthrough__";

/** Header carrying the parked request's original path and query. */
export const DEV_PREVIEW_PASSTHROUGH_HEADER =
  "x-morph-dev-preview-original-url";

/**
 * Whether a Host header names a Live Preview or Build Preview host.
 *
 * Only the Sandbox's exposed-port shape under the configured preview
 * hostname (`<port>-<id>-<token>.<previewHostname>`) and a Build Preview's
 * `bp-<token>` label, so Morph's own hostnames — the editor and dashboard —
 * are never parked.
 */
export function isDevPreviewHost(
  hostHeader: string | undefined,
  previewHostname: string,
): boolean {
  if (!hostHeader || !previewHostname) return false;
  const host = hostHeader.toLowerCase().replace(/:\d+$/, "");
  const suffix = `.${previewHostname.toLowerCase()}`;
  if (!host.endsWith(suffix)) return false;
  const label = host.slice(0, -suffix.length);
  // Underscores included: the SDK's preview tokens are [a-z0-9_]. A token
  // with one was left to Morph's Vite, which served Morph's own modules to
  // the preview, and the page never hydrated.
  if (/^\d{2,5}-[a-z0-9_-]+$/.test(label)) return true;
  // A Build Preview host (`bp-<token>`): the build's instance answers every
  // path there, so none of them may be Morph's own Vite modules either.
  return /^bp-[0-9a-f]{40}$/.test(label);
}

/**
 * The request as the browser sent it, or null when it is not a parked one.
 * The original must be a path on the same host; anything else is refused.
 */
export function restoreDevPreviewRequest(request: Request): Request | null {
  const url = new URL(request.url);
  if (url.pathname !== DEV_PREVIEW_PASSTHROUGH_PATH) return null;
  const original = request.headers.get(DEV_PREVIEW_PASSTHROUGH_HEADER);
  if (!original || !original.startsWith("/") || original.startsWith("//")) {
    return null;
  }
  const restored = new URL(original, url.origin);
  if (restored.origin !== url.origin) return null;
  const headers = new Headers(request.headers);
  headers.delete(DEV_PREVIEW_PASSTHROUGH_HEADER);
  return new Request(restored.href, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
    redirect: "manual",
    // Required by the Request constructor for a streamed body.
    ...(request.method === "GET" || request.method === "HEAD"
      ? {}
      : { duplex: "half" }),
  } as RequestInit);
}
