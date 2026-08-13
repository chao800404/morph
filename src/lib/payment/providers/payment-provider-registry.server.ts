import { manualPaymentProvider } from "./manual-payment-provider";
import type { PaymentProvider } from "./payment-provider";

const providers = new Map<string, PaymentProvider>([
  [manualPaymentProvider.id, manualPaymentProvider],
]);

export const paymentProviderRegistry = {
  get(id: string) {
    const provider = providers.get(id);
    if (!provider) throw new Error(`Payment provider is not registered: ${id}`);
    return provider;
  },
};
