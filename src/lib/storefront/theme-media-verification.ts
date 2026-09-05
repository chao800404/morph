import type { ThemeMediaKind, ThemeMediaValue } from "./theme-media";

/**
 * Checks asset-backed media against the asset it claims to be.
 *
 * The stored shape is validated structurally — a UUID that parses, a URL that
 * is safe, a media type that matches the field. None of that asks whether the
 * asset exists, whether it belongs to this storefront's library, whether it is
 * the right kind, or whether the URL is the one that asset is served from. So
 * `{ source: "asset", assetId: <any uuid>, url: "https://elsewhere/x.png" }`
 * was accepted, and a field declared `allowExternal: false` could be given an
 * arbitrary external URL simply by labelling it as an asset.
 *
 * The client supplies the reference; the server decides what it means.
 */

export type VerifiableAsset = Readonly<{
  id: string;
  type: string;
  url: string;
}>;

export type MediaVerification =
  | { ok: true; value: ThemeMediaValue }
  | { ok: false; reason: "unknown-asset" | "wrong-asset-type" };

/** Asset kinds that satisfy each media kind. */
const ASSET_TYPES_FOR_MEDIA: Record<ThemeMediaKind, readonly string[]> = {
  image: ["image"],
  video: ["video"],
};

/**
 * Replaces a claimed asset reference with what the library actually holds.
 *
 * The URL is taken from the asset row rather than trusted from the caller, so
 * the stored value cannot point somewhere else while wearing an asset's id.
 * External media is returned unchanged — it was never claiming to be an asset,
 * and whether external URLs are allowed at all is the field's own rule.
 */
export function verifyThemeMediaValue({
  media,
  asset,
}: {
  media: ThemeMediaValue;
  asset: VerifiableAsset | null;
}): MediaVerification {
  if (media.source !== "asset") return { ok: true, value: media };

  if (!asset) return { ok: false, reason: "unknown-asset" };

  const allowed = ASSET_TYPES_FOR_MEDIA[media.mediaType] ?? [];
  if (!allowed.includes(asset.type)) {
    return { ok: false, reason: "wrong-asset-type" };
  }

  return {
    ok: true,
    value: { ...media, assetId: asset.id, url: asset.url },
  };
}

/** Every asset id an incoming props object refers to. */
export function collectMediaAssetIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  const seen = new Set<unknown>();

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = node as Record<string, unknown>;
    if (record.source === "asset" && typeof record.assetId === "string") {
      const id = record.assetId.trim();
      if (id) ids.add(id);
    }
    for (const item of Object.values(record)) visit(item);
  };

  visit(value);
  return ids;
}

/**
 * Rewrites every asset reference in `props` to the verified asset.
 *
 * Throws on a reference that cannot be verified, so a rejected media value
 * fails the write rather than being silently dropped — a silently dropped
 * image looks to the author like a save that worked.
 */
export function verifyMediaReferences({
  props,
  assetsById,
}: {
  props: Record<string, unknown>;
  assetsById: ReadonlyMap<string, VerifiableAsset>;
}): Record<string, unknown> {
  const visit = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(visit);

    const record = node as Record<string, unknown>;
    if (record.source === "asset" && typeof record.assetId === "string") {
      const verified = verifyThemeMediaValue({
        media: record as unknown as ThemeMediaValue,
        asset: assetsById.get(record.assetId.trim()) ?? null,
      });
      if (!verified.ok) {
        throw new Error(
          `INVALID_THEME_MEDIA_REFERENCE:${record.assetId}:${verified.reason}`,
        );
      }
      return verified.value;
    }

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) result[key] = visit(item);
    return result;
  };

  return visit(props) as Record<string, unknown>;
}
