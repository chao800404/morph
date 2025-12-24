import { ac, guest, user } from "@/auth/permissions";
import { getConfig } from "@/server/get-config";
import type {
  D1Database,
  IncomingRequestCfProperties,
  KVNamespace,
  R2Bucket,
} from "@cloudflare/workers-types";
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  admin,
  anonymous,
  createAuthMiddleware,
  emailOTP,
  openAPI,
} from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { sendPasswordResetEmail } from "../lib/email";

export interface CloudflareBindings {
  DATABASE: D1Database;
  KV: KVNamespace;
  R2_BUCKET: R2Bucket;
  BETTER_AUTH_SECRET: string;
}

// Single auth configuration that handles both CLI and runtime scenarios
function createAuth(
  env?: CloudflareBindings,
  cf?: IncomingRequestCfProperties,
) {
  // Use actual DB for runtime, empty object for CLI
  const db = env
    ? drizzle(env.DATABASE, { schema, logger: true })
    : ({} as any);

  return betterAuth({
    ...withCloudflare(
      {
        autoDetectIpAddress: true,
        geolocationTracking: true,
        cf: cf || {},
        d1: env
          ? {
              db,
              options: {
                usePlural: true,
                debugLogs: true,
              },
            }
          : undefined,
        kv: env?.KV,
        // Optional: Enable R2 file storage
        r2: {
          bucket: env?.R2_BUCKET as any,
          maxFileSize: 10 * 1024 * 1024, // 10MB
          allowedTypes: [
            ".jpg",
            ".jpeg",
            ".png",
            ".gif",
            ".pdf",
            ".doc",
            ".docx",
          ],
          additionalFields: {
            category: { type: "string", required: false },
            isPublic: { type: "boolean", required: false },
            description: { type: "string", required: false },
          },
          hooks: {
            upload: {
              before: async (file, ctx) => {
                // Only allow authenticated users to upload files
                if (ctx.session === null) {
                  return null; // Blocks upload
                }

                // Only allow paid users to upload files (for example)
                const isPaidUser = (userId: string) => true; // example
                if (isPaidUser(ctx.session.user.id) === false) {
                  return null; // Blocks upload
                }

                // Allow upload
              },
              after: async (file, ctx) => {
                // Track your analytics (for example)
                console.log("File uploaded:", file);
              },
            },
            download: {
              before: async (file, ctx) => {
                // Only allow user to access their own files (by default all files are public)
                if (
                  file.isPublic === false &&
                  file.userId !== ctx.session?.user.id
                ) {
                  return null; // Blocks download
                }
                // Allow download
              },
            },
          },
        },
      },
      {
        secret: env?.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET,
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
            metadata: {
              type: "json",
              required: false,
            },
          },
        },
        rateLimit: {
          enabled: true,
          window: 60, // Minimum KV TTL is 60s
          max: 100, // reqs/window
          customRules: {
            // https://github.com/better-auth/better-auth/issues/5452
            "/sign-in/email": {
              window: 60,
              max: 100,
            },
            "/sign-in/social": {
              window: 60,
              max: 100,
            },
          },
        },
        hooks: {
          after: createAuthMiddleware(async (ctx) => {
            if (ctx.path === "/email-otp/reset-password") {
              // const cookiesStore = await cookies();
              // cookiesStore.delete("otp-sent");
            }
          }),
        },
        session: {
          additionalFields: {
            city: {
              type: "string",
              input: false,
            },
            timezone: {
              type: "string",
              input: false,
            },
            country: {
              type: "string",
              input: false,
            },
            region: {
              type: "string",
              input: false,
            },
            regionCode: {
              type: "string",
              input: false,
            },
            colo: {
              type: "string",
              input: false,
            },
            latitude: {
              type: "string",
              input: false,
            },
            longitude: {
              type: "string",
              input: false,
            },
            impersonatedBy: {
              type: "string",
              input: false,
            },
          },
        },
        databaseHooks: {
          user: {
            create: {
              async before(user) {
                // Set default language from CMS config if user doesn't have one
                if (!user.language) {
                  const config = getConfig();
                  const defaultLanguage =
                    config.server.localization?.defaultLanguage;
                  return {
                    data: {
                      ...user,
                      language: defaultLanguage,
                    },
                  };
                }
                return { data: user };
              },
            },
          },
        },
        plugins: [
          tanstackStartCookies(), // CRITICAL for TanStack Start
          anonymous(),
          openAPI(),
          admin({
            ac,
            defaultRole: "guest",
            roles: {
              user,
              guest,
            },
          }),
          emailOTP({
            overrideDefaultEmailVerification: true,
            async sendVerificationOTP({ email, otp, type }) {
              if (type === "sign-in") {
                // TODO: Implement sign-in OTP email
                console.log(`Sign-in OTP for ${email}: ${otp}`);
              } else if (type === "email-verification") {
                // TODO: Implement email verification OTP
                console.log(`Email verification OTP for ${email}: ${otp}`);
              } else if (type === "forget-password") {
                await sendPasswordResetEmail({
                  email,
                  otp,
                });
              }
            },
          }),
        ],
      },
    ),
    // Only add database adapter for CLI schema generation
    ...(env
      ? {}
      : {
          database: drizzleAdapter({} as D1Database, {
            provider: "sqlite",
            usePlural: true,
            debugLogs: true,
          }),
        }),
  });
}

// Export for CLI schema generation
export const auth = createAuth();

// Export for runtime usage
export { createAuth };

// Type augmentation to expose admin plugin API
// This ensures TypeScript recognizes admin plugin methods
export type Auth = ReturnType<typeof createAuth>;
