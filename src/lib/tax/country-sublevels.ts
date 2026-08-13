export const TAX_SUBLEVEL_TYPES = [
  "canton",
  "county",
  "department",
  "district",
  "emirate",
  "governorate",
  "prefecture",
  "province",
  "region",
  "state",
  "stateOrTerritory",
] as const;

export type TaxSublevelType = (typeof TAX_SUBLEVEL_TYPES)[number];

const countryTaxSublevels: Readonly<Record<string, TaxSublevelType>> = {
  AE: "emirate",
  AR: "province",
  AU: "stateOrTerritory",
  BR: "state",
  CA: "province",
  CH: "canton",
  CL: "region",
  CN: "province",
  CO: "province",
  CR: "province",
  EG: "governorate",
  ES: "province",
  GT: "department",
  HK: "region",
  IE: "county",
  IN: "state",
  IT: "province",
  JP: "prefecture",
  KR: "province",
  KW: "governorate",
  MX: "state",
  MY: "stateOrTerritory",
  NG: "state",
  NZ: "region",
  PA: "province",
  PE: "province",
  PH: "region",
  PT: "district",
  RO: "county",
  RU: "region",
  TH: "province",
  US: "state",
  UY: "department",
  VE: "state",
  ZA: "province",
};

const taxSublevelLabels: Readonly<Record<TaxSublevelType, string>> = {
  canton: "Cantons",
  county: "Counties",
  department: "Departments",
  district: "Districts",
  emirate: "Emirates",
  governorate: "Governorates",
  prefecture: "Prefectures",
  province: "Provinces",
  region: "Regions",
  state: "States",
  stateOrTerritory: "States and Territories",
};

export function getCountryTaxSublevelType(
  countryCode: string | null | undefined,
): TaxSublevelType | null {
  if (!countryCode) return null;

  return countryTaxSublevels[countryCode.toUpperCase()] ?? null;
}

export function getTaxSublevelLabel(type: TaxSublevelType | null): string {
  return type ? taxSublevelLabels[type] : "Sublevel Regions";
}
