import { describe, expect, it } from "vitest";
import { toDashboardReturnTo } from "./dashboard-search";

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
