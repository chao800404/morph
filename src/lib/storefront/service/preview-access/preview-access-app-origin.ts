/**
 * Morph's own app origins, exactly: scheme, host and port. `PUBLIC_URL` is
 * the app's origin; the CMS and platform hostnames are served over HTTPS.
 * Loopback editors are believed only by a development server.
 */
export function isMorphAppOrigin(
  origin: string,
  bindings: Record<string, unknown>,
  development: boolean,
): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  const origins = new Set<string>();
  if (typeof bindings.PUBLIC_URL === "string") {
    try {
      origins.add(new URL(bindings.PUBLIC_URL).origin);
    } catch {
      // A malformed PUBLIC_URL names no origin.
    }
  }
  for (const key of ["MORPH_CMS_HOSTNAME", "MORPH_PLATFORM_HOSTNAMES"]) {
    const value = bindings[key];
    if (typeof value !== "string") continue;
    for (const hostname of value.split(",")) {
      const trimmed = hostname.trim().toLowerCase();
      if (trimmed) origins.add(`https://${trimmed}`);
    }
  }
  if (origins.has(origin)) return true;
  return (
    development &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
}
