/**
 * Hostname canonicalization with no runtime dependencies.
 *
 * Kept apart from `storefront-host-resolver.ts` (which reaches the DALs and so
 * the Worker runtime) so that code running outside the Worker — the Core
 * deploy tooling in `src/lib/core-deploy/` — canonicalizes hostnames with the
 * same function the request path uses, not with a copy.
 */

const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const MAX_HOSTNAME_LENGTH = 253;

/**
 * Normalizes an untrusted `Host` header into a comparable hostname.
 * Returns `null` when the value cannot be a routable storefront hostname, so
 * callers never query storage with attacker-controlled shapes.
 */
export function normalizeStorefrontHostname(raw: string | null): string | null {
  if (!raw) return null;
  let value = raw.trim().toLowerCase();
  if (!value) return null;

  // Strip an explicit port, including bracketed IPv6 forms we do not serve.
  if (value.startsWith("[")) return null;
  const colonIndex = value.lastIndexOf(":");
  if (colonIndex !== -1) {
    const port = value.slice(colonIndex + 1);
    if (!/^\d+$/.test(port)) return null;
    value = value.slice(0, colonIndex);
  }

  value = value.replace(/\.$/, "");
  if (!value || value.length > MAX_HOSTNAME_LENGTH) return null;
  if (value.includes("..") || value.includes("_")) return null;
  if (!HOSTNAME_PATTERN.test(value)) return null;

  return value;
}
