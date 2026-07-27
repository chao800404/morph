export interface CurrencyDefinition {
  code: string;
  symbol: string;
  symbolNative: string;
  name: string;
  decimalDigits: number;
  rounding: number;
}

const FALLBACK_CURRENCY_CODES = [
  "AUD",
  "CAD",
  "CHF",
  "CNY",
  "EUR",
  "GBP",
  "HKD",
  "JPY",
  "KRW",
  "NZD",
  "SGD",
  "TWD",
  "USD",
] as const;

type CurrencyAwareIntl = typeof Intl & {
  supportedValuesOf?: (key: "currency") => string[];
};

const currencyCodes = (): string[] => {
  const supported = (Intl as CurrencyAwareIntl).supportedValuesOf?.("currency");
  return supported?.length ? supported : [...FALLBACK_CURRENCY_CODES];
};

const currencySymbol = (code: string, locale: string): string => {
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    currencyDisplay: "narrowSymbol",
  }).formatToParts(0);
  return parts.find((part) => part.type === "currency")?.value ?? code;
};

/**
 * Runtime-backed ISO-4217 catalogue.
 *
 * This avoids a second hand-maintained currency list. Cloudflare Workers and
 * modern browsers both use ICU data for names, symbols and minor-unit digits.
 */
export const getCurrencyCatalog = (): CurrencyDefinition[] => {
  const names = new Intl.DisplayNames(["en"], { type: "currency" });

  return currencyCodes()
    .map((upperCode) => {
      const code = upperCode.toLowerCase();
      const options = new Intl.NumberFormat("en", {
        style: "currency",
        currency: upperCode,
      }).resolvedOptions();

      return {
        code,
        symbol: currencySymbol(upperCode, "en"),
        symbolNative: currencySymbol(upperCode, "und"),
        name: names.of(upperCode) ?? upperCode,
        decimalDigits: options.maximumFractionDigits ?? 0,
        rounding: 0,
      };
    })
    .sort((left, right) => left.code.localeCompare(right.code));
};

export const findCurrency = (
  code: string,
  catalog = getCurrencyCatalog(),
): CurrencyDefinition | undefined =>
  catalog.find((currency) => currency.code === code.toLowerCase());

export const toMinorUnits = (
  value: string | number,
  currency: Pick<CurrencyDefinition, "decimalDigits">,
): number => {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 10 ** currency.decimalDigits);
};

export const toMajorUnits = (
  amount: number,
  currency: Pick<CurrencyDefinition, "decimalDigits">,
): number => amount / 10 ** currency.decimalDigits;

export const formatMoney = (
  amount: number,
  currency: Pick<CurrencyDefinition, "code" | "decimalDigits">,
  locale?: string,
): string =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.code.toUpperCase(),
    minimumFractionDigits: currency.decimalDigits,
    maximumFractionDigits: currency.decimalDigits,
  }).format(toMajorUnits(amount, currency));
