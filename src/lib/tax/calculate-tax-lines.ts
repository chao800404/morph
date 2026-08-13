import type {
  TaxCalculationContext,
  TaxCalculationItemLine,
  TaxCalculationRegion,
  TaxCalculationShippingLine,
  TaxLine,
  TaxProvider,
} from "./providers/tax-provider";

export interface CalculateTaxLinesInput {
  context: TaxCalculationContext;
  itemLines?: TaxCalculationItemLine[];
  shippingLines?: TaxCalculationShippingLine[];
}

export interface TaxCalculationDependencies {
  findCalculationRegion: (
    countryCode: string,
    provinceCode?: string | null,
  ) => Promise<TaxCalculationRegion | null>;
  isProviderEnabled: (providerId: string) => Promise<boolean>;
  providers: { get: (providerId: string) => TaxProvider };
}

export const calculateTaxLinesWithDependencies = async (
  input: CalculateTaxLinesInput,
  dependencies: TaxCalculationDependencies,
): Promise<TaxLine[]> => {
  const address = {
    ...input.context.address,
    countryCode: input.context.address.countryCode.trim().toLowerCase(),
    provinceCode:
      input.context.address.provinceCode?.trim().toUpperCase() || null,
  };
  const region = await dependencies.findCalculationRegion(
    address.countryCode,
    address.provinceCode,
  );
  if (!region) return [];
  const providerId = region.countryRegion.providerId;
  if (!providerId) return [];
  if (!(await dependencies.isProviderEnabled(providerId)))
    throw new Error(`Tax provider is disabled: ${providerId}`);
  const provider = dependencies.providers.get(providerId);
  return provider.getTaxLines({
    context: { ...input.context, address },
    region,
    itemLines: input.itemLines ?? [],
    shippingLines: input.shippingLines ?? [],
  });
};
