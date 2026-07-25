import { cmsConfigBase } from "@/cms.config";
import { createCMSConfig } from "@/lib/config/create-config";
import { resendAdapter } from "@/lib/email/adapters";
import { createIsomorphicFn } from "@tanstack/react-start";

/**
 * Get CMS Configuration (Isomorphic)
 *
 * Handles environment-specific transformation:
 * - Server: Full config with initialized adapters
 * - Client: Safe config subset with sensitive keys stripped
 */
export const getConfig = createIsomorphicFn()
  .server(() => {
    const { database, email, ...base } = cmsConfigBase;
    return createCMSConfig({
      ...base,
      database,
      email: resendAdapter(email),
    });
  })
  .client(() => {
    const { database: _, email: __, ...base } = cmsConfigBase;
    return createCMSConfig({
      ...base,
      database: undefined,
      email: undefined,
    });
  });
