import { env } from "cloudflare:workers";
import { getAuthWithAdmin } from "@/server/auth/helpers";
import {
  RELEASE_PREVIEW_VIEWPORTS,
  releasePreviewKey,
  type ReleasePreviewViewport,
} from "@/lib/storefront/release-preview";
import { createFileRoute } from "@tanstack/react-router";

function isViewport(value: string): value is ReleasePreviewViewport {
  return Object.hasOwn(RELEASE_PREVIEW_VIEWPORTS, value);
}

/**
 * Serves a release's captured image to a signed-in dashboard user.
 *
 * Behind the session rather than public: a capture shows an unreleased or
 * access-limited storefront exactly as it renders, so an unauthenticated URL
 * would publish the contents of a private store to anyone holding a release id.
 *
 * The key is derived from the release id rather than read from a query
 * parameter, so no request can address an arbitrary object in the bucket.
 */
async function serve(request: Request, releaseId: string, viewport: string) {
  const session = await getAuthWithAdmin().api.getSession({
    headers: request.headers,
  });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  if (!isViewport(viewport)) return new Response("Not found", { status: 404 });

  const bucket = (env as unknown as { R2_BUCKET?: R2Bucket }).R2_BUCKET;
  if (!bucket) return new Response("Not found", { status: 404 });

  const object = await bucket.get(releasePreviewKey(releaseId, viewport));
  // A release with no capture is ordinary — the deployment may have no
  // screenshot credentials, or the capture may still be queued. The card
  // falls back to its placeholder on a 404.
  if (!object) return new Response("Not found", { status: 404 });

  return new Response(object.body, {
    headers: {
      "Content-Type": "image/png",
      // A release is immutable and so is its capture, but the response is
      // per-user, so it must not be stored by a shared cache.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const Route = createFileRoute("/release-preview/$releaseId/$viewport")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        serve(request, params.releaseId, params.viewport),
    },
  },
});
