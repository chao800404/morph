import { describe, expect, it } from "vitest";
import { createSelectionStylePreview } from "./selection-style-preview";

describe("createSelectionStylePreview", () => {
  it("updates allowlisted inline styles and restores the original values", () => {
    const element = document.createElement("div");
    element.style.setProperty("padding-top", "8px", "important");
    const preview = createSelectionStylePreview();

    preview.apply(element, {
      "padding-top": "32px",
      "font-size": "48px",
      position: "fixed",
      width: "320px",
      height: "180px",
      opacity: "0.5",
      overflow: "hidden",
      color: "red",
    });

    expect(element.style.getPropertyValue("padding-top")).toBe("32px");
    expect(element.style.getPropertyPriority("padding-top")).toBe("");
    expect(element.style.getPropertyValue("font-size")).toBe("48px");
    expect(element.style.getPropertyValue("position")).toBe("fixed");
    expect(element.style.getPropertyValue("width")).toBe("320px");
    expect(element.style.getPropertyValue("height")).toBe("180px");
    expect(element.style.getPropertyValue("opacity")).toBe("0.5");
    expect(element.style.getPropertyValue("overflow")).toBe("hidden");
    expect(element.style.getPropertyValue("color")).toBe("");

    preview.restore();

    expect(element.style.getPropertyValue("padding-top")).toBe("8px");
    expect(element.style.getPropertyPriority("padding-top")).toBe("important");
    expect(element.style.getPropertyValue("font-size")).toBe("");
    expect(element.style.getPropertyValue("width")).toBe("");
    expect(element.style.getPropertyValue("height")).toBe("");
  });

  it("restores the previous target before previewing a new selection", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    const preview = createSelectionStylePreview();

    preview.apply(first, { padding: "24px" });
    preview.apply(second, { padding: "40px" });

    expect(first.style.padding).toBe("");
    expect(second.style.padding).toBe("40px");
  });
});
