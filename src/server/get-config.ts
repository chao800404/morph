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
 * - Server: the adapter constructed inside `cmsConfig.server()`
 * - Client: declarative subset only
 *
 * The `server` callback's body is compiled out of the client bundle and is
 * never evaluated in the client view.
 */
export const getConfig = createIsomorphicFn()
  .server(() => {
    const { server, ...base } = cmsConfig;
    const secrets = server();
    fulfillmentProviderRegistry.configure(secrets.fulfillmentProviders);
    shippingRateProviderRegistry.configure(secrets.shippingRateProviders);
    taxProviderRegistry.configure(secrets.taxProviders);
    const adapter = secrets.email;
    return createCMSConfig({
      ...base,
      database: secrets.database,
      email: adapter,
      emailSupportAddress: adapter?.supportAddress,
    });
  })
  .client(() => {
    const { server: _server, ...base } = cmsConfig;
    return createCMSConfig({
      ...base,
      database: undefined,
      email: undefined,
      emailSupportAddress: undefined,
    });
  });
