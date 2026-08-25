import { normalizeStorefrontHostname } from "./storefront-host-resolver";
import {
  DispatchNamespaceThemeRuntime,
  LocalDirectThemeRuntime,
  ServiceBindingThemeRuntime,
  UnavailableThemeRuntime,
  type DispatchNamespaceBinding,
  type ThemeServiceBinding,
} from "./theme-runtimes";
import type { ThemeRuntime } from "./theme-runtime.types";

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
  if (extra) {
    for (const entry of extra.split(",")) {
      const normalized = entry.trim().toLowerCase();
      if (normalized) hosts.add(normalized);
    }
  }

  return hosts;
}

export function isPlatformHostname(
  rawHostname: string | null,
  platformHostnames: ReadonlySet<string>,
): boolean {
  if (!rawHostname) return true;
  const withoutPort = rawHostname.trim().toLowerCase().split(":")[0] ?? "";
  if (!withoutPort) return true;
  if (platformHostnames.has(withoutPort)) return true;
  // Deploy previews and the default Workers domain are platform surface.
  if (withoutPort.endsWith(".workers.dev")) return true;
  return normalizeStorefrontHostname(withoutPort) === null;
}

function safeUrlHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Decides whether a request belongs to the storefront plane.
 *
 * The decision is made purely on hostname: a storefront hostname routes to the
 * storefront for **every** path, so Morph Core's dashboard, editor and server
 * function routes are unreachable from a merchant domain. Path-based carve-outs
 * are deliberately absent — one would expose platform surface on the public
 * site the moment a route moved.
 */
export function shouldRouteToStorefront(
  request: Request,
  env: Record<string, unknown> | undefined,
): boolean {
  const platformHostnames = collectPlatformHostnames(env);
  const host = request.headers.get("host") ?? safeUrlHostname(request.url);
  return !isPlatformHostname(host, platformHostnames);
}

/**
 * Hostnames that must never be connected as a storefront domain.
 *
 * Routing classifies platform hosts first, so a storefront registered on a
 * platform hostname would be silently unreachable while the dashboard reports
 * it as connected. Refusing at creation keeps that contradiction impossible.
 */
export function isReservedPlatformHostname(
  hostname: string,
  env: Record<string, unknown> | undefined,
): boolean {
  return isPlatformHostname(hostname, collectPlatformHostnames(env));
}

export const DEFAULT_THEME_SERVICE_BINDING = "THEME_WORKER";

/**
 * Maps a storefront to the service binding that reaches its Theme Worker.
 *
 * A single-storefront deployment needs no configuration and uses
 * `THEME_WORKER`. A deployment carrying several storefronts declares one
 * binding per storefront and maps them with `MORPH_THEME_SERVICE_BINDINGS`,
 * a JSON object of `{ storefrontId: bindingName }`. An unmapped storefront is
 * refused rather than falling back to another storefront's Theme Worker.
 */
export function resolveThemeServiceBindingName(
  env: Record<string, unknown> | undefined,
  storefrontId: string,
): string | null {
  const raw = env?.MORPH_THEME_SERVICE_BINDINGS;
  if (typeof raw !== "string" || raw.trim() === "") {
    return DEFAULT_THEME_SERVICE_BINDING;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A malformed map must not silently widen into the default binding.
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const mapped = (parsed as Record<string, unknown>)[storefrontId];
  return typeof mapped === "string" && mapped.trim() !== "" ? mapped : null;
}

/**
 * Selects the Theme Worker transport for the current environment.
 *
 * A service binding is the production transport for a single-tenant Morph
 * deployment: the Theme Worker lives in the same Cloudflare account. The
 * dispatch namespace is reserved for a future multi-tenant topology, and a
 * local origin is accepted solely for development. When nothing is configured
 * the runtime fails closed rather than degrading into a substitute renderer.
 */
export function createThemeRuntime(
  env: Record<string, unknown> | undefined,
): ThemeRuntime {
  const environment = env;

  const readServiceBinding = (name: string): ThemeServiceBinding | null => {
    const candidate = environment?.[name];
    return candidate &&
      typeof candidate === "object" &&
      typeof (candidate as ThemeServiceBinding).fetch === "function"
      ? (candidate as ThemeServiceBinding)
      : null;
  };

  // Only the declared theme binding names count. Scanning every env value for a
  // `fetch` method would misclassify unrelated bindings as the Theme Worker and
  // then fail closed instead of falling through to the development transport.
  const hasServiceBinding =
    readServiceBinding(DEFAULT_THEME_SERVICE_BINDING) !== null ||
    (typeof environment?.MORPH_THEME_SERVICE_BINDINGS === "string" &&
      environment.MORPH_THEME_SERVICE_BINDINGS.trim() !== "");

  if (hasServiceBinding) {
    return new ServiceBindingThemeRuntime((resolved) => {
      const bindingName = resolveThemeServiceBindingName(
        environment,
        resolved.storefrontId,
      );
      return bindingName ? readServiceBinding(bindingName) : null;
    });
  }

  const dispatcher = environment?.THEME_DISPATCHER as
    | DispatchNamespaceBinding
    | undefined;
  if (dispatcher && typeof dispatcher.get === "function") {
    return new DispatchNamespaceThemeRuntime(dispatcher);
  }

  const localOrigin =
    typeof environment?.MORPH_LOCAL_THEME_ORIGIN === "string"
      ? environment.MORPH_LOCAL_THEME_ORIGIN
      : null;
  if (localOrigin) {
    return new LocalDirectThemeRuntime(localOrigin);
  }

  return new UnavailableThemeRuntime(
    "Storefront runtime is not configured: bind THEME_WORKER to the deployed Theme Worker, or set MORPH_LOCAL_THEME_ORIGIN for local development.",
  );
}
