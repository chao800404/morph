import {
  isPreviewHostname,
  isReservedPlatformHostname,
  readPlatformBindingHostnames,
} from "../storefront/service/platform-hostnames";
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
    },
  };
}

/** The hostname part of a Route pattern (`*.preview.example.com/*` → `preview.example.com`). */
export function routePatternHostname(pattern: string): string {
  return pattern.replace(/^\*\.?/, "").replace(/\/.*$/, "");
}

export function isInZone(hostname: string, zoneName: string): boolean {
  return hostname === zoneName || hostname.endsWith(`.${zoneName}`);
}
