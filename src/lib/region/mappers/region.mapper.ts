import { regionCountries, regions } from "@/db/region.schema";
import type { RegionCountryDTO, RegionDTO } from "../dto/region.dto";

export type RegionRow = typeof regions.$inferSelect;
export type RegionCountryRow = typeof regionCountries.$inferSelect;

export const toRegionDTO = (row: RegionRow): RegionDTO => ({
  id: row.id,
  name: row.name,
  currencyCode: row.currencyCode,
  automaticTaxes: row.automaticTaxes,
  isTaxInclusive: row.isTaxInclusive,
  metadata: row.metadata ?? {},
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
});

export const toRegionCountryDTO = (
  row: RegionCountryRow,
): RegionCountryDTO => ({
  iso2: row.iso2,
  name: row.name,
  displayName: row.displayName,
  iso3: row.iso3 ?? null,
  numCode: row.numCode ?? null,
  regionId: row.regionId ?? null,
});
