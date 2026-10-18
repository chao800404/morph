import { cmsConfig } from "@/cms.config";
import { createCMSConfig } from "@/lib/config/create-config";
import { fulfillmentProviderRegistry } from "@/lib/fulfillment/providers/fulfillment-provider-registry.server";
import { shippingRateProviderRegistry } from "@/lib/shipping/providers/shipping-rate-provider-registry.server";
import { taxProviderRegistry } from "@/lib/tax/providers/tax-provider-registry.server";
import { createIsomorphicFn } from "@tanstack/react-start";

/**
 * Get CMS Configuration (Isomorphic)
 *
 * Splits the authored config into its two runtime views:
 * - Server: the adapter constructed by the server-only `cmsConfig.email()`
 * - Client: declarative subset only
 *
 * Both `email` and `server` carry server-only callbacks whose bodies are
 * compiled out of the client bundle. Neither is evaluated in the client view.
 */
export const getConfig = createIsomorphicFn()
  .server(() => {
    const { server, email, ...base } = cmsConfig;
    const secrets = server();
    fulfillmentProviderRegistry.configure(secrets.fulfillmentProviders);
    shippingRateProviderRegistry.configure(secrets.shippingRateProviders);
    taxProviderRegistry.configure(secrets.taxProviders);
    const adapter = email?.();
    return createCMSConfig({
      ...base,
      database: secrets.database,
      email: adapter,
      emailSupportAddress: adapter?.supportAddress,
    });
  })
  .client(() => {
    const { server: _server, email: _email, ...base } = cmsConfig;
    return createCMSConfig({
      ...base,
      database: undefined,
      email: undefined,
      emailSupportAddress: undefined,
    });
  });
