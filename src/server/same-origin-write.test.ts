// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  hasRequestBody,
  isJsonContentType,
  isSameOriginWrite,
  originOf,
  refuseCrossOriginWrite,
} from "./same-origin-write";

const ADMIN = "https://admin-stg.showtrue.com.tw";
const STOREFRONT = "https://stg.showtrue.com.tw";

const post = (headers: Record<string, string>, url = `${ADMIN}/api/x`) =>
  new Request(url, { method: "POST", headers });

describe("isSameOriginWrite (Start's CSRF rule, on a configured origin)", () => {
  it.each<[string, Record<string, string>, boolean]>([
    ["Sec-Fetch-Site same-origin", { "sec-fetch-site": "same-origin" }, true],
    [
      "same-site from the storefront",
      { "sec-fetch-site": "same-site", origin: STOREFRONT },
      false,
    ],
    // Sec-Fetch-Site decides when present, as in Start: a same-site request
    // is not rescued by an Origin header.
    [
      "same-site with the admin Origin",
      { "sec-fetch-site": "same-site", origin: ADMIN },
      false,
    ],
    ["cross-site", { "sec-fetch-site": "cross-site", origin: STOREFRONT }, false],
    ["none (typed address)", { "sec-fetch-site": "none" }, false],
    ["Origin exactly the admin origin", { origin: ADMIN }, true],
    ["Origin of the storefront", { origin: STOREFRONT }, false],
    ["a suffix of the admin origin", { origin: `${ADMIN}.evil.com` }, false],
    ["a prefix of it", { origin: "https://admin-stg.showtrue.com" }, false],
    ["another scheme", { origin: "http://admin-stg.showtrue.com.tw" }, false],
    ["Origin null", { origin: "null" }, false],
    ["neither header", {}, false],
    // No Referer fallback: a request with only a Referer is refused.
    ["only a same-origin Referer", { referer: `${ADMIN}/dashboard` }, false],
  ])("%s", async (_case, headers, allowed) => {
    expect(await isSameOriginWrite(post(headers), ADMIN)).toBe(allowed);
  });

  it("with no configured origin, accepts only Sec-Fetch-Site same-origin", async () => {
    expect(await isSameOriginWrite(post({ origin: ADMIN }), null)).toBe(false);
    expect(
      await isSameOriginWrite(post({ "sec-fetch-site": "same-origin" }), null),
    ).toBe(true);
  });

  it("left undefined, compares Origin with the request's own", async () => {
    expect(
      await isSameOriginWrite(post({ origin: STOREFRONT }, `${STOREFRONT}/x`)),
    ).toBe(true);
    expect(
      await isSameOriginWrite(post({ origin: ADMIN }, `${STOREFRONT}/x`)),
    ).toBe(false);
  });
});

describe("refuseCrossOriginWrite", () => {
  it("passes every safe method unchecked", async () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(
        await refuseCrossOriginWrite(
          new Request(`${ADMIN}/x`, { method }),
          ADMIN,
        ),
      ).toBeNull();
    }
  });

  it("answers a refused write with a 403 that says why", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await refuseCrossOriginWrite(
        new Request(`${ADMIN}/x`, { method, headers: { origin: STOREFRONT } }),
        ADMIN,
      );
      expect(response?.status, method).toBe(403);
      expect(await response!.json()).toMatchObject({
        error: "CROSS_ORIGIN_REQUEST",
      });
      expect(response!.headers.get("cache-control")).toBe("private, no-store");
    }
  });
});

describe("helpers", () => {
  it("originOf canonicalises a configured URL and fails closed", () => {
    expect(originOf(`${ADMIN}/`)).toBe(ADMIN);
    expect(originOf("HTTPS://Admin-Stg.Showtrue.com.tw:443/x")).toBe(ADMIN);
    expect(originOf("not a url")).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });

  it("isJsonContentType accepts application/json with parameters only", () => {
    expect(isJsonContentType("application/json")).toBe(true);
    expect(isJsonContentType("Application/JSON; charset=utf-8")).toBe(true);
    expect(isJsonContentType("text/plain;charset=UTF-8")).toBe(false);
    expect(isJsonContentType("application/x-www-form-urlencoded")).toBe(false);
    expect(isJsonContentType("application/jsonp")).toBe(false);
    expect(isJsonContentType(null)).toBe(false);
  });

  it("hasRequestBody sees an untyped body", () => {
    expect(hasRequestBody(new Request(`${ADMIN}/x`, { method: "POST" }))).toBe(
      false,
    );
    expect(
      hasRequestBody(
        new Request(`${ADMIN}/x`, { method: "POST", body: new Blob(["{}"]) }),
      ),
    ).toBe(true);
    expect(
      hasRequestBody(
        new Request(`${ADMIN}/x`, {
          method: "POST",
          headers: { "content-length": "0" },
        }),
      ),
    ).toBe(false);
  });
});
