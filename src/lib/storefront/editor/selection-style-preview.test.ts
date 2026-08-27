// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createSelectionStylePreview } from "./selection-style-preview";

function element(inline = "") {
  const node = document.createElement("div");
  if (inline) node.setAttribute("style", inline);
  document.body.appendChild(node);
  return node;
}

describe("selection style preview", () => {
  it("carries the previewed value onto the element a re-render produced", () => {
    // Dropping it in the same frame exposes the old value until the generated
    // rule for the new class exists, so one edit appears to move twice.
    const preview = createSelectionStylePreview();
    preview.apply(element(), { "font-size": "24px" });

    const rerendered = element();
    preview.carryTo(rerendered);

    expect(rerendered.style.getPropertyValue("font-size")).toBe("24px");
  });

  it("forgets the previewed value when cleared", () => {
    // The remembered styles and the applied ones have to die together. When
    // they did not, reversing an edit re-applied the value it had just removed
    // on the very next re-render — which read as "undo does nothing".
    const preview = createSelectionStylePreview();
    preview.apply(element(), { "font-size": "24px" });

    preview.clear();
    const rerendered = element();
    preview.carryTo(rerendered);

    expect(preview.hasPending()).toBe(false);
    expect(rerendered.style.getPropertyValue("font-size")).toBe("");
  });



  it("copies the computed appearance onto the element as inline styles", () => {
    // The generated stylesheet lands after the DOM already carries the new
    // class, so between the two the element has a class no rule matches and
    // falls back to its unstyled size. An edit applied without a live drag —
    // reversing one, for instance — shows that as a visible jump. Pinning means
    // taking what is currently computed and writing it inline, so the value
    // survives the gap.
    const node = element();
    expect(node.getAttribute("style")).toBeNull();
    const preview = createSelectionStylePreview();

    preview.holdCurrentStyles(node);

    // Copied from the computed style, not from an inline value that was
    // already there.
    expect(node.style.getPropertyValue("display")).not.toBe("");
    // Recorded as pending, because the edit replaces the element: styles left
    // on the old node would vanish with it, which is the gap this covers.
    expect(preview.hasPending()).toBe(true);
  });

  it("carries the pinned appearance onto the element the edit produced", () => {
    // The edit that follows re-renders the component, so the node holding the
    // pin is discarded. Without carrying it, the replacement starts unstyled
    // and the value visibly drops before the new stylesheet arrives.
    const preview = createSelectionStylePreview();
    preview.holdCurrentStyles(element());

    const rerendered = element();
    preview.carryTo(rerendered);

    expect(rerendered.style.getPropertyValue("display")).not.toBe("");
  });

  it("removes the pin again so the class takes over", () => {
    const node = element();
    const preview = createSelectionStylePreview();
    preview.holdCurrentStyles(node);
    expect(node.style.getPropertyValue("display")).not.toBe("");

    preview.clear();

    expect(node.style.getPropertyValue("display")).toBe("");
  });

  it("puts back the inline value the element started with", () => {
    const node = element("font-size: 12px");
    const preview = createSelectionStylePreview();

    preview.apply(node, { "font-size": "24px" });
    expect(node.style.getPropertyValue("font-size")).toBe("24px");

    preview.clear();
    expect(node.style.getPropertyValue("font-size")).toBe("12px");
  });

  it("accumulates several properties across separate previews", () => {
    const preview = createSelectionStylePreview();
    const node = element();

    preview.apply(node, { "font-size": "24px" });
    preview.apply(node, { padding: "16px" });

    const rerendered = element();
    preview.carryTo(rerendered);
    expect(rerendered.style.getPropertyValue("font-size")).toBe("24px");
    expect(rerendered.style.getPropertyValue("padding")).toBe("16px");
  });

  it("ignores properties outside the previewable set", () => {
    const preview = createSelectionStylePreview();
    const node = element();

    preview.apply(node, { "font-size": "24px", content: "'x'" });

    expect(node.style.getPropertyValue("content")).toBe("");
    expect(node.style.getPropertyValue("font-size")).toBe("24px");
  });

  it("does nothing when there is nothing to carry", () => {
    const preview = createSelectionStylePreview();
    const node = element();

    preview.carryTo(node);

    expect(node.getAttribute("style")).toBeNull();
  });
});
