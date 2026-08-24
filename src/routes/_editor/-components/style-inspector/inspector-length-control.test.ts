import { describe, expect, it } from "vitest";

import {
  inspectorLengthUtility,
  resolveInspectorLength,
} from "./inspector-length-control";

describe("Inspector length controls", () => {
  it("preserves source units and resolves the active responsive variant", () => {
    expect(
      resolveInspectorLength({
        className: "p-[1.5rem] md:p-[12%]",
        sources: [{ property: "padding", prefix: "p" }],
        targetVariants: ["md"],
        computedValue: "48px",
      }),
    ).toEqual({ unit: "%", value: 12 });

    expect(
      resolveInspectorLength({
        className: "rounded-[2em]",
        sources: [{ property: "border-radius", prefix: "rounded" }],
        targetVariants: ["lg"],
        computedValue: "32px",
      }),
    ).toEqual({ unit: "em", value: 2 });
  });

  it("preserves a negative margin from the active responsive utility", () => {
    expect(
      resolveInspectorLength({
        className: "m-[4px] md:-m-[2rem]",
        sources: [{ property: "margin", prefix: "m" }],
        targetVariants: ["md"],
        computedValue: "-32px",
      }),
    ).toEqual({ unit: "rem", value: -2 });
  });

  it("resolves responsive Margin Auto utilities", () => {
    expect(
      resolveInspectorLength({
        className: "m-[12px] md:m-auto",
        sources: [{ property: "margin", prefix: "m" }],
        targetVariants: ["md"],
        computedValue: "0px",
        allowAuto: true,
      }),
    ).toEqual({ unit: "auto", value: null });

    expect(inspectorLengthUtility("m", "auto")).toBe("m-auto");
    expect(inspectorLengthUtility("ml", "auto")).toBe("ml-auto");
  });

  it("uses Auto for unset sizing and gives optimistic edits priority", () => {
    expect(
      resolveInspectorLength({
        className: "",
        sources: [{ property: "width", prefix: "w" }],
        targetVariants: [],
        computedValue: "592px",
        allowAuto: true,
        autoWhenUnset: true,
      }),
    ).toEqual({ unit: "auto", value: null });

    expect(
      resolveInspectorLength({
        className: "w-[100px]",
        sources: [{ property: "width", prefix: "w" }],
        targetVariants: [],
        computedValue: "100px",
        optimisticValue: "42vw",
        allowAuto: true,
      }),
    ).toEqual({ unit: "vw", value: 42 });
  });

  it("generates Tailwind arbitrary lengths and Auto utilities", () => {
    expect(inspectorLengthUtility("w", "50%")).toBe("w-[50%]");
    expect(inspectorLengthUtility("h", "auto")).toBe("h-auto");
    expect(inspectorLengthUtility("max-w", "none")).toBe("max-w-none");
    expect(inspectorLengthUtility("rounded-tl", "1.25rem")).toBe(
      "rounded-tl-[1.25rem]",
    );
  });

  it("resolves an unset maximum size as None", () => {
    expect(
      resolveInspectorLength({
        className: "",
        sources: [{ property: "max-width", prefix: "max-w" }],
        targetVariants: [],
        computedValue: "none",
        allowNone: true,
        noneWhenUnset: true,
      }),
    ).toEqual({ unit: "none", value: null });
  });
});
