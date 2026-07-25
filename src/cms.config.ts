import { createServerOnlyFn } from "@tanstack/react-start";
import { defineConfig } from "./lib/config/create-config";
import { localization } from "./lib/config/localization";
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
  trustedOrigins: [
    "http://192.168.31.105:3000",
    "https://192.168.31.105:3000",
    "https://*.cmsapp.org",
  ],
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
