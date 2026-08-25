import type { R2BucketLike } from "../compiler/cloudflare-r2-theme-build-artifact-store";
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
import type { ThemeRuntime } from "./theme-runtime.types";

const DEFAULT_CLIENT_ASSETS_DIRECTORY = "runtime/client";

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
