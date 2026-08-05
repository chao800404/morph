import { describe, expect, it } from "vitest";
import type { ProductOptionDTO } from "./dto/product-option.dto";
import type { ProductVariantDTO } from "./dto/product-variant.dto";
import {
  filterVariants,
  optionSortKey,
  paginateVariants,
  sortVariants,
  toVariantSortKey,
  variantOptionValue,
} from "./variant-table";

/** `rank` is the position given: it is the order the author arranged. */
const option = (
  id: string,
  title: string,
  values: Array<[string, string]>,
): ProductOptionDTO =>
  ({
    id,
    title,
    values: values.map(([valueId, value], rank) => ({
      id: valueId,
      value,
      rank,
    })),
  }) as ProductOptionDTO;

const variant = (
  id: string,
  title: string,
  sku: string | null,
  optionValueIds: string[],
): ProductVariantDTO =>
  ({ id, title, sku, optionValueIds }) as ProductVariantDTO;

const COLOR = option("opt-color", "Color", [
  ["v-black", "Black"],
  ["v-white", "White"],
]);
const SIZE = option("opt-size", "Size", [
  ["v-s", "S"],
  ["v-l", "L"],
]);

describe("variantOptionValue", () => {
  it("picks the value belonging to the option, not the first id", () => {
    // The variant's ids are a flat list across every axis, so an implementation
    // that took `optionValueIds[0]` would put Black in the Size column.
    const row = variant("var-1", "S / Black", "SHIRT-S-BLACK", [
      "v-s",
      "v-black",
    ]);

    expect(variantOptionValue(row, COLOR)).toBe("Black");
    expect(variantOptionValue(row, SIZE)).toBe("S");
  });

  it("returns null when the variant has no value on that axis", () => {
    // An option added to the product after this variant existed.
    const row = variant("var-1", "Black", null, ["v-black"]);

    expect(variantOptionValue(row, SIZE)).toBeNull();
  });
});

describe("filterVariants", () => {
  const rows = [
    variant("v1", "S / Black", "SHIRT-S-BLACK", ["v-s", "v-black"]),
    variant("v2", "L / White", "SHIRT-L-WHITE", ["v-l", "v-white"]),
  ];

  it("matches on the option value columns, not just title and SKU", () => {
    expect(filterVariants(rows, "white", [COLOR, SIZE]).map((r) => r.id)).toEqual(
      ["v2"],
    );
  });

  it("returns everything for a blank term", () => {
    expect(filterVariants(rows, "   ", [COLOR, SIZE])).toHaveLength(2);
    expect(filterVariants(rows, undefined, [COLOR, SIZE])).toHaveLength(2);
  });

  it("tolerates a null SKU", () => {
    const withoutSku = [variant("v3", "One size", null, [])];

    expect(filterVariants(withoutSku, "one", [])).toHaveLength(1);
  });
});

describe("paginateVariants", () => {
  const rows = Array.from({ length: 8 }, (_, index) =>
    variant(`v${index}`, `Variant ${index}`, null, []),
  );

  it("reports the counts the footer shows", () => {
    const { rows: page, pagination } = paginateVariants(rows, 1, 10);

    expect(page).toHaveLength(8);
    expect(pagination).toEqual({
      page: 1,
      limit: 10,
      total: 8,
      totalPages: 1,
    });
  });

  it("clamps a page past the end instead of showing nothing", () => {
    // Searching narrows the list while `?page` still points at the old page.
    const { rows: page, pagination } = paginateVariants(rows, 5, 5);

    expect(pagination.page).toBe(2);
    expect(page.map((row) => row.id)).toEqual(["v5", "v6", "v7"]);
  });

  it("still reports one page when there are no rows", () => {
    const { pagination } = paginateVariants([], 1, 10);

    expect(pagination).toEqual({ page: 1, limit: 10, total: 0, totalPages: 1 });
  });
});

