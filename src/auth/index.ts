import { ac, administrator, guest, user } from "@/auth/permissions";
import {
  DEFAULT_DEV_ORIGIN,
  isProductionRuntime,
  resolvePublicOrigin,
  type PublicOriginEnv,
} from "@/server/public-origin";
import { buildAuthTrustedOrigins } from "./auth-trusted-origins";
import { DISABLED_AUTH_PATHS } from "./disabled-auth-paths";
import { resolveStorefrontTrustedOrigin } from "./storefront-origin";
import { AUTH_COOKIE_PREFIX } from "@/lib/auth/platform-cookies";
import { localization } from "@/lib/config/localization";
import {
  cmsDevTrustedOrigins,
  cmsTrustedOrigins,
} from "@/lib/config/trusted-origins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { D1Database } from "@cloudflare/workers-types";
import { betterAuth } from "better-auth/minimal";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { admin, anonymous, emailOTP } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";

type PreviewAccessRevocationHooks =
  typeof import("../server/preview-access-revocation-hooks");

/**
 * Loads the Live Preview revocation hooks and runs one (#214 P2d). Loading is
 * inside the guard too: a module that fails to load must not turn a finished
 * sign-out, ban or deletion into a failed one. Only the hook's name and the
 * error's name are logged.
 */
async function endPreviewAccess(
  hook: string,
  run: (hooks: PreviewAccessRevocationHooks) => Promise<void>,
): Promise<void> {
  try {
    await run(await import("../server/preview-access-revocation-hooks"));
  } catch (error) {
    console.error("[preview-access] revocation hook did not run", {
      hook,
      error: error instanceof Error ? error.name : typeof error,
    });
  }
}

/**
 * The bindings `createAuth` reads.
 *
 * `BETTER_AUTH_SECRET` is a Wrangler secret and `PUBLIC_URL` a var, so neither
 * appears in the generated `Env` type. Both are optional here because the code
 * below already falls back to `process.env`, and declaring them as required
 * only forced casts at every call site.
 */
export interface CloudflareBindings {
  DATABASE: D1Database;
  BETTER_AUTH_SECRET?: string;
  PUBLIC_URL?: string;
}

/**
 * Build one auth configuration for both the Cloudflare runtime and the schema CLI.
 * D1 is the source of truth for users, accounts, sessions, and verifications.
 */
/**
 * The origin Better Auth runs under — and so the CMS's own origin, which
 * `/api/admin/*` and the other cookie-authenticated routes require a write to
 * come from (`src/server/same-origin-write.ts`).
 *
 * Unchanged in production: the chain below is what it always was, and
 * `resolvePublicOrigin` returns it untouched there. Outside production the
 * request wins, because `PUBLIC_URL` is a fixed string and a dev server on
 * another port would otherwise check its own sign-in requests against an
 * origin it is not being served from — better-auth refuses them, and the
 * browser reports "Failed to fetch" without naming the port. `baseURL` is in
 * `trustedOrigins` below, so following the request is what admits it.
 */
export function resolveAuthBaseURL(
  env?: CloudflareBindings,
  requestUrl?: string | null,
): string {
  return resolvePublicOrigin({
    env: (env ?? {}) as PublicOriginEnv,
    configured:
      env?.PUBLIC_URL ||
      process.env.BETTER_AUTH_URL ||
      process.env.PUBLIC_URL ||
      DEFAULT_DEV_ORIGIN,
    requestUrl,
  });
}

/**
 * Cookie names and attributes for a base URL.
 *
 * Over HTTPS the session cookies are `__Host-` cookies: Secure, `Path=/`, and
 * no `Domain`, which a browser enforces. A `__Secure-` cookie may carry a
 * `Domain`, so a storefront that shares a site with the CMS (`stg.example`
 * and `admin-stg.example`) could set one for the whole site and have the CMS
 * read it ("cookie tossing"); a `__Host-` cookie can only be set by the host
 * it belongs to.
 *
 * Better Auth's `useSecureCookies` prepends `__Secure-` to every name, so it
 * is turned off and these names are given whole; `defaultCookieAttributes`
 * keeps every other Better Auth cookie Secure as before (those lose only the
 * `__Secure-` prefix, which never stopped a `Domain` either).
 *
 * Over plain HTTP (a developer's `http://localhost`, the LAN origin, the
 * end-to-end runs) nothing changes: Better Auth's names without a prefix, as
 * before. A `__Host-` cookie must be Secure, and a browser refuses a Secure
 * cookie from a plain-HTTP origin other than localhost.
 *
 * "Secure" is decided by Better Auth's own rule (the base URL is `https://`),
 * so an instance that reads a session and the one that issued it still agree
 * on the name (`src/server/auth/helpers.ts`).
 */
