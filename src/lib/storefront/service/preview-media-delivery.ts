import { applyLibrarySvgHeaders } from "@/lib/asset/svg-delivery";
import { isSvgContentType } from "@/lib/storefront/theme-svg-isolation";
import {
  isLibraryStorageKey,
  PREVIEW_MEDIA_PATH_PREFIX,
  previewMediaExpiry,
  signPreviewMediaUrl,
  verifyPreviewMediaUrl,
} from "./preview-media-signature";

/**
 * Issuing and honouring signed Live Preview media addresses.
 *
 * See `preview-media-signature.ts` for why they exist. Both sides ask the
 * asset library rather than trusting what they are handed: an address is only
 * issued for an image or video that exists, at the storage key it has now, and
 * only honoured while the asset still has that key.
 */

export type PreviewMediaAsset = Readonly<{
  id: string;
  type: string;
  metadata: Readonly<{ r2Key: string }>;
}>;

const PREVIEW_MEDIA_TYPES = new Set(["image", "video"]);
const LOOKUP_BATCH = 50;
/** At most this many assets are signed for one request. */
export const MAX_PREVIEW_MEDIA_ASSETS = 500;

function servableKey(asset: PreviewMediaAsset | null | undefined) {
  if (!asset || !PREVIEW_MEDIA_TYPES.has(asset.type)) return null;
  const key = asset.metadata?.r2Key;
  return typeof key === "string" && isLibraryStorageKey(key) ? key : null;
}

/** Signed addresses for the servable assets among `assetIds`, by id. */
export async function signPreviewMediaAssets(
  assetIds: Iterable<string>,
  options: {
    origin: string;
    secret: string;
    now: number;
    findAssets(ids: string[]): Promise<readonly PreviewMediaAsset[]>;
  },
): Promise<{ urls: Map<string, string>; expiresAt: number }> {
  const ids = [...new Set([...assetIds].map((id) => id.toLowerCase()))].slice(
    0,
    MAX_PREVIEW_MEDIA_ASSETS,
  );
  const expiresAt = previewMediaExpiry(options.now);
  const urls = new Map<string, string>();
  for (let index = 0; index < ids.length; index += LOOKUP_BATCH) {
    const assets = await options.findAssets(
      ids.slice(index, index + LOOKUP_BATCH),
    );
    for (const asset of assets) {
      const storageKey = servableKey(asset);
      if (!storageKey) continue;
      urls.set(
        asset.id.toLowerCase(),
        await signPreviewMediaUrl({
          origin: options.origin,
          assetId: asset.id,
          storageKey,
          expiresAt,
          secret: options.secret,
        }),
      );
    }
  }
  return { urls, expiresAt };
}

export type PreviewMediaObject = Readonly<{
  body: ReadableStream | null;
  httpEtag: string;
  httpMetadata?: Readonly<{ contentType?: string }>;
}>;

export function isPreviewMediaRequest(url: URL): boolean {
  return url.pathname.startsWith(PREVIEW_MEDIA_PATH_PREFIX);
}

function refused(status: number): Response {
  return new Response(status === 404 ? "Not found." : "Forbidden.", {
    status,
    headers: { "cache-control": "no-store", "content-type": "text/plain" },
  });
}

/**
 * The bytes a signed address names, or a refusal.
 *
 * Served to anyone holding the address — the preview page has no session —
 * so it is answered only while the signature holds, the address has not
 * expired, and the asset still exists with the storage key it was signed for.
 */
export async function servePreviewMedia(
  request: Request,
  ports: {
    secret: string;
    now: number;
    findAsset(id: string): Promise<PreviewMediaAsset | null>;
    getObject(key: string): Promise<PreviewMediaObject | null>;
  },
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET, HEAD", "cache-control": "no-store" },
    });
  }
  const verified = await verifyPreviewMediaUrl(
    new URL(request.url),
    ports.secret,
    ports.now,
  );
  if (!verified.ok) return refused(403);

  // Replaced or deleted since the address was issued: those bytes are no
  // longer the asset, whatever the signature says.
  const asset = await ports.findAsset(verified.assetId);
  if (servableKey(asset) !== verified.storageKey) return refused(404);

  const object = await ports.getObject(verified.storageKey);
  if (!object) return refused(404);

  const headers = new Headers();
  const contentType =
    object.httpMetadata?.contentType ?? "application/octet-stream";
  headers.set("content-type", contentType);
  // The address names one version of the bytes, and stops working on its own.
  headers.set("cache-control", "private, max-age=3600");
  headers.set("etag", object.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  // Loaded by a page on another origin.
  headers.set("cross-origin-resource-policy", "cross-origin");
  // Served from Morph's own origin to anyone with the address: whatever the
  // file is, opened directly it must not run as a Morph page.
  headers.set(
    "content-security-policy",
    "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
  );
  if (isSvgContentType(contentType)) {
    applyLibrarySvgHeaders(headers, null, { inlineAllowed: false });
  }

  if (request.headers.get("if-none-match") === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers,
  });
}
