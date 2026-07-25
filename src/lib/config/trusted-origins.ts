/**
 * Public origins trusted by the CMS authentication layer.
 *
 * Keep this in a client-safe, dependency-free module. Authentication is also
 * imported by server-function middleware, so reading these values through the
 * full CMS config would create a cycle back through collections and queries.
 */
export const cmsTrustedOrigins = [
  "http://192.168.31.105:3000",
  "https://192.168.31.105:3000",
  "https://*.cmsapp.org",
];
