import { isLoopbackPreviewHostname } from "@/lib/storefront/compiler/local-preview-host";
import { DEFAULT_DEV_ORIGIN } from "@/server/public-origin";

/** Whether an origin names this machine (localhost, 127.0.0.1, [::1], *.localhost). */
function isLoopbackOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    // `URL` keeps the brackets on an IPv6 literal; the shared rule expects them gone.
    return isLoopbackPreviewHostname(hostname.replace(/^\[(.*)\]$/, "$1"));
  } catch {
    return false;
  }
}

/**
 * The `trustedOrigins` list Better Auth checks requests against.
 *
 * Production trusts only what it is configured with: `baseURL`, the validated
 * `additionalTrustedOrigins` (a storefront's own origin), and
 * `cmsTrustedOrigins`. Both CMS lists are explicit inputs, so a change to
 * either stays a one-line change at the call site.
 *
 * The dev-only origins are exactly `http://localhost:3000` plus
 * `cmsDevTrustedOrigins`. They are added only when `isProduction` is false.
 * `isProduction` is the caller's `isProductionRuntime(env)`, which is true only
 * through `CF_PAGES`, `ENVIRONMENT`, or the build-time `NODE_ENV` replacement —
 * never through `PUBLIC_URL`. As an extra, fail-closed condition the resolved
 * `baseURL` must also be loopback or exactly one of the dev-only origins (an
 * exact match, not an address range): if the `NODE_ENV` replacement ever broke,
 * a deployment reached on any other origin still does not trust them.
 *
 * Not closed here: a production `baseURL` with neither `PUBLIC_URL` nor
 * `BETTER_AUTH_URL` set is itself `http://localhost:3000` (see `createAuth`)
 * and is trusted as `baseURL`; and a broken `NODE_ENV` replacement lets the
 * request's Host become `baseURL`.
 */
export function buildAuthTrustedOrigins(input: {
  baseURL: string;
  isProduction: boolean;
  cmsTrustedOrigins: readonly string[];
  cmsDevTrustedOrigins: readonly string[];
  additionalTrustedOrigins: readonly string[];
}): string[] {
  const devOrigins = [DEFAULT_DEV_ORIGIN, ...input.cmsDevTrustedOrigins];
  const devOnly =
    !input.isProduction &&
    (isLoopbackOrigin(input.baseURL) || devOrigins.includes(input.baseURL))
      ? devOrigins
      : [];
  return Array.from(
    new Set([
      ...input.cmsTrustedOrigins,
      input.baseURL,
      ...devOnly,
      ...input.additionalTrustedOrigins,
    ]),
  );
}
