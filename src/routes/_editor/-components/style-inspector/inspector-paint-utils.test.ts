import { describe, expect, it } from "vitest";

import {
  paintPreviewStyles,
  parseTailwindBackgroundPaint,
  parseTailwindTextGradient,
  patchTailwindTextPaint,
  textPaintPreviewStyles,
  toBackgroundPaintUtility,
  toBorderColorUtility,
  toTextColorUtility,
} from "./inspector-paint-utils";

describe("inspector-paint-utils", () => {
  it("round-trips gradient paints through a Tailwind arbitrary utility", () => {
    const gradient =
      "linear-gradient(90deg, rgba(28,25,23,1) 0%, rgba(216,208,195,1) 100%)";
    const utility = toBackgroundPaintUtility(gradient);

    expect(utility).toBe(
      "bg-[linear-gradient(90deg,_rgba(28,25,23,1)_0%,_rgba(216,208,195,1)_100%)]",
    );
    expect(parseTailwindBackgroundPaint(`relative ${utility} px-4`)).toBe(
      gradient,
    );
  });

  it("normalizes solid colors without allowing text gradients", () => {
    expect(toTextColorUtility("rgba(28, 25, 23, 0.8)")).toBe(
      "text-[rgba(28,25,23,0.8)]",
    );
    expect(toBorderColorUtility("rgba(28, 25, 23, 0.8)")).toBe(
      "border-[rgba(28,25,23,0.8)]",
    );
    expect(parseTailwindBackgroundPaint("bg-[url(/hero.png)]")).toBeNull();
  });

  it("switches preview properties between solid and gradient paint", () => {
    expect(paintPreviewStyles("#d8d0c3")).toEqual({
      "background-color": "#d8d0c3",
      "background-image": "none",
    });
    expect(
      paintPreviewStyles("radial-gradient(circle, #fafaf9 0%, #1c1917 100%)"),
    ).toEqual({
      "background-color": "",
      "background-image": "radial-gradient(circle, #fafaf9 0%, #1c1917 100%)",
    });
  });

  it("persists and removes text gradients as one paint operation", () => {
    const gradient =
      "linear-gradient(90deg, rgba(28,25,23,1) 0%, rgba(216,208,195,1) 100%)";
    const gradientClasses = patchTailwindTextPaint(
      "font-serif text-stone-900 text-[48px]",
      gradient,
    );

    expect(gradientClasses).toContain("text-transparent");
    expect(gradientClasses).toContain("bg-clip-text");
    expect(parseTailwindTextGradient(gradientClasses)).toBe(gradient);

    const solidClasses = patchTailwindTextPaint(gradientClasses, "#1c1917");
    expect(solidClasses).toContain("text-[#1c1917]");
    expect(solidClasses).not.toContain("text-transparent");
    expect(solidClasses).not.toContain("bg-clip-text");
    expect(parseTailwindTextGradient(solidClasses)).toBeNull();
  });

  it("previews text gradients without changing the confirmed class list", () => {
    const gradient = "linear-gradient(90deg, #1c1917 0%, #d8d0c3 100%)";
    expect(textPaintPreviewStyles(gradient, "#1c1917")).toEqual({
      color: "transparent",
      "background-image": gradient,
      "background-clip": "text",
      "-webkit-background-clip": "text",
    });
    expect(textPaintPreviewStyles("#fafaf9", gradient)).toEqual({
      color: "#fafaf9",
      "background-image": "none",
      "background-clip": "border-box",
      "-webkit-background-clip": "border-box",
    });
  });
});
