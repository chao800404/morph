import { describe, expect, it } from "vitest";
import {
  createStorefrontDomainInputSchema,
  normalizeHostname,
} from "./storefront-domain";

describe("storefront domain validation", () => {
  it("normalizes hostnames before persistence", () => {
    expect(normalizeHostname(" Shop.Example.COM. ")).toBe("shop.example.com");
    expect(
      createStorefrontDomainInputSchema.parse({
        hostname: " Shop.Example.COM. ",
      }),
    ).toEqual({ hostname: "shop.example.com" });
  });

  it.each([
    "https://example.com",
    "example.com/path",
    "localhost",
    "example.com:443",
    "-shop.example.com",
  ])("rejects %s", (hostname) => {
    expect(
      createStorefrontDomainInputSchema.safeParse({ hostname }).success,
    ).toBe(false);
  });
});
