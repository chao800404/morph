import { isolateSvgResponse } from "../theme-svg-isolation";

/**
 * Makes a refused Live Preview request something a browser will ask again.
 *
 * A preview page imports its modules from a URL that outlives any one
 * container: the address is kept across restarts, so the same module URL is
 * requested over and over. When the Sandbox SDK briefly refused one of those
 * requests — its runtime was restarting — the browser kept the refusal and
 * answered every later load of that module from its own cache, without asking
 * again. A module that fails stops its whole graph, so the preview never came
 * up again in that browser, however healthy the container became, until the
 * cache was cleared by hand.
 *
 * An error from the preview is a statement about that moment, never about the
 * resource, so none of them is stored. Successful responses are left alone:
 * Vite sets their caching itself.
 */
export function uncacheablePreviewError(response: Response): Response {
  if (response.status < 400) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * What the preview proxy sends for a container's response: a refusal that
 * is never stored, since it is about this moment and a browser that kept it
 * would stop asking; and an SVG, whatever in the container sent it, with the
 * platform's isolation headers.
 */
export function finishPreviewResponse(response: Response): Response {
  return isolateSvgResponse(uncacheablePreviewError(response));
}
