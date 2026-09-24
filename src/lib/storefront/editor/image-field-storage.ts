import {
  withThemeImageSource,
  type ThemeMediaValue,
} from "@/lib/storefront/theme-media";

/**
 * What the Inspector's image module will actually store for a pick.
 *
 * Decided by the shape the value is saved in, not by the field's name: a
 * grouped `image: { src, alt }` value and a field declared `type: "image"`
 * both keep the asset reference, while a field the Theme types as a string —
 * a legacy `imageSrc`, or one declared `text`/`url` — can only hold a URL.
 *
 * A library asset picked into a string field used to be saved as its CMS URL
 * with the asset id dropped. That URL renders for the author and for no
 * visitor, since publishing only serves assets it can see referenced. So a
 * string field is not offered the Asset library at all.
 */
export type ImageFieldStorage = "grouped" | "media" | "url";

export function imageFieldStorage(args: {
  usesGroupedImage: boolean;
  definitionType: string | undefined;
}): ImageFieldStorage {
  if (args.usesGroupedImage) return "grouped";
  if (args.definitionType === "image") return "media";
  return "url";
}

/** Whether a field stored this way keeps which asset was chosen. */
export function canStoreLibraryAsset(storage: ImageFieldStorage): boolean {
  return storage !== "url";
}

/**
 * The value to save for a pick, in the field's own storage shape, or
 * `undefined` when the pick cannot be stored without losing what it is.
 */
export function imageFieldValue(
  storage: ImageFieldStorage,
  current: unknown,
  next: ThemeMediaValue,
): unknown {
  if (storage === "grouped") return withThemeImageSource(current, next);
  if (storage === "media") return next;
  // The picker is not offered here, so an asset should never arrive; if one
  // does, refusing it is better than saving a URL visitors cannot load.
  return next.source === "asset" ? undefined : next.url;
}
