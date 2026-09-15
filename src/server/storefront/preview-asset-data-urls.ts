import { env } from "cloudflare:workers";
import type { assetDal } from "@/lib/asset/dal/asset.dal";

/**
 * Image bytes the Live Preview is allowed to inline.
 *
 * Its own module, not an export of the catalog server function. A server
 * function file is replaced by RPC stubs in the client bundle, and that
 * substitution only happens while every export is a server function: one plain
 * export keeps the real module — and its `cloudflare:workers` import — in the
 * browser graph, where the editor route then fails to load at all.
 */

const PREVIEW_ASSET_MIME_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_PREVIEW_ASSET_BYTES = 3 * 1024 * 1024;
const MAX_PREVIEW_ASSET_TOTAL_BYTES = 8 * 1024 * 1024;

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * Gives the isolated iframe bounded, inert image bytes without giving Theme
 * code an authenticated Morph URL or an R2 capability. Production continues
 * to use the public channel-scoped asset endpoint; this is preview-only.
 */
export async function previewAssetDataUrls(
  assets: Awaited<ReturnType<typeof assetDal.findByIds>>,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (!env.R2_BUCKET) return urls;
  let totalBytes = 0;
  for (const asset of assets) {
    const mimeType = asset.mimeType?.toLowerCase() ?? "";
    if (
      !PREVIEW_ASSET_MIME_TYPES.has(mimeType) ||
      asset.size <= 0 ||
      asset.size > MAX_PREVIEW_ASSET_BYTES ||
      totalBytes + asset.size > MAX_PREVIEW_ASSET_TOTAL_BYTES
    ) {
      continue;
    }
    const key = asset.url.replace(/^\/+/, "");
    const object = await env.R2_BUCKET.get(
      key.startsWith("assets/") ? key : `assets/${key}`,
    );
    if (!object || object.size > MAX_PREVIEW_ASSET_BYTES) continue;
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (totalBytes + bytes.byteLength > MAX_PREVIEW_ASSET_TOTAL_BYTES) continue;
    totalBytes += bytes.byteLength;
    urls.set(
      `/api/store/assets/${asset.id}`,
      `data:${mimeType};base64,${encodeBase64(bytes)}`,
    );
  }
  return urls;
}
