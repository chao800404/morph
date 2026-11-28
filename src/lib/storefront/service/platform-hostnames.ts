import { normalizeStorefrontHostname } from "./storefront-hostname";

/**
 * Morph Core's own hostnames, read from the Worker vars.
 *
 * One reading for two consumers: the request path (routing, storefront
 * admission) and the Core deploy tooling that binds these hostnames to the
 * Worker (`src/lib/core-deploy/platform-manifest.ts`). This module has no
 * runtime dependencies so that both can import it; a second copy of these
 * rules in the deploy tooling could bind a hostname the runtime does not
 * reserve, or reserve one nothing binds.
 */

/** The Worker vars `collectPlatformHostnames` reads, and no others. */
const PLATFORM_HOSTNAME_ENV_KEYS = [
  "PUBLIC_URL",
  "MORPH_PLATFORM_HOSTNAMES",
  "MORPH_CMS_HOSTNAME",
] as const;

export type PlatformHostnameEnv = Readonly<
  Partial<Record<(typeof PLATFORM_HOSTNAME_ENV_KEYS)[number], string>>
>;

/**
 * The part of a Worker env that names Morph's own hostnames, copied out by
 * key. Anything that must decide platform hostnames somewhere the env should
 * not go — another process, a container — is handed this instead, so secrets
 * and bindings never travel with it.
 */
export function pickPlatformHostnameEnv(
  env: Record<string, unknown> | undefined,
): PlatformHostnameEnv {
  const picked: Partial<Record<keyof PlatformHostnameEnv, string>> = {};
  for (const key of PLATFORM_HOSTNAME_ENV_KEYS) {
    const value = env?.[key];
    if (typeof value === "string") picked[key] = value;
  }
  return picked;
}

/**
 * Hostnames that always belong to Morph Core (dashboard, editor, server
 * functions) and must never be resolved as a customer storefront.
 *
 * Membership is decided by exact hostname, not by suffix matching: a suffix
 * rule would let a merchant attach `evil-morph.example.com` and have it treated
 * as platform surface.
 */
export function collectPlatformHostnames(
  env: Record<string, unknown> | undefined,
): ReadonlySet<string> {
  const hosts = new Set<string>(["localhost", "127.0.0.1", "0.0.0.0"]);

  const publicUrl = typeof env?.PUBLIC_URL === "string" ? env.PUBLIC_URL : null;
  if (publicUrl) {
    try {
      hosts.add(new URL(publicUrl).hostname.toLowerCase());
    } catch {
      // A malformed PUBLIC_URL must not widen storefront routing.
    }
  }

  const extra =
    typeof env?.MORPH_PLATFORM_HOSTNAMES === "string"
      ? env.MORPH_PLATFORM_HOSTNAMES
      : null;
  addConfiguredPlatformHostnames(hosts, extra);

  // A single CMS hostname is convenient for the common split-domain setup;
  // keep the plural variable above for deployments with staging/admin hosts.
  addConfiguredPlatformHostnames(hosts, env?.MORPH_CMS_HOSTNAME);

  return hosts;
}

export function isPlatformHostname(
  rawHostname: string | null,
  platformHostnames: ReadonlySet<string>,
): boolean {
  if (!rawHostname) return true;

  // Use the same canonicalizer for configured values and request headers. In
  // particular, this handles a trailing dot and an explicit port consistently
  // so `shop.example.com.` cannot bypass the platform-host check.
  const normalized = normalizeStorefrontHostname(rawHostname);
  if (!normalized) {
    // Local development and malformed hosts are platform traffic. The latter
    // must never be guessed into a storefront request.
    return true;
  }

  if (platformHostnames.has(normalized)) return true;
  // Deploy previews and the default Workers domain are platform surface.
  if (normalized.endsWith(".workers.dev")) return true;
  return false;
}

/**
 * Accept a platform hostname in either the form operators usually use in
 * environment variables (`admin.example.com`) or a full origin
 * (`https://admin.example.com`). Invalid entries are ignored so a typo cannot
 * turn an arbitrary request host into platform traffic.
 */
function normalizeConfiguredPlatformHostname(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return normalizeStorefrontHostname(parsed.hostname);
    }
  } catch {
    // Treat the entry as a hostname below. Invalid values are rejected there.
  }

  return normalizeStorefrontHostname(value);
}

function addConfiguredPlatformHostnames(
  hosts: Set<string>,
  raw: unknown,
): void {
  if (typeof raw !== "string") return;
  for (const entry of raw.split(",")) {
    const normalized = normalizeConfiguredPlatformHostname(entry);
    if (normalized) hosts.add(normalized);
  }
}

export function isPreviewHostname(
  rawHostname: string | null,
  env?: Record<string, unknown>,
): boolean {
  if (!rawHostname) return false;
  const normalized = normalizeStorefrontHostname(rawHostname);
  if (!normalized) return false;
  if (
    normalized === "preview.localhost" ||
    normalized.endsWith(".preview.localhost")
  ) {
    return true;
  }
  const configured =
    typeof env?.THEME_PREVIEW_HOSTNAME === "string"
      ? normalizeStorefrontHostname(env.THEME_PREVIEW_HOSTNAME)
      : null;
  if (
    configured &&
    (normalized === configured || normalized.endsWith("." + configured))
  ) {
    return true;
  }
  return false;
}

