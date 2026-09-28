import { systemTaxProvider } from "./system-tax-provider";
import type { TaxProvider } from "./tax-provider";

export class TaxProviderRegistry {
  private readonly providers = new Map<string, TaxProvider>();

  constructor(providers: TaxProvider[] = [systemTaxProvider]) {
    this.install(providers);
  }

  private install(providers: TaxProvider[]) {
    const next = new Map<string, TaxProvider>();
    for (const provider of providers) {
      const id = provider.id.trim();
      if (!id || id !== provider.id || id.length > 128) {
        throw new Error("Tax provider IDs must be 1 to 128 characters");
      }
      if (next.has(id))
        throw new Error(`Tax provider is already registered: ${id}`);
      next.set(id, provider);
    }
    this.providers.clear();
    for (const [id, provider] of next) this.providers.set(id, provider);
  }

  register(provider: TaxProvider) {
    if (this.providers.has(provider.id))
      throw new Error(`Tax provider is already registered: ${provider.id}`);
    this.providers.set(provider.id, provider);
    return this;
  }

  configure(configuredProviders: TaxProvider[] = []) {
    this.install([systemTaxProvider, ...configuredProviders]);
  }

  list() {
    return [...this.providers.keys()];
  }

  get(providerId: string) {
    const provider = this.providers.get(providerId);
    if (!provider)
      throw new Error(`Tax provider is not registered: ${providerId}`);
    return provider;
  }
}

export const taxProviderRegistry = new TaxProviderRegistry();
