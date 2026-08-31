import { describe, expect, it } from "vitest";
import {
  collectPlatformHostnames,
  createThemeRuntime,
  isPlatformHostname,
  isReservedPlatformHostname,
  resolveThemeServiceBindingName,
  shouldRouteToStorefront,
} from "./storefront-request-routing";

describe("collectPlatformHostnames", () => {
  it("always includes local development hosts", () => {
    const hosts = collectPlatformHostnames({});
    expect(hosts.has("localhost")).toBe(true);
    expect(hosts.has("127.0.0.1")).toBe(true);
  });

  it("includes the configured public origin", () => {
    const hosts = collectPlatformHostnames({
      PUBLIC_URL: "https://morph.yuho0298.workers.dev",
    });
    expect(hosts.has("morph.yuho0298.workers.dev")).toBe(true);
  });

  it("ignores a malformed PUBLIC_URL rather than widening storefront routing", () => {
    const hosts = collectPlatformHostnames({ PUBLIC_URL: "not a url" });
    expect(hosts.has("not a url")).toBe(false);
  });

  it("accepts extra platform hostnames from configuration", () => {
    const hosts = collectPlatformHostnames({
      MORPH_PLATFORM_HOSTNAMES: "admin.morph.app, staging.morph.app",
    });
    expect(hosts.has("admin.morph.app")).toBe(true);
    expect(hosts.has("staging.morph.app")).toBe(true);
  });

  it("accepts CMS origins and ignores malformed platform entries", () => {
    const hosts = collectPlatformHostnames({
      MORPH_PLATFORM_HOSTNAMES:
        "https://staging.morph.app:443,not a host,javascript://unsafe.morph.app",
      MORPH_CMS_HOSTNAME: "shop.morph.app:443",
    });
    expect(hosts.has("staging.morph.app")).toBe(true);
    expect(hosts.has("shop.morph.app")).toBe(true);
    expect(hosts.has("not a host")).toBe(false);
    expect(hosts.has("unsafe.morph.app")).toBe(false);
  });
});

describe("isPlatformHostname", () => {
  const platform = collectPlatformHostnames({
    PUBLIC_URL: "https://morph.example.com",
  });

  it("keeps platform surface on the Morph Core router", () => {
    expect(isPlatformHostname("morph.example.com", platform)).toBe(true);
    expect(isPlatformHostname("localhost:3000", platform)).toBe(true);
    expect(isPlatformHostname("morph.yuho0298.workers.dev", platform)).toBe(true);
  });

  it("routes merchant hostnames to the storefront plane", () => {
    expect(isPlatformHostname("shop.example.com", platform)).toBe(false);
    expect(isPlatformHostname("www.merchant.store", platform)).toBe(false);
  });

  it("does not treat a lookalike suffix as platform surface", () => {
    expect(isPlatformHostname("evil-morph.example.com", platform)).toBe(false);
    expect(isPlatformHostname("morph.example.com.evil.net", platform)).toBe(
      false,
    );
  });

  it("normalizes ports and trailing dots before checking the platform set", () => {
    expect(isPlatformHostname("morph.example.com:443", platform)).toBe(true);
    expect(isPlatformHostname("morph.example.com.", platform)).toBe(true);
    expect(isPlatformHostname("morph.yuho0298.workers.dev.", platform)).toBe(
      true,
    );
  });

  it("treats unusable hosts as platform surface rather than guessing a storefront", () => {
    expect(isPlatformHostname(null, platform)).toBe(true);
    expect(isPlatformHostname("", platform)).toBe(true);
    expect(isPlatformHostname("not a host", platform)).toBe(true);
  });
});

describe("createThemeRuntime", () => {
  const binding = { fetch: async () => new Response("ok") };

  it("prefers the service binding for a single-tenant deployment", () => {
    expect(createThemeRuntime({ THEME_WORKER: binding }).kind).toBe(
      "service-binding",
    );
  });

  it("uses the service binding transport when a storefront map is configured", () => {
    const runtime = createThemeRuntime({
      MORPH_THEME_SERVICE_BINDINGS: '{"sf_1":"THEME_WORKER_A"}',
      THEME_WORKER_A: binding,
    });
    expect(runtime.kind).toBe("service-binding");
  });

  it("does not mistake an unrelated fetcher binding for the Theme Worker", () => {
    const runtime = createThemeRuntime({
      ASSETS: binding,
      MORPH_LOCAL_THEME_ORIGIN: "http://127.0.0.1:8788",
    });
    expect(runtime.kind).toBe("local-direct");
  });

  it("keeps the dispatch namespace available for a future multi-tenant topology", () => {
    const runtime = createThemeRuntime({ THEME_DISPATCHER: { get: () => ({}) } });
    expect(runtime.kind).toBe("dispatch-namespace");
  });

  it("falls back to a local origin only when explicitly configured", () => {
    const runtime = createThemeRuntime({
      MORPH_LOCAL_THEME_ORIGIN: "http://127.0.0.1:8788",
    });
    expect(runtime.kind).toBe("local-direct");
  });

  it("fails closed when no transport is configured", () => {
    expect(createThemeRuntime({}).kind).toBe("unavailable");
    expect(createThemeRuntime(undefined).kind).toBe("unavailable");
  });
});