/**
 * Hostnames that must never be connected as a storefront domain.
 *
 * Routing classifies preview and platform hosts first, so a storefront
 * registered on either would be silently unreachable while the dashboard
 * reports it as connected. Refusing at creation keeps that contradiction
 * impossible — and keeps a merchant from claiming a hostname that the Core
 * deploy tooling binds to the Worker as platform surface (the preview
 * namespace's wildcard Route among them).
 */
export function isReservedPlatformHostname(
  hostname: string,
  env: Record<string, unknown> | undefined,
): boolean {
  return (
    isPlatformHostname(hostname, collectPlatformHostnames(env)) ||
    isPreviewHostname(hostname, env)
  );
}

/**
 * What the Core deploy tooling binds to the Worker, from the same vars the
 * request path reads above.
 *
 * - `customDomainHostnames`: every configured platform hostname — the
 *   `PUBLIC_URL` host, `MORPH_CMS_HOSTNAME` and each `MORPH_PLATFORM_HOSTNAMES`
 *   entry — in that order, without repeats. Each one is a hostname
 *   `collectPlatformHostnames` reserves.
 * - `previewHostname`: the configured preview namespace, when it is a public
 *   DNS name (not loopback, an IP address or `*.localhost`). Every host under
 *   it is one `isPreviewHostname` reserves.
 * - `problems`: configured values the request path silently ignores. Ignoring
 *   them is right at runtime (a typo must not widen routing) and wrong at
 *   deploy time, where the operator meant something by them.
 */
export type PlatformBindingHostnames = Readonly<{
  customDomainHostnames: readonly string[];
  previewHostname: string | null;
  problems: readonly string[];
}>;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function isPublicDnsName(hostname: string): boolean {
  return (
    !IPV4.test(hostname) &&
    hostname !== "localhost" &&
    !hostname.endsWith(".localhost")
  );
}

export function readPlatformBindingHostnames(
  env: Record<string, unknown> | undefined,
): PlatformBindingHostnames {
  const hostnames: string[] = [];
  const problems: string[] = [];
  const add = (hostname: string) => {
    if (!hostnames.includes(hostname)) hostnames.push(hostname);
  };

  const publicUrl = env?.PUBLIC_URL;
  if (typeof publicUrl !== "string" || publicUrl.trim() === "") {
    problems.push("PUBLIC_URL is not set.");
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(publicUrl);
    } catch {
      problems.push(`PUBLIC_URL is not a URL: ${publicUrl}`);
    }
    if (parsed) {
      const hostname = normalizeStorefrontHostname(parsed.hostname);
      if (parsed.protocol !== "https:") {
        problems.push(`PUBLIC_URL must be an https origin: ${publicUrl}`);
      } else if (!hostname || !isPublicDnsName(hostname)) {
        problems.push(`PUBLIC_URL does not name a public hostname: ${publicUrl}`);
      } else if (hostname.endsWith(".workers.dev")) {
        problems.push(
          `PUBLIC_URL is a workers.dev address (${hostname}); with workers_dev off it is unreachable. Name the CMS Custom Domain.`,
        );
      } else {
        add(hostname);
      }
    }
  }

  for (const key of ["MORPH_CMS_HOSTNAME", "MORPH_PLATFORM_HOSTNAMES"] as const) {
    const raw = env?.[key];
    if (raw === undefined) continue;
    if (typeof raw !== "string") {
      problems.push(`${key} is not a string.`);
      continue;
    }
    for (const entry of raw.split(",")) {
      if (entry.trim() === "") continue;
      const hostname = normalizeConfiguredPlatformHostname(entry);
      if (!hostname || !isPublicDnsName(hostname)) {
        problems.push(`${key} entry is not a public hostname: ${entry.trim()}`);
      } else if (hostname.endsWith(".workers.dev")) {
        problems.push(`${key} entry is a workers.dev address: ${hostname}`);
      } else {
        add(hostname);
      }
    }
  }

  let previewHostname: string | null = null;
  const rawPreview = env?.THEME_PREVIEW_HOSTNAME;
  if (typeof rawPreview === "string" && rawPreview.trim() !== "") {
    const normalized = normalizeStorefrontHostname(rawPreview);
    if (!normalized) {
      // `isPreviewHostname` also refuses it, so the runtime serves no preview
      // namespace from it; nothing to bind, but the operator should know.
      if (!IPV4.test(rawPreview.trim())) {
        problems.push(`THEME_PREVIEW_HOSTNAME is not a hostname: ${rawPreview}`);
      }
    } else if (isPublicDnsName(normalized)) {
      if (hostnames.includes(normalized)) {
        problems.push(
          `THEME_PREVIEW_HOSTNAME (${normalized}) is also a platform hostname; the preview must be a host of its own.`,
        );
      } else {
        previewHostname = normalized;
      }
    }
  }

  return { customDomainHostnames: hostnames, previewHostname, problems };
}
