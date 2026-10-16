/**
 * Paths Morph sends that only make sense on the origin that sent them.
 *
 * Published page media resolve to `/_storefront-media/<id>` and product
 * images to `/api/store/assets/<id>`. A site on another domain would resolve
 * either against itself, so they are made absolute against the base URL.
 *
 * Only these two prefixes are touched. Content values carry no field types,
 * so any other string that starts with `/` may be a link, a Theme file or
 * plain text, and rewriting it would be a guess. Those stay as Morph sent
 * them; see the limits in `README.md`.
 */
const MORPH_PATH_PREFIXES = ["/_storefront-media/", "/api/store/assets/"];

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
