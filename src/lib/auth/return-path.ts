/**
 * Where to send someone back to after they sign in again.
 *
 * The path is attacker-controllable — it arrives as a `?callbackURL=` search
 * param — and it is fed to `window.location.href` by Better Auth's redirect
 * plugin once the credentials are accepted. Better Auth only checks the URL
 * *scheme* (`isSafeUrlScheme` blocks `javascript:` and friends but, by its own
 * documentation, "intentionally" allows absolute URLs), so without the check
 * below `/sign-in?callbackURL=https://evil.example` sends a freshly
 * authenticated user off-site.
 *
 * Everything here therefore refuses anything that is not a same-origin path.
 */

const STORAGE_KEY = "morph:auth:return-path";

/** The landing page when there is nothing worth returning to. */
export const DEFAULT_RETURN_PATH = "/dashboard";

/**
 * Paths that must never be returned to, because arriving at them is what
 * produced the return path in the first place. Restoring one would bounce the
 * user straight back out of the app they just signed in to.
 */
const EXCLUDED_PREFIXES = [
  "/sign-in",
  "/create-first-admin",
  "/reset-password",
  "/invite",
];

/**
 * Narrows an untrusted value to a same-origin path, or `null`.
 *
 * Rejects, in order: non-strings; anything not rooted at `/`; protocol-relative
 * `//host` and its backslash variants, which browsers resolve to another
 * origin; control characters, which can be used to smuggle a scheme past a
 * naive prefix check; and the auth pages themselves.
 */
export function sanitizeReturnPath(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  // Must be rooted, so it can never carry a scheme or an authority.
  if (!trimmed.startsWith("/")) return null;

  // `//evil.example` and `/\evil.example` are both read as protocol-relative
  // URLs by browsers, which makes them cross-origin.
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return null;

  // A backslash anywhere is normalised to `/` by browsers, so treat it as an
  // attempt to dodge the checks above rather than as a literal path character.
  if (trimmed.includes("\\")) return null;

  // Control characters (including the NUL, CR and LF used to split headers or
  // truncate the value before it reaches a parser).
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;

  const pathname = trimmed.split(/[?#]/)[0] ?? "";
  if (
    EXCLUDED_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    return null;
  }

  return trimmed;
}

/**
 * Remembers where to come back to, so the path survives the tab being closed.
 *
 * `sessionStorage` rather than `localStorage`: a return path is only meaningful
 * for the browsing session that was interrupted, and it should not outlive the
 * tab or leak between them.
 */
export function storeReturnPath(value: unknown): void {
  const path = sanitizeReturnPath(value);
  if (typeof window === "undefined") return;
  try {
    if (path === null) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(STORAGE_KEY, path);
  } catch {
    // Storage can be unavailable (private mode, blocked cookies, quota). The
    // return path is a convenience, so losing it must never break sign-out.
  }
}

/** Reads the remembered path, re-validating it on the way out. */
export function readStoredReturnPath(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sanitizeReturnPath(window.sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearStoredReturnPath(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // See storeReturnPath.
  }
}

/**
 * Picks the path to land on after a successful sign-in.
 *
 * The search param wins over storage: it describes the navigation that was
 * actually interrupted, while storage may hold an older one from the same tab.
 */
export function resolveReturnPath(searchValue?: unknown): string {
  return (
    sanitizeReturnPath(searchValue) ??
    readStoredReturnPath() ??
    DEFAULT_RETURN_PATH
  );
}

/** The current location as a return path, for use at logout time. */
export function currentReturnPath(): string | null {
  if (typeof window === "undefined") return null;
  return sanitizeReturnPath(
    window.location.pathname + window.location.search + window.location.hash,
  );
}
