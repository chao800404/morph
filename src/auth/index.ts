import { ac, administrator, guest, user } from "@/auth/permissions";
import { localization } from "@/lib/config/localization";
import { cmsTrustedOrigins } from "@/lib/config/trusted-origins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { D1Database } from "@cloudflare/workers-types";
import { betterAuth } from "better-auth/minimal";
import { admin, anonymous, emailOTP } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";

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
function createAuth(env?: CloudflareBindings) {
  const db = env
    ? drizzle(env.DATABASE, { schema })
    : ({} as ReturnType<typeof drizzle>);
  const baseURL =
    env?.PUBLIC_URL ||
    process.env.BETTER_AUTH_URL ||
    process.env.PUBLIC_URL ||
    "http://localhost:3000";

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
      usePlural: true,
    }),
    secret: env?.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET,
    baseURL,
    trustedOrigins: Array.from(
      new Set([...cmsTrustedOrigins, baseURL, "http://localhost:3000"]),
    ),
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
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
        strategy: "compact",
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
      ipAddress: {
        // Cloudflare overwrites cf-connecting-ip at edge; fallback to x-forwarded-for in dev
        ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"],
      },
    },
    databaseHooks: {
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

// Exported for Better Auth schema generation and client-side type inference.
export const auth = createAuth();

export { createAuth };

export type Auth = ReturnType<typeof createAuth>;
