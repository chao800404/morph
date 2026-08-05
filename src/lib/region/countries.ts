export interface CountryDefinition {
  /** ISO 3166-1 alpha-2, lowercase. */
  iso2: string;
  /** Localised name, e.g. "Taiwan". */
  name: string;
  /** Upper-case name for display in a list of codes, e.g. "TAIWAN". */
  displayName: string;
}

/**
 * Runtime-backed ISO 3166-1 catalogue.
 *
 * The same approach `currency/catalog.ts` takes, for the same reason: a
 * hand-maintained list of 250 countries is a second source of truth that goes
 * stale and can carry a typo into a customs field.
 *
 * ICU has no "list all regions" API — `Intl.supportedValuesOf` covers
 * calendars, currencies, time zones and a few others, but not regions. So the
 * codes are discovered instead: ask `Intl.DisplayNames` for every two-letter
 * combination and keep the ones it recognises. An unknown code comes back
 * unchanged (with `fallback: "code"`), which is exactly the signal needed.
 *
 * 676 lookups sounds wasteful and is not: it runs once per isolate and the
 * result is cached below. Doing it lazily matters more than doing it cheaply —
 * on Workers this must not run at module scope.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Codes ICU resolves but which are not countries.
 *
 * `EU`/`EZ`/`UN` are organisations and `QO`/`XA`/`XB`/`ZZ` are ICU's own
 * placeholders. They would otherwise appear in the picker as shippable
 * destinations.
 */
const NON_COUNTRIES = new Set(["EU", "EZ", "UN", "QO", "XA", "XB", "ZZ"]);

let cache: CountryDefinition[] | null = null;

export const getCountryCatalog = (
  locale = "en",
): CountryDefinition[] => {
  if (cache) return cache;

  const names = new Intl.DisplayNames([locale], {
    type: "region",
    fallback: "code",
  });

  const countries: CountryDefinition[] = [];
  for (const first of ALPHABET) {
    for (const second of ALPHABET) {
      const code = `${first}${second}`;
      if (NON_COUNTRIES.has(code)) continue;

      const name = names.of(code);
      // `fallback: "code"` returns the input untouched for an unknown region,
      // so an unchanged value means ICU does not know this code.
      if (!name || name === code) continue;

      countries.push({
        iso2: code.toLowerCase(),
        name,
        displayName: name.toUpperCase(),
      });
    }
  }

  countries.sort((a, b) => a.name.localeCompare(b.name, locale));
  cache = countries;
  return countries;
};

/** Test seam — the cache is per-isolate and would leak between cases. */
export const resetCountryCatalog = (): void => {
  cache = null;
};

export const findCountry = (iso2: string): CountryDefinition | undefined =>
  getCountryCatalog().find(
    (country) => country.iso2 === iso2.trim().toLowerCase(),
  );
