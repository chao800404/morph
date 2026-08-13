import type { taxRateRules, taxRates, taxRegions } from "@/db/tax.schema";
import { findCountry } from "@/lib/region/countries";
import type {
  TaxRateDTO,
  TaxRateRuleDTO,
  TaxRateRuleReference,
  TaxRegionDTO,
} from "../dto/tax.dto";

export type TaxRuleLabels = Map<string, string>;

export const toTaxRegionDTO = (
  row: typeof taxRegions.$inferSelect,
): TaxRegionDTO => ({
  id: row.id,
  countryCode: row.countryCode,
  countryName:
    findCountry(row.countryCode)?.displayName ?? row.countryCode.toUpperCase(),
  provinceCode: row.provinceCode ?? null,
  parentId: row.parentId ?? null,
  providerId: row.providerId ?? null,
  metadata: row.metadata ?? {},
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
});

export const toTaxRateRuleDTO = (
  row: typeof taxRateRules.$inferSelect,
  labels: TaxRuleLabels,
): TaxRateRuleDTO => ({
  id: row.id,
  taxRateId: row.taxRateId,
  reference: row.reference as TaxRateRuleReference,
  referenceId: row.referenceId,
  label: labels.get(`${row.reference}:${row.referenceId}`) ?? row.referenceId,
});

export const toTaxRateDTO = (
  row: typeof taxRates.$inferSelect,
  rules: TaxRateRuleDTO[] = [],
): TaxRateDTO => ({
  id: row.id,
  taxRegionId: row.taxRegionId,
  rate: row.rate ?? null,
  code: row.code,
  name: row.name,
  isDefault: row.isDefault,
  isCombinable: row.isCombinable,
  metadata: row.metadata ?? {},
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
  rules,
});
