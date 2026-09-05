import type { R2BucketLike } from "../compiler/cloudflare-r2-theme-build-artifact-store";
import {
  lookupPublishedMedia,
  parsePublishedMediaPath,
  type PublishedMediaPorts,
} from "./storefront-media-delivery";
import {
  PRODUCTION_ARTIFACT_POLICY,
  sanitizeArtifactPath,
  serveThemeArtifact,
} from "./theme-artifact-server";
import {
  resolveStorefrontHost,
  type ResolvedStorefrontHost,
  type StorefrontHostResolverDeps,
} from "./storefront-host-resolver";
import {
  resolveStorefrontContent,
  type ContentRuntimePorts,
} from "./storefront-content-runtime";
import type { ThemeRuntime } from "./theme-runtime.types";

const DEFAULT_CLIENT_ASSETS_DIRECTORY = "runtime/client";

/**
 * Platform-owned path a Theme reads its published content from.
 *
 * Served by Morph Core rather than the Theme Worker: only Morph Core knows
 * which release is active, and content must come from that release's immutable
 * publication, never from a draft.
 */
export const STOREFRONT_CONTENT_PATH = "/_morph/content";

/**
 * Reads the client assets directory from the canonical manifest.
 *
 * The artifact store maps the runner's `metadata` onto the canonical `runtime`
 * block before persisting, and D1 stores the canonical shape — so production
 * must read `runtime`, not `metadata`.
 */
function readClientAssetsDirectory(resolved: ResolvedStorefrontHost): string {
  const runtime = resolved.manifest?.runtime;
  const value = runtime?.clientAssetsDirectory;
  if (typeof value === "string" && value.trim() !== "") {
    return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  }
  return DEFAULT_CLIENT_ASSETS_DIRECTORY;
}

function errorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export type StorefrontProductionServiceOptions = Readonly<{
  runtime: ThemeRuntime;
  r2Bucket?: R2BucketLike;
  resolverDeps?: StorefrontHostResolverDeps;
  contentPorts?: ContentRuntimePorts;
  /** Required to serve published CMS media on the merchant hostname. */
  mediaPorts?: PublishedMediaPorts;
}>;

/**
 * Production storefront request handler.
 *
 * Request path:
 *   hostname -> active release -> immutable build artifact
 *     -> client asset from R2, or the released Theme Worker.
 *
 * Static assets are served through the same artifact core the editor preview
 * uses, so the manifest boundary and path sanitization cannot diverge between
 * the two planes. Anything not declared as a client asset is a page request and
 * belongs to the Theme Worker; the service never renders a fallback page, since
 * substituting one would present an unavailable release as a working store.
 */
export class StorefrontProductionService {
  constructor(private readonly options: StorefrontProductionServiceOptions) {}

  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const resolution = await resolveStorefrontHost(
      request.headers.get("host") ?? url.hostname,
      this.options.resolverDeps,
    );

    if (!resolution.success) {
      return errorResponse(resolution.status, resolution.message);
    }

    const resolved = resolution.value;

    if (url.pathname === STOREFRONT_CONTENT_PATH) {
      return this.serveContent(request, url, resolved);
    }

    const mediaAssetId = parsePublishedMediaPath(url.pathname);
    if (mediaAssetId) {
      return this.servePublishedMedia(request, mediaAssetId, resolved);
    }

    if (request.method === "GET" || request.method === "HEAD") {
      const asset = await this.tryServeClientAsset(request, url, resolved);
      if (asset) return asset;
    }

