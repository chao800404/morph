import { describe, expect, it } from "vitest";
import {
  getCountryTaxSublevelType,
  getTaxSublevelLabel,
} from "./country-sublevels";

describe("country tax sublevels", () => {
  it("uses the matching administrative level for known countries", () => {
    expect(getCountryTaxSublevelType("US")).toBe("state");
    expect(getCountryTaxSublevelType("ca")).toBe("province");
    expect(getTaxSublevelLabel(getCountryTaxSublevelType("CH"))).toBe(
      "Cantons",
    );
  });

  it("requires an explicit reveal for countries outside the catalog", () => {
    expect(getCountryTaxSublevelType("TW")).toBeNull();
    expect(getTaxSublevelLabel(null)).toBe("Sublevel Regions");
  });
});
