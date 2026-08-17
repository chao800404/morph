import crypto from "node:crypto";
import type {
  StorefrontThemeBuildDTO,
  StorefrontThemeBuildInput,
} from "@/lib/storefront/dto/storefront-theme-build.dto";
import type {
  CanonicalThemeBuildManifest,
  CanonicalThemeBuildManifestFile,
  ThemeBuildArtifactStore,
  ThemeBuildArtifactStoreResult,
} from "./theme-build-artifact-store.types";
import type { ThemeBuildArtifactFile } from "./theme-build-runner.types";

/**
 * Minimal interface representing Cloudflare R2 bucket binding operations.
 */
export interface R2BucketLike {
  get(
    key: string,
    options?: any,
  ): Promise<{
    body: ReadableStream | any;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
    httpEtag?: string;
    customMetadata?: Record<string, string>;
    httpMetadata?: {
      contentType?: string;
    };
    size?: number;
  } | null>;
  head(
    key: string,
  ): Promise<{
    httpEtag?: string;
    customMetadata?: Record<string, string>;
    httpMetadata?: {
      contentType?: string;
    };
    size?: number;
  } | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream | null,
    options?: {
      httpMetadata?: {
        contentType?: string;
      };
      customMetadata?: Record<string, string>;
      onlyIf?: {
        etagDoesNotMatch?: string;
        etagMatches?: string;
      };
    },
  ): Promise<{
    key: string;
    size: number;
    httpEtag?: string;
    customMetadata?: Record<string, string>;
  } | null>;
  delete(key: string | string[]): Promise<void>;
}

export type CloudflareR2ArtifactStoreOptions = {
  id?: string;
  r2Bucket?: R2BucketLike;
};

/**
 * Calculates deterministic SHA-256 hexadecimal hash for artifact contents.
 */
export function calculateArtifactSha256(content: string | Uint8Array): string {
  const hash = crypto.createHash("sha256");
  if (typeof content === "string") {
    hash.update(content, "utf8");
  } else {
    hash.update(content);
  }
  return hash.digest("hex");
}

/**
 * Validates and canonicalizes artifact relative file paths against directory traversal,
 * absolute paths, backslashes, URI-encoded traversal, null bytes, and reserved file names.
 */
export function validateAndCanonicalizeArtifactPath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== "string") {
    throw new Error("INVALID_ARTIFACT_PATH: Artifact path must be a non-empty string.");
  }

  const trimmed = rawPath.trim();
  if (trimmed.length === 0) {
    throw new Error("INVALID_ARTIFACT_PATH: Artifact path cannot be empty.");
  }

  if (trimmed.includes("\0")) {
    throw new Error("INVALID_ARTIFACT_PATH: Artifact path contains forbidden null byte.");
  }

  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    throw new Error(
      `INVALID_ARTIFACT_PATH: Artifact path cannot be absolute: "${rawPath}"`,
    );
  }

  if (trimmed.includes("\\")) {
    throw new Error(
      `INVALID_ARTIFACT_PATH: Artifact path cannot contain backslashes: "${rawPath}"`,
    );
  }

  // Canonicalize slashes
  const normalized = trimmed.replace(/\\/g, "/");

  // Check URL-encoded traversal attempts (e.g. %2e%2e, %2f, %5c)
  try {
    const decoded = decodeURIComponent(normalized);
    if (
      decoded.includes("\0") ||
      decoded.startsWith("/") ||
      decoded.includes("\\") ||
      decoded.split("/").some((seg) => seg === ".." || seg === ".")
    ) {
      throw new Error(
        `ARTIFACT_PATH_TRAVERSAL: Decoded artifact path contains path traversal or invalid characters: "${rawPath}"`,
      );
    }
  } catch (err) {
    if (err instanceof URIError) {
      throw new Error(`INVALID_ARTIFACT_PATH: Malformed URI encoding in artifact path: "${rawPath}"`);
    }
    throw err;
  }

  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment === ".." || segment === "." || segment.length === 0) {
      throw new Error(
        `ARTIFACT_PATH_TRAVERSAL: Artifact path cannot contain traversal segments: "${rawPath}"`,
      );
    }
  }

  if (normalized.toLowerCase() === "manifest.json") {
    throw new Error(
      `RESERVED_ARTIFACT_PATH: "manifest.json" is reserved for the canonical build manifest and cannot be provided as an input artifact.`,
    );
  }

  return normalized;
}

/**
 * Builds the canonical tenant/theme/build scoped immutable artifact prefix.
 */
