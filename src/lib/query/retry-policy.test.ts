// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { accessDenied, authRequired } from "@/lib/auth/auth-failure";
import { queryRetry } from "./retry-policy";

describe("queryRetry", () => {
  it("stops at once on either auth refusal", () => {
    expect(queryRetry(0, authRequired())).toBe(false);
    expect(queryRetry(0, accessDenied("Forbidden: nope"))).toBe(false);
  });

  it("keeps React Query's three browser retries for anything else", () => {
    for (const error of [
      new Error("Network down"),
      // Text alone is not a refusal.
      new Error("Unauthorized: Please sign in to continue"),
      Object.assign(new Error("x"), { code: "AUTH_REQUIRED" }),
      undefined,
    ]) {
      expect([0, 1, 2, 3].map((count) => queryRetry(count, error))).toEqual([
        true,
        true,
        true,
        false,
      ]);
    }
  });
});
