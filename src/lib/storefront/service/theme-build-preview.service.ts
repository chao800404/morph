import { env } from "cloudflare:workers";
import { getAuthWithAdmin } from "@/server/auth/helpers";
import { hasAnyRole } from "@/server/middleware/auth.middleware";
import type { R2BucketLike } from "../compiler/cloudflare-r2-theme-build-artifact-store";
import type { CanonicalThemeBuildManifest } from "../compiler/theme-build-artifact-store.types";
import {
  PREVIEW_ARTIFACT_POLICY,
  sanitizeArtifactPath,
  serveThemeArtifact,
} from "./theme-artifact-server";
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

/**
 * Backwards-compatible alias for the shared artifact path sanitizer.
 * Preview and production must never diverge on this boundary.
 */
export const sanitizePreviewArtifactPath = sanitizeArtifactPath;

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
    const reqOrigin = request.headers.get("origin");
    // Defense-in-depth: emit ACAO: null for sandboxed opaque origins (Origin: null) or omit if direct navigation / foreign origin
    const isNullOrigin = reqOrigin === "null";
    const allowedOrigin = isNullOrigin ? "null" : undefined;

    // 0. Handle CORS Preflight OPTIONS immediately (supports Origin: null from opaque iframe sandbox)
    if (request.method === "OPTIONS") {
      const headers: Record<string, string> = {
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      };
      if (allowedOrigin) {
        headers["Access-Control-Allow-Origin"] = allowedOrigin;
      }
      return new Response(null, {
        status: 204,
        headers,
      });
    }

    const baseCorsHeaders: Record<string, string> = {
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Timing-Allow-Origin": "*",
    };
    if (allowedOrigin) {
      baseCorsHeaders["Access-Control-Allow-Origin"] = allowedOrigin;
      baseCorsHeaders["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS";
    }

    const noStoreHeaders: Record<string, string> = {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
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

    // 6-11. Manifest boundary enforcement, path sanitization, R2 resolution
    // and response headers are owned by the shared artifact serving core so
    // preview and production cannot drift into two serving contracts.
    const served = await serveThemeArtifact({
      request,
      artifactPrefix: build.artifactPrefix,
      manifest: build.manifestJson as CanonicalThemeBuildManifest,
      artifactPath: params.artifactPath,
      r2Bucket: this.r2Bucket,
      policy: {
        ...PREVIEW_ARTIFACT_POLICY,
        allowOrigin: allowedOrigin ?? null,
      },
    });

    if (!served.success) {
      const { failure } = served;
      const message =
        failure.kind === "NOT_IN_MANIFEST"
          ? `Artifact "${failure.canonicalPath}" is not part of build "${buildId}" manifest`
          : failure.message;
      return new Response(message, {
        status: failure.status,
        headers: noStoreHeaders,
      });
    }

    return served.response;
  }
}
