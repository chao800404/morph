/**
 * Decides what the background remover is allowed to fetch.
 *
 * The transform runs as a `fetch()` with Cloudflare's `cf.image` options, so
 * the source has to be fetched by the worker rather than read from R2. The
 * asset route it reads from is session-gated, which is why that request has to
 * carry the caller's cookie — and that is exactly what made an unrestricted
 * target dangerous: a caller-supplied `https://…` was fetched verbatim with
 * the CMS session cookie attached, handing the session to whatever host was
 * named, on top of giving an authenticated user an arbitrary server-side fetch.
 *
 * So the target must be same-origin. The only caller passes an asset id plus
 * that asset's own URL, so nothing legitimate needs to leave the origin.
 */

export type RemoveBackgroundTarget =
  | { ok: true; url: string }
  | { ok: false; reason: "missing" | "malformed" | "cross-origin" };

/**
 * Resolves a candidate image reference against the incoming request's origin.
 *
 * Relative paths resolve against it; absolute URLs must match it exactly.
 * Comparing parsed origins rather than string prefixes is deliberate — a
 * prefix test accepts `https://cms.example.com.attacker.test`.
 */
export function resolveRemoveBackgroundTarget({
  candidate,
  requestUrl,
}: {
  candidate: string | null | undefined;
  requestUrl: string;
}): RemoveBackgroundTarget {
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    return { ok: false, reason: "missing" };
  }

  let origin: string;
  try {
    origin = new URL(requestUrl).origin;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  let resolved: URL;
  try {
    resolved = new URL(candidate.trim(), requestUrl);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // `new URL()` resolves `javascript:` and `data:` to themselves rather than
  // against the base, so the origin check below is what rejects them; naming
  // them here would be a second, weaker list to keep in sync.
  if (resolved.origin !== origin) {
    return { ok: false, reason: "cross-origin" };
  }

  return { ok: true, url: resolved.toString() };
}
