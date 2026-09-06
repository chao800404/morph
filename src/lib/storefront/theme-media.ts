import { publishedMediaPath } from "./service/storefront-media-delivery";

/** Media kinds that Theme content fields can render. */
export type ThemeMediaKind = "image" | "video";

export const THEME_MEDIA_VALUE_KEYS = [
  "source",
  "mediaType",
  "url",
  "assetId",
  "name",
] as const;

export type ThemeExternalMediaValue = {
  source: "external";
  mediaType: ThemeMediaKind;
  url: string;
};

export type ThemeAssetMediaValue = {
  source: "asset";
  mediaType: ThemeMediaKind;
  assetId: string;
  url: string;
  name?: string;
};

/**
 * Stored value of an image or video content field.
 *
 * Asset-backed values retain the asset identity for future replacement and
 * audits. `url` is stored as the current delivery URL so published snapshots
 * remain deterministic even when the Asset library later changes.
 */
export type ThemeMediaValue = ThemeExternalMediaValue | ThemeAssetMediaValue;

/**
 * Image content is one authoring decision: the source and its accessible name
 * travel together. Asset-backed sources may retain the richer media value so
 * the server can still verify ownership and resolve the published URL.
 */
export type ThemeImageValue = {
  src: string | ThemeMediaValue;
  alt: string;
};

export function isThemeImageValue(value: unknown): value is ThemeImageValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const image = value as Record<string, unknown>;
  return (
    Object.keys(image).every((key) => key === "src" || key === "alt") &&
    Object.prototype.hasOwnProperty.call(image, "src") &&
    (typeof image.src === "string" || isThemeMediaShape(image.src)) &&
    typeof image.alt === "string"
  );
}

/** Reads the new grouped image value and legacy imageSrc/imageAlt values. */
export function normalizeThemeImageValue(value: unknown): ThemeImageValue {
  if (isThemeImageValue(value)) {
    return {
      src: value.src,
      alt: typeof value.alt === "string" ? value.alt : "",
    };
  }
  return {
    src: typeof value === "string" || isThemeMediaShape(value) ? value : "",
    alt: "",
  };
}

/** Stores a picker result while keeping the image source and alt text grouped. */
export function withThemeImageSource(
  value: unknown,
  source: ThemeMediaValue,
): ThemeImageValue {
  const image = normalizeThemeImageValue(value);
  return {
    src: source.source === "external" ? source.url : source,
    alt: image.alt,
  };
}

function isThemeMediaShape(value: unknown): value is ThemeMediaValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (
    (source.source !== "external" && source.source !== "asset") ||
    (source.mediaType !== "image" && source.mediaType !== "video") ||
    typeof source.url !== "string"
  ) {
    return false;
  }
  if (source.source === "external" && source.assetId !== undefined) {
    return false;
  }
  if (
    source.source === "asset" &&
    (typeof source.assetId !== "string" || !source.assetId.trim())
  ) {
    return false;
  }
  return Object.keys(source).every((key) =>
    (THEME_MEDIA_VALUE_KEYS as readonly string[]).includes(key),
  );
}

export function isSafeThemeMediaUrl(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return true;
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../")
  ) {
    return true;
  }
  try {
    return ["http:", "https:"].includes(new URL(normalized).protocol);
  } catch {
    return false;
  }
}

export function normalizeThemeMediaValue(
  value: unknown,
  mediaType: ThemeMediaKind,
): ThemeMediaValue {
  if (typeof value === "string") {
    return { source: "external", mediaType, url: value };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { source: "external", mediaType, url: "" };
  }
  const source = value as Record<string, unknown>;
  const url = typeof source.url === "string" ? source.url : "";
  if (
    source.source === "asset" &&
    typeof source.assetId === "string" &&
    source.assetId.trim()
  ) {
    return {
      source: "asset",
      mediaType,
      assetId: source.assetId,
      url,
      ...(typeof source.name === "string" && source.name.trim()
        ? { name: source.name }
        : {}),
    };
  }
  return { source: "external", mediaType, url };
}

/**
 * Converts stored media references to the URL props Theme components already
 * consume. This runs at both preview and published-content boundaries.
 */
export type ThemeMediaUrlResolver = (media: ThemeMediaValue) => string;

/**
 * Default: the stored URL, which is the CMS delivery path for library assets.
 *
 * Correct inside the editor, where the session that can read `/assets` is the
 * one looking at the page. A published storefront needs a different answer —
 * see `resolvePublishedThemeMediaUrl`.
 */
function storedThemeMediaUrl(media: ThemeMediaValue): string {
  return isSafeThemeMediaUrl(media.url) ? media.url : "";
}

export function resolveThemeMediaInSlotValues(
  props: Record<string, unknown>,
  resolveUrl: ThemeMediaUrlResolver = storedThemeMediaUrl,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    result[key] = resolveThemeMediaValue(value, resolveUrl);
  }
  return result;
}

function resolveThemeMediaValue(
  value: unknown,
  resolveUrl: ThemeMediaUrlResolver,
): unknown {
  if (isThemeMediaShape(value)) return resolveUrl(value);
  if (Array.isArray(value)) {
    return value.map((item) => resolveThemeMediaValue(item, resolveUrl));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = resolveThemeMediaValue(item, resolveUrl);
    }
    return result;
  }
  return value;
}

/**
 * URL for media on a published storefront.
 *
 * Library assets resolve to the storefront's own published-media path rather
 * than the CMS delivery URL, which requires a session an anonymous visitor
 * does not have. External URLs are already public and pass through unchanged.
 */
export function resolvePublishedThemeMediaUrl(media: ThemeMediaValue): string {
  if (media.source === "asset" && media.assetId) {
    const key = media.url.replace(/^\/+/, "");
    if (!key.startsWith("assets/") || key.includes("..")) return "";
    return publishedMediaPath(media.assetId, key);
  }
  return isSafeThemeMediaUrl(media.url) ? media.url : "";
}
