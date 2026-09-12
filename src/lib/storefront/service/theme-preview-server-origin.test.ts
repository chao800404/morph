// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  resolveThemePreviewServerHost,
  validateExposedPreviewUrl,
} from "./theme-preview-server-origin";

const ENV = {
  PUBLIC_URL: "https://admin.example.com",
  MORPH_PLATFORM_HOSTNAMES: "staging.example.com",
};

const resolve = (configuredPreviewHostname: string | undefined) =>
  resolveThemePreviewServerHost({ configuredPreviewHostname, env: ENV });

const validate = (url: string, hostname = "preview.example.com") =>
  validateExposedPreviewUrl({ url, hostname, env: ENV });

describe("resolving the host a preview server may run Theme code on", () => {
  it("accepts a host that is nobody else's", () => {
    expect(resolve("preview.example.com")).toEqual({
      enabled: true,
      hostname: "preview.example.com",
    });
  });

  it("fails closed when no host is configured", () => {
    for (const value of [undefined, "", "   "]) {
      expect(resolve(value)).toEqual({
        enabled: false,
        reason: "MISSING_PREVIEW_HOST",
      });
    }
  });

  it("refuses any platform host, not just the editor's", () => {
    // The dashboard, the API and a configured staging host share the editor's
    // cookie jar, so "not the editor" would still leave ways in.
    for (const host of ["admin.example.com", "staging.example.com"]) {
      expect(resolve(host)).toEqual({
        enabled: false,
        reason: "PLATFORM_PREVIEW_HOST",
      });
    }
  });

  it("refuses localhost, which is platform surface and not a routable host", () => {
    // Refused one step earlier, by the hostname rules. Which refusal it is
    // matters less than that it is one.
    expect(resolve("localhost").enabled).toBe(false);
  });

  it("sees through the ways one host can be written down", () => {
    for (const host of [
      "ADMIN.example.com",
      "admin.example.com.",
      "admin.example.com:443",
    ]) {
      expect(resolve(host)).toEqual({
        enabled: false,
        reason: "PLATFORM_PREVIEW_HOST",
      });
    }
  });

  it("refuses a host that is not a hostname", () => {
    for (const host of ["https://preview.example.com", "not a host", "a..b"]) {
      expect(resolve(host)).toEqual({
        enabled: false,
        reason: "INVALID_PREVIEW_HOST",
      });
    }
  });
});

describe("validating the URL a container hands back", () => {
  it("accepts a sandbox preview on the configured host", () => {
    const result = validate("https://5173-sbx1-abc123.preview.example.com/");
    expect(result).toEqual({
      ok: true,
      url: "https://5173-sbx1-abc123.preview.example.com/",
      origin: "https://5173-sbx1-abc123.preview.example.com",
    });
  });

  it("allows an underscore in a preview token, which a storefront host may not have", () => {
    // Cloudflare permits underscores in a custom preview token, so the label
    // is compared rather than run through the storefront host rules.
    expect(validate("https://5173-sbx1-my_token.preview.example.com/").ok).toBe(
      true,
    );
  });

  it("refuses the bare configured host, which is the Worker and not a sandbox", () => {
    expect(validate("https://preview.example.com/")).toEqual({
      ok: false,
      reason: "PREVIEW_URL_OFF_HOST",
    });
  });

  it("refuses a host that only looks like the configured one", () => {
    for (const url of [
      "https://evil-preview.example.com/",
      "https://preview.example.com.evil.test/",
      "https://sbx.preview.example.com.evil.test/",
    ]) {
      expect(validate(url)).toEqual({
        ok: false,
        reason: "PREVIEW_URL_OFF_HOST",
      });
    }
  });

  it("refuses a downgrade to http", () => {
    expect(validate("http://5173-sbx1-abc.preview.example.com/")).toEqual({
      ok: false,
      reason: "INSECURE_PREVIEW_URL",
    });
  });

  it("refuses credentials smuggled into the URL", () => {
    expect(
      validate("https://user:pass@5173-sbx1-abc.preview.example.com/"),
    ).toEqual({ ok: false, reason: "INVALID_PREVIEW_URL" });
  });

  it("refuses something that is not a URL at all", () => {
    for (const url of ["", "not-a-url", "javascript:alert(1)"]) {
      expect(validate(url).ok).toBe(false);
    }
  });

  it("still refuses a platform host that the configured host would otherwise admit", () => {
    expect(
      validateExposedPreviewUrl({
        url: "https://admin.example.com/",
        hostname: "example.com",
        env: ENV,
      }),
    ).toEqual({ ok: false, reason: "PLATFORM_PREVIEW_HOST" });
  });
});
