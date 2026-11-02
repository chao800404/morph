// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  signStorefrontRenderContext,
  STOREFRONT_RENDER_CONTEXT_TTL_MS,
  verifyStorefrontRenderContext,
  type StorefrontRenderPin,
} from "./storefront-render-context";

const SECRET = "render-context-test-secret";
const NOW = 1_800_000_000_000;
const PIN: StorefrontRenderPin = {
  storefrontId: "sf_1",
  hostname: "shop.example.com",
  releaseId: "rel_1",
  contentPublicationId: "pub_1",
};

function verify(
  token: string,
  overrides: Partial<{
    secret: string;
    now: number;
    storefrontId: string;
    hostname: string;
  }> = {},
) {
  return verifyStorefrontRenderContext({
    token,
    secret: SECRET,
    now: NOW,
    storefrontId: PIN.storefrontId,
    hostname: PIN.hostname,
    ...overrides,
  });
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("the render context that pins one page render to its release", () => {
  it("names the release and publication it was signed for", async () => {
    const token = await signStorefrontRenderContext({
      pin: PIN,
      secret: SECRET,
      now: NOW,
    });
    expect(await verify(token)).toEqual({ ok: true, pin: PIN });
  });

  it("carries a release without a publication as exactly that", async () => {
    const pin = { ...PIN, contentPublicationId: null };
    const token = await signStorefrontRenderContext({
      pin,
      secret: SECRET,
      now: NOW,
    });
    expect(await verify(token)).toEqual({ ok: true, pin });
  });

  it("holds for the render's lifetime and not after it", async () => {
    const token = await signStorefrontRenderContext({
      pin: PIN,
      secret: SECRET,
      now: NOW,
    });
    expect(
      (await verify(token, { now: NOW + STOREFRONT_RENDER_CONTEXT_TTL_MS - 1 }))
        .ok,
    ).toBe(true);
    expect(
      await verify(token, { now: NOW + STOREFRONT_RENDER_CONTEXT_TTL_MS }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses one that outlives what this code would issue now", async () => {
    // Signed for a later "now": its expiry is further out than a context
    // issued at NOW could be.
    const token = await signStorefrontRenderContext({
      pin: PIN,
      secret: SECRET,
      now: NOW + 1,
    });
    expect(await verify(token)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses one issued for another storefront or another host", async () => {
    const token = await signStorefrontRenderContext({
      pin: PIN,
      secret: SECRET,
      now: NOW,
    });
    expect(await verify(token, { storefrontId: "sf_2" })).toEqual({
      ok: false,
      reason: "other-storefront",
    });
    expect(await verify(token, { hostname: "other.example.com" })).toEqual({
      ok: false,
      reason: "other-storefront",
    });
  });

  it("refuses one signed with another secret", async () => {
    const token = await signStorefrontRenderContext({
      pin: PIN,
      secret: "another-secret",
      now: NOW,
    });
    expect(await verify(token)).toEqual({ ok: false, reason: "forged" });
  });

  it("refuses a payload changed after signing: a visitor cannot choose the release", async () => {
    const token = await signStorefrontRenderContext({
      pin: PIN,
      secret: SECRET,
      now: NOW,
    });
    const [version, , signature] = token.split(".");
    const chosen = base64UrlJson({
      v: 1,
      s: PIN.storefrontId,
      h: PIN.hostname,
      r: "rel_0",
      p: "pub_0",
      exp: NOW + 1000,
    });
    expect(await verify([version, chosen, signature].join("."))).toEqual({
      ok: false,
      reason: "forged",
    });
  });

  it.each([
    ["empty", ""],
    ["no parts", "v1"],
    ["another version", "v2.e30.e30"],
    ["too many parts", "v1.a.b.c"],
    ["not base64url", "v1.***.***"],
    ["oversized", "v1." + "a".repeat(3000) + ".a"],
  ])("refuses a malformed context (%s)", async (_name, token) => {
    expect(await verify(token)).toEqual({ ok: false, reason: "malformed" });
  });
});
