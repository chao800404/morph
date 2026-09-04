import { beforeEach, describe, expect, it } from "vitest";
import {
  clearStoredReturnPath,
  currentReturnPath,
  DEFAULT_RETURN_PATH,
  readStoredReturnPath,
  resolveReturnPath,
  sanitizeReturnPath,
  storeReturnPath,
} from "./return-path";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("sanitizeReturnPath", () => {
  it("keeps a same-origin path with its query and hash", () => {
    expect(sanitizeReturnPath("/dashboard/products")).toBe(
      "/dashboard/products",
    );
    expect(sanitizeReturnPath("/dashboard/products?page=2&q=shoe")).toBe(
      "/dashboard/products?page=2&q=shoe",
    );
    expect(sanitizeReturnPath("/editor/theme-a#section")).toBe(
      "/editor/theme-a#section",
    );
  });

  // Better Auth hands the value to `window.location.href` and only screens the
  // scheme, so an absolute URL that reaches it is an open redirect against a
  // user who has just entered their password.
  it("refuses anything that could leave the origin", () => {
    expect(sanitizeReturnPath("https://evil.example/steal")).toBeNull();
    expect(sanitizeReturnPath("http://evil.example")).toBeNull();
    // Protocol-relative: the browser reads this as another origin.
    expect(sanitizeReturnPath("//evil.example/steal")).toBeNull();
    // Browsers normalise backslashes to slashes, so these are the same attack.
    expect(sanitizeReturnPath("/\\evil.example")).toBeNull();
    expect(sanitizeReturnPath("/\\/evil.example")).toBeNull();
    expect(sanitizeReturnPath("javascript:alert(1)")).toBeNull();
    expect(sanitizeReturnPath("dashboard")).toBeNull();
  });

  it("refuses control characters used to smuggle a scheme past the checks", () => {
    expect(sanitizeReturnPath("/dash\u0000board")).toBeNull();
    expect(sanitizeReturnPath("/dash\nboard")).toBeNull();
    expect(sanitizeReturnPath("/dash\rboard")).toBeNull();
  });

  it("trims surrounding whitespace before judging the value", () => {
    expect(sanitizeReturnPath(" //evil.example")).toBeNull();
    expect(sanitizeReturnPath("  /dashboard/orders  ")).toBe(
      "/dashboard/orders",
    );
  });

  it("refuses non-strings and blank values", () => {
    expect(sanitizeReturnPath(undefined)).toBeNull();
    expect(sanitizeReturnPath(null)).toBeNull();
    expect(sanitizeReturnPath(42)).toBeNull();
    expect(sanitizeReturnPath({ toString: () => "/dashboard" })).toBeNull();
    expect(sanitizeReturnPath("   ")).toBeNull();
  });

  // Returning to an auth page would bounce the user straight back out of the
  // app they just signed in to.
  it("refuses the auth pages themselves", () => {
    expect(sanitizeReturnPath("/sign-in")).toBeNull();
    expect(sanitizeReturnPath("/sign-in?email=a@b.c")).toBeNull();
    expect(sanitizeReturnPath("/reset-password/verify")).toBeNull();
    expect(sanitizeReturnPath("/create-first-admin")).toBeNull();
    expect(sanitizeReturnPath("/invite")).toBeNull();
  });

  it("does not confuse a prefix with a path segment", () => {
    // `/invitations` merely starts with the same letters as `/invite`.
    expect(sanitizeReturnPath("/invitations")).toBe("/invitations");
  });
});

describe("stored return path", () => {
  it("round-trips a valid path", () => {
    storeReturnPath("/dashboard/orders?page=3");
    expect(readStoredReturnPath()).toBe("/dashboard/orders?page=3");
    clearStoredReturnPath();
    expect(readStoredReturnPath()).toBeNull();
  });

  it("never stores a value it would refuse to return", () => {
    storeReturnPath("https://evil.example");
    expect(readStoredReturnPath()).toBeNull();
  });

  // Storage is shared with anything else running on the origin, so a value that
  // was tampered with after being written must still not escape.
  it("re-validates on read, not only on write", () => {
    window.sessionStorage.setItem(
      "morph:auth:return-path",
      "https://evil.example",
    );
    expect(readStoredReturnPath()).toBeNull();
  });

  it("clears the stored path when asked to store an invalid one", () => {
    storeReturnPath("/dashboard/orders");
    storeReturnPath("//evil.example");
    expect(readStoredReturnPath()).toBeNull();
  });
});

describe("resolveReturnPath", () => {
  it("prefers the search param, which describes the interrupted navigation", () => {
    storeReturnPath("/dashboard/older");
    expect(resolveReturnPath("/dashboard/newer")).toBe("/dashboard/newer");
  });

  it("falls back to storage when there is no search param", () => {
    storeReturnPath("/dashboard/orders");
    expect(resolveReturnPath(undefined)).toBe("/dashboard/orders");
  });

  it("falls back to storage when the search param is rejected", () => {
    storeReturnPath("/dashboard/orders");
    expect(resolveReturnPath("https://evil.example")).toBe("/dashboard/orders");
  });

  it("lands on the default when there is nothing to return to", () => {
    expect(resolveReturnPath(undefined)).toBe(DEFAULT_RETURN_PATH);
  });
});

describe("currentReturnPath", () => {
  it("reads the live location", () => {
    window.history.replaceState({}, "", "/dashboard/products?page=2");
    expect(currentReturnPath()).toBe("/dashboard/products?page=2");
  });

  it("returns null on an auth page, so signing in does not loop", () => {
    window.history.replaceState({}, "", "/sign-in");
    expect(currentReturnPath()).toBeNull();
  });
});
