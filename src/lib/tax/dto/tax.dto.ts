import type { Metadata } from "@/db/json";

export type TaxMetadata = Metadata;

export type TaxRateRuleReference =
  | "product"
  | "product_type"
  | "shipping_option";

export interface TaxRateRuleDTO {
  id: string;
  taxRateId: string;
  reference: TaxRateRuleReference;
  referenceId: string;
  label: string;
}

export interface TaxRegionDTO {
  id: string;
  countryCode: string;
  countryName: string;
  provinceCode: string | null;
  parentId: string | null;
  providerId: string | null;
  metadata: TaxMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaxRegionSummaryDTO extends TaxRegionDTO {
  provinceCount: number;
  taxRateCount: number;
}

export interface TaxRateDTO {
  id: string;
  taxRegionId: string;
  rate: number | null;
  code: string;
  name: string;
  isDefault: boolean;
  isCombinable: boolean;
  metadata: TaxMetadata;
  createdAt: Date;
  updatedAt: Date;
  rules: TaxRateRuleDTO[];
}

export interface TaxRuleTargetOptionDTO {
  id: string;
  label: string;
}