export function buildThemeArtifactPrefix(
  storefrontId: string,
  themeId: string,
  buildId: string,
): string {
  return `storefronts/${storefrontId}/themes/${themeId}/builds/${buildId}`;
}

/**
 * Cloudflare R2 Theme Build Artifact Store.
 * Handles immutable R2 persistence, deterministic SHA-256 verification, and canonical manifest commitment.
 */
export class CloudflareR2ThemeBuildArtifactStore implements ThemeBuildArtifactStore {
  readonly id: string;
  private readonly r2Bucket?: R2BucketLike;

  constructor(options: CloudflareR2ArtifactStoreOptions = {}) {
    this.id = options.id ?? "cloudflare-r2-theme-build-artifact-store";
    this.r2Bucket = options.r2Bucket;
  }

  /**
   * Persists all artifacts produced by the runner into immutable storage,
   * performs SHA-256 verification, and commits the canonical manifest.json.
   */
  async persistBuildArtifacts(params: {
    build: StorefrontThemeBuildDTO;
    buildInput: StorefrontThemeBuildInput;
    artifacts: ThemeBuildArtifactFile[];
    runnerManifest?: any;
  }): Promise<ThemeBuildArtifactStoreResult> {
    const { build, buildInput, artifacts } = params;

    if (!this.r2Bucket) {
      throw new Error(
        "R2_BUCKET_UNAVAILABLE: Cloudflare R2 bucket binding is not configured in artifact store.",
      );
    }

    if (!artifacts || artifacts.length === 0) {
      throw new Error(
        "EMPTY_ARTIFACTS: Cannot persist build with zero artifact files.",
      );
    }

    // Provenance consistency checks against immutable build & buildInput
    if (build.id !== buildInput.buildId) {
      throw new Error(
        `BUILD_PROVENANCE_MISMATCH: Build ID mismatch between build record (${build.id}) and buildInput (${buildInput.buildId}).`,
      );
    }
    if (build.storefrontId !== buildInput.storefrontId || build.themeId !== buildInput.themeId) {
      throw new Error("BUILD_PROVENANCE_MISMATCH: Tenant scope mismatch between build and buildInput.");
    }
    if (build.sourceRevisionId !== buildInput.sourceRevisionId) {
      throw new Error("BUILD_PROVENANCE_MISMATCH: Source revision mismatch between build and buildInput.");
    }

    const artifactPrefix = buildThemeArtifactPrefix(
      buildInput.storefrontId,
      buildInput.themeId,
      buildInput.buildId,
    );

    // Stage 1: Validate and Hash all artifact files before writing
    const validatedFiles: Array<{
      relPath: string;
      fullKey: string;
      content: string | Uint8Array;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
    }> = [];

    let totalSizeBytes = 0;

    for (const artifact of artifacts) {
      const relPath = validateAndCanonicalizeArtifactPath(artifact.path);
      const fullKey = `${artifactPrefix}/${relPath}`;

      // Ensure key containment
      if (!fullKey.startsWith(`${artifactPrefix}/`)) {
        throw new Error(
          `ARTIFACT_CONTAINMENT_BREACH: Artifact key "${fullKey}" escapes artifact prefix "${artifactPrefix}".`,
        );
      }

      const sha256 = calculateArtifactSha256(artifact.content);
      const sizeBytes =
        artifact.sizeBytes ??
        (typeof artifact.content === "string"
          ? Buffer.byteLength(artifact.content, "utf8")
          : artifact.content.byteLength);

      totalSizeBytes += sizeBytes;

      validatedFiles.push({
        relPath,
        fullKey,
        content: artifact.content,
        mimeType: artifact.mimeType || "application/octet-stream",
        sizeBytes,
        sha256,
      });
    }

    // Stage 2: Upload all artifact files with immutability verification
    const uploadedManifestFiles: CanonicalThemeBuildManifestFile[] = [];

    for (const item of validatedFiles) {
      // Check existing object to enforce immutability
      const existing = await this.r2Bucket.head(item.fullKey);
      if (existing) {
        const existingSha256 = existing.customMetadata?.sha256;
        if (existingSha256 && existingSha256 !== item.sha256) {
          throw new Error(
            `IMMUTABLE_ARTIFACT_OVERWRITE_FORBIDDEN: Artifact at key "${item.fullKey}" already exists with different content hash (existing: ${existingSha256}, incoming: ${item.sha256}).`,
          );
        }
        // If identical sha256 exists, treat as idempotent success
        uploadedManifestFiles.push({
          path: item.relPath,
          contentType: item.mimeType,
          sizeBytes: existing.size ?? item.sizeBytes,
          sha256: item.sha256,
          r2Etag: existing.httpEtag,
        });
        continue;
      }

      // Write new object to R2
      const body =
        typeof item.content === "string"
          ? item.content
          : item.content instanceof Uint8Array
            ? item.content
            : new Uint8Array(item.content);

      const putResult = await this.r2Bucket.put(item.fullKey, body, {
        httpMetadata: {
          contentType: item.mimeType,
        },
        customMetadata: {
          sha256: item.sha256,
          buildId: buildInput.buildId,
          storefrontId: buildInput.storefrontId,
          themeId: buildInput.themeId,
        },
      });

      uploadedManifestFiles.push({
        path: item.relPath,
        contentType: item.mimeType,
        sizeBytes: item.sizeBytes,
        sha256: item.sha256,
        r2Etag: putResult?.httpEtag,
      });
    }

    // Stage 3: Verify all files were uploaded successfully
    if (uploadedManifestFiles.length !== validatedFiles.length) {
      throw new Error(
        `ARTIFACT_UPLOAD_INCOMPLETE: Expected ${validatedFiles.length} uploaded files, but only ${uploadedManifestFiles.length} were recorded.`,
      );
    }

    // Stage 4: Construct and Commit Canonical Manifest LAST as the commit marker
    const cssChunks = uploadedManifestFiles
      .filter((f) => f.contentType === "text/css" || f.path.endsWith(".css"))
      .map((f) => f.path);
    const jsChunks = uploadedManifestFiles
      .filter(
        (f) =>
          f.contentType === "application/javascript" ||
          f.contentType === "text/javascript" ||
          f.path.endsWith(".js") ||
          f.path.endsWith(".mjs"),
      )
      .map((f) => f.path);

    const artifactEntry =
      uploadedManifestFiles.find((f) => f.path === "index.html")?.path ??
      uploadedManifestFiles[0]?.path ??
      "index.html";

    const canonicalManifest: CanonicalThemeBuildManifest = {
      buildId: buildInput.buildId,
      storefrontId: buildInput.storefrontId,
      themeId: buildInput.themeId,
      sourceRevisionId: buildInput.sourceRevisionId,
      revisionNumber: buildInput.revisionNumber,
      inputHash: buildInput.inputHash,
      compilerId: buildInput.compilerId,
      compilerVersion: buildInput.compilerVersion,
      sourceEntry: buildInput.entry,
      entry: buildInput.entry,
      artifactEntry,

      filesCount: uploadedManifestFiles.length,
      totalSizeBytes,
      files: uploadedManifestFiles,
      cssChunks,
      jsChunks,
      createdAt: new Date().toISOString(),
    };

    const manifestKey = `${artifactPrefix}/manifest.json`;
    const manifestJsonString = JSON.stringify(canonicalManifest, null, 2);
    const manifestSha256 = calculateArtifactSha256(manifestJsonString);

    await this.r2Bucket.put(manifestKey, manifestJsonString, {
      httpMetadata: {
        contentType: "application/json",
      },
      customMetadata: {
        sha256: manifestSha256,
        buildId: buildInput.buildId,
        type: "canonical-manifest",
      },
    });

    return {
      artifactPrefix,
      manifest: canonicalManifest,
    };
  }

