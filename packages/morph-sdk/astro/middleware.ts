/**
 * The platform's Astro middleware: each render runs as the render of its own
 * request, so `@morph/sdk/astro`'s reads know which content source it may
 * read. It reads no content and changes neither the request nor the response.
 *
 * Added by Morph's integrations (Live Preview and build) with
 * `addMiddleware({ order: "pre", ... })`, before any middleware of the
 * author's, so the author's own middleware can read content too. The author
 * never writes or imports it.
 */
import { runWithMorphRequest } from "./index";

export function onRequest(
  context: { request: Request },
  next: () => Promise<Response>,
): Promise<Response> {
  return runWithMorphRequest(context.request, next);
}
