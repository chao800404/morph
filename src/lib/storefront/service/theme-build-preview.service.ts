import { env } from "cloudflare:workers";
import { getAuthWithAdmin } from "@/server/auth/helpers";
import { hasAnyRole } from "@/server/middleware/auth.middleware";
import type { R2BucketLike } from "../compiler/cloudflare-r2-theme-build-artifact-store";
import type {
  CanonicalThemeBuildManifest,
  CanonicalThemeBuildManifestFile,
} from "../compiler/theme-build-artifact-store.types";
import {
  storefrontThemeBuildDal,
  type StorefrontThemeBuildDAL,
} from "../dal/storefront-theme-build.dal";
import {
  resolveThemePreviewSecret,
  verifyPreviewCapabilityToken,
} from "./theme-build-preview-token";

export type AuthSessionResolver = (request: Request) => Promise<{
  user?: { id: string; role?: string | null } | null;
} | null>;

export type StorefrontAccessChecker = (
  userId: string,
  storefrontId: string,
  role?: string | null,
) => Promise<boolean> | boolean;

export interface ThemeBuildPreviewServiceOptions {
  dal?: StorefrontThemeBuildDAL;
  r2Bucket?: R2BucketLike;
  sessionResolver?: AuthSessionResolver;
  storefrontAccessChecker?: StorefrontAccessChecker;
  tokenSecret?: string;
}

const MIME_FALLBACKS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
};

function resolveMimeFallback(filename: string): string {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx === -1) return "application/octet-stream";
  const ext = filename.slice(dotIdx).toLowerCase();
  return MIME_FALLBACKS[ext] || "application/octet-stream";
}

/**
 * Validates and canonicalizes an untrusted preview artifact path.
 * Strictly prevents path traversal attempts (.., \, encoded dots/slashes, null bytes).
 */
export function sanitizePreviewArtifactPath(rawPath?: string): string {
  if (!rawPath || rawPath.trim() === "" || rawPath.trim() === "/") {
    return "";
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    throw new Error(
      "INVALID_PATH_ENCODING: Malformed URI encoding in requested path.",
    );
  }

  // Null byte check
  if (decoded.includes("\0") || rawPath.includes("%00")) {
    throw new Error(
      "PATH_TRAVERSAL_DETECTED: Null byte detected in artifact path.",
    );
  }

  // Backslash check
  if (
    decoded.includes("\\") ||
    rawPath.includes("%5c") ||
    rawPath.includes("%5C")
  ) {
    throw new Error(
      "PATH_TRAVERSAL_DETECTED: Backslashes are forbidden in artifact path.",
    );
  }

  // Encoded traversal tokens
  const lowerRaw = rawPath.toLowerCase();
  if (
    lowerRaw.includes("%2e%2e") ||
    lowerRaw.includes("%252e") ||
    lowerRaw.includes("%2f")
  ) {
    throw new Error(
      "PATH_TRAVERSAL_DETECTED: Encoded traversal sequence detected.",
    );
  }

  // Normalize path segments
  const normalized = decoded.replace(/^\/+/, "").replace(/\/+$/, "");
  const segments = normalized.split("/");

  for (const seg of segments) {
    if (seg === ".." || seg === "." || seg.trim() === "") {
      throw new Error(
        `PATH_TRAVERSAL_DETECTED: Invalid path segment "${seg}".`,
      );
    }
  }

  return segments.join("/");
}

/**
 * Theme Build Preview Serving Service.
 *
 * Immutability & Security Invariants:
 * 1. Build Preview is strictly bound to buildId (never working source or mutable aliases).
 * 2. Only builds in "succeeded" status with valid artifactPrefix and manifestJson can be served.
 * 3. Supports ephemeral HMAC preview capability tokens in URL path for sandboxed opaque-origin iframe sub-resources.
 * 4. Fails closed with 500 when no secret is configured (zero hardcoded fallback secrets).
 * 5. Supports CORS for Origin: null to enable browser module graph sub-resource fetches under opaque sandbox.
 * 6. Direct session requests strictly require admin role and theme ownership.
 * 7. Only files declared in canonical manifest.files (or sanitized artifactEntry) can be served.
 * 8. Immutable assets are served with private long-lived cache; HTML and errors are private, no-store.
 * 9. Content-Type and security headers (nosniff, CSP) are consistently enforced.
 */
export class ThemeBuildPreviewService {
  private readonly dal: StorefrontThemeBuildDAL;
  private readonly r2Bucket?: R2BucketLike;
  private readonly sessionResolver: AuthSessionResolver;
  private readonly storefrontAccessChecker?: StorefrontAccessChecker;
  private readonly explicitTokenSecret?: string;

