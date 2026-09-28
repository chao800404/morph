/** Bind auth to the hostname already resolved by the storefront router. */
export function resolveStorefrontTrustedOrigin(
  requestUrl: string,
  resolvedHostname: string,
  requireHttps: boolean,
): string | null {
  try {
    const url = new URL(requestUrl);
    const expected = resolvedHostname.trim().toLowerCase().replace(/\.$/, "");
    const actual = url.hostname.trim().toLowerCase().replace(/\.$/, "");
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      (requireHttps && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      !expected ||
      actual !== expected
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}
