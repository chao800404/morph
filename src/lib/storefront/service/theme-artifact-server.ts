import type { R2BucketLike } from "../compiler/cloudflare-r2-theme-build-artifact-store";
import type {
  CanonicalThemeBuildManifest,
  CanonicalThemeBuildManifestFile,
} from "../compiler/theme-build-artifact-store.types";

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

export function resolveMimeFallback(filename: string): string {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx === -1) return "application/octet-stream";
  const ext = filename.slice(dotIdx).toLowerCase();
  return MIME_FALLBACKS[ext] || "application/octet-stream";
}

/**
 * Validates and canonicalizes an untrusted artifact path.
 * Strictly prevents path traversal attempts (.., \, encoded dots/slashes, null bytes).
 *
 * This is the single sanitization boundary shared by every artifact serving
 * caller (editor preview and production storefront). Callers must never build
 * an R2 key from a raw request path.
 */
export function sanitizeArtifactPath(rawPath?: string): string {
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

  if (decoded.includes("\0") || rawPath.includes("%00")) {
    throw new Error(
      "PATH_TRAVERSAL_DETECTED: Null byte detected in artifact path.",
    );
  }

  if (
    decoded.includes("\\") ||
    rawPath.includes("%5c") ||
    rawPath.includes("%5C")
  ) {
    throw new Error(
      "PATH_TRAVERSAL_DETECTED: Backslashes are forbidden in artifact path.",
    );
  }

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
 * Serving policy differences between the editor preview plane and the
 * production storefront plane. Resolution, manifest boundary enforcement and
 * path sanitization stay identical for both; only cache visibility, document
 * CSP and CORS exposure differ.
 */
export type ThemeArtifactServingPolicy = Readonly<{
  /** Manifest key used when the request targets the artifact root. */
  entryOverride?: string;
  /** `private` for authenticated editor preview, `public` for production edge. */
  cacheVisibility: "private" | "public";
  /** Document-level CSP for HTML responses. `null` disables the header. */
  htmlContentSecurityPolicy: string | null;
  /** `X-Frame-Options` for HTML responses. `null` disables the header. */
  htmlFrameOptions: string | null;
  /** Explicit `Access-Control-Allow-Origin`, or `null` to omit CORS headers. */
  allowOrigin: string | null;
  /** Emitted for HTML documents that must never be cached. */
  htmlCacheControl: string;
}>;

export const PREVIEW_ARTIFACT_POLICY: ThemeArtifactServingPolicy = {
  cacheVisibility: "private",
  htmlContentSecurityPolicy:
    "sandbox allow-scripts; default-src 'self' 'unsafe-inline' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' blob: https:; frame-ancestors 'self'; object-src 'none'; base-uri 'none';",
  htmlFrameOptions: "SAMEORIGIN",
  allowOrigin: null,
  htmlCacheControl: "private, no-store",
};

/**
 * Production edge policy. Storefront assets are publicly cacheable and must not
 * inherit the editor preview's opaque-origin sandbox CSP, which would stop the
 * released Theme from running as a real site.
 */
export const PRODUCTION_ARTIFACT_POLICY: ThemeArtifactServingPolicy = {
  cacheVisibility: "public",
  htmlContentSecurityPolicy: null,
  htmlFrameOptions: null,
  allowOrigin: null,
  htmlCacheControl: "public, max-age=0, must-revalidate",
};

export type ThemeArtifactRequest = Readonly<{
  request: Request;
  artifactPrefix: string;
  manifest: CanonicalThemeBuildManifest;
  artifactPath?: string;
  r2Bucket?: R2BucketLike;
  policy: ThemeArtifactServingPolicy;
}>;

export type ThemeArtifactFailure = Readonly<{
  kind:
    | "INVALID_PATH"
    | "INVALID_MANIFEST"
    | "NOT_IN_MANIFEST"
    | "OBJECT_MISSING"
    | "STORAGE_UNAVAILABLE";
  status: number;
  message: string;
  /** Canonical path the failure refers to, so callers can compose messages. */
  canonicalPath?: string;
}>;

export type ThemeArtifactResult =
  | { success: true; response: Response }
  | { success: false; failure: ThemeArtifactFailure };

function immutableCacheControl(visibility: "private" | "public"): string {
  return `${visibility}, max-age=31536000, immutable`;
}

/**
 * Resolves and serves one immutable artifact object.
 *
 * Invariants shared by every caller:
 * 1. The requested path is sanitized before it can reach an R2 key.
 * 2. Only files declared in the canonical manifest can be served; R2 orphans
 *    are rejected even when the object exists.
 * 3. Hashed bundle assets are immutable; HTML documents are never cached.
 *
 * Authorization is intentionally NOT handled here. Each plane performs its own
 * authorization before delegating, so this function must only ever be reached
 * with an already-authorized artifactPrefix.
 */
export async function serveThemeArtifact(
  args: ThemeArtifactRequest,
): Promise<ThemeArtifactResult> {
  const { request, manifest, policy } = args;

  if (
    !manifest ||
    typeof manifest !== "object" ||
    !Array.isArray(manifest.files)
  ) {
    return {
      success: false,
      failure: {
        kind: "INVALID_MANIFEST",
        status: 500,
        message: "Invalid or corrupt theme build manifest",
      },
    };
  }

  let canonicalPath: string;
  try {
    canonicalPath = sanitizeArtifactPath(args.artifactPath);
  } catch (err: any) {
    return {
      success: false,
      failure: {
        kind: "INVALID_PATH",
        status: 400,
        message: err?.message || "Invalid artifact path",
      },
    };
  }

  const rawEntry =
    policy.entryOverride || manifest.artifactEntry || manifest.entry || "index.html";
  let defaultEntry: string;
  try {
    defaultEntry = sanitizeArtifactPath(rawEntry);
  } catch {
    defaultEntry = "index.html";
  }

  if (canonicalPath === "") {
    canonicalPath = defaultEntry;
  }

  let manifestFile: CanonicalThemeBuildManifestFile | undefined =
    manifest.files.find((f) => f.path === canonicalPath);

  // Resources referenced relatively by the entry document resolve against the
  // entry's directory, not the artifact root. When the entry lives in a
  // subdirectory (`preview/index.html`), the browser asks for
  // `assets/app.js` while the artifact stores `preview/assets/app.js`.
  // The retry is still bounded by the manifest, so nothing outside the build
  // becomes reachable.
  if (!manifestFile && defaultEntry.includes("/")) {
    const entryDirectory = defaultEntry.slice(0, defaultEntry.lastIndexOf("/"));
    const scopedPath = `${entryDirectory}/${canonicalPath}`;
    const scopedFile = manifest.files.find((f) => f.path === scopedPath);
    if (scopedFile) {
      canonicalPath = scopedPath;
      manifestFile = scopedFile;
    }
  }

  if (!manifestFile) {
    return {
      success: false,
      failure: {
        kind: "NOT_IN_MANIFEST",
        status: 404,
        message: `Artifact "${canonicalPath}" is not part of build manifest`,
        canonicalPath,
      },
    };
  }

  const isEntryFile = canonicalPath === defaultEntry;

  if (!args.r2Bucket) {
    return {
      success: false,
      failure: {
        kind: "STORAGE_UNAVAILABLE",
        status: 500,
        message: "R2 storage bucket binding is not configured",
      },
    };
  }

  const fullKey = `${args.artifactPrefix}/${canonicalPath}`;
  const object = await args.r2Bucket.get(fullKey);
  if (!object) {
    return {
      success: false,
      failure: {
        kind: "OBJECT_MISSING",
        status: 404,
        message: `Artifact object "${canonicalPath}" not found in storage`,
        canonicalPath,
      },
    };
  }

  const isHtml =
    isEntryFile ||
    canonicalPath.endsWith(".html") ||
    canonicalPath.endsWith(".htm");

  const corsHeaders: Record<string, string> = {
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Timing-Allow-Origin": "*",
  };
  if (policy.allowOrigin) {
    corsHeaders["Access-Control-Allow-Origin"] = policy.allowOrigin;
    corsHeaders["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS";
  }

  const etag =
    object.httpEtag || (manifestFile ? `"${manifestFile.sha256}"` : undefined);

  const cacheControl = isHtml
    ? policy.htmlCacheControl
    : immutableCacheControl(policy.cacheVisibility);

  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch && etag && ifNoneMatch === etag) {
    return {
      success: true,
      response: new Response(null, {
        status: 304,
        headers: {
          etag,
          "Cache-Control": cacheControl,
          "X-Content-Type-Options": "nosniff",
          Vary: "Origin",
          ...corsHeaders,
        },
      }),
    };
  }

  const contentType =
    manifestFile?.contentType ||
    object.httpMetadata?.contentType ||
    resolveMimeFallback(canonicalPath);

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Vary", "Origin");
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  if (etag) headers.set("ETag", etag);
  headers.set("Cache-Control", cacheControl);

  if (isHtml) {
    if (policy.htmlFrameOptions) {
      headers.set("X-Frame-Options", policy.htmlFrameOptions);
    }
    if (policy.htmlContentSecurityPolicy) {
      headers.set("Content-Security-Policy", policy.htmlContentSecurityPolicy);
    }
  }

  let bodyStream: any = object.body;
  if (!bodyStream && typeof (object as any).arrayBuffer === "function") {
    const buf = await (object as any).arrayBuffer();
    bodyStream = new Uint8Array(buf);
  }

  return {
    success: true,
    response: new Response(bodyStream, { status: 200, headers }),
  };
}
