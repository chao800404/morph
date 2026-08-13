import { manualShippingRateProvider } from "./manual-shipping-rate-provider";
import type { ShippingRateProvider } from "./shipping-rate-provider";

const providers = new Map<string, ShippingRateProvider>([
  [manualShippingRateProvider.id, manualShippingRateProvider],
]);

export const shippingRateProviderRegistry = {
  get(id: string) {
    return providers.get(id) ?? null;
  },
};
