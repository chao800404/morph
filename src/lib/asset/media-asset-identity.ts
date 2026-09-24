import type { AssetType } from "@/db/asset.schema";

/**
 * Which library asset a media field points at, as the library has it now.
 *
 * A content field stores the asset's id, plus the name and URL it had when it
 * was picked. The id is the identity; the rest is a snapshot. So the Inspector
 * asks the library by id rather than trusting the stored name: moving or
 * renaming an asset changes what the author sees without touching the
 * Document, and an asset that is gone says so instead of rendering blank.
 */
export type MediaAssetIdentity = Readonly<{
  id: string;
  type: AssetType;
  name: string;
  /** Folder segments from the library root; empty at the root. */
  folders: readonly string[];
  mimeType: string | null;
  size: number;
  sizeFormatted: string;
  width: number | null;
  height: number | null;
}>;

export type MediaAssetLookup =
  | Readonly<{ status: "found"; asset: MediaAssetIdentity }>
  | Readonly<{ status: "missing" }>;

type AssetRecord = Readonly<{
  id: string;
  type: AssetType;
  name: string;
  folderId: string | null;
  mimeType: string | null;
  size: number;
  sizeFormatted: string;
  width: number | null;
  height: number | null;
}>;

const DELIVERY_URL =
  /^\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.[a-z0-9]+)?$/i;

/**
 * The asset a bare CMS delivery URL (`/assets/<id>.<ext>`) names.
 *
 * Older content, and the starter, stores library images as that plain string
 * rather than as an asset reference. Upload names the file after the asset
 * id, so the id can still be read back for display; the stored value is left
 * as it is.
 */
export function assetIdFromDeliveryUrl(url: string): string | null {
  return DELIVERY_URL.exec(url.trim())?.[1]?.toLowerCase() ?? null;
}

/** Splits a stored folder path (`/Marketing/Home`) into its segments. */
export function folderPathSegments(path: string | null | undefined): string[] {
  if (!path) return [];
  return path.split("/").filter((segment) => segment.length > 0);
}

export function describeMediaAsset(
  asset: AssetRecord | null,
  folderPath: string | null,
): MediaAssetLookup {
  if (!asset) return { status: "missing" };
  return {
    status: "found",
    asset: {
      id: asset.id,
      type: asset.type,
      name: asset.name,
      folders: folderPathSegments(folderPath),
      mimeType: asset.mimeType,
      size: asset.size,
      sizeFormatted: asset.sizeFormatted,
      width: asset.width,
      height: asset.height,
    },
  };
}

/** `Marketing / Home / hero.png`, or just the name at the library root. */
export function mediaAssetLocation(asset: MediaAssetIdentity): string {
  return [...asset.folders, asset.name].join(" / ");
}

/** `1920×1080 · 420 KB · PNG`, leaving out whatever the library lacks. */
export function mediaAssetDetails(asset: MediaAssetIdentity): string {
  const parts: string[] = [];
  if (asset.width && asset.height) parts.push(`${asset.width}×${asset.height}`);
  if (asset.sizeFormatted) parts.push(asset.sizeFormatted);
  const subtype = asset.mimeType?.split("/")[1]?.split(/[+;]/)[0];
  if (subtype) parts.push(subtype.toUpperCase());
  return parts.join(" · ");
}
