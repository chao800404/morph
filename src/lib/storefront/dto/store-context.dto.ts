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
/** Catalog browsing is available before a pricing/checkout region is configured. */
export type StoreCatalogContextDTO = Omit<
  StoreContextDTO,
  "regionId" | "currencyCode"
> & {
  regionId: string | null;
  currencyCode: string | null;
};
