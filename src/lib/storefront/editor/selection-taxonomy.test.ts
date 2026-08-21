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
});
