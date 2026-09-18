/**
 * Which origin this deployment is served from, and who is allowed to say so.
 *
 * Two answers, because there are two threat models sharing one question.
 *
 * In production the origin is configuration. It must come from `PUBLIC_URL`
 * and never from the request, because a request's URL is built from its `Host`
 * header, which the caller writes: trusting it there is host-header injection,
 * and it would put an attacker's hostname into password-reset links, into
 * `trustedOrigins`, and into every absolute URL the app hands a browser.
 *
 * Outside production the request is the better answer, and the configured value
 * is the one that lies. `PUBLIC_URL` is a fixed string in `wrangler.jsonc`, so
 * a dev server on any port other than the one it names serves its pages from
 * one origin while its sign-in requests are checked against another — and
 * better-auth refuses them, which arrives as "Failed to fetch" with nothing
 * naming the port. That is why an end-to-end run had to own port 3000: not a
 * property of the suite, an artifact of this constant.
 *
 * So the rule is a single conditional in one place, rather than two callers
 * each deciding. `getPublicURL` and `createAuth` must agree — one supplies the
 * browser's auth client with a base URL and the other decides which origins the
 * server will accept it from, and a disagreement between them is a sign-in that
 * fails for no visible reason.
 */

export type PublicOriginEnv = {
  CF_PAGES?: string;
  ENVIRONMENT?: string;
  PUBLIC_URL?: string;
};

/** The port a developer gets when nothing says otherwise. */
export const DEFAULT_DEV_ORIGIN = "http://localhost:3000";

/**
 * Whether this is a runtime whose origin is configuration rather than context.
 *
 * `CF_PAGES` and `ENVIRONMENT` are injected by the platform; `NODE_ENV` covers
 * a production build run anywhere else.
 */
export function isProductionRuntime(env: PublicOriginEnv): boolean {
  return (
    env.CF_PAGES === "1" ||
    env.ENVIRONMENT === "production" ||
    process.env.NODE_ENV === "production"
  );
}

/**
 * The origin of a request URL, if it is one worth repeating back to a browser.
 *
 * Rejects anything that is not plain http(s) and anything carrying credentials,
 * so a malformed or hostile URL falls through to the configured value rather
 * than becoming the app's identity.
 */
export function originFromRequestUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * The origin to hand out, given what is configured and what was asked for.
 *
 * `configured` is the caller's own existing chain, passed in rather than
 * rebuilt here: `getPublicURL` and `createAuth` read different variables in
 * different orders, and unifying those would change production behaviour while
 * fixing a development one. In production this returns `configured` untouched,
 * so both callers behave exactly as they did.
 */
export function resolvePublicOrigin(options: {
  env: PublicOriginEnv;
  configured: string;
  requestUrl?: string | null;
}): string {
  if (isProductionRuntime(options.env)) return options.configured;
  return originFromRequestUrl(options.requestUrl) ?? options.configured;
}