  /**
   * Reads a single artifact file from the immutable build prefix.
   */
  async getArtifact(params: {
    storefrontId: string;
    themeId: string;
    buildId: string;
    path: string;
  }): Promise<ThemeBuildArtifactFile | null> {
    if (!this.r2Bucket) {
      throw new Error("R2_BUCKET_UNAVAILABLE: Cloudflare R2 bucket binding is not configured.");
    }

    const relPath = validateAndCanonicalizeArtifactPath(params.path);
    const prefix = buildThemeArtifactPrefix(params.storefrontId, params.themeId, params.buildId);
    const key = `${prefix}/${relPath}`;

    const object = await this.r2Bucket.get(key);
    if (!object) {
      return null;
    }

    const mimeType = object.httpMetadata?.contentType || "application/octet-stream";
    const arrayBuffer = await object.arrayBuffer();
    const isText =
      mimeType.startsWith("text/") ||
      mimeType === "application/javascript" ||
      mimeType === "application/json" ||
      mimeType === "image/svg+xml";

    const content = isText
      ? new TextDecoder().decode(arrayBuffer)
      : new Uint8Array(arrayBuffer);

    return {
      path: relPath,
      content,
      mimeType,
      sizeBytes: object.size ?? arrayBuffer.byteLength,
    };
  }
}
