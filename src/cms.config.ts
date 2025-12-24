import { Account, Contents, General, Marketing } from "./collections";
import { localization } from "./lib/config/localization";

/**
 * CMS Configuration Base Data
 *
 * This file contains the pure configuration data for the CMS.
 * Logic to access this data across server/client is handled in @/server/get-config.
 */
export const cmsConfigBase = {
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
  // Raw configuration data
  database: {
    connectionString: process.env.DATABASE_URL,
  },
  email: {
    apiKey: process.env.RESEND_API_KEY || "",
    defaultFromAddress: "medusa@mail.cmsapp.org",
    defaultFromName: "medusa",
  },
};
