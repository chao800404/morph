import { describe, expect, it } from "vitest";
import { dashboardSearchSchema, toDashboardReturnTo } from "./dashboard-search";

/**
 * `returnTo` is navigated to on close and comes straight from the URL, so it is
 * the one search param an attacker controls that turns into a destination.
 */
describe("toDashboardReturnTo", () => {
  it("accepts an in-app dashboard path", () => {
    expect(toDashboardReturnTo("/dashboard/product-options/abc")).toBe(
      "/dashboard/product-options/abc",
    );
  });

  it("rejects anything outside the dashboard", () => {
    expect(toDashboardReturnTo(undefined)).toBeUndefined();
    expect(toDashboardReturnTo("")).toBeUndefined();
    expect(toDashboardReturnTo("/api/asset/download")).toBeUndefined();
    expect(toDashboardReturnTo("https://example.com")).toBeUndefined();
    // Protocol-relative: the browser reads this as another host.
    expect(toDashboardReturnTo("//example.com/dashboard")).toBeUndefined();
  });
});

describe("asset filters", () => {
  it("accepts the supported size and upload-date buckets", () => {
    expect(
      dashboardSearchSchema.parse({
        assetSize: "1mb-10mb",
        assetCreatedWithin: "30d",
      }),
    ).toMatchObject({
      assetSize: "1mb-10mb",
      assetCreatedWithin: "30d",
    });
  });

  it("rejects unknown buckets", () => {
    expect(() => dashboardSearchSchema.parse({ assetSize: "huge" })).toThrow();
    expect(() =>
      dashboardSearchSchema.parse({ assetCreatedWithin: "all-time" }),
    ).toThrow();
  });
});

describe("tax region filters", () => {
  it("accepts only supported tax-rate presence values", () => {
    expect(
      dashboardSearchSchema.parse({ taxRegionHasRates: "yes" }),
    ).toMatchObject({ taxRegionHasRates: "yes" });
    expect(() =>
      dashboardSearchSchema.parse({ taxRegionHasRates: "all" }),
    ).toThrow();
  });
});