  constructor(options: ThemeBuildPreviewServiceOptions = {}) {
    this.dal = options.dal ?? storefrontThemeBuildDal;
    this.r2Bucket = options.r2Bucket;
    this.sessionResolver =
      options.sessionResolver ??
      (async (request: Request) => {
        try {
          const auth = getAuthWithAdmin();
          const session = await auth.api.getSession({
            headers: request.headers,
          });
          return session;
        } catch {
          return null;
        }
      });
    this.storefrontAccessChecker = options.storefrontAccessChecker;
    this.explicitTokenSecret = options.tokenSecret;
  }

  private getTokenSecret(): string {
    return resolveThemePreviewSecret(this.explicitTokenSecret, env);
  }

  /**
   * Serves an immutable theme build artifact for preview.
   */
  async handlePreviewRequest(
    request: Request,
    params: { buildId: string; token?: string; artifactPath?: string },
  ): Promise<Response> {
    // 0. Handle CORS Preflight OPTIONS immediately (supports Origin: null from opaque iframe sandbox)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const baseCorsHeaders: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Timing-Allow-Origin": "*",
    };

    const noStoreHeaders: Record<string, string> = {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...baseCorsHeaders,
    };

    // 1. Validate buildId parameter
    const buildId = params.buildId?.trim();
    if (!buildId) {
      return new Response("Bad Request: Missing build ID", {
        status: 400,
        headers: noStoreHeaders,
      });
    }

    // 2. Resolve Build Record
    const build = await this.dal.getBuildById(buildId);
    if (!build) {
      return new Response(`Build "${buildId}" not found`, {
        status: 404,
        headers: noStoreHeaders,
      });
    }

    // 3. Authorization Check (Capability Token vs Direct Session)
    if (params.token && params.token.trim() !== "") {
      // Resolve secret key with fail-closed behavior
      let secret: string;
      try {
        secret = this.getTokenSecret();
      } catch (err: any) {
        return new Response(
          `Server Configuration Error: ${err?.message || "Missing preview token secret"}`,
          {
            status: 500,
            headers: noStoreHeaders,
          },
        );
      }

      // Ephemeral Preview Capability Token validation (for opaque sandboxed iframe & sub-resources)
      const tokenVerification = await verifyPreviewCapabilityToken(
        params.token,
        secret,
        build.id,
      );

      if (!tokenVerification.valid || !tokenVerification.payload) {
        return new Response(
          `Unauthorized: ${tokenVerification.error || "Invalid preview capability token"}`,
          {
            status: 401,
            headers: noStoreHeaders,
          },
        );
      }

      // Verify token provenance matches build entity
      const { payload } = tokenVerification;
      if (
        payload.storefrontId !== build.storefrontId ||
        payload.themeId !== build.themeId
      ) {
        return new Response(
          "Forbidden: Preview capability token does not match build entity",
          {
            status: 403,
            headers: noStoreHeaders,
          },
        );
      }
    } else {
      // Direct session authentication check (for direct browser navigation)
      const session = await this.sessionResolver(request);
      if (!session?.user) {
        return new Response(
          "Unauthorized: Please sign in to preview theme build",
          {
            status: 401,
            headers: noStoreHeaders,
          },
        );
      }

      if (!hasAnyRole(session.user.role, ["admin"])) {
        return new Response("Forbidden: Administrator access is required", {
          status: 403,
          headers: noStoreHeaders,
        });
      }

      if (this.storefrontAccessChecker) {
        const hasStorefrontAccess = await this.storefrontAccessChecker(
          session.user.id,
          build.storefrontId,
          session.user.role,
        );
        if (!hasStorefrontAccess) {
          return new Response(
            "Forbidden: User does not have access to this storefront",
            {
              status: 403,
              headers: noStoreHeaders,
            },
          );
        }
      }
    }

    // 4. Verify Storefront & Theme Ownership (Theme belongs to that Storefront)
    const isOwner = await this.dal.verifyThemeOwnership(
      build.storefrontId,
      build.themeId,
    );
    if (!isOwner) {
      return new Response(
        "Forbidden: Storefront theme ownership verification failed",
        {
          status: 403,
          headers: noStoreHeaders,
        },
      );
    }

    // 5. Authoritative Succeeded State Validation
    if (build.status === "queued" || build.status === "building") {
      return new Response(
        `Build "${buildId}" is still in progress (${build.status})`,
        {
          status: 409,
          headers: {
            ...noStoreHeaders,
            "Content-Type": "text/plain; charset=utf-8",
          },
        },
      );
    }