    const runtimeResult = await this.options.runtime.handle({
      request,
      resolved,
    });
    if (!runtimeResult.success) {
      return errorResponse(runtimeResult.status, runtimeResult.message);
    }
    return runtimeResult.response;
  }

  /**
   * Serves the published content for one route of the active release.
   *
   * Immutable for a given release, so it is cached hard and keyed by the
   * release id: a new release changes the URL's meaning only through a new
   * release id, and rollback restores the previous content without a purge.
   */
  private async serveContent(
    request: Request,
    url: URL,
    resolved: ResolvedStorefrontHost,
  ): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorResponse(405, "Method not allowed.");
    }
    if (!this.options.contentPorts) {
      return errorResponse(503, "Storefront content is not configured.");
    }

    const requestedPath = url.searchParams.get("path") ?? "/";
    if (requestedPath.length > 500 || !requestedPath.startsWith("/")) {
      return errorResponse(400, "Invalid content path.");
    }

    const content = await resolveStorefrontContent({
      publicationId: resolved.contentPublicationId,
      pathname: requestedPath,
      ports: this.options.contentPorts,
    });

    return new Response(JSON.stringify(content), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // Content is immutable within a release; the release id is the version.
        "Cache-Control": "public, max-age=60, must-revalidate",
        ETag: `"${resolved.releaseId}:${requestedPath}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  /**
   * Serves a CMS asset that the active release published.
   *
   * Authorised by the publication rather than by a session: a visitor may read
   * exactly the media the live release refers to, and nothing else in the
   * library. The asset is only looked up after that check, so an unpublished id
   * cannot be used to find out whether it exists.
   */
  private async servePublishedMedia(
    request: Request,
    assetId: string,
    resolved: ResolvedStorefrontHost,
  ): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorResponse(405, "Method not allowed.");
    }
    if (!this.options.mediaPorts || !this.options.r2Bucket) {
      return errorResponse(503, "Storefront media is not configured.");
    }

    const lookup = await lookupPublishedMedia({
      assetId,
      publicationId: resolved.contentPublicationId,
      ports: this.options.mediaPorts,
    });
    // Both cases answer the same way: whether an asset exists is not something
    // an unpublished id should be able to distinguish.
    if (lookup.status !== "found") return errorResponse(404, "Not found.");

    const object = await this.options.r2Bucket.get(lookup.storageKey);
    if (!object) return errorResponse(404, "Not found.");

    const headers = new Headers();
    // The stored asset row is the type authority; R2 metadata is a fallback
    // for objects written before a type was recorded.
    const contentType =
      lookup.contentType ??
      object.httpMetadata?.contentType ??
      "application/octet-stream";
    headers.set("Content-Type", contentType);
    // Bytes are immutable for an asset id, and the release id keeps a rollback
    // from serving a stale cache entry under the same URL.
    headers.set("Cache-Control", "public, max-age=300, must-revalidate");
    headers.set("ETag", `"${resolved.releaseId}:${assetId}"`);
    headers.set("X-Content-Type-Options", "nosniff");
    // Never inline: a stored SVG is script-capable, and this route has no
    // session to lose but the storefront's own origin to protect.
    if (headers.get("Content-Type") === "image/svg+xml") {
      headers.set("Content-Disposition", "attachment");
    }

    if (request.headers.get("if-none-match") === headers.get("ETag")) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(request.method === "HEAD" ? null : object.body, {
      status: 200,
      headers,
    });
  }

  /**
   * Serves a declared client asset, or returns `null` when the path is not one,
   * in which case the request is a page request for the Theme Worker.
   */
  private async tryServeClientAsset(
    request: Request,
    url: URL,
    resolved: ResolvedStorefrontHost,
  ): Promise<Response | null> {
    let requestedPath: string;
    try {
      requestedPath = sanitizeArtifactPath(url.pathname);
    } catch {
      // A traversal-shaped path is never a valid asset; refuse rather than
      // handing an attacker-shaped path to the Theme Worker.
      return errorResponse(400, "Invalid asset path.");
    }
    if (requestedPath === "") return null;

    const assetsDirectory = readClientAssetsDirectory(resolved);
    const candidate = `${assetsDirectory}/${requestedPath}`;

    const files = Array.isArray(resolved.manifest?.files)
      ? resolved.manifest.files
      : [];
    if (!files.some((file) => file.path === candidate)) return null;

    const served = await serveThemeArtifact({
      request,
      artifactPrefix: resolved.artifactPrefix,
      manifest: resolved.manifest,
      artifactPath: candidate,
      r2Bucket: this.options.r2Bucket,
      policy: PRODUCTION_ARTIFACT_POLICY,
    });

    if (!served.success) {
      return errorResponse(served.failure.status, served.failure.message);
    }
    return served.response;
  }
}
