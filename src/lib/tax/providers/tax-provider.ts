import type { Metadata } from "@/db/json";
import type { TaxRateDTO, TaxRegionDTO } from "../dto/tax.dto";
import type { TaxableItemReference } from "../resolve-tax-rates";

export interface TaxCalculationAddress {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  countryCode: string;
  provinceCode?: string | null;
  postalCode?: string | null;
}

export interface TaxCalculationContext {
  address: TaxCalculationAddress;
  currencyCode: string;
  customerId?: string | null;
}

export interface TaxCalculationItemLine extends TaxableItemReference {
  id: string;
  unitAmount: number;
  quantity: number;
}

export interface TaxCalculationShippingLine extends TaxableItemReference {
  id: string;
  amount: number;
}

export interface TaxCalculationRegion {
  countryRegion: TaxRegionDTO;
  provinceRegion: TaxRegionDTO | null;
  rates: TaxRateDTO[];
}

export interface TaxProviderInput {
  context: TaxCalculationContext;
  region: TaxCalculationRegion;
  itemLines: TaxCalculationItemLine[];
  shippingLines: TaxCalculationShippingLine[];
}

interface TaxLineBase {
  rate: number;
  name: string;
  code: string;
  providerId: string;
  taxRateId?: string | null;
  data?: Metadata;
}

export interface ItemTaxLine extends TaxLineBase {
  lineItemId: string;
}

export interface ShippingTaxLine extends TaxLineBase {
  shippingLineId: string;
}

export type TaxLine = ItemTaxLine | ShippingTaxLine;

export interface TaxProvider {
  readonly id: string;
  getTaxLines(input: TaxProviderInput): Promise<TaxLine[]>;
}
