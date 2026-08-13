import type { FulfillmentProvider } from "./fulfillment-provider";
import { manualFulfillmentProvider } from "./manual-fulfillment-provider";

const providers = new Map<string, FulfillmentProvider>([
  [manualFulfillmentProvider.id, manualFulfillmentProvider],
]);

export const fulfillmentProviderRegistry = {
  get(id: string | null) {
    return providers.get(id ?? manualFulfillmentProvider.id) ?? null;
  },
};
