import { assetIdFromDeliveryUrl } from "@/lib/asset/media-asset-identity";
import { parsePublishedMediaPath } from "./service/storefront-media-delivery";
import {
  isSafeThemeMediaUrl,
  resolveThemeMediaInSlotValues,
  type ThemeMediaValue,
} from "./theme-media";

/**
 * Library media in content bound for a Live Preview, and its replacement by
 * addresses the preview can actually load.
 *
 * Content reaches the preview in two shapes. The start-time snapshot has been
 * through the published-content resolver, so an asset reference is already a
 * `/_storefront-media/<id>?version=…` path — which only a storefront host
 * serves. A live edit posted by the editor still holds the stored value: an
 * asset reference object, or, in older content, a bare `/assets/<id>.<ext>`
 * string. Every one of those names an asset the preview origin cannot read.
 */

/** The library asset a media URL names, if it names one. */
export function previewMediaAssetId(url: string): string | null {
  const delivered = assetIdFromDeliveryUrl(url);
  if (delivered) return delivered;
  const trimmed = url.trim();
  const query = trimmed.indexOf("?");
  const published = parsePublishedMediaPath(
    query === -1 ? trimmed : trimmed.slice(0, query),
  );
  return published?.toLowerCase() ?? null;
}

function isAssetReference(
  value: unknown,
): value is { source: "asset"; assetId: string } {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { source?: unknown }).source === "asset" &&
    typeof (value as { assetId?: unknown }).assetId === "string"
  );
}

/** Every library asset the content refers to, by id. */
export function collectPreviewMediaAssetIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (node: unknown, depth: number): void => {
    if (depth > 40) return;
    if (typeof node === "string") {
      const id = previewMediaAssetId(node);
      if (id) ids.add(id);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (isAssetReference(node)) {
      const id = node.assetId.trim().toLowerCase();
      if (id) ids.add(id);
      return;
    }
    for (const item of Array.isArray(node) ? node : Object.values(node)) {
      visit(item, depth + 1);
    }
  };
  visit(value, 0);
  return ids;
}

function replaceMediaStrings(
  value: unknown,
  urls: ReadonlyMap<string, string>,
  depth: number,
): unknown {
  if (depth > 40) return value;
  if (typeof value === "string") {
    const id = previewMediaAssetId(value);
    return (id && urls.get(id)) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceMediaStrings(item, urls, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceMediaStrings(item, urls, depth + 1),
      ]),
    );
  }
  return value;
}

/**
 * The content with each library asset it names pointing at `urls`.
 *
 * Asset reference objects become URL strings, as the published resolver would
 * make them, so a live edit reaches the Theme in the same shape as the content
 * it loaded with. An asset with no entry in `urls` keeps the address it had.
 */
export function applyPreviewMediaUrls<T>(
  value: T,
  urls: ReadonlyMap<string, string>,
): T {
  const resolveUrl = (media: ThemeMediaValue): string => {
    const signed =
      media.source === "asset"
        ? urls.get(media.assetId.trim().toLowerCase())
        : undefined;
    if (signed) return signed;
    return isSafeThemeMediaUrl(media.url) ? media.url : "";
  };
  const resolved = resolveThemeMediaInSlotValues({ value }, resolveUrl).value;
  return replaceMediaStrings(resolved, urls, 0) as T;
}