describe("sortVariants", () => {
  const rows = [
    { id: "b", title: "S / White", createdAt: new Date("2026-01-02") },
    { id: "a", title: "l / black", createdAt: new Date("2026-01-01") },
    { id: "c", title: "M / Black", createdAt: new Date("2026-01-03") },
  ] as ProductVariantDTO[];

  it("sorts titles case-insensitively", () => {
    // A plain `<` comparison puts every capital before every lowercase, so
    // "l / black" would sort after "S / White".
    expect(
      sortVariants(rows, "name", "asc").map((row) => row.id),
    ).toEqual(["a", "c", "b"]);
  });

  it("sorts dates newest-first by default direction", () => {
    expect(
      sortVariants(rows, "createdAt", "desc").map((row) => row.id),
    ).toEqual(["c", "b", "a"]);
  });

  it("does not mutate the input", () => {
    const original = [...rows];
    sortVariants(rows, "name", "asc");

    expect(rows).toEqual(original);
  });
});

describe("sortVariants by an option axis", () => {
  // Declared S, M, L, XL — the order a wearer expects and the order the author
  // arranged in the option library.
  const WEAR = option("opt-wear", "Size", [
    ["v-s", "S"],
    ["v-m", "M"],
    ["v-l", "L"],
    ["v-xl", "XL"],
  ]);

  const rows = [
    variant("xl", "XL", null, ["v-xl"]),
    variant("s", "S", null, ["v-s"]),
    variant("l", "L", null, ["v-l"]),
    variant("m", "M", null, ["v-m"]),
  ];

  const ids = (list: ProductVariantDTO[]) => list.map((row) => row.id);

  it("orders by the axis's own rank, not alphabetically", () => {
    // This is the whole point. Comparing the values as strings gives
    // L, M, S, XL — an order nobody asked for, and the one a naive
    // `localeCompare` on the column text would produce.
    expect(
      ids(sortVariants(rows, optionSortKey("opt-wear"), "asc", [WEAR])),
    ).toEqual(["s", "m", "l", "xl"]);
  });

  it("reverses on desc", () => {
    expect(
      ids(sortVariants(rows, optionSortKey("opt-wear"), "desc", [WEAR])),
    ).toEqual(["xl", "l", "m", "s"]);
  });

  it("puts variants with no value on the axis last in both directions", () => {
    // A variant added before this axis existed holds no value on it. Folding it
    // in with the direction would hide it at the top on one click, and it is
    // exactly the row that needs filling in.
    const withGap = [...rows, variant("none", "Legacy", null, [])];

    expect(ids(sortVariants(withGap, optionSortKey("opt-wear"), "asc", [WEAR])).at(-1)).toBe("none");
    expect(ids(sortVariants(withGap, optionSortKey("opt-wear"), "desc", [WEAR])).at(-1)).toBe("none");
  });

  it("leaves the order alone when the axis is gone", () => {
    // A bookmarked `?sortBy` outlives the option it names. Inventing an order
    // would be worse than keeping the one already on screen.
    expect(ids(sortVariants(rows, optionSortKey("opt-removed"), "asc", [WEAR]))).toEqual(
      ids(rows),
    );
  });

  it("does not mutate the input", () => {
    const original = ids(rows);
    sortVariants(rows, optionSortKey("opt-wear"), "asc", [WEAR]);

    expect(ids(rows)).toEqual(original);
  });
});

describe("toVariantSortKey", () => {
  const OPTIONS = [SIZE, COLOR];

  it("keeps the fixed keys", () => {
    expect(toVariantSortKey("name", OPTIONS)).toBe("name");
    expect(toVariantSortKey("updatedAt", OPTIONS)).toBe("updatedAt");
  });

  it("accepts an axis the product actually has", () => {
    expect(toVariantSortKey("option:opt-size", OPTIONS)).toBe("option:opt-size");
  });

  it("falls back when the axis is not on this product", () => {
    // The same URL opened on a different product, or after the axis was
    // removed. Sorting by nothing would look like the control is broken.
    expect(toVariantSortKey("option:opt-gone", OPTIONS)).toBe("createdAt");
  });

  it("falls back for anything else", () => {
    expect(toVariantSortKey("size", OPTIONS)).toBe("createdAt");
    expect(toVariantSortKey("option:", OPTIONS)).toBe("createdAt");
    expect(toVariantSortKey(undefined, OPTIONS)).toBe("createdAt");
    expect(toVariantSortKey(["name"], OPTIONS)).toBe("createdAt");
  });
});
