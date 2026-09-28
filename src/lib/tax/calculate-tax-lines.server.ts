import { taxDal } from "./dal/tax.dal";
import { taxProviderRegistry } from "./providers/tax-provider-registry.server";
import { getConfig } from "@/server/get-config";
import {
  calculateTaxLinesWithDependencies,
  type CalculateTaxLinesInput,
  type TaxCalculationDependencies,
} from "./calculate-tax-lines";

const defaultDependencies: TaxCalculationDependencies = {
  findCalculationRegion: (countryCode, provinceCode) =>
    taxDal.findCalculationRegion(countryCode, provinceCode),
  isProviderEnabled: (providerId) => taxDal.isProviderEnabled(providerId),
  providers: taxProviderRegistry,
};

export const calculateTaxLines = (input: CalculateTaxLinesInput) => {
  getConfig();
  return calculateTaxLinesWithDependencies(input, defaultDependencies);
};

export type { CalculateTaxLinesInput } from "./calculate-tax-lines";
