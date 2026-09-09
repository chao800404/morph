import { describe, expect, it } from "vitest";
import {
  capabilitiesForSelection,
  getFieldPathValue,
  selectionKindFromElement,
  setFieldPathValue,
} from "./selection-taxonomy";

describe("selection taxonomy", () => {
  it("prefers explicit component metadata and falls back to semantics", () => {
    expect(selectionKindFromElement({ component: "image", tagName: "div" })).toBe("image");
    expect(selectionKindFromElement({ tagName: "h2" })).toBe("heading");
    expect(selectionKindFromElement({ tagName: "input", inputType: "checkbox" })).toBe("checkbox");
    expect(selectionKindFromElement({ tagName: "a", role: "link" })).toBe("link");
    expect(selectionKindFromElement({ tagName: "div", role: "img" })).toBe("image");
    expect(selectionKindFromElement({ tagName: "div", role: "textbox" })).toBe("input");
    expect(selectionKindFromElement({ tagName: "textarea", role: "textbox" })).toBe("textarea");
  });

  it("exposes capabilities by selected kind", () => {
    expect(capabilitiesForSelection("image").media).toBe(true);
    expect(capabilitiesForSelection("image").typography).toBe(false);
    expect(capabilitiesForSelection("heading").typography).toBe(true);
    expect(capabilitiesForSelection("section", true).content).toBe(true);
  });

  it("updates one nested repeater path immutably", () => {
    const source = { items: [{ title: "One" }, { title: "Two" }] };
    const next = setFieldPathValue(source, "items.1.title", "Updated");
    expect(getFieldPathValue(next, "items.1.title")).toBe("Updated");
    expect(getFieldPathValue(next, "items.0.title")).toBe("One");
    expect(source.items[1].title).toBe("Two");
  });

  it("creates a list, not a record, for a numeric segment", () => {
    // A repeated field with no stored value has nothing to clone from. Making
    // an object produced `{"0": …}`, which the server refuses as not matching
    // a list — the only way to reach it was editing a row of a field whose
    // entries were still coming from the component's own defaults.
    expect(setFieldPathValue({}, "items.0.label", "Shop")).toEqual({
      items: [{ label: "Shop" }],
    });
  });

  it("keeps writing into an existing list as a list", () => {
    expect(
      setFieldPathValue({ items: [{ label: "a" }, { label: "b" }] }, "items.1.label", "c"),
    ).toEqual({ items: [{ label: "a" }, { label: "c" }] });
  });

  it("still creates a record for a named segment", () => {
    expect(setFieldPathValue({}, "link.href", "/cart")).toEqual({
      link: { href: "/cart" },
    });
  });
});
