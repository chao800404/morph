import { cmsConfig } from "@/cms.config";
import { createCMSConfig } from "@/lib/config/create-config";
import { resendAdapter } from "@/lib/email/adapters";
import { fulfillmentProviderRegistry } from "@/lib/fulfillment/providers/fulfillment-provider-registry.server";
import { shippingRateProviderRegistry } from "@/lib/shipping/providers/shipping-rate-provider-registry.server";
import { taxProviderRegistry } from "@/lib/tax/providers/tax-provider-registry.server";
import { createIsomorphicFn } from "@tanstack/react-start";

/**
 * Get CMS Configuration (Isomorphic)
 *
 * Splits the authored config into its two runtime views:
 * - Server: adapters built from `cmsConfig.server()` secrets
 * - Client: declarative subset only
 *
 * `server` is the only key carrying secrets, and its body is compiled out of
 * the client bundle, so the rest of `cmsConfig` is safe in either build.
 */
export const getConfig = createIsomorphicFn()
  .server(() => {
    const { server, email, ...base } = cmsConfig;
    const secrets = server();
    fulfillmentProviderRegistry.configure(secrets.fulfillmentProviders);
    shippingRateProviderRegistry.configure(secrets.shippingRateProviders);
    taxProviderRegistry.configure(secrets.taxProviders);
    return createCMSConfig({
      ...base,
      database: secrets.database,
      email: resendAdapter({
        ...email,
        apiKey: secrets.email?.apiKey ?? "",
      }),
    });
  })
  .client(() => {
    const { server: _server, email: _email, ...base } = cmsConfig;
    return createCMSConfig({
      ...base,
      database: undefined,
      email: undefined,
    });
  });
