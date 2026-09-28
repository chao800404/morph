import { manualShippingRateProvider } from "./manual-shipping-rate-provider";
import type { ShippingRateProvider } from "./shipping-rate-provider";

const assertUniqueProviders = (providers: ShippingRateProvider[]) => {
  const next = new Map<string, ShippingRateProvider>();
  for (const provider of [manualShippingRateProvider, ...providers]) {
    const id = provider.id.trim();
    if (!id || id !== provider.id || id.length > 128) {
      throw new Error("Shipping rate provider IDs must be 1 to 128 characters");
    }
    if (next.has(id))
      throw new Error(`Duplicate shipping rate provider: ${id}`);
    next.set(id, provider);
  }
  return next;
};

let providers = assertUniqueProviders([]);

export const shippingRateProviderRegistry = {
  configure(configuredProviders: ShippingRateProvider[] = []) {
    providers = assertUniqueProviders(configuredProviders);
  },
  get(id: string) {
    return providers.get(id) ?? null;
  },
  list() {
    return [...providers.values()].map((provider) => ({
      id: provider.id,
      name: provider.name ?? provider.id,
    }));
  },
};
