import { describe, expect, it } from "vitest";
import type { ProductOptionDTO } from "./dto/product-option.dto";
import type { ProductVariantDTO } from "./dto/product-variant.dto";
import {
  missingCombinations,
  variantsUsingOptions,
} from "./variant-table";

const option = (
  id: string,
  title: string,
  values: Array<[string, string]>,
): ProductOptionDTO =>
  ({
    id,
    title,
    values: values.map(([valueId, value]) => ({ id: valueId, value })),
  }) as ProductOptionDTO;

const variant = (id: string, optionValueIds: string[]): ProductVariantDTO =>
  ({ id, optionValueIds }) as ProductVariantDTO;

const SIZE = option("opt-size", "Size", [
  ["v-s", "S"],
  ["v-l", "L"],
]);
const COLOR = option("opt-color", "Color", [
  ["v-black", "Black"],
  ["v-white", "White"],
]);

describe("missingCombinations", () => {
  it("returns every cell when the product has no variants", () => {
    const missing = missingCombinations([SIZE, COLOR], []);

    expect(missing.map((row) => row.title)).toEqual([
      "S / Black",
      "S / White",
      "L / Black",
      "L / White",
    ]);
  });

  it("skips the cells that already have a variant", () => {
    const missing = missingCombinations(
      [SIZE, COLOR],
      [variant("v1", ["v-s", "v-black"])],
    );

    expect(missing.map((row) => row.title)).toEqual([
      "S / White",
      "L / Black",
      "L / White",
    ]);
  });

  it("matches a variant whose ids are in a different order", () => {
    // A variant stores its value ids without saying which axis each came from,
    // so comparing them as a list would report an existing cell as missing.
    const missing = missingCombinations(
      [SIZE, COLOR],
      [variant("v1", ["v-black", "v-s"])],
    );

    expect(missing.map((row) => row.title)).not.toContain("S / Black");
  });

  it("treats a variant from before a new axis as covering nothing", () => {
    // This is the case the feature exists for: `Color` was added later, so the
    // old size-only variant fills none of the new cells.
    const missing = missingCombinations(
      [SIZE, COLOR],
      [variant("v1", ["v-s"])],
    );

    expect(missing).toHaveLength(4);
  });

  it("carries the value ids the server needs", () => {
    const [first] = missingCombinations([SIZE, COLOR], []);

    expect(first.valueIds).toEqual(["v-s", "v-black"]);
    expect(first.key).toBe("v-s|v-black");
  });

  it("returns nothing rather than a matrix past the cap", () => {
    // Bailing before building it, so a careless option set cannot allocate the
    // whole product first.
    const big = option(
      "opt-big",
      "Big",
      Array.from({ length: 30 }, (_, i) => [`v${i}`, `V${i}`] as [string, string]),
    );

    expect(missingCombinations([big, big, big], [], 200)).toEqual([]);
  });

  it("ignores an axis with no values", () => {
    expect(missingCombinations([option("opt-empty", "Empty", [])], [])).toEqual(
      [],
    );
  });
});

describe("variantsUsingOptions", () => {
  it("finds the variants that would collapse", () => {
    const variants = [
      variant("v1", ["v-s", "v-black"]),
      variant("v2", ["v-l", "v-black"]),
    ];

    const doomed = variantsUsingOptions([SIZE, COLOR], variants, ["opt-size"]);

    expect(doomed.map((row) => row.id)).toEqual(["v1", "v2"]);
  });

  it("leaves variants that predate the removed axis alone", () => {
    // A variant added before Color exists holds no Color value, so removing
    // Color costs it nothing.
    const variants = [variant("v1", ["v-s"])];

    expect(variantsUsingOptions([SIZE, COLOR], variants, ["opt-color"])).toEqual(
      [],
    );
  });

  it("returns nothing when no axis is being removed", () => {
    const variants = [variant("v1", ["v-s", "v-black"])];

    expect(variantsUsingOptions([SIZE, COLOR], variants, [])).toEqual([]);
  });
});
