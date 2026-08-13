export interface StoreContextDTO {
  storeId: string;
  storefrontId: string | null;
  salesChannelId: string;
  regionId: string;
  currencyCode: string;
  automaticTaxes: boolean;
  isTaxInclusive: boolean;
  countryCode: string | null;
  localeCode: string | null;
}
