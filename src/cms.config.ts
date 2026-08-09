import { createServerOnlyFn } from "@tanstack/react-start";
import { defineConfig } from "./lib/config/create-config";
import { localization } from "./lib/config/localization";
import { cmsTrustedOrigins } from "./lib/config/trusted-origins";
import {
  Account,
  Contents,
  General,
  Marketing,
} from "./routes/_backend/dashboard/-collections";

/**
 * CMS Configuration
 *
 * The single place to configure this CMS. `defineConfig` gives the whole object
 * autocomplete and type-checking; `@/server/get-config` turns it into the
 * server and client views of the config.
 *
 * Everything outside `server` is declarative and ships to the browser.
 * Secrets belong in `server`: `createServerOnlyFn` is one of the TanStack Start
 * compiler's `transformFuncs`, so that function's body is removed from the
 * client bundle. Read `process.env` inside it, never as a module-level
 * constant, or the value is captured before the transform can strip it.
 */
export const cmsConfig = defineConfig({
  appName: "Morph",
  collections: {
    global: [Marketing, Contents],
    settings: [General, Account],
  },
  upload: {
    maxFileSize: 50 * 1024 * 1024,
    minFiles: 1,
    maxFiles: 10,
    maxAssetsPerRecord: 50,
    allowedTypes: [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/svg+xml",
      "video/mp4",
      "video/webm",
      "video/ogg",
      "video/quicktime",
    ],
    allowedExtensions: [".riv"],
  },
  products: {
    sku: {
      autoGenerate: true,
      pattern: "{product}-{options}",
      separator: "-",
      casing: "upper",
      suffixLength: 2,
    },
  },
  localization,
  auth: {
    autoLogout: {
      enabled: true,
      timeout: 30,
      promptBeforeIdle: 5,
    },
  },
  features: {
    // Requires Cloudflare Image Resizing with background removal support.
    // Keep disabled unless the customer's Cloudflare environment is provisioned.
    removeBackground: {
      enabled: true,
    },
  },
  // Cloudflare exposes no runtime API for the account plan, and the
  // per-invocation subrequest budget differs by an order of magnitude
  // (free: 1,000 to Cloudflare services; paid: 10,000). The bulk delete and
  // download caps are derived from this.
  cloudflare: {
    plan: "paid",
  },
  trustedOrigins: cmsTrustedOrigins,
  email: {
    defaultFromAddress: "medusa@mail.cmsapp.org",
    defaultFromName: "medusa",
  },

  // Server-only. Never reaches the browser.
  server: createServerOnlyFn(() => ({
    database: {
      connectionString: process.env.DATABASE_URL,
    },
    email: {
      apiKey: process.env.RESEND_API_KEY || "",
    },
  })),
});
