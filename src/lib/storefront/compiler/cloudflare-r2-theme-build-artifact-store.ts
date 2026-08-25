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

function validateAndCanonicalizeArtifactDirectory(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/\/+$/, "");
  const sentinel = validateAndCanonicalizeArtifactPath(
    `${trimmed}/.morph-directory`,
  );
  return sentinel.slice(0, -"/.morph-directory".length);
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
 * Handles atomic immutable R2 persistence via conditional creates, deterministic SHA-256 verification,
 * and authoritative canonical manifest commitment.
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
    const { build, buildInput, artifacts, runnerManifest } = params;

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

    // Provenance consistency checks against immutable frozen build & buildInput
    if (build.status !== "building") {
      throw new Error(
        `BUILD_PROVENANCE_MISMATCH: Build must be in "building" status when persisting artifacts (current: "${build.status}").`,
      );
    }
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
    if (build.inputHash !== buildInput.inputHash) {
      throw new Error("BUILD_PROVENANCE_MISMATCH: Input hash mismatch between build record and buildInput.");
    }
    if (build.compilerId !== buildInput.compilerId || build.compilerVersion !== buildInput.compilerVersion) {
      throw new Error("BUILD_PROVENANCE_MISMATCH: Compiler identity mismatch between build record and buildInput.");
    }
    if (build.artifactPrefix !== null) {
      throw new Error("BUILD_PROVENANCE_MISMATCH: In-flight build must have artifactPrefix set to null before persistence.");
    }

    const artifactPrefix = buildThemeArtifactPrefix(
      buildInput.storefrontId,
      buildInput.themeId,
      buildInput.buildId,
    );

    // Stage 1: Validate, calculate authoritative actual size, and Hash all artifact files
    const validatedFiles: Array<{
      relPath: string;
      fullKey: string;
      content: string | Uint8Array;
      mimeType: string;
      actualSizeBytes: number;
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

      // Authoritative byte size calculation
      const actualSizeBytes =
        typeof artifact.content === "string"
          ? Buffer.byteLength(artifact.content, "utf8")
          : artifact.content.byteLength;

      // Fail-closed verification if runner declared a conflicting size
      if (artifact.sizeBytes !== undefined && artifact.sizeBytes !== actualSizeBytes) {
        throw new Error(
          `ARTIFACT_SIZE_MISMATCH: Declared sizeBytes (${artifact.sizeBytes}) does not match actual byte count (${actualSizeBytes}) for artifact "${artifact.path}".`,
        );
      }

      const sha256 = calculateArtifactSha256(artifact.content);
      totalSizeBytes += actualSizeBytes;

      validatedFiles.push({
        relPath,
        fullKey,
        content: artifact.content,
        mimeType: artifact.mimeType || "application/octet-stream",
        actualSizeBytes,
        sha256,
      });
    }

    const requestedArtifactEntry =
      typeof runnerManifest?.artifactEntry === "string"
        ? validateAndCanonicalizeArtifactPath(runnerManifest.artifactEntry)
        : null;
    if (
      requestedArtifactEntry &&
      !validatedFiles.some((file) => file.relPath === requestedArtifactEntry)
    ) {
      throw new Error(
        `INVALID_ARTIFACT_ENTRY: Runner entry "${requestedArtifactEntry}" is not present in the immutable artifact set.`,
      );
    }
    const runtimeMetadata = runnerManifest?.metadata;
    if (
      runtimeMetadata?.runtime === "cloudflare-worker" &&
      typeof runtimeMetadata.workerEntry !== "string"
    ) {
      throw new Error(
        "INVALID_WORKER_ENTRY: Cloudflare Worker runtime metadata requires workerEntry.",
      );
    }
    const runtime =
      runtimeMetadata?.runtime === "cloudflare-worker"
        ? {
            kind: "cloudflare-worker" as const,
            workerEntry: validateAndCanonicalizeArtifactPath(
              runtimeMetadata.workerEntry,
            ),
            clientAssetsDirectory:
              typeof runtimeMetadata.clientAssetsDirectory === "string"
                ? validateAndCanonicalizeArtifactDirectory(
                    runtimeMetadata.clientAssetsDirectory,
                  )
                : undefined,
            previewEntry:
              typeof runtimeMetadata.previewEntry === "string"
                ? validateAndCanonicalizeArtifactPath(
                    runtimeMetadata.previewEntry,
                  )
                : undefined,
          }
        : { kind: "static" as const };

    if (
      runtime.workerEntry &&
      !validatedFiles.some((file) => file.relPath === runtime.workerEntry)
    ) {
      throw new Error(
        `INVALID_WORKER_ENTRY: Worker entry "${runtime.workerEntry}" is not present in the immutable artifact set.`,
      );
    }
    if (
      runtime.previewEntry &&
      !validatedFiles.some((file) => file.relPath === runtime.previewEntry)
    ) {
      throw new Error(
        `INVALID_PREVIEW_ENTRY: Preview entry "${runtime.previewEntry}" is not present in the immutable artifact set.`,
      );
    }
    if (
      runtime.clientAssetsDirectory &&
      !validatedFiles.some((file) =>
        file.relPath.startsWith(`${runtime.clientAssetsDirectory}/`),
      )
    ) {
      throw new Error(
        `INVALID_CLIENT_ASSETS_DIRECTORY: Client assets directory "${runtime.clientAssetsDirectory}" is not present in the immutable artifact set.`,
      );
    }

    // Stage 2: Upload all artifact files via atomic conditional creates
    const uploadedManifestFiles: CanonicalThemeBuildManifestFile[] = [];

    for (const item of validatedFiles) {
      const body =
        typeof item.content === "string"
          ? item.content
          : item.content instanceof Uint8Array
            ? item.content
            : new Uint8Array(item.content);

      // Atomic conditional write: onlyIf etagDoesNotMatch: "*" prevents TOCTOU concurrent overwrite race
      const putResult = await this.r2Bucket.put(item.fullKey, body, {
        onlyIf: { etagDoesNotMatch: "*" },
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

      if (putResult !== null) {
        // Successfully created new object
        uploadedManifestFiles.push({
          path: item.relPath,
          contentType: item.mimeType,
          sizeBytes: item.actualSizeBytes,
          sha256: item.sha256,
          r2Etag: putResult.httpEtag,
        });
        continue;
      }

      // Precondition failed: object already exists in R2.
      // MUST NOT assume identical! Verify existing object hash.
      const existingHead = await this.r2Bucket.head(item.fullKey);
      let existingSha256 = existingHead?.customMetadata?.sha256;
      let existingEtag = existingHead?.httpEtag;
      let existingSize = existingHead?.size;

      if (!existingSha256) {
        // No SHA-256 metadata present: fetch full object to verify actual content bytes
        const existingObj = await this.r2Bucket.get(item.fullKey);
        if (!existingObj) {
          throw new Error(
            `CONCURRENT_ARTIFACT_DELETION: Object "${item.fullKey}" vanished during concurrent conflict resolution.`,
          );
        }
        const downloadedBytes = new Uint8Array(await existingObj.arrayBuffer());
        existingSha256 = calculateArtifactSha256(downloadedBytes);
        existingEtag = existingObj.httpEtag;
        existingSize = downloadedBytes.byteLength;
      }

      if (existingSha256 !== item.sha256) {
        throw new Error(
          `IMMUTABLE_ARTIFACT_OVERWRITE_FORBIDDEN: Artifact at key "${item.fullKey}" already exists with different content hash (existing: ${existingSha256}, incoming: ${item.sha256}). Succeeded/immutable build artifacts cannot be overwritten.`,
        );
      }

      // Identical SHA-256: idempotent success
      uploadedManifestFiles.push({
        path: item.relPath,
        contentType: item.mimeType,
        sizeBytes: existingSize ?? item.actualSizeBytes,
        sha256: item.sha256,
        r2Etag: existingEtag,
      });
    }

    // Stage 3: Verify all files were uploaded successfully
    if (uploadedManifestFiles.length !== validatedFiles.length) {
      throw new Error(
        `ARTIFACT_UPLOAD_INCOMPLETE: Expected ${validatedFiles.length} uploaded files, but only ${uploadedManifestFiles.length} were recorded.`,
      );
    }

    // Stage 4: Construct and Commit Canonical Manifest LAST as the atomic commit marker
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
      requestedArtifactEntry ??
      uploadedManifestFiles.find((f) => f.path === "index.html")?.path ??
      uploadedManifestFiles[0]?.path ??
      "index.html";

    // Use deterministic build startedAt/createdAt timestamp for manifest reproducibility across identical retries
    const manifestCreatedAt =
      build.startedAt ?? build.createdAt ?? new Date().toISOString();

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
      runtime,
      filesCount: uploadedManifestFiles.length,
      totalSizeBytes,
      files: uploadedManifestFiles,
      cssChunks,
      jsChunks,
      createdAt: manifestCreatedAt,
    };

    const manifestKey = `${artifactPrefix}/manifest.json`;
    const manifestJsonString = JSON.stringify(canonicalManifest, null, 2);
    const manifestSha256 = calculateArtifactSha256(manifestJsonString);

    // Conditional create for manifest.json as well
    const manifestPutResult = await this.r2Bucket.put(manifestKey, manifestJsonString, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: {
        contentType: "application/json",
      },
      customMetadata: {
        sha256: manifestSha256,
        buildId: buildInput.buildId,
        type: "canonical-manifest",
      },
    });

    if (manifestPutResult === null) {
      // Manifest already exists - verify identical content
      const existingManifestObj = await this.r2Bucket.get(manifestKey);
      if (!existingManifestObj) {
        throw new Error(
          `CONCURRENT_MANIFEST_DELETION: Manifest "${manifestKey}" vanished during conflict check.`,
        );
      }
      const existingManifestText = await existingManifestObj.text();
      const existingManifestSha = calculateArtifactSha256(existingManifestText);
      if (existingManifestSha !== manifestSha256) {
        throw new Error(
          `IMMUTABLE_MANIFEST_OVERWRITE_FORBIDDEN: Canonical manifest at "${manifestKey}" already exists with different content hash.`,
        );
      }
    }

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
