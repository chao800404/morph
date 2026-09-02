import type {
  StorefrontThemeFileDTO,
  ThemeSourceRevisionManifest,
  ThemeSourceRevisionManifestFile,
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
  files: readonly StorefrontThemeFileDTO[],
  blobStore: ThemeSourceBlobStore,
): Promise<ThemeSourceRevisionManifest> {
  const manifestFiles: ThemeSourceRevisionManifestFile[] = [];

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
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

