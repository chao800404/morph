import {
  isBinaryThemeFile,
  type StorefrontThemeWorkspaceEntryDTO,
  type ThemeSourceRevisionManifest,
  type ThemeSourceRevisionManifestFile,
} from "@/lib/storefront/dto/storefront-theme-file.dto";
import {
  calculateThemeSourceSha256,
} from "./cloudflare-r2-theme-source-blob-store";
import type { ThemeSourceBlobStore } from "./theme-storage.types";

/**
 * Builds and persists a deterministic source manifest from a workspace read.
 * The caller must still perform the D1 ownership/OCC write afterwards; an
 * aborted write may leave harmless, unreferenced immutable blobs for GC.
 */
export async function persistThemeSourceRevisionBlobs(
  files: readonly StorefrontThemeWorkspaceEntryDTO[],
  blobStore: ThemeSourceBlobStore,
): Promise<ThemeSourceRevisionManifest> {
  const manifestFiles: ThemeSourceRevisionManifestFile[] = [];

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    // A binary file's bytes went into the blob store when it was uploaded,
    // under the digest the workspace records. The manifest names them; it
    // never digests the empty string the row keeps in place of content.
    if (isBinaryThemeFile(file)) {
      manifestFiles.push({
        path: file.path,
        digest: file.blobDigest,
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
        isEntry: file.isEntry,
        encoding: "binary",
      });
      continue;
    }
    const digest = calculateThemeSourceSha256(file.content);
    const sizeBytes = new TextEncoder().encode(file.content).byteLength;
    await blobStore.putImmutable({
      digest,
      content: file.content,
      mimeType: file.mimeType,
    });
    manifestFiles.push({
      path: file.path,
      digest,
      sizeBytes,
      mimeType: file.mimeType,
      isEntry: file.isEntry,
    });
  }

  return {
    version: 1,
    algorithm: "sha256",
    files: manifestFiles,
  };
}

