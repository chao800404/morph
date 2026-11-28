import {
  collectPlatformHostnames,
  isPlatformHostname,
  isPreviewHostname,
} from "./platform-hostnames";
import {
  DispatchNamespaceThemeRuntime,
  LocalDirectThemeRuntime,
  ServiceBindingThemeRuntime,
  UnavailableThemeRuntime,
  type DispatchNamespaceBinding,
  type ThemeServiceBinding,
} from "./theme-runtimes";
import type { ThemeRuntime } from "./theme-runtime.types";
import { releaseWorkerMatchEnabled } from "./theme-worker-build-match";

// The hostname rules live in a module with no runtime dependencies, so the
// Core deploy tooling reads the same ones (see platform-hostnames.ts). They
// are exported from here too, where every existing caller imports them.
export {
  collectPlatformHostnames,
  isPlatformHostname,
  isPreviewHostname,
  isReservedPlatformHostname,
  pickPlatformHostnameEnv,
  type PlatformHostnameEnv,
} from "./platform-hostnames";

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
  const host = request.headers.get("host") ?? safeUrlHostname(request.url);
  if (isPreviewHostname(host, env)) return false;
  const platformHostnames = collectPlatformHostnames(env);
  return !isPlatformHostname(host, platformHostnames);
}

/**
 * Whether Morph Core's own static files may answer this request.
 *
 * Only on a platform hostname. A storefront hostname is the merchant's site
 * and a preview hostname is a Theme's, so neither may be answered with the
 * platform's favicon, robots.txt or build assets — whatever those happen to
 * be. Decided by hostname, like the storefront routing above, never by a list
 * of file names: a file added to Morph's `public/` later must not reach a
 * storefront either.
 */
export function mayServePlatformAssets(
  request: Request,
  env: Record<string, unknown> | undefined,
): boolean {
  const host = request.headers.get("host") ?? safeUrlHostname(request.url);
  if (isPreviewHostname(host, env)) return false;
  return isPlatformHostname(host, collectPlatformHostnames(env));
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
  const target = resolveThemeServiceBindingTarget(env, storefrontId);
  return target.ok ? target.name : null;
}

/**
 * Same mapping as `resolveThemeServiceBindingName`, but says why a storefront
 * has no binding name, as a fixed code that never carries the map's contents.
 */
export function resolveThemeServiceBindingTarget(
  env: Record<string, unknown> | undefined,
  storefrontId: string,
):
  | { ok: true; name: string }
  | { ok: false; unmapped: "MAP_MALFORMED" | "ENTRY_MISSING" } {
  const raw = env?.MORPH_THEME_SERVICE_BINDINGS;
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: true, name: DEFAULT_THEME_SERVICE_BINDING };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A malformed map must not silently widen into the default binding.
    return { ok: false, unmapped: "MAP_MALFORMED" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, unmapped: "MAP_MALFORMED" };
  }

  const mapped = (parsed as Record<string, unknown>)[storefrontId];
  return typeof mapped === "string" && mapped.trim() !== ""
    ? { ok: true, name: mapped }
    : { ok: false, unmapped: "ENTRY_MISSING" };
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

  // A presence check only: an env entry that is unset (or a plain value) is
  // not a binding. It cannot tell one binding kind from another — a workerd
  // RPC stub claims every property — so outcomes travel on the resolver's
  // `ok` wrapper, never on a probe of the stub.
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
    return new ServiceBindingThemeRuntime(
      (resolved) => {
        const target = resolveThemeServiceBindingTarget(
          environment,
          resolved.storefrontId,
        );
        if (!target.ok) return target;
        const binding = readServiceBinding(target.name);
        return binding
          ? { ok: true, binding }
          : { ok: false, unmapped: "BINDING_ABSENT" };
      },
      // The same switch the deployer reads (theme-worker-deployer.factory.ts).
      { releaseWorkerMatch: releaseWorkerMatchEnabled(environment) },
    );
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
