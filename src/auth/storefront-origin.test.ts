import { describe, expect, it } from "vitest";
import { resolveStorefrontTrustedOrigin } from "./storefront-origin";

describe("resolveStorefrontTrustedOrigin", () => {
  it("returns the origin only when it matches the resolved store hostname", () => {
    expect(
      resolveStorefrontTrustedOrigin(
        "https://SHOP.example.com/api/auth/sign-in/email",
        "shop.example.com",
        true,
      ),
    ).toBe("https://shop.example.com");
  });

  it("rejects a caller-controlled host that differs from the resolved store", () => {
    expect(
      resolveStorefrontTrustedOrigin(
        "https://attacker.example/api/auth/sign-in/email",
        "shop.example.com",
        true,
      ),
    ).toBeNull();
  });

  it("requires HTTPS for production storefronts but allows HTTP in local development", () => {
    expect(
      resolveStorefrontTrustedOrigin(
        "http://shop.example.com/api/auth/sign-in/email",
        "shop.example.com",
        true,
      ),
    ).toBeNull();
    expect(
      resolveStorefrontTrustedOrigin(
        "http://shop.localhost:3000/api/auth/sign-in/email",
        "shop.localhost",
        false,
      ),
    ).toBe("http://shop.localhost:3000");
  });

  it.each([
    "javascript:alert(1)",
    "https://shop.example.com@attacker.example/",
    "not a url",
  ])("rejects malformed or credential-bearing URLs (%s)", (requestUrl) => {
    expect(
      resolveStorefrontTrustedOrigin(requestUrl, "shop.example.com", true),
    ).toBeNull();
  });
});
