import { describe, expect, it } from "vitest";
import {
  resolveStorefrontRenderPolicy,
  storefrontConcreteRenderPolicySchema,
  storefrontPageRenderPolicySchema,
  validateStorefrontRenderEligibility,
} from "./storefront-render-policy";

describe("storefront publishing render policy (not yet wired to runtime)", () => {
  it("defaults legacy websites and new pages to inherited SSR", () => {
    expect(resolveStorefrontRenderPolicy({})).toEqual({
      success: true,
      policy: { mode: "ssr" },
      inherited: true,
    });
  });

  it("inherits the current website policy rather than copying an old default", () => {
    const page = { mode: "inherit" };
    expect(
      resolveStorefrontRenderPolicy({ page, website: { mode: "ssr" } }),
    ).toMatchObject({
      policy: { mode: "ssr" },
      inherited: true,
    });
    expect(
      resolveStorefrontRenderPolicy({
        page,
        website: { mode: "isr", revalidateSeconds: 300 },
      }),
    ).toMatchObject({
      policy: { mode: "isr", revalidateSeconds: 300 },
      inherited: true,
    });
  });

  it.each(["ssr", "ssg", "csr"])(
    "keeps a page's explicit %s despite a website change",
    (mode) => {
      expect(
        resolveStorefrontRenderPolicy({
          website: { mode: "isr", revalidateSeconds: 60 },
          page: { mode },
        }),
      ).toEqual({ success: true, policy: { mode }, inherited: false });
    },
  );

  it("keeps the page's own ISR interval", () => {
    expect(
      resolveStorefrontRenderPolicy({
        website: { mode: "isr", revalidateSeconds: 300 },
        page: { mode: "isr", revalidateSeconds: 60 },
      }),
    ).toEqual({
      success: true,
      policy: { mode: "isr", revalidateSeconds: 60 },
      inherited: false,
    });
  });

  it.each([0, -1, 0.5, 604_801, Infinity, NaN, "300", undefined])(
    "rejects an invalid ISR interval %s",
    (revalidateSeconds) => {
      expect(
        storefrontConcreteRenderPolicySchema.safeParse({
          mode: "isr",
          revalidateSeconds,
        }).success,
      ).toBe(false);
    },
  );

  it.each(["ssr", "ssg", "csr", "inherit"])(
    "refuses irrelevant ISR settings on %s",
    (mode) => {
      expect(
        storefrontPageRenderPolicySchema.safeParse({
          mode,
          revalidateSeconds: 60,
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    null,
    {},
    { mode: "auto" },
    { mode: "spa" },
    { mode: "ssr", plugin: () => null },
  ])("does not silently default malformed page input", (page) => {
    expect(resolveStorefrontRenderPolicy({ page })).toEqual({
      success: false,
      code: "INVALID_PAGE_RENDER_POLICY",
    });
  });

  it("rejects an invalid website policy even when a page overrides it", () => {
    expect(
      resolveStorefrontRenderPolicy({
        website: { mode: "inherit" },
        page: { mode: "ssr" },
      }),
    ).toEqual({
      success: false,
      code: "INVALID_WEBSITE_RENDER_POLICY",
    });
  });

  it("does not mutate or retain mutable caller objects", () => {
    const website = { mode: "isr", revalidateSeconds: 300 };
    const result = resolveStorefrontRenderPolicy({ website });
    website.revalidateSeconds = 600;
    expect(result).toMatchObject({ policy: { revalidateSeconds: 300 } });
  });

  it.each(["ssg", "isr"] as const)("refuses personalized %s output", (mode) => {
    const policy = mode === "isr" ? { mode, revalidateSeconds: 300 } : { mode };
    expect(
      validateStorefrontRenderEligibility({ policy, personalized: true }),
    ).toEqual({
      success: false,
      code: "PERSONALIZED_SHARED_HTML_REFUSED",
    });
    expect(
      validateStorefrontRenderEligibility({ policy, personalized: false }),
    ).toEqual({ success: true });
  });

  it.each(["ssr", "csr"] as const)(
    "allows personalized %s without approving any shared cache",
    (mode) => {
      expect(
        validateStorefrontRenderEligibility({
          policy: { mode },
          personalized: true,
        }),
      ).toEqual({ success: true });
    },
  );
});
