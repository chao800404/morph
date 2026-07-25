import { saveAs } from "file-saver";
import JSZip from "jszip";
import pLimit from "p-limit";

/**
 * Shape returned by `/api/asset/download`. Declared here so the route and this
 * consumer cannot drift.
 */
export interface DownloadManifestFile {
  id: string;
  name: string;
  path: string;
  downloadUrl: string;
  size: number | null;
}

export interface DownloadManifest {
  files: DownloadManifestFile[];
  zipName: string;
}


/**
 * Utility functions for downloading folders and assets
 */

export interface DownloadFolderOptions {
  ids: string | string[];
  defaultFilename?: string;
}

export interface DownloadFolderResult {
  success: boolean;
  message: string;
  error?: string;
}

export interface DownloadAssetOptions {
  ids: string | string[];
  defaultFilename?: string;
}

export interface DownloadAssetResult {
  success: boolean;
  message: string;
  error?: string;
}

export interface DownloadMixedOptions {
  assetIds?: string[];
  folderIds?: string[];
  defaultFilename?: string;
}

export interface DownloadMixedResult {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * Helper to download a single file directly from URL
 */
async function downloadSingleFile(
  url: string,
  defaultFilename: string,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.statusText}`);
  }

  const contentDisposition = response.headers.get("Content-Disposition");
  let filename = defaultFilename;
  if (contentDisposition) {
    const filenameMatch = contentDisposition.match(
      /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/,
    );
    if (filenameMatch && filenameMatch[1]) {
      filename = filenameMatch[1].replace(/['"]/g, "");
      try {
        filename = decodeURIComponent(filename);
      } catch {
        // Ignore decoding errors
      }
    }
  }

  const blob = await response.blob();
  saveAs(blob, filename);
}

/**
 * Helper to handle bulk download with frontend zipping
 */
async function handleBulkDownload(
  params: URLSearchParams,
): Promise<{ success: boolean; message: string; error?: string }> {
  try {
    // 1. Get Manifest
    params.set("mode", "list");
    const manifestRes = await fetch(`/api/asset/download?${params.toString()}`);

    if (!manifestRes.ok) {
      const errorData = (await manifestRes.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(errorData.error || "Failed to fetch download manifest");
    }

    const { files, zipName } =
      (await manifestRes.json()) as DownloadManifest;

    // 2. Download files and add to ZIP
    const zip = new JSZip();
    const limit = pLimit(5); // Limit concurrency to 5

    // Download in parallel with limit
    await Promise.all(
      files.map((file) =>
        limit(async () => {
          try {
            const res = await fetch(file.downloadUrl);

            if (!res.ok) {
              throw new Error(`Status ${res.status}`);
            }

            // Check for potential error responses disguised as 200 OK (e.g. HTML login page or JSON error)
            const contentType = res.headers.get("content-type");
            if (contentType) {
              if (contentType.includes("application/json")) {
                const errorJson = (await res.json().catch(() => ({}))) as {
                  error?: string;
                };
                throw new Error(
                  errorJson.error || "Received JSON instead of file",
                );
              }
              if (contentType.includes("text/html")) {
                throw new Error(
                  "Received HTML instead of file (possible auth error)",
                );
              }
            }

            const blob = await res.blob();

            // Verify blob size if possible (optional, but good for integrity)
            if (file.size && blob.size !== file.size) {
              console.warn(
                `Size mismatch for ${file.name}: expected ${file.size}, got ${blob.size}`,
              );
            }

            zip.file(file.path, blob);
          } catch (err) {
            console.error(`Error downloading ${file.name}:`, err);
            // Create a text file in the zip explaining the error, instead of a corrupt file
            zip.file(
              `${file.path}.error.txt`,
              `Failed to download: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }),
      ),
    );

    // 3. Generate and save ZIP
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, zipName || "download.zip");

    return {
      success: true,
      message: "Download started",
    };
  } catch (error) {
    console.error("Bulk download error:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to download",
      error: error instanceof Error ? error.message : "Failed to download",
    };
  }
}

export async function downloadFolder(
  options: DownloadFolderOptions,
): Promise<DownloadFolderResult> {
  const { ids } = options;
  const idsArray = Array.isArray(ids) ? ids : [ids];

  // Folders always imply potential multiple files -> Bulk Download
  const params = new URLSearchParams();
  params.set(
    "folderIds",
    idsArray.map((id) => encodeURIComponent(id)).join(","),
  );

  return handleBulkDownload(params);
}

export async function downloadAsset(
  options: DownloadAssetOptions,
): Promise<DownloadAssetResult> {
  const { ids, defaultFilename = "download.zip" } = options;
  const idsArray = Array.isArray(ids) ? ids : [ids];

  // Single asset -> Direct Download
  if (idsArray.length === 1) {
    try {
      await downloadSingleFile(
        `/api/asset/download?assetId=${idsArray[0]}`,
        defaultFilename,
      );
      return { success: true, message: "Download started" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Failed",
        error: error instanceof Error ? error.message : "Failed",
      };
    }
  }

  // Multiple assets -> Bulk Download
  const params = new URLSearchParams();
  params.set(
    "assetIds",
    idsArray.map((id) => encodeURIComponent(id)).join(","),
  );
  return handleBulkDownload(params);
}

export async function downloadMixed(
  options: DownloadMixedOptions,
): Promise<DownloadMixedResult> {
  const {
    assetIds = [],
    folderIds = [],
    defaultFilename = "download.zip",
  } = options;

  if (assetIds.length === 0 && folderIds.length === 0) {
    return {
      success: false,
      message: "No assets or folders to download",
      error: "No assets or folders to download",
    };
  }

  // Single asset and no folders -> Direct Download
  if (assetIds.length === 1 && folderIds.length === 0) {
    try {
      await downloadSingleFile(
        `/api/asset/download?assetId=${assetIds[0]}`,
        defaultFilename,
      );
      return { success: true, message: "Download started" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Failed",
        error: error instanceof Error ? error.message : "Failed",
      };
    }
  }

  // Mixed content -> Bulk Download
  const params = new URLSearchParams();
  if (assetIds.length > 0) {
    params.set(
      "assetIds",
      assetIds.map((id) => encodeURIComponent(id)).join(","),
    );
  }
  if (folderIds.length > 0) {
    params.set(
      "folderIds",
      folderIds.map((id) => encodeURIComponent(id)).join(","),
    );
  }

  return handleBulkDownload(params);
}
