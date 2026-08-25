import { describe, expect, it } from "vitest";
import {
  createSelectionStylePreview,
  selectionStylePreviewNeedsOverlayUpdate,
} from "./selection-style-preview";

describe("createSelectionStylePreview", () => {
  it("updates allowlisted inline styles and restores the original values", () => {
    const element = document.createElement("div");
    element.style.setProperty("padding-top", "8px", "important");
    const preview = createSelectionStylePreview();

    preview.apply(element, {
      "padding-top": "32px",
      "font-size": "48px",
      "border-width": "3px",
      "border-style": "dashed",
      "border-color": "#d8d0c3",
      "border-radius": "12px",
      "border-top-left-radius": "24px",
      "border-top-right-radius": "20px",
      "border-bottom-right-radius": "16px",
      "border-bottom-left-radius": "8px",
      position: "fixed",
      width: "320px",
      height: "180px",
      opacity: "0.5",
      overflow: "hidden",
      color: "red",
      "background-image": "linear-gradient(90deg, red, blue)",
      "background-clip": "text",
      "-webkit-background-clip": "text",
    });

    expect(element.style.getPropertyValue("padding-top")).toBe("32px");
    expect(element.style.getPropertyPriority("padding-top")).toBe("");
    expect(element.style.getPropertyValue("font-size")).toBe("48px");
    expect(element.style.getPropertyValue("border-width")).toBe("3px");
    expect(element.style.getPropertyValue("border-style")).toBe("dashed");
    expect(element.style.getPropertyValue("border-color")).toBe(
      "rgb(216, 208, 195)",
    );
    expect(element.style.getPropertyValue("border-radius")).toBe("12px");
    expect(element.style.getPropertyValue("border-top-left-radius")).toBe(
      "24px",
    );
    expect(element.style.getPropertyValue("border-top-right-radius")).toBe(
      "20px",
    );
    expect(element.style.getPropertyValue("border-bottom-right-radius")).toBe(
      "16px",
    );
    expect(element.style.getPropertyValue("border-bottom-left-radius")).toBe(
      "8px",
    );
    expect(element.style.getPropertyValue("position")).toBe("fixed");
    expect(element.style.getPropertyValue("width")).toBe("320px");
    expect(element.style.getPropertyValue("height")).toBe("180px");
    expect(element.style.getPropertyValue("opacity")).toBe("0.5");
    expect(element.style.getPropertyValue("overflow")).toBe("hidden");
    expect(element.style.getPropertyValue("color")).toBe("red");
    expect(element.style.getPropertyValue("background-image")).toBe(
      "linear-gradient(90deg, red, blue)",
    );
    expect(element.style.getPropertyValue("background-clip")).toBe("text");

    preview.apply(element, { color: "" });
    expect(element.style.getPropertyValue("color")).toBe("");

    preview.restore();

    expect(element.style.getPropertyValue("padding-top")).toBe("8px");
    expect(element.style.getPropertyPriority("padding-top")).toBe("important");
    expect(element.style.getPropertyValue("font-size")).toBe("");
    expect(element.style.getPropertyValue("width")).toBe("");
    expect(element.style.getPropertyValue("height")).toBe("");
    expect(element.style.getPropertyValue("background-image")).toBe("");
    expect(element.style.getPropertyValue("background-clip")).toBe("");
  });

  it("previews each Border side immediately and restores the original widths", () => {
    const element = document.createElement("div");
    element.style.setProperty("border-top-width", "1px", "important");
    const preview = createSelectionStylePreview();

    preview.apply(element, {
      "border-top-width": "4px",
      "border-bottom-width": "5px",
      "border-left-width": "6px",
      "border-right-width": "7px",
    });

    expect(element.style.getPropertyValue("border-top-width")).toBe("4px");
    expect(element.style.getPropertyPriority("border-top-width")).toBe("");
    expect(element.style.getPropertyValue("border-bottom-width")).toBe("5px");
    expect(element.style.getPropertyValue("border-left-width")).toBe("6px");
    expect(element.style.getPropertyValue("border-right-width")).toBe("7px");
    expect(
      selectionStylePreviewNeedsOverlayUpdate({
        "border-left-width": "6px",
      }),
    ).toBe(true);

    preview.restore();

    expect(element.style.getPropertyValue("border-top-width")).toBe("1px");
    expect(element.style.getPropertyPriority("border-top-width")).toBe(
      "important",
    );
    expect(element.style.getPropertyValue("border-bottom-width")).toBe("");
    expect(element.style.getPropertyValue("border-left-width")).toBe("");
    expect(element.style.getPropertyValue("border-right-width")).toBe("");
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

  it("previews Margin values immediately and restores the original styles", () => {
    const element = document.createElement("div");
    element.style.setProperty("margin-top", "6px", "important");
    const preview = createSelectionStylePreview();

    preview.apply(element, {
      "margin-top": "24px",
      "margin-bottom": "-8px",
      "margin-left": "auto",
      "margin-right": "auto",
    });

    expect(element.style.getPropertyValue("margin-top")).toBe("24px");
    expect(element.style.getPropertyPriority("margin-top")).toBe("");
    expect(element.style.getPropertyValue("margin-bottom")).toBe("-8px");
    expect(element.style.getPropertyValue("margin-left")).toBe("auto");
    expect(element.style.getPropertyValue("margin-right")).toBe("auto");
    expect(
      selectionStylePreviewNeedsOverlayUpdate({ "margin-top": "24px" }),
    ).toBe(true);

    preview.restore();

    expect(element.style.getPropertyValue("margin-top")).toBe("6px");
    expect(element.style.getPropertyPriority("margin-top")).toBe("important");
    expect(element.style.getPropertyValue("margin-bottom")).toBe("");
    expect(element.style.getPropertyValue("margin-left")).toBe("");
    expect(element.style.getPropertyValue("margin-right")).toBe("");
  });

  it("does not remeasure overlays for paint-only previews", () => {
    expect(
      selectionStylePreviewNeedsOverlayUpdate({
        color: "#fafaf9",
        "border-color": "#d8d0c3",
        "background-image": "linear-gradient(90deg, red, blue)",
        "background-clip": "text",
      }),
    ).toBe(false);
    expect(selectionStylePreviewNeedsOverlayUpdate({ width: "320px" })).toBe(
      true,
    );
  });
});
