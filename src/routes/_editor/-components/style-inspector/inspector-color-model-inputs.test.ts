import { describe, expect, it } from "vitest";

import {
  convertInspectorHslaToRgba,
  convertInspectorRgbaToHsla,
  formatInspectorHexa,
  formatInspectorRgba,
  parseInspectorRgba,
} from "./inspector-color-model-inputs";

describe("InspectorColorModelInputs color conversion", () => {
  it("parses hex alpha into RGB channels", () => {
    expect(parseInspectorRgba("#bd464680")).toEqual({
      r: 189,
      g: 70,
      b: 70,
      a: 50,
    });
  });

  it("formats RGB channels for preview and HEX mode", () => {
    const channels = { r: 189, g: 70, b: 70, a: 100 };
    expect(formatInspectorRgba(channels)).toBe("rgba(189,70,70,1)");
    expect(formatInspectorHexa(channels)).toBe("#BD4646FF");
  });

  it("converts RGB channels to HSL", () => {
    expect(convertInspectorRgbaToHsla({ r: 189, g: 70, b: 70, a: 75 })).toEqual(
      { h: 0, s: 47, l: 51, a: 75 },
    );
  });

  it("converts HSL channels back to RGB", () => {
    expect(convertInspectorHslaToRgba({ h: 210, s: 50, l: 40, a: 60 })).toEqual(
      { r: 51, g: 102, b: 153, a: 60 },
    );
  });
});
