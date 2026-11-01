import { isProductionEnvironment } from "./storefront-domain-provider";

/**
 * Decides whether the local Theme Worker transport may be used at all.
 *
 * `MORPH_LOCAL_THEME_ORIGIN` points at an operator-started Theme Worker. It is
 * a development convenience on both sides of a release: the deployer skips the
 * upload, and the storefront runtime forwards requests to that origin. Both
 * sides read this one predicate so they cannot disagree — a deployment that is
 * refused must never leave a runtime that still forwards to the local origin.
 *
 * It holds only when the origin is set, no real Cloudflare credentials are
 * present, and the environment is not production.
 */
export function localThemeTransportAllowed(
  bindings: Record<string, unknown> | undefined,
): boolean {
  if (!bindings) return false;
  const origin = bindings.MORPH_LOCAL_THEME_ORIGIN;
  if (typeof origin !== "string" || origin.trim() === "") return false;
  if (hasCredential(bindings.CLOUDFLARE_API_TOKEN)) return false;
  if (hasCredential(bindings.CLOUDFLARE_ACCOUNT_ID)) return false;
  return !isProductionEnvironment(bindings);
}

/**
 * Same reading the deployer factory has always used: a non-empty string.
 * A non-string binding (for example a Secrets Store object) counts as absent,
 * because the factory only reads string credentials when it builds a deployer.
 */
function hasCredential(value: unknown): boolean {
  return typeof value === "string" && value !== "";
}
