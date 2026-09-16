import { describe, expect, it } from "vitest";
import { backfillRowIds } from "./backfill-row-ids";

/** Deterministic ids, so a test can state exactly what was written. */
function sequentialIds(prefix = "new") {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

describe("backfillRowIds", () => {
  it("gives every row an id and leaves the rest of the props alone", () => {
    const result = backfillRowIds(
      {
        storeName: "Online Store",
        navItems: [
          { label: "Shop", link: { href: "/collections/all" } },
          { label: "About", link: { href: "/pages/about" } },
        ],
        cartLabel: "Cart (0)",
      },
      sequentialIds(),
    );

    expect(result.changed).toBe(true);
    expect(result.assigned).toBe(2);
    expect(result.value).toEqual({
      storeName: "Online Store",
      navItems: [
        { label: "Shop", link: { href: "/collections/all" }, id: "new-1" },
        { label: "About", link: { href: "/pages/about" }, id: "new-2" },
      ],
      cartLabel: "Cart (0)",
    });
  });

  it("keeps ids that already exist", () => {
    const result = backfillRowIds(
      { navItems: [{ id: "morph-kept", label: "Shop" }, { label: "About" }] },
      sequentialIds(),
    );

    expect(result.assigned).toBe(1);
    expect(result.value).toEqual({
      navItems: [
        { id: "morph-kept", label: "Shop" },
        { label: "About", id: "new-1" },
      ],
    });
  });

  /**
   * The case that silently breaks React's matching without ever looking wrong
   * in the data: two rows claiming the same identity. The first keeps it, so a
   * row that already carries instance styles does not lose them.
   */
  it("re-issues a duplicate id rather than leaving two rows sharing one", () => {
    const result = backfillRowIds(
      {
        navItems: [
          { id: "same", label: "Shop" },
          { id: "same", label: "About" },
          { id: "same", label: "Journal" },
        ],
      },
      sequentialIds(),
    );

    expect(result.deduplicated).toBe(2);
    expect(result.value).toEqual({
      navItems: [
        { id: "same", label: "Shop" },
        { id: "new-1", label: "About" },
        { id: "new-2", label: "Journal" },
      ],
    });
  });

  it("treats each array separately, so two lists may share an id", () => {
    const result = backfillRowIds(
      {
        exploreItems: [{ id: "shared", label: "Shop all" }],
        helpItems: [{ id: "shared", label: "Contact" }],
      },
      sequentialIds(),
    );

    expect(result.changed).toBe(false);
  });

  it("is idempotent", () => {
    const first = backfillRowIds(
      { navItems: [{ label: "Shop" }, { label: "About" }] },
      sequentialIds("a"),
    );
    const second = backfillRowIds(first.value, sequentialIds("b"));

    expect(second.changed).toBe(false);
    expect(second.value).toBe(first.value);
  });

  it("returns the original reference when there is nothing to do", () => {
    const props = { navItems: [{ id: "one", label: "Shop" }] };
    const result = backfillRowIds(props, sequentialIds());

    expect(result.changed).toBe(false);
    expect(result.value).toBe(props);
  });

  it("preserves row order", () => {
    const result = backfillRowIds(
      { rows: [{ label: "a" }, { label: "b" }, { label: "c" }] },
      sequentialIds(),
    );

    expect(
      (result.value.rows as { label: string }[]).map((row) => row.label),
    ).toEqual(["a", "b", "c"]);
  });

  it("reaches rows nested inside other rows", () => {
    const result = backfillRowIds(
      { groups: [{ label: "Explore", links: [{ label: "Shop all" }] }] },
      sequentialIds(),
    );

    expect(result.assigned).toBe(2);
    expect(result.value).toEqual({
      groups: [
        { label: "Explore", links: [{ label: "Shop all", id: "new-1" }], id: "new-2" },
      ],
    });
  });

  it("leaves arrays that are not rows untouched", () => {
    const props = {
      tags: ["new", "sale"],
      sizes: [1, 2, 3],
      mixed: [{ label: "a" }, "b"],
      empty: [],
      link: { href: "/cart" },
    };

    expect(backfillRowIds(props, sequentialIds()).changed).toBe(false);
  });

  /** An id that is present but unusable is a missing id, not one to keep. */
  it("replaces an id that is blank or not a string", () => {
    const result = backfillRowIds(
      { rows: [{ id: "   " }, { id: 7 }, { id: null }] },
      sequentialIds(),
    );

    expect(result.assigned).toBe(3);
    expect(result.value).toEqual({
      rows: [{ id: "new-1" }, { id: "new-2" }, { id: "new-3" }],
    });
  });

  it("does not mutate the document it was given", () => {
    const props = { navItems: [{ label: "Shop" }] };
    backfillRowIds(props, sequentialIds());

    expect(props).toEqual({ navItems: [{ label: "Shop" }] });
  });
});
