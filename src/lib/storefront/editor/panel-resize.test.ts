import { describe, expect, it } from "vitest";
import { resolvePanelResizeWidth } from "./panel-resize";

const base = { startWidth: 300, startX: 500, min: 220, max: 460 } as const;

describe("resolvePanelResizeWidth", () => {
  it("grows the left panel as the pointer moves right", () => {
    expect(
      resolvePanelResizeWidth({ ...base, clientX: 560, edge: "left" }),
    ).toBe(360);
    expect(
      resolvePanelResizeWidth({ ...base, clientX: 440, edge: "left" }),
    ).toBe(240);
  });

  // The right panel's handle is on its inner edge, so the pointer moves the
  // opposite way from the width.
  it("grows the right panel as the pointer moves left", () => {
    expect(
      resolvePanelResizeWidth({ ...base, clientX: 440, edge: "right" }),
    ).toBe(360);
    expect(
      resolvePanelResizeWidth({ ...base, clientX: 560, edge: "right" }),
    ).toBe(240);
  });

  it("clamps to the panel's bounds", () => {
    expect(
      resolvePanelResizeWidth({ ...base, clientX: 5000, edge: "left" }),
    ).toBe(460);
    expect(resolvePanelResizeWidth({ ...base, clientX: 0, edge: "left" })).toBe(
      220,
    );
  });

  it("rounds to whole pixels", () => {
    expect(
      resolvePanelResizeWidth({
        ...base,
        startX: 500.4,
        clientX: 560.9,
        edge: "left",
      }),
    ).toBe(361);
  });

  it("is stable when the pointer has not moved", () => {
    expect(
      resolvePanelResizeWidth({ ...base, clientX: base.startX, edge: "left" }),
    ).toBe(300);
  });
});