export function authCookieOptions(baseURL: string) {
  if (!baseURL.startsWith("https://")) {
    return { cookiePrefix: AUTH_COOKIE_PREFIX };
  }
  const hostCookie = (name: string) => ({
    name: `__Host-${AUTH_COOKIE_PREFIX}.${name}`,
    attributes: { secure: true, path: "/" },
  });
  return {
    cookiePrefix: AUTH_COOKIE_PREFIX,
    useSecureCookies: false,
    defaultCookieAttributes: { secure: true },
    cookies: {
      session_token: hostCookie("session_token"),
      dont_remember: hostCookie("dont_remember"),
      // The admin plugin keeps the impersonating admin's own session token
      // here; it is a session credential like the other two.
      admin_session: hostCookie("admin_session"),
    },
  };
}

/** Roles that make an account CMS staff rather than a customer. */
const STAFF_ROLES = ["admin", "user"];

function isStaffRole(role: unknown): boolean {
  return (
    typeof role === "string" &&
    role
      .split(",")
      .map((value) => value.trim())
      .some((value) => STAFF_ROLES.includes(value))
  );
}

type CreateAuthOptions = {
  /**
   * Refuse to create a session for a CMS staff account (role `admin` or
   * `user`). Set on storefront hosts: staff sign in on the CMS host only, so
   * a storefront, which may share a site with the CMS, never holds a staff
   * session. Customers are unaffected.
   */
  refuseStaffSessions?: boolean;
};

