import { systemTaxProvider } from "./system-tax-provider";
import type { TaxProvider } from "./tax-provider";

export class TaxProviderRegistry {
  private readonly providers = new Map<string, TaxProvider>();

  constructor(providers: TaxProvider[] = [systemTaxProvider]) {
    providers.forEach((provider) => this.register(provider));
  }

  register(provider: TaxProvider) {
    if (this.providers.has(provider.id))
      throw new Error(`Tax provider is already registered: ${provider.id}`);
    this.providers.set(provider.id, provider);
    return this;
  }

  get(providerId: string) {
    const provider = this.providers.get(providerId);
    if (!provider)
      throw new Error(`Tax provider is not registered: ${providerId}`);
    return provider;
  }
}

export const taxProviderRegistry = new TaxProviderRegistry();
