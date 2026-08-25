import { describe, expect, it } from "vitest";
import {
  collectPlatformHostnames,
  createThemeRuntime,
  isPlatformHostname,
  resolveThemeServiceBindingName,
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