function createAuth(
  env?: CloudflareBindings,
  requestUrl?: string | null,
  additionalTrustedOrigins: readonly string[] = [],
  options: CreateAuthOptions = {},
) {
  const db = env
    ? drizzle(env.DATABASE, { schema })
    : ({} as ReturnType<typeof drizzle>);
  const baseURL = resolveAuthBaseURL(env, requestUrl);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
      usePlural: true,
    }),
    secret: env?.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET,
    baseURL,
    trustedOrigins: buildAuthTrustedOrigins({
      baseURL,
      isProduction: isProductionRuntime((env ?? {}) as PublicOriginEnv),
      cmsTrustedOrigins,
      cmsDevTrustedOrigins,
      additionalTrustedOrigins,
    }),
    // Closed over HTTP; server code still calls them through `auth.api`.
    disabledPaths: [...DISABLED_AUTH_PATHS],
    emailAndPassword: {
      enabled: true,
    },
    user: {
      additionalFields: {
        language: {
          type: "string",
          required: false,
        },
        phoneNumber: {
          type: "string",
          required: false,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // No session renewal: ordinary requests no longer extend the session;
      // when the expiresAt already stored in the database is reached, the user
      // signs in again. (Explicit operations that create a new session — sign
      // in, or a password change that revokes the other sessions — give that
      // new session its own expiresAt; `updateUser` and `updateSession` re-set
      // the cookie but leave the stored expiry alone.) Renewal (`updateAge`)
      // answered an ordinary request with a fresh `session_token` cookie for
      // the session that request was sent under. If that response lands after
      // another account signed in, in another tab, it puts the earlier
      // account's token back, and every tab of the browser is that account
      // again. With renewal off, reading a session sets no cookie at all, so a
      // late response to it cannot change who is signed in
      // (src/auth/session-identity.integration.test.ts).
      disableSessionRefresh: true,
      additionalFields: {
        city: {
          type: "string",
          required: false,
          input: false,
        },
        country: {
          type: "string",
          required: false,
          input: false,
        },
      },
      // Off: every session read goes to the database by its `session_token`.
      // The cache (`session_data`) is not tied to that token in this Better
      // Auth version, so a browser holding one account's token and another
      // account's cache cookie was answered as the cached account — a write
      // from a browser signed in as B ran as A. With the cache off Better Auth
      // ignores a `session_data` cookie a browser still holds and writes no
      // new one (src/auth/session-identity.integration.test.ts).
      cookieCache: {
        enabled: false,
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/get-session": false,
        "/sign-in/email": {
          window: 60,
          max: 5,
        },
        "/sign-in/social": {
          window: 60,
          max: 10,
        },
        "/sign-up/email": {
          window: 60,
          max: 3,
        },
      },
    },
    advanced: {
      // The prefix is named here so the Live Preview proxy can know the
      // platform's cookies from the same value; see
      // `isPlatformCredentialCookieName`. Over HTTPS the session cookies are
      // `__Host-` cookies; see `authCookieOptions`.
      ...authCookieOptions(baseURL),
      ipAddress: {
        // Cloudflare overwrites cf-connecting-ip at edge; fallback to x-forwarded-for in dev
        ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"],
      },
    },
    // Live Preview access ends with the session or user it answers to
    // (#214 P2d). The after-hooks run once the change is written; they mark
    // the preview grants revoked and ask open preview sockets to close.
    // They never throw, so a sign-out, ban or deletion is never reported as
    // failed for a preview's sake; the database change already refuses the
    // next preview request, and a socket's lease ends it regardless.
    databaseHooks: {
      session: {
        ...(options.refuseStaffSessions
          ? {
              create: {
                async before(session: { userId: string }) {
                  const [found] = await db
                    .select({ role: schema.users.role })
                    .from(schema.users)
                    .where(eq(schema.users.id, session.userId))
                    .limit(1);
                  // An account that cannot be read is refused too, rather
                  // than guessed to be a customer.
                  if (!found || isStaffRole(found.role)) {
                    throw new APIError("FORBIDDEN", {
                      code: "STAFF_SIGN_IN_ON_STOREFRONT",
                      message:
                        "Staff accounts sign in on the CMS, not on a storefront",
                    });
                  }
                },
              },
            }
          : {}),
        delete: {
          async after(session) {
            await endPreviewAccess("session.delete", (hooks) =>
              hooks.previewAccessAfterSessionDeleted(session),
            );
          },
        },
      },
      user: {
        create: {
          async before(userData) {
            if (!userData.language) {
              return {
                data: {
                  ...userData,
                  language: localization.defaultLanguage,
                },
              };
            }
            return { data: userData };
          },
        },
        update: {
          async after(user) {
            await endPreviewAccess("user.update", (hooks) =>
              hooks.previewAccessAfterUserUpdated(
                user as typeof user & {
                  role?: string | null;
                  banned?: boolean | null;
                },
              ),
            );
          },
        },
        delete: {
          async after(user) {
            await endPreviewAccess("user.delete", (hooks) =>
              hooks.previewAccessAfterUserDeleted(user),
            );
          },
        },
      },
    },
    plugins: [
      anonymous(),
      admin({
        ac,
        defaultRole: "guest",
        roles: {
          admin: administrator,
          user,
          guest,
        },
      }),
      emailOTP({
        overrideDefaultEmailVerification: true,
        async sendVerificationOTP({ email, otp, type }) {
          if (type === "sign-in" || type === "email-verification") {
            const { sendAuthVerificationEmail } = await import("../lib/email");
            await sendAuthVerificationEmail({ email, otp, type });
          } else if (type === "forget-password") {
            // Email configuration reads the full CMS config. Load it only when
            // an email is sent so auth middleware initialization cannot cycle
            // through collections -> queries -> server functions -> auth.
            const { sendPasswordResetEmail } = await import("../lib/email");
            await sendPasswordResetEmail({ email, otp });
          } else {
            throw new Error("Unsupported authentication OTP type.");
          }
        },
      }),
      // Must be last so cookie headers from every plugin are forwarded by Start.
      tanstackStartCookies(),
    ],
  });
}

/**
 * Use the same Better Auth configuration on a validated storefront host.
 *
 * `resolvedHostname` must come from StorefrontProductionService's active-domain
 * resolution; never pass a hostname taken directly from a request header.
 * Production storefronts are HTTPS-only and each store gets a host-only
 * session cookie through Better Auth's existing cookie configuration.
 */
export function createStorefrontAuth(
  env: CloudflareBindings,
  requestUrl: string,
  resolvedHostname: string,
) {
  const trustedOrigin = resolveStorefrontTrustedOrigin(
    requestUrl,
    resolvedHostname,
    isProductionRuntime((env ?? {}) as PublicOriginEnv),
  );
  if (!trustedOrigin) {
    throw new Error("The request origin does not match the resolved storefront");
  }
  return createAuth(env, requestUrl, [trustedOrigin], {
    refuseStaffSessions: true,
  });
}

// Exported for Better Auth schema generation and client-side type inference.
export const auth = createAuth();

export { createAuth };

export type Auth = ReturnType<typeof createAuth>;
