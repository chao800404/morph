// @vitest-environment node
import { getCookies } from "better-auth/cookies";
import { describe, expect, it } from "vitest";
import { auth, authCookieOptions } from "@/auth";
import {
  AUTH_COOKIE_PREFIX,
  carriesPlatformCredentialCookie,
  isPlatformCredentialCookieName,
} from "./platform-cookies";
import { resetAccessCookieHeader } from "./reset-access-token";

describe("the session cookies over HTTPS", () => {
  const cookies = getCookies({
    ...auth.options,
    baseURL: "https://admin-stg.showtrue.com.tw",
    advanced: {
      ...auth.options.advanced,
      ...authCookieOptions("https://admin-stg.showtrue.com.tw"),
    },
  });

  it("are __Host- cookies: Secure, HttpOnly, Path=/, no Domain", () => {
    for (const cookie of [cookies.sessionToken, cookies.dontRememberToken]) {
      expect(cookie.name.startsWith("__Host-")).toBe(true);
      expect(cookie.name.startsWith("__Host-__Secure-")).toBe(false);
      expect(cookie.attributes.secure).toBe(true);
      expect(cookie.attributes.httpOnly).toBe(true);
      expect(cookie.attributes.path).toBe("/");
      expect(cookie.attributes.domain).toBeUndefined();
    }
    expect(cookies.sessionToken.name).toBe(
      `__Host-${AUTH_COOKIE_PREFIX}.session_token`,
    );
  });

  it("keeps every other Better Auth cookie Secure, and a platform name", () => {
    for (const cookie of Object.values(cookies)) {
      expect(cookie.attributes.secure).toBe(true);
      expect(isPlatformCredentialCookieName(cookie.name)).toBe(true);
    }
  });

  it("are unchanged over plain HTTP (localhost, the end-to-end runs)", () => {
    const plain = getCookies({
      ...auth.options,
      baseURL: "http://localhost:3000",
      advanced: {
        ...auth.options.advanced,
        ...authCookieOptions("http://localhost:3000"),
      },
    });
    expect(plain.sessionToken.name).toBe(
      `${AUTH_COOKIE_PREFIX}.session_token`,
    );
    expect(plain.sessionToken.attributes.secure).toBe(false);
  });
});

describe("carriesPlatformCredentialCookie", () => {
  it("finds a platform cookie among a Theme's", () => {
    expect(
      carriesPlatformCredentialCookie(
        new Headers({
          cookie: `cart=1; __Host-${AUTH_COOKIE_PREFIX}.session_token=s`,
        }),
      ),
    ).toBe(true);
    expect(
      carriesPlatformCredentialCookie(
        new Headers({ cookie: `${AUTH_COOKIE_PREFIX}.session_token=s` }),
      ),
    ).toBe(true);
  });

  it("is false for a Theme's cookies only, or none", () => {
    expect(
      carriesPlatformCredentialCookie(new Headers({ cookie: "cart=1; x=2" })),
    ).toBe(false);
    expect(carriesPlatformCredentialCookie(new Headers())).toBe(false);
  });
});

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
