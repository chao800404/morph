import {
  isPreviewHostname,
  isReservedPlatformHostname,
  readPlatformBindingHostnames,
} from "../storefront/service/platform-hostnames";
import { normalizeStorefrontHostname } from "../storefront/service/storefront-hostname";
import type { Parsed } from "./deploy-target";

/**
 * What Morph Core binds to its own Worker: the platform's Custom Domains and
 * the preview namespace's wildcard Route.
 *
 * Derived from the Worker vars — the same values the request path reads to
 * reserve these hostnames (`platform-hostnames.ts`) — so nothing is bound
 * that the runtime would treat as a storefront, and nothing is reserved that
 * no command binds. Storefront domains are not here: the storefront domain
 * provider binds those, and they are listed in D1.
 */
export type PlatformManifest = Readonly<{
  zoneId: string;
  customDomains: readonly string[];
  routes: readonly Readonly<{ pattern: string }>[];
  /**
   * The configured preview namespace as the runtime reads it, public or not:
   * a storefront domain inside it is not served as a storefront.
   */
  previewNamespace: string | null;
}>;

export function previewRoutePattern(previewHostname: string): string {
  return `*.${previewHostname}/*`;
}

export function platformManifest(
  vars: Record<string, unknown> | undefined,
): Parsed<PlatformManifest> {
  const read = readPlatformBindingHostnames(vars);
  const problems = [...read.problems];
  const zoneId = vars?.CLOUDFLARE_ZONE_ID;
  if (typeof zoneId !== "string" || !/^[0-9a-f]{32}$/.test(zoneId)) {
    problems.push(
      "vars.CLOUDFLARE_ZONE_ID must name the zone the platform hostnames are bound in (32-character id).",
    );
  }
  if (read.customDomainHostnames.length === 0 && read.problems.length === 0) {
    problems.push("No platform hostname is configured (PUBLIC_URL, MORPH_CMS_HOSTNAME).");
  }
  if (problems.length > 0) return { ok: false, problems };

  // The manifest is only safe if the runtime reserves what it binds. These
  // hold by construction; checked so that a later edit to either side fails
  // here instead of binding a hostname a merchant could also connect.
  for (const hostname of read.customDomainHostnames) {
    if (!isReservedPlatformHostname(hostname, vars)) {
      throw new Error(`platform hostname ${hostname} is not reserved by the runtime`);
    }
  }
  if (read.previewHostname && !isPreviewHostname(`a.${read.previewHostname}`, vars)) {
    throw new Error(`preview namespace ${read.previewHostname} is not reserved by the runtime`);
  }

  return {
    ok: true,
    value: {
      zoneId: zoneId as string,
      customDomains: read.customDomainHostnames,
      routes: read.previewHostname
        ? [{ pattern: previewRoutePattern(read.previewHostname) }]
        : [],
      previewNamespace:
        typeof vars?.THEME_PREVIEW_HOSTNAME === "string"
          ? normalizeStorefrontHostname(vars.THEME_PREVIEW_HOSTNAME)
          : null,
    },
  };
}

/**
 * A Route pattern as Cloudflare matches it: hostnames are case-insensitive,
 * and an `http://` or `https://` prefix only narrows the scheme, so it is
 * stripped before any host comparison.
 */
export function normalizeRoutePattern(pattern: string): string {
  return pattern.trim().toLowerCase().replace(/^https?:\/\//, "");
}

/** The host part of a Route pattern, without its leading wildcard (`*.preview.example.com/*` → `preview.example.com`). */
export function routePatternHostname(pattern: string): string {
  return normalizeRoutePattern(pattern).replace(/^\*\.?/, "").replace(/\/.*$/, "");
}

/** Whether the pattern's host part starts with a wildcard. */
export function isWildcardRoute(pattern: string): boolean {
  return normalizeRoutePattern(pattern).startsWith("*");
}

/**
 * Whether a Route pattern can match requests for `hostname`: an exact host,
 * `*.base` (every subdomain of base), or `*base` (base and every host ending
 * in it; `*` alone matches all).
 */
export function routeMatchesHostname(pattern: string, hostname: string): boolean {
  const host = normalizeRoutePattern(pattern).replace(/\/.*$/, "");
  const name = hostname.toLowerCase();
  if (!host.startsWith("*")) return host === name;
  const suffix = host.slice(1);
  return suffix === "" || name.endsWith(suffix);
}

export function isInZone(hostname: string, zoneName: string): boolean {
  return hostname === zoneName || hostname.endsWith(`.${zoneName}`);
}
