// @vitest-environment node
import { getCookies } from "better-auth/cookies";
import { describe, expect, it } from "vitest";
import { auth } from "@/auth";
import {
  AUTH_COOKIE_PREFIX,
  isPlatformCredentialCookieName,
} from "./platform-cookies";
import { resetAccessCookieHeader } from "./reset-access-token";

describe("the platform's credential cookie names", () => {
  it("is the prefix the auth configuration actually uses", () => {
    expect(auth.options.advanced?.cookiePrefix).toBe(AUTH_COOKIE_PREFIX);
  });

  it("covers every cookie Better Auth names from that configuration", () => {
    // Asked of Better Auth itself, in both the plain and the Secure form, so
    // a change to the configuration shows up here rather than as a cookie the
    // preview proxy lets through.
    for (const useSecureCookies of [false, true]) {
      const cookies = getCookies({
        ...auth.options,
        advanced: { ...auth.options.advanced, useSecureCookies },
      });
      const names = Object.values(cookies).map((cookie) => cookie.name);
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        expect(isPlatformCredentialCookieName(name)).toBe(true);
      }
    }
  });

  it("covers the password-reset grant", () => {
    const name = resetAccessCookieHeader("a".repeat(64), true).split("=")[0];
    expect(isPlatformCredentialCookieName(name)).toBe(true);
  });

  it("covers the __Secure- and __Host- forms, in any case", () => {
    for (const name of [
      `__Secure-${AUTH_COOKIE_PREFIX}.session_token`,
      `__Host-${AUTH_COOKIE_PREFIX}.session_token`,
      `__SECURE-${AUTH_COOKIE_PREFIX}.session_data`,
      `__host-verify_access`,
      `${AUTH_COOKIE_PREFIX}-session_token`,
    ]) {
      expect(isPlatformCredentialCookieName(name)).toBe(true);
    }
  });

  it("leaves a Theme's own cookie names alone", () => {
    for (const name of [
      "session",
      "cart",
      "__Host-session",
      "better-authx",
      "my-better-auth.session_token",
      "verify_access_extra",
      "",
    ]) {
      expect(isPlatformCredentialCookieName(name)).toBe(false);
    }
  });
});
