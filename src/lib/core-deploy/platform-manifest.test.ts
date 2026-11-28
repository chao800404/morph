// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isPreviewHostname,
  isReservedPlatformHostname,
  readPlatformBindingHostnames,
} from "../storefront/service/platform-hostnames";
import { platformManifest } from "./platform-manifest";
import { ZONE } from "./test-support/mock-cloudflare-api";

describe("the platform manifest, from the vars the runtime reads", () => {
  it("binds every configured platform hostname once, and the preview namespace as a wildcard Route", () => {
    const vars = {
      PUBLIC_URL: "https://admin.example.com",
      MORPH_CMS_HOSTNAME: "https://admin.example.com",
      MORPH_PLATFORM_HOSTNAMES: "Admin-Stg.example.com., ops.example.com",
      THEME_PREVIEW_HOSTNAME: "preview.example.com",
      CLOUDFLARE_ZONE_ID: ZONE,
    };
    const manifest = platformManifest(vars);
    expect(manifest).toEqual({
      ok: true,
      value: {
        zoneId: ZONE,
        customDomains: ["admin.example.com", "admin-stg.example.com", "ops.example.com"],
        routes: [{ pattern: "*.preview.example.com/*" }],
        previewNamespace: "preview.example.com",
      },
    });
    // What it binds is what the runtime reserves from the same vars.
    for (const hostname of manifest.ok ? manifest.value.customDomains : []) {
      expect(isReservedPlatformHostname(hostname, vars)).toBe(true);
    }
    expect(isPreviewHostname("abc.preview.example.com", vars)).toBe(true);
  });

  it("binds no Route for a loopback or .localhost preview hostname", () => {
    for (const preview of ["preview.localhost", "127.0.0.1"]) {
      const manifest = platformManifest({
        PUBLIC_URL: "https://admin.example.com",
        THEME_PREVIEW_HOSTNAME: preview,
        CLOUDFLARE_ZONE_ID: ZONE,
      });
      expect(manifest.ok && manifest.value.routes).toEqual([]);
    }
  });

  it.each([
    ["a workers.dev PUBLIC_URL", { PUBLIC_URL: "https://morph.yuho0298.workers.dev" }, /workers\.dev/],
    ["an http PUBLIC_URL", { PUBLIC_URL: "http://admin.example.com" }, /https/],
    ["a localhost PUBLIC_URL", { PUBLIC_URL: "https://localhost:3000" }, /public hostname/],
    ["a malformed MORPH_PLATFORM_HOSTNAMES entry", { MORPH_PLATFORM_HOSTNAMES: "ok.example.com,bad_host" }, /bad_host/],
    ["no zone", { CLOUDFLARE_ZONE_ID: undefined }, /CLOUDFLARE_ZONE_ID/],
    ["a preview hostname that is also a platform hostname", { THEME_PREVIEW_HOSTNAME: "admin.example.com" }, /inside the preview namespace/],
    ["a platform hostname under the preview namespace", { THEME_PREVIEW_HOSTNAME: "example.com" }, /admin.example.com is a platform hostname inside the preview namespace/],
  ])("refuses %s, which the runtime would silently ignore", (_label, overrides, message) => {
    const manifest = platformManifest({
      PUBLIC_URL: "https://admin.example.com",
      CLOUDFLARE_ZONE_ID: ZONE,
      ...overrides,
    });
    expect(manifest.ok).toBe(false);
    if (!manifest.ok) expect(manifest.problems.join("\n")).toMatch(message);
  });

  it("reports malformed values rather than dropping them", () => {
    expect(readPlatformBindingHostnames({ PUBLIC_URL: "not a url" }).problems).toEqual([
      "PUBLIC_URL is not a URL: not a url",
    ]);
  });
});

describe("storefront admission of the preview namespace", () => {
  const env = { PUBLIC_URL: "https://admin.example.com", THEME_PREVIEW_HOSTNAME: "preview.example.com" };

  it("refuses the preview hostname and every host under it as a storefront domain", () => {
    expect(isReservedPlatformHostname("preview.example.com", env)).toBe(true);
    expect(isReservedPlatformHostname("t1.preview.example.com", env)).toBe(true);
    expect(isReservedPlatformHostname("x.preview.localhost", env)).toBe(true);
  });

  it("still admits an ordinary storefront hostname", () => {
    expect(isReservedPlatformHostname("shop.example.com", env)).toBe(false);
    expect(isReservedPlatformHostname("evil-preview.example.com", env)).toBe(false);
  });
});
