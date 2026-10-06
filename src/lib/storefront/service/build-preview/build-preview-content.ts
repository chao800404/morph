import {
  resolveStorefrontContent,
  type ContentRuntimePorts,
} from "../storefront-content-runtime";
import type { VerifiedBuildPreviewCapability } from "./build-preview-capability";

/**
 * `/_morph/content` for a Build Preview.
 *
 * Answers from the content snapshot the build was made with, and from nothing
 * else: not the drafts, not the live release. What the preview shows is then
 * what publishing this build would show, which is the point of previewing the
 * build rather than the source. Same shape and the same resolver as the
 * production endpoint (`StorefrontProductionService.serveContent`); only the
 * publication it reads and the caching differ — a preview's answer is private
 * to the user holding the capability, and is never stored.
 */
export async function serveBuildPreviewContent(input: {
  request: Request;
  capability: VerifiedBuildPreviewCapability;
  ports: ContentRuntimePorts;
}): Promise<Response> {
  const { request, capability, ports } = input;
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405,
      headers: { ...headers, Allow: "GET, HEAD" },
    });
  }
  const requestedPath = new URL(request.url).searchParams.get("path") ?? "/";
  if (requestedPath.length > 500 || !requestedPath.startsWith("/")) {
    return new Response(JSON.stringify({ error: "Invalid content path." }), {
      status: 400,
      headers,
    });
  }
  const content = await resolveStorefrontContent({
    publicationId: capability.contentPublicationId,
    pathname: requestedPath,
    ports,
  });
  return new Response(
    request.method === "HEAD" ? null : JSON.stringify(content),
    { status: 200, headers },
  );
}
