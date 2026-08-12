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