    if (build.status === "failed") {
      return new Response(
        `Build "${buildId}" failed: ${build.errorMessage || "Theme compilation error"}`,
        {
          status: 422,
          headers: {
            ...noStoreHeaders,
            "Content-Type": "text/plain; charset=utf-8",
          },
        },
      );
    }

    if (
      build.status !== "succeeded" ||
      !build.artifactPrefix ||
      !build.manifestJson
    ) {
      return new Response(
        `Build "${buildId}" has no valid succeeded build artifacts`,
        {
          status: 404,
          headers: noStoreHeaders,
        },
      );
    }

    // 6. Canonical Manifest Parsing & Validation
    const manifest = build.manifestJson as CanonicalThemeBuildManifest;
    if (
      !manifest ||
      typeof manifest !== "object" ||
      !Array.isArray(manifest.files)
    ) {
      return new Response("Invalid or corrupt theme build manifest", {
        status: 500,
        headers: noStoreHeaders,
      });
    }

    // 7. Sanitize & Canonicalize Requested Artifact Path
    let canonicalPath: string;
    try {
      canonicalPath = sanitizePreviewArtifactPath(params.artifactPath);
    } catch (err: any) {
      return new Response(err?.message || "Invalid artifact path", {
        status: 400,
        headers: noStoreHeaders,
      });
    }

    // Resolve entry point if root requested with P2 defense-in-depth sanitization
    const rawEntry = manifest.artifactEntry || manifest.entry || "index.html";
    let defaultEntry: string;
    try {
      defaultEntry = sanitizePreviewArtifactPath(rawEntry);
    } catch {
      defaultEntry = "index.html";
    }

    if (canonicalPath === "") {
      canonicalPath = defaultEntry;
    }

    // 8. Canonical Manifest Serving Boundary Check
    const manifestFile: CanonicalThemeBuildManifestFile | undefined =
      manifest.files.find((f) => f.path === canonicalPath);

    const isEntryFile = canonicalPath === defaultEntry;

    if (!manifestFile && (!isEntryFile || manifest.files.length > 0)) {
      return new Response(
        `Artifact "${canonicalPath}" is not part of build "${buildId}" manifest`,
        {
          status: 404,
          headers: noStoreHeaders,
        },
      );
    }

    // 9. Fetch Immutable Object from R2
    if (!this.r2Bucket) {
      return new Response("R2 storage bucket binding is not configured", {
        status: 500,
        headers: noStoreHeaders,
      });
    }

    const fullKey = `${build.artifactPrefix}/${canonicalPath}`;
    const object = await this.r2Bucket.get(fullKey);
    if (!object) {
      return new Response(
        `Artifact object "${canonicalPath}" not found in storage`,
        {
          status: 404,
          headers: noStoreHeaders,
        },
      );
    }

    // 10. Conditional ETag / 304 Not Modified check
    const ifNoneMatch = request.headers.get("if-none-match");
    const etag =
      object.httpEtag ||
      (manifestFile ? `"${manifestFile.sha256}"` : undefined);

    if (ifNoneMatch && etag && ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          etag,
          "Cache-Control": isEntryFile
            ? "private, no-store"
            : "private, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
          ...baseCorsHeaders,
        },
      });
    }

    // 11. Content-Type, CORS & Security Headers
    const contentType =
      manifestFile?.contentType ||
      object.httpMetadata?.contentType ||
      resolveMimeFallback(canonicalPath);

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    headers.set("Timing-Allow-Origin", "*");

    if (etag) {
      headers.set("ETag", etag);
    }

    if (
      isEntryFile ||
      canonicalPath.endsWith(".html") ||
      canonicalPath.endsWith(".htm")
    ) {
      // HTML entry: private, no-store with frame and CSP restrictions
      headers.set("Cache-Control", "private, no-store");
      headers.set("X-Frame-Options", "SAMEORIGIN");
      headers.set(
        "Content-Security-Policy",
        "default-src 'self' 'unsafe-inline' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' blob: https:; frame-ancestors 'self'; object-src 'none'; base-uri 'self';",
      );
    } else {
      // Immutable hashed bundle assets (JS, CSS, images, fonts): private, max-age=1yr, immutable
      headers.set("Cache-Control", "private, max-age=31536000, immutable");
    }

    // Return object body
    let bodyStream: any = object.body;
    if (!bodyStream && typeof (object as any).arrayBuffer === "function") {
      const buf = await (object as any).arrayBuffer();
      bodyStream = new Uint8Array(buf);
    }

    return new Response(bodyStream, {
      status: 200,
      headers,
    });
  }
}
