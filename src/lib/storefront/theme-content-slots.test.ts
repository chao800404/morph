import { describe, expect, it } from "vitest";
import {
  isValidThemeContentSlotId,
  resolveThemeContentSlot,
} from "./theme-content-slots";

describe("isValidThemeContentSlotId", () => {
  it("accepts plain identifier-shaped ids", () => {
    for (const id of ["hero", "promo-2", "editorial_intro", "A1"]) {
      expect(isValidThemeContentSlotId(id), id).toBe(true);
    }
  });

  it("refuses anything that would need escaping at a use site", () => {
    // Slot ids reach storage keys and DOM attributes.
    for (const id of [
      "",
      "-leading",
      "has space",
      "has/slash",
      "has.dot",
      'quote"',
      "<script>",
      "a".repeat(65),
      null,
      42,
      {},
    ]) {
      expect(isValidThemeContentSlotId(id), String(id)).toBe(false);
    }
  });
});

describe("resolveThemeContentSlot", () => {
  const slots = { hero: { heading: "Hi" } };

  it("returns the stored values for a declared slot", () => {
    expect(resolveThemeContentSlot(slots, "hero")).toEqual({ heading: "Hi" });
  });

  it("returns empty for a slot with no authored content yet", () => {
    // A route may declare a slot before anything is written for it; the
    // component's own prop defaults are the correct result.
    expect(resolveThemeContentSlot(slots, "promo")).toEqual({});
    expect(resolveThemeContentSlot(undefined, "hero")).toEqual({});
  });

  it("refuses an invalid id instead of reading an arbitrary key", () => {
    expect(resolveThemeContentSlot(slots, "__proto__")).toEqual({});
    expect(resolveThemeContentSlot(slots, "has space")).toEqual({});
  });

  it("ignores a stored value that is not an object", () => {
    expect(
      resolveThemeContentSlot({ hero: "oops" as never }, "hero"),
    ).toEqual({});
    expect(resolveThemeContentSlot({ hero: [] as never }, "hero")).toEqual({});
  });
});
