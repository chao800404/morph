import { describe, expect, it } from "vitest";
import {
  clearResetAccessCookieHeader,
  createResetAccessToken,
  hashResetAccessToken,
  readResetAccessCookie,
  resetAccessCookieHeader,
} from "./reset-access-token";

describe("reset access token", () => {
  it("creates opaque high-entropy tokens and stores a different stable hash", async () => {
    const first = createResetAccessToken();
    const second = createResetAccessToken();

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
    expect(await hashResetAccessToken(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashResetAccessToken(first)).not.toBe(first);
    expect(await hashResetAccessToken(first)).toBe(
      await hashResetAccessToken(first),
    );
  });

  it("only accepts a correctly shaped bearer cookie", () => {
    const token = "a".repeat(64);
    expect(readResetAccessCookie(`other=1; verify_access=${token}`)).toBe(
      token,
    );
    expect(
      readResetAccessCookie("verify_access=user@example.com|999999"),
    ).toBeNull();
    expect(readResetAccessCookie("verify_access=abc")).toBeNull();
  });

  it("uses a scoped HttpOnly strict cookie and Secure on HTTPS", () => {
    const issued = resetAccessCookieHeader("a".repeat(64), true);
    expect(issued).toContain("Path=/reset-password");
    expect(issued).toContain("HttpOnly");
    expect(issued).toContain("SameSite=Strict");
    expect(issued).toContain("Secure");
    expect(clearResetAccessCookieHeader(true)).toContain("Max-Age=0");
  });
});
