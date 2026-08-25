import { describe, expect, it } from "vitest";
import {
  buildSpacingOverlayStrips,
  cssPixelValue,
  formatSpacingOverlayValue,
  isPreviewSpacingOverlayMode,
} from "./spacing-overlay";

const metrics = {
  margin: { top: 12, right: 0, bottom: -8, left: 16 },
  padding: { top: 10, right: 20, bottom: 30, left: 40 },
  border: { top: 2, right: 2, bottom: 2, left: 2 },
} as const;

describe("spacing overlay", () => {
  it("maps positive margins outside and negative margins inside the border box", () => {
    const strips = buildSpacingOverlayStrips(
      { left: 100, top: 200, width: 300, height: 180 },
      metrics,
    );

    expect(
      strips.find((strip) => strip.kind === "margin" && strip.side === "top"),
    ).toMatchObject({
      value: 12,
      negative: false,
      rect: { left: 100, top: 188, width: 300, height: 12 },
    });
    expect(
      strips.find(
        (strip) => strip.kind === "margin" && strip.side === "bottom",
      ),
    ).toMatchObject({
      value: -8,
      negative: true,
      rect: { left: 100, top: 372, width: 300, height: 8 },
    });
  });

  it("places padding inside the element borders", () => {
    const strips = buildSpacingOverlayStrips(
      { left: 100, top: 200, width: 300, height: 180 },
      metrics,
    );

    expect(
      strips.find((strip) => strip.kind === "padding" && strip.side === "top"),
    ).toMatchObject({
      value: 10,
      rect: { left: 102, top: 202, width: 296, height: 10 },
    });
    expect(
      strips.find((strip) => strip.kind === "padding" && strip.side === "left"),
    ).toMatchObject({
      value: 40,
      rect: { left: 102, top: 212, width: 40, height: 136 },
    });
  });

  it("keeps mode and display parsing bounded", () => {
    expect(isPreviewSpacingOverlayMode("selected")).toBe(true);
    expect(isPreviewSpacingOverlayMode("everything")).toBe(false);
    expect(cssPixelValue("-12.5px")).toBe(-12.5);
    expect(cssPixelValue("auto")).toBe(0);
    expect(formatSpacingOverlayValue(12.04)).toBe("12");
    expect(formatSpacingOverlayValue(12.06)).toBe("12.1");
  });
});
