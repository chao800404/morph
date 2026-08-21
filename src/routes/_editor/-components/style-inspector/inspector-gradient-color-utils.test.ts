import { describe, expect, it } from "vitest";

import {
  getInspectorEditablePaintColor,
  updateInspectorEditablePaintColor,
} from "./inspector-gradient-color-utils";

describe("Inspector gradient color utilities", () => {
  it("uses the first stop when a gradient has no selected-stop marker", () => {
    expect(
      getInspectorEditablePaintColor(
        "linear-gradient(90deg, rgba(28,25,23,1) 0%, rgba(216,208,195,1) 100%)",
      ),
    ).toBe("rgba(28,25,23,1)");
  });

  it("reads and updates only the selected gradient stop", () => {
    const gradient =
      "linear-gradient(90deg, rgba(28,25,23,1) 0%, RGBA(216,208,195,1) 100%)";

    expect(getInspectorEditablePaintColor(gradient)).toBe(
      "RGBA(216,208,195,1)",
    );
    expect(
      updateInspectorEditablePaintColor(gradient, "rgba(64,96,128,0.5)"),
    ).toBe(
      "linear-gradient(90deg, rgba(28,25,23,1) 0%, RGBA(64,96,128,0.5) 100%)",
    );
  });

  it("replaces a solid paint directly", () => {
    expect(updateInspectorEditablePaintColor("#fafaf9", "rgba(1,2,3,1)")).toBe(
      "rgba(1,2,3,1)",
    );
  });
});
