import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_DOMAIN_PROVISIONING_FLAG,
  LocalStorefrontDomainProvider,
  isProductionEnvironment,
  selectStorefrontDomainProvider,
  type StorefrontDomainProvider,
} from "./storefront-domain-provider";

const cloudflareProvider: StorefrontDomainProvider = {
  kind: "cloudflare",
  attach: vi.fn(async () => "cf_domain_1"),
  detach: vi.fn(async () => {}),
};

const CONFIGURED = {
  CLOUDFLARE_API_TOKEN: "token",
  CLOUDFLARE_ACCOUNT_ID: "account",
  CLOUDFLARE_ZONE_ID: "zone",
  CLOUDFLARE_WORKER_SERVICE: "morph",
};

const originalNodeEnv = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe("LocalStorefrontDomainProvider", () => {
  it("returns a clearly synthetic id that cannot pass as a Cloudflare domain", async () => {
    const id = await new LocalStorefrontDomainProvider().attach("shop.localtest.me");
    expect(id).toBe("local-dev:shop.localtest.me");
    expect(id).toContain("local-dev:");
  });

  it("detach is a no-op because nothing was provisioned remotely", async () => {
    await expect(
      new LocalStorefrontDomainProvider().detach(),
    ).resolves.toBeUndefined();
  });
});

describe("selectStorefrontDomainProvider", () => {
  it("uses Cloudflare whenever its credentials are configured", () => {
    const result = selectStorefrontDomainProvider({
      env: CONFIGURED,
      cloudflareProvider,
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.provider.kind).toBe("cloudflare");
  });

  it("never falls back to local when Cloudflare is configured, even with the flag set", () => {
    const result = selectStorefrontDomainProvider({
      env: { ...CONFIGURED, [LOCAL_DOMAIN_PROVISIONING_FLAG]: "true" },
      cloudflareProvider,
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.provider.kind).toBe("cloudflare");
  });

  it("fails closed when nothing is configured and the flag is absent", () => {
    const result = selectStorefrontDomainProvider({
      env: {},
      cloudflareProvider,
    });
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toContain(LOCAL_DOMAIN_PROVISIONING_FLAG);
  });

  it("enables the local provider only on an explicit opt-in", () => {
    process.env.NODE_ENV = "development";
    const result = selectStorefrontDomainProvider({
      env: { [LOCAL_DOMAIN_PROVISIONING_FLAG]: "true" },
      cloudflareProvider,
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.provider.kind).toBe("local");
  });

  it("treats any value other than the exact opt-in string as disabled", () => {
    process.env.NODE_ENV = "development";
    for (const value of ["1", "yes", "TRUE", true, undefined]) {
      const result = selectStorefrontDomainProvider({
        env: { [LOCAL_DOMAIN_PROVISIONING_FLAG]: value as never },
        cloudflareProvider,
      });
      expect(result.available, `value ${String(value)} must not enable local`).toBe(
        false,
      );
    }
  });

  it("refuses local provisioning in production even when opted in", () => {
    process.env.NODE_ENV = "development";
    for (const productionEnv of [
      { CF_PAGES: "1" },
      { ENVIRONMENT: "production" },
    ]) {
      const result = selectStorefrontDomainProvider({
        env: { ...productionEnv, [LOCAL_DOMAIN_PROVISIONING_FLAG]: "true" },
        cloudflareProvider,
      });
      expect(result.available).toBe(false);
      if (result.available) return;
      expect(result.reason).toContain("cannot be used in production");
    }
  });

  it("refuses local provisioning when NODE_ENV is production", () => {
    process.env.NODE_ENV = "production";
    const result = selectStorefrontDomainProvider({
      env: { [LOCAL_DOMAIN_PROVISIONING_FLAG]: "true" },
      cloudflareProvider,
    });
    expect(result.available).toBe(false);
  });

  it("requires the complete Cloudflare credential set, not a partial one", () => {
    process.env.NODE_ENV = "development";
    for (const missing of Object.keys(CONFIGURED)) {
      const partial: Record<string, unknown> = { ...CONFIGURED };
      delete partial[missing];
      const result = selectStorefrontDomainProvider({
        env: partial,
        cloudflareProvider,
      });
      expect(result.available, `missing ${missing} must not select Cloudflare`).toBe(
        false,
      );
    }
  });
});

describe("isProductionEnvironment", () => {
  it("detects the platform signals used elsewhere in the app", () => {
    process.env.NODE_ENV = "development";
    expect(isProductionEnvironment({ CF_PAGES: "1" })).toBe(true);
    expect(isProductionEnvironment({ ENVIRONMENT: "production" })).toBe(true);
    expect(isProductionEnvironment({})).toBe(false);
    process.env.NODE_ENV = "production";
    expect(isProductionEnvironment({})).toBe(true);
  });
});
