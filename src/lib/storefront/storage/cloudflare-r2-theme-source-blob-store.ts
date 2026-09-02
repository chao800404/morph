import crypto from "node:crypto";
import type { R2BucketLike } from "@/lib/storefront/compiler/cloudflare-r2-theme-build-artifact-store";
import type {
  ThemeSourceBlob,
  ThemeSourceBlobStore,
} from "./theme-storage.types";

export const THEME_SOURCE_BLOB_PREFIX = "theme-source";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function bytesForContent(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? new TextEncoder().encode(content) : content;
}

export function calculateThemeSourceSha256(content: string | Uint8Array): string {
  return crypto.createHash("sha256").update(bytesForContent(content)).digest("hex");
}

function validateDigest(digest: string): string {
  if (!SHA256_PATTERN.test(digest)) {
    throw new Error(
      `INVALID_THEME_SOURCE_DIGEST: Expected a lowercase SHA-256 digest, got "${digest}".`,
    );
  }
  return digest;
}

function sourceBlobKey(digest: string): string {
  return `${THEME_SOURCE_BLOB_PREFIX}/${validateDigest(digest)}`;
}

/**
 * R2 implementation for immutable Theme source bytes.
 *
 * A conditional create prevents a later revision from replacing a blob. If
 * an identical object already exists, the write is idempotent; a different
 * object at the same digest is an integrity failure.
 */
export class CloudflareR2ThemeSourceBlobStore implements ThemeSourceBlobStore {
  constructor(private readonly r2Bucket?: R2BucketLike) {}

  async putImmutable(blob: ThemeSourceBlob): Promise<void> {
    if (!this.r2Bucket) {
      throw new Error(
        "R2_BUCKET_UNAVAILABLE: Theme source blob storage is not configured.",
      );
    }

    const digest = validateDigest(blob.digest);
    const bytes = bytesForContent(blob.content);
    const actualDigest = calculateThemeSourceSha256(bytes);
    if (actualDigest !== digest) {
      throw new Error(
        `THEME_SOURCE_DIGEST_MISMATCH: Blob digest "${digest}" does not match content hash "${actualDigest}".`,
      );
    }

    const key = sourceBlobKey(digest);
    const created = await this.r2Bucket.put(key, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: blob.mimeType || "application/octet-stream" },
      customMetadata: {
        sha256: digest,
        kind: "theme-source-blob",
        sizeBytes: String(bytes.byteLength),
      },
    });
    if (created !== null) return;

    // A conditional-create collision is only idempotent after verifying the
    // existing object's actual bytes. Metadata alone is not authoritative.
    const existing = await this.r2Bucket.get(key);
    if (!existing) {
      throw new Error(
        `CONCURRENT_THEME_SOURCE_BLOB_DELETION: Blob "${digest}" vanished during immutable write.`,
      );
    }
    const existingBytes = new Uint8Array(await existing.arrayBuffer());
    const existingDigest = calculateThemeSourceSha256(existingBytes);
    if (existingDigest !== digest) {
      throw new Error(
        `IMMUTABLE_THEME_SOURCE_OVERWRITE_FORBIDDEN: Blob "${digest}" already contains different content (actual: ${existingDigest}).`,
      );
    }
  }

  async getImmutable(digest: string): Promise<Uint8Array | null> {
    if (!this.r2Bucket) {
      throw new Error(
        "R2_BUCKET_UNAVAILABLE: Theme source blob storage is not configured.",
      );
    }

    const normalizedDigest = validateDigest(digest);
    const object = await this.r2Bucket.get(sourceBlobKey(normalizedDigest));
    if (!object) return null;

    const bytes = new Uint8Array(await object.arrayBuffer());
    const actualDigest = calculateThemeSourceSha256(bytes);
    if (actualDigest !== normalizedDigest) {
      throw new Error(
        `THEME_SOURCE_BLOB_INTEGRITY_FAILURE: Blob "${normalizedDigest}" failed SHA-256 verification (actual: ${actualDigest}).`,
      );
    }
    return bytes;
  }
}

