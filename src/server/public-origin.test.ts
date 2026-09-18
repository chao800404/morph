import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DEV_ORIGIN,
  isProductionRuntime,
  originFromRequestUrl,
  resolvePublicOrigin,
} from "./public-origin";

/**
 * The rule that decides whether a request gets to name the app's origin.
 *
 * Most of these are about production refusing to listen. A request's URL is
 * built from its `Host` header, so honouring it there would let a caller put
 * their own hostname into password-reset links, into `trustedOrigins`, and into
 * every absolute URL handed to a browser. The development cases are the reason
 * the function exists at all: a fixed `PUBLIC_URL` is what pinned an end-to-end
 * run to port 3000.
 */

const CONFIGURED = "https://morph.example.com";
const FORGED = "https://attacker.example/anything";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("which runtime treats its origin as configuration", () => {
  it("recognises each way a production runtime announces itself", () => {
    expect(isProductionRuntime({ CF_PAGES: "1" })).toBe(true);
    expect(isProductionRuntime({ ENVIRONMENT: "production" })).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(isProductionRuntime({})).toBe(true);
  });

  it("does not mistake a development runtime for one", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isProductionRuntime({})).toBe(false);
    expect(isProductionRuntime({ CF_PAGES: "0", ENVIRONMENT: "staging" })).toBe(
      false,
    );
  });
});

describe("the origin a deployment hands to a browser", () => {
  it.each([
    ["CF_PAGES", { CF_PAGES: "1", PUBLIC_URL: CONFIGURED }],
    ["ENVIRONMENT", { ENVIRONMENT: "production", PUBLIC_URL: CONFIGURED }],
  ])("ignores the request in production, by %s", (_name, env) => {
    expect(
      resolvePublicOrigin({ env, configured: CONFIGURED, requestUrl: FORGED }),
    ).toBe(CONFIGURED);
  });

  it("ignores the request when NODE_ENV says production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      resolvePublicOrigin({
        env: { PUBLIC_URL: CONFIGURED },
        configured: CONFIGURED,
        requestUrl: FORGED,
      }),
    ).toBe(CONFIGURED);
  });

  it("follows the request outside production, which is what moves the port", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(
      resolvePublicOrigin({
        env: { PUBLIC_URL: DEFAULT_DEV_ORIGIN },
        configured: DEFAULT_DEV_ORIGIN,
        requestUrl: "http://localhost:3123/dashboard/settings?tab=store",
      }),
    ).toBe("http://localhost:3123");
  });

  it("falls back to the configured value when there is no request", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(
      resolvePublicOrigin({
        env: {},
        configured: DEFAULT_DEV_ORIGIN,
        requestUrl: null,
      }),
    ).toBe(DEFAULT_DEV_ORIGIN);
  });
});

describe("what counts as an origin worth repeating back", () => {
  it("accepts a plain http or https request", () => {
    expect(originFromRequestUrl("http://localhost:3123/a/b?c=d")).toBe(
      "http://localhost:3123",
    );
    expect(originFromRequestUrl("https://192.168.31.105:3000/")).toBe(
      "https://192.168.31.105:3000",
    );
  });

  it.each([
    ["nothing", null],
    ["an empty string", ""],
    ["a malformed URL", "not-a-url"],
    ["a non-http scheme", "file:///etc/passwd"],
    ["a javascript URL", "javascript:alert(1)"],
    ["embedded credentials", "http://user:pass@localhost:3123/"],
  ])("refuses %s", (_name, url) => {
    expect(originFromRequestUrl(url)).toBeNull();
  });

  it("does not let a refused URL become the origin in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(
      resolvePublicOrigin({
        env: {},
        configured: DEFAULT_DEV_ORIGIN,
        requestUrl: "http://user:pass@attacker.example/",
      }),
    ).toBe(DEFAULT_DEV_ORIGIN);
  });
});
