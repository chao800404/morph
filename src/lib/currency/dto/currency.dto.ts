export interface CurrencyDTO {
  code: string;
  symbol: string;
  symbolNative: string;
  name: string;
  decimalDigits: number;
  rounding: number;
}

export interface StoreCurrencyDTO extends CurrencyDTO {
  isDefault: boolean;
  isTaxInclusive: boolean;
}

export interface StoreCurrencySettingsDTO {
  storeId: string;
  storeName: string;
  defaultSalesChannelId: string;
  salesChannels: Array<{ id: string; name: string }>;
  supportedCurrencies: StoreCurrencyDTO[];
}

export interface StoreAdminCurrencyDTO {
  id: string;
  currencyCode: string;
  storeId: string;
  isDefault: boolean;
  isTaxInclusive: boolean;
  currency: CurrencyDTO;
  createdAt: string;
  updatedAt: string;
}

export interface StoreAdminLocaleDTO {
  id: string;
  localeCode: string;
  storeId: string;
  isDefault: boolean;
  locale: { code: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface StoreAdminDTO {
  id: string;
  name: string;
  supportedCurrencies: StoreAdminCurrencyDTO[];
  defaultSalesChannelId: string | null;
  defaultRegionId: string | null;
  defaultLocationId: string | null;
  metadata: import("@/db/json").Metadata;
  createdAt: string;
  updatedAt: string;
  supportedLocales: StoreAdminLocaleDTO[];
}

export interface StoreAdminUpdateInput {
  name?: string;
  defaultSalesChannelId?: string;
  defaultRegionId?: string | null;
  defaultLocationId?: string | null;
  metadata?: import("@/db/json").Metadata | null;
  supportedCurrencies?: Array<{
    currencyCode: string;
    isDefault?: boolean;
    isTaxInclusive?: boolean;
  }>;
  supportedLocales?: Array<{
    localeCode: string;
    isDefault?: boolean;
  }>;
}
