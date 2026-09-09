import { describe, expect, it } from "vitest";
import {
  toStorableContentProps,
  toStorableContentValue,
} from "./content-write-value";

describe("content on its way to be stored", () => {
  it("drops a key whose value is undefined", () => {
    // A link normaliser filling in absent optional parts as `undefined` is
    // what reached the store, where the schema has no member for it.
    expect(
      toStorableContentProps({
        cartLink: { href: "/cart", title: undefined, nofollow: false },
      }),
    ).toEqual({ cartLink: { href: "/cart", nofollow: false } });
  });

  it("keeps null, which is a value the author chose", () => {
    expect(toStorableContentProps({ heading: null })).toEqual({
      heading: null,
    });
  });

  it("cleans every entry of a list", () => {
    expect(
      toStorableContentProps({
        items: [{ label: "Shop", link: { href: "/x", title: undefined } }],
      }),
    ).toEqual({ items: [{ label: "Shop", link: { href: "/x" } }] });
  });

  it("fills a hole rather than renumbering the entries after it", () => {
    const sparse: unknown[] = [];
    sparse[2] = { label: "Third" };

    expect(toStorableContentValue(sparse)).toEqual([
      null,
      null,
      { label: "Third" },
    ]);
  });

  it("leaves content that is already storable alone", () => {
    const props = { heading: "Hi", count: 2, on: true, items: ["a"] };

    expect(toStorableContentProps(props)).toEqual(props);
  });
});
