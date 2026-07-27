import {
  getStoreCurrencySettings,
  listAvailableCurrencies,
} from "@/server/currency/currencies.serverFn";
import { queryOptions } from "@tanstack/react-query";

export const currencyQueries = {
  all: () => ["currencies"] as const,
  store: () =>
    queryOptions({
      queryKey: [...currencyQueries.all(), "store"],
      queryFn: () => getStoreCurrencySettings(),
    }),
  available: (query = "") =>
    queryOptions({
      queryKey: [...currencyQueries.all(), "available", query],
      queryFn: () => listAvailableCurrencies({ data: { query } }),
    }),
};
