/**
 * Paths Morph sends that only make sense on the origin that sent them.
 *
 * Published page media resolve to `/_storefront-media/<id>` and product
 * images to `/api/store/assets/<id>`.
 *
 * Only these two prefixes are touched. Content values carry no field types,
 * so any other string that starts with `/` may be a link, a Theme file or
 * plain text, and rewriting it would be a guess. Those stay as Morph sent
 * them; see the limits in `README.md`.
 */
const MORPH_PATH_PREFIXES = ["/_storefront-media/", "/api/store/assets/"];

/**
 * How a reader hands back the two Morph paths above. Fixed by each entry
 * point and part of that entry's stable contract (`README.md`, "Media URL
 * mode"); a reader never picks it from a response or a request.
 *
 * - `"absolute"`: made absolute against the content origin. For a site on
 *   another domain (`createMorph({ baseUrl })`), which would otherwise
 *   resolve them against itself.
 * - `"relative"`: left exactly as Morph sent them. For a Theme Morph hosts
 *   (`@morph/sdk/start`): its pages are served on the origin these paths
 *   belong to, while the content origin it reads from is a platform address
 *   (the full-Start preview's `morph-preview-content.invalid`, or a build's
 *   loopback prerender server) that must never reach a page.
 */
export type MorphMediaUrls = "absolute" | "relative";

/**
 * The one URL step every read takes, in the reader's mode. Everything else
 * about a read is the same in both modes.
 */
export function resolveMorphPaths<T>(
  value: T,
  origin: string,
  mediaUrls: MorphMediaUrls,
): T {
  return mediaUrls === "absolute" ? absolutizeMorphPaths(value, origin) : value;
}

function absoluteMorphPath(value: string, origin: string): string {
  if (!MORPH_PATH_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return value;
  }
  const resolved = new URL(value, origin);
  // A path cannot leave the origin, but `new URL` is the authority on that,
  // not the prefix check above.
  return resolved.origin === origin ? resolved.href : value;
}

/** Returns a copy with every Morph path made absolute. */
export function absolutizeMorphPaths<T>(value: T, origin: string): T {
  if (typeof value === "string") {
    return absoluteMorphPath(value, origin) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => absolutizeMorphPaths(item, origin)) as T;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      // Defined, not assigned: a parsed `__proto__` key must stay a key.
      Object.defineProperty(result, key, {
        value: absolutizeMorphPaths(item, origin),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result as T;
  }
  return value;
}
