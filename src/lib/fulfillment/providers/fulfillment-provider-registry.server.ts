import type { FulfillmentProvider } from "./fulfillment-provider";
import { manualFulfillmentProvider } from "./manual-fulfillment-provider";

const assertUniqueProviders = (providers: FulfillmentProvider[]) => {
  const next = new Map<string, FulfillmentProvider>();
  for (const provider of [manualFulfillmentProvider, ...providers]) {
    const id = provider.id.trim();
    if (!id || id !== provider.id || id.length > 128) {
      throw new Error("Fulfillment provider IDs must be 1 to 128 characters");
    }
    if (next.has(id)) throw new Error(`Duplicate fulfillment provider: ${id}`);
    next.set(id, provider);
  }
  return next;
};

let providers = assertUniqueProviders([]);

export const fulfillmentProviderRegistry = {
  configure(configuredProviders: FulfillmentProvider[] = []) {
    providers = assertUniqueProviders(configuredProviders);
  },
  get(id: string | null) {
    return providers.get(id ?? manualFulfillmentProvider.id) ?? null;
  },
  list() {
    return [...providers.values()].map((provider) => ({
      id: provider.id,
      name: provider.name ?? provider.id,
    }));
  },
};
