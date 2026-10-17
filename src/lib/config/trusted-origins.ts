/**
 * Origins trusted by the CMS authentication layer.
 *
 * Keep this in a client-safe, dependency-free module. Authentication is also
 * imported by server-function middleware, so reading these values through the
 * full CMS config would create a cycle back through collections and queries.
 */

/**
 * Trusted in every environment, production included. Empty on purpose: a
 * deployment trusts its own configured `PUBLIC_URL` and nothing else.
 *
 * `https://*.cmsapp.org` used to be here. It was an old deployment domain whose
 * registration has expired, so anyone could register it; it must not come back.
 */
export const cmsTrustedOrigins: string[] = [];

/**
 * The owner's development machine on the LAN, so the CMS can be signed in to
 * from another device on the same network. Trusted only in development, under
 * the gate in `buildAuthTrustedOrigins`; never in production.
 */
export const cmsDevTrustedOrigins: readonly string[] = [
  "http://192.168.31.105:3000",
  "https://192.168.31.105:3000",
];
