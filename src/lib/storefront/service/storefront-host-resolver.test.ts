import { describe, expect, it } from "vitest";
import {
  normalizeStorefrontHostname,
  resolveStorefrontHost,
  type StorefrontHostResolverDeps,
} from "./storefront-host-resolver";

const HOST = "shop.example.com";

function deps(overrides: {
  domain?: any;
  storefront?: any;
  release?: any;
  build?: any;
} = {}): StorefrontHostResolverDeps {
  const domain =
    overrides.domain === undefined
      ? {
          id: "dom_1",
          storefrontId: "sf_1",
          hostname: HOST,
          status: "active",
        }
      : overrides.domain;

  const storefront =
    overrides.storefront === undefined
      ? { id: "sf_1", status: "published", activeReleaseId: "rel_1" }
      : overrides.storefront;

  const release =
    overrides.release === undefined
      ? {
          id: "rel_1",
          storefrontId: "sf_1",
          themeId: "th_1",
          sourceRevisionId: "rev_1",
          themeBuildId: "bld_1",
          contentPublicationId: "pub_1",
        }
      : overrides.release;

  const build =
    overrides.build === undefined
      ? {
          id: "bld_1",
          storefrontId: "sf_1",
          themeId: "th_1",
          status: "succeeded",
          artifactPrefix: "themes/th_1/builds/bld_1",
          manifestJson: { files: [], artifactEntry: "runtime/client/index.html" },
        }
      : overrides.build;

  return {
    domainDal: { findByHostname: async () => domain },
    storefrontDalRef: { findActive: async () => storefront },
    releaseDal: { getActive: async () => release },
    buildDal: { getBuildById: async () => build },
  };
}

describe("normalizeStorefrontHostname", () => {
  it("normalizes case, trailing dot and explicit port", () => {
    expect(normalizeStorefrontHostname("Shop.Example.COM")).toBe(HOST);
    expect(normalizeStorefrontHostname("shop.example.com.")).toBe(HOST);
    expect(normalizeStorefrontHostname("shop.example.com:8787")).toBe(HOST);
    expect(normalizeStorefrontHostname("  shop.example.com  ")).toBe(HOST);
  });

  it("rejects hostnames that cannot route to a storefront", () => {
    for (const value of [
      null,
      "",
      "   ",
      "localhost",
      "shop..example.com",
      "shop_example.com",
      "-shop.example.com",
      "shop.example.com:notaport",
      "[::1]",
      "shop.example.com/../admin",
      `${"a".repeat(250)}.example.com`,
    ]) {
      expect(normalizeStorefrontHostname(value as string | null)).toBeNull();
    }
  });
});

describe("resolveStorefrontHost fail-closed boundaries", () => {
  it("resolves a published storefront with an active release to its build artifact", async () => {
    const result = await resolveStorefrontHost(HOST, deps());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value).toMatchObject({
      hostname: HOST,
      storefrontId: "sf_1",
      releaseId: "rel_1",
      themeBuildId: "bld_1",
      contentPublicationId: "pub_1",
      artifactPrefix: "themes/th_1/builds/bld_1",
    });
  });

  it("refuses an unroutable hostname before touching storage", async () => {
    let queried = false;
    const result = await resolveStorefrontHost("not a host", {
      domainDal: {
        findByHostname: async () => {
          queried = true;
          return null;
        },
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("INVALID_HOSTNAME");
    expect(queried).toBe(false);
  });

  it("refuses an unmapped hostname", async () => {
    const result = await resolveStorefrontHost(HOST, deps({ domain: null }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("DOMAIN_NOT_FOUND");
  });

  it("refuses a domain that is not verified", async () => {
    for (const status of ["pending", "failed"]) {
      const result = await resolveStorefrontHost(
        HOST,
        deps({ domain: { id: "dom_1", storefrontId: "sf_1", hostname: HOST, status } }),
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe("DOMAIN_NOT_ACTIVE");
    }
  });

  it("refuses a storefront that is not published", async () => {
    for (const status of ["draft", "disabled"]) {
      const result = await resolveStorefrontHost(
        HOST,
        deps({ storefront: { id: "sf_1", status, activeReleaseId: "rel_1" } }),
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe("STOREFRONT_NOT_PUBLISHED");
    }
  });

  it("refuses when no release is active, never falling back to a recent build", async () => {
    const result = await resolveStorefrontHost(HOST, deps({ release: null }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("NO_ACTIVE_RELEASE");
  });

  it("refuses when the released build did not succeed or has no artifact", async () => {
    for (const build of [
      null,
      { id: "bld_1", storefrontId: "sf_1", themeId: "th_1", status: "building", artifactPrefix: null, manifestJson: null },
      { id: "bld_1", storefrontId: "sf_1", themeId: "th_1", status: "failed", artifactPrefix: null, manifestJson: null },
      { id: "bld_1", storefrontId: "sf_1", themeId: "th_1", status: "succeeded", artifactPrefix: null, manifestJson: { files: [] } },
      { id: "bld_1", storefrontId: "sf_1", themeId: "th_1", status: "succeeded", artifactPrefix: "p", manifestJson: null },
    ]) {
      const result = await resolveStorefrontHost(HOST, deps({ build }));
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe("RELEASE_BUILD_UNAVAILABLE");
      expect(result.status).toBe(503);
    }
  });

  it("refuses a release pointing at another storefront's build", async () => {
    const result = await resolveStorefrontHost(
      HOST,
      deps({
        build: {
          id: "bld_1",
          storefrontId: "sf_OTHER",
          themeId: "th_1",
          status: "succeeded",
          artifactPrefix: "themes/th_1/builds/bld_1",
          manifestJson: { files: [] },
        },
      }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("RELEASE_BUILD_UNAVAILABLE");
  });

  it("refuses a release whose build belongs to a different theme", async () => {
    const result = await resolveStorefrontHost(
      HOST,
      deps({
        build: {
          id: "bld_1",
          storefrontId: "sf_1",
          themeId: "th_OTHER",
          status: "succeeded",
          artifactPrefix: "themes/th_1/builds/bld_1",
          manifestJson: { files: [] },
        },
      }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("RELEASE_BUILD_UNAVAILABLE");
  });
});