describe("resolveThemeServiceBindingName", () => {
  it("defaults to the single-storefront binding when no map is configured", () => {
    expect(resolveThemeServiceBindingName({}, "sf_1")).toBe("THEME_WORKER");
  });

  it("maps each storefront to its own Theme Worker binding", () => {
    const env = {
      MORPH_THEME_SERVICE_BINDINGS: '{"sf_1":"THEME_WORKER_A","sf_2":"THEME_WORKER_B"}',
    };
    expect(resolveThemeServiceBindingName(env, "sf_1")).toBe("THEME_WORKER_A");
    expect(resolveThemeServiceBindingName(env, "sf_2")).toBe("THEME_WORKER_B");
  });

  it("refuses an unmapped storefront instead of serving another storefront's Theme", () => {
    const env = { MORPH_THEME_SERVICE_BINDINGS: '{"sf_1":"THEME_WORKER_A"}' };
    expect(resolveThemeServiceBindingName(env, "sf_UNKNOWN")).toBeNull();
  });

  it("refuses a malformed map rather than widening to the default binding", () => {
    expect(
      resolveThemeServiceBindingName({ MORPH_THEME_SERVICE_BINDINGS: "{oops" }, "sf_1"),
    ).toBeNull();
    expect(
      resolveThemeServiceBindingName({ MORPH_THEME_SERVICE_BINDINGS: "[]" }, "sf_1"),
    ).toBeNull();
  });
});

describe("shouldRouteToStorefront", () => {
  // CMS on a subdomain, storefront on the apex domain.
  const env = { PUBLIC_URL: "https://admin.client.com" };
  const req = (url: string, host?: string) =>
    new Request(url, host ? { headers: { host } } : undefined);

  it("keeps every dashboard path on the platform hostname", () => {
    for (const path of ["/", "/dashboard", "/dashboard/products", "/api/auth/session"]) {
      expect(
        shouldRouteToStorefront(req(`https://admin.client.com${path}`), env),
      ).toBe(false);
    }
  });

  it("routes every path on a merchant hostname to the storefront", () => {
    for (const path of ["/", "/about", "/products/mug"]) {
      expect(shouldRouteToStorefront(req(`https://client.com${path}`), env)).toBe(
        true,
      );
    }
  });

  it("does not leak dashboard, editor or server-function routes on a storefront hostname", () => {
    // These paths exist on Morph Core. On a merchant domain they must still be
    // handed to the storefront plane, never to the Start router.
    for (const path of [
      "/dashboard",
      "/dashboard/settings",
      "/store/sf_1/themes/th_1/editor",
      "/api/auth/sign-in",
      "/_serverFn/whatever",
      "/preview-build/bld_1/token/index.html",
    ]) {
      expect(
        shouldRouteToStorefront(req(`https://client.com${path}`), env),
        `path ${path} must not reach Morph Core on a storefront hostname`,
      ).toBe(true);
    }
  });

  it("prefers the Host header over the request URL", () => {
    expect(
      shouldRouteToStorefront(req("https://client.com/", "admin.client.com"), env),
    ).toBe(false);
    expect(
      shouldRouteToStorefront(req("https://admin.client.com/", "client.com"), env),
    ).toBe(true);
  });

  it("treats an unusable host as platform surface rather than guessing", () => {
    expect(shouldRouteToStorefront(req("https://client.com/", "not a host"), env)).toBe(
      false,
    );
  });
});

describe("isReservedPlatformHostname", () => {
  const env = { PUBLIC_URL: "https://admin.client.com" };

  it("reserves the dashboard hostname and the default Workers domain", () => {
    expect(isReservedPlatformHostname("admin.client.com", env)).toBe(true);
    expect(isReservedPlatformHostname("morph.yuho0298.workers.dev", env)).toBe(true);
    expect(isReservedPlatformHostname("localhost", env)).toBe(true);
  });

  it("allows a merchant hostname on the same registrable domain", () => {
    expect(isReservedPlatformHostname("client.com", env)).toBe(false);
    expect(isReservedPlatformHostname("www.client.com", env)).toBe(false);
    expect(isReservedPlatformHostname("shop.client.com", env)).toBe(false);
  });
});
