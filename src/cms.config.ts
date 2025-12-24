import { Account, Contents, General, Marketing } from "./collections";
import { createCMSConfig } from "./lib/config/create-config";

import { localization } from "./lib/config/localization";
import { resendAdapter } from "./lib/email/adapters";

/**
 * CMS Configuration
 *
 * Uses factory pattern to create type-safe configuration.
 * Automatically splits into server and client parts.
 */
const isServer = typeof window === "undefined";

const cmsConfigBase = {
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
  trustedOrigins: [
    "http://192.168.31.105:3000",
    "https://192.168.31.105:3000",
    "https://*.cmsapp.org",
  ],
};

/**
 * CMS Configuration
 *
 * Uses factory pattern to create type-safe configuration.
 */
const cmsConfig = createCMSConfig({
  ...cmsConfigBase,
  // Only inject sensitive data on the server
  database: isServer
    ? {
        connectionString: process.env.DATABASE_URL,
      }
    : undefined,
  email: isServer
    ? resendAdapter({
        apiKey: process.env.RESEND_API_KEY || "",
        defaultFromAddress: "medusa@mail.cmsapp.org",
        defaultFromName: "medusa",
      })
    : undefined,
});

/**
 * Get full config
 */
export const getConfig = () => {
  return cmsConfig;
};
