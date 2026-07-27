import { describe, expect, it } from "vitest";
import {
  findCurrency,
  formatMoney,
  getCurrencyCatalog,
  toMinorUnits,
} from "./catalog";

describe("currency catalogue", () => {
  it("normalizes ISO currency codes and includes TWD", () => {
    const catalog = getCurrencyCatalog();
    const twd = findCurrency("TWD", catalog);

    expect(twd).toMatchObject({
      code: "twd",
      decimalDigits: 2,
    });
    expect(catalog.every((currency) => /^[a-z]{3}$/.test(currency.code))).toBe(
      true,
    );
  });

  it("converts major units using each currency's minor-unit digits", () => {
    expect(toMinorUnits("12.34", { decimalDigits: 2 })).toBe(1234);
    expect(toMinorUnits("1234", { decimalDigits: 0 })).toBe(1234);
  });

  it("formats stored minor units through Intl.NumberFormat", () => {
    expect(
      formatMoney(1234, { code: "usd", decimalDigits: 2 }, "en-US"),
    ).toBe("$12.34");
  });
});
