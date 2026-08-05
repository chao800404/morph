import type { Metadata } from "@/db/json";

export interface RegionCountryDTO {
  iso2: string;
  name: string;
  displayName: string;
  /** Null until something authoritative supplies them — see the schema. */
  iso3: string | null;
  numCode: string | null;
  /** The region serving this country, or null if the store does not sell there. */
  regionId: string | null;
}

export interface RegionDTO {
  id: string;
  name: string;
  currencyCode: string;
  /** When true the region's tax rates apply without the author opting in. */
  automaticTaxes: boolean;
  /** Free-form store-defined data; never trusted to hold anything private. */
  metadata: Metadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegionDetailDTO extends RegionDTO {
  countries: RegionCountryDTO[];
}

export interface RegionSummaryDTO extends RegionDTO {
  countryCount: number;
}

export interface RegionInsertDTO {
  id: string;
  name: string;
  currencyCode: string;
  automaticTaxes?: boolean;
}

export interface UpdateRegionDTO {
  name?: string;
  currencyCode?: string;
  automaticTaxes?: boolean;
  metadata?: Metadata;
}
