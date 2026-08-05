import { beforeEach, describe, expect, it } from "vitest";
import {
  findCountry,
  getCountryCatalog,
  resetCountryCatalog,
} from "./countries";

describe("getCountryCatalog", () => {
  beforeEach(() => {
    resetCountryCatalog();
  });

  it("discovers real countries from the runtime", () => {
    const codes = getCountryCatalog().map((country) => country.iso2);

    expect(codes).toContain("tw");
    expect(codes).toContain("us");
    expect(codes).toContain("de");
    // If the discovery loop broke, this would be 676 or 0 rather than ~250.
    expect(codes.length).toBeGreaterThan(200);
    expect(codes.length).toBeLessThan(300);
  });

  it("drops the codes ICU resolves that are not countries", () => {
    // `EU` has a display name ("European Union") and would otherwise look like
    // a shippable destination in the picker.
    const codes = getCountryCatalog().map((country) => country.iso2);

    expect(codes).not.toContain("eu");
    expect(codes).not.toContain("un");
    expect(codes).not.toContain("zz");
  });

  it("drops codes the runtime does not recognise", () => {
    // `QQ` is unassigned; with `fallback: "code"` ICU echoes it back, and
    // without the equality check every one of the 676 pairs would be kept.
    expect(findCountry("qq")).toBeUndefined();
  });

  it("sorts by name so the picker reads alphabetically", () => {
    const names = getCountryCatalog().map((country) => country.name);

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("stores codes lowercase, matching the schema's check constraint", () => {
    for (const country of getCountryCatalog()) {
      expect(country.iso2).toBe(country.iso2.toLowerCase());
      expect(country.iso2).toHaveLength(2);
    }
  });

  it("finds a country regardless of the case it is asked for", () => {
    expect(findCountry("TW")?.iso2).toBe("tw");
    expect(findCountry(" tw ")?.iso2).toBe("tw");
  });
});
