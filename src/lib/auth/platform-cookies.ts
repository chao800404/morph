import { RESET_ACCESS_COOKIE } from "./reset-access-token";

/**
 * The cookie prefix Better Auth is configured with (`advanced.cookiePrefix`).
 *
 * It is Better Auth's own default, set explicitly so that code which has to
 * know which cookies are the platform's reads the configured value instead of
 * keeping a copy of the default that could drift from it.
 */
export const AUTH_COOKIE_PREFIX = "better-auth";

/**
 * Whether a cookie name is one Morph issues as a credential.
 *
 * Every Better Auth cookie is named `<prefix>.<name>` (and read under the
 * older `<prefix>-<name>` too), so the whole prefix is reserved rather than a
 * list of today's names: a plugin that adds a cookie is covered without
 * anyone remembering to add it here. `verify_access` is the password-reset
 * grant. The `__Secure-` and `__Host-` forms are the same cookie to the
 * platform, so they are the same name here; browsers match those prefixes
 * without regard to case.
 */
export function isPlatformCredentialCookieName(name: string): boolean {
  const bare = name.trim().replace(/^__(?:secure|host)-/i, "");
  return (
    bare === RESET_ACCESS_COOKIE ||
    bare.startsWith(`${AUTH_COOKIE_PREFIX}.`) ||
    bare.startsWith(`${AUTH_COOKIE_PREFIX}-`)
  );
}
