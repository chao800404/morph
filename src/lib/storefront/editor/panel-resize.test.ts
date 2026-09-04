import { describe, expect, it } from "vitest";
import {
  PANEL_RESIZE_LARGE_STEP,
  PANEL_RESIZE_STEP,
  resolvePanelResizeKey,
  resolvePanelResizeWidth,
} from "./panel-resize";

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

describe("resolvePanelResizeKey", () => {
  const bounds = { width: 300, min: 220, max: 460 } as const;

  // The key that pushes the edge outward widens the panel, matching the drag.
  it("widens the left panel with ArrowRight and the right panel with ArrowLeft", () => {
    expect(
      resolvePanelResizeKey({ ...bounds, key: "ArrowRight", edge: "left" }),
    ).toBe(300 + PANEL_RESIZE_STEP);
    expect(
      resolvePanelResizeKey({ ...bounds, key: "ArrowLeft", edge: "left" }),
    ).toBe(300 - PANEL_RESIZE_STEP);
    expect(
      resolvePanelResizeKey({ ...bounds, key: "ArrowLeft", edge: "right" }),
    ).toBe(300 + PANEL_RESIZE_STEP);
    expect(
      resolvePanelResizeKey({ ...bounds, key: "ArrowRight", edge: "right" }),
    ).toBe(300 - PANEL_RESIZE_STEP);
  });

  it("takes a larger step with a modifier held", () => {
    expect(
      resolvePanelResizeKey({
        ...bounds,
        key: "ArrowRight",
        edge: "left",
        shiftKey: true,
      }),
    ).toBe(300 + PANEL_RESIZE_LARGE_STEP);
  });

  it("sends Home and End to the bounds", () => {
    expect(resolvePanelResizeKey({ ...bounds, key: "Home", edge: "left" })).toBe(
      220,
    );
    expect(resolvePanelResizeKey({ ...bounds, key: "End", edge: "left" })).toBe(
      460,
    );
  });

  it("clamps rather than stepping past a bound", () => {
    expect(
      resolvePanelResizeKey({
        ...bounds,
        width: 455,
        key: "ArrowRight",
        edge: "left",
        shiftKey: true,
      }),
    ).toBe(460);
  });

  // So the caller can leave the event to the browser instead of swallowing it.
  it("reports no change when already against the bound", () => {
    expect(
      resolvePanelResizeKey({
        ...bounds,
        width: 460,
        key: "ArrowRight",
        edge: "left",
      }),
    ).toBeNull();
    expect(
      resolvePanelResizeKey({ ...bounds, width: 220, key: "Home", edge: "left" }),
    ).toBe(220);
  });

  it("ignores keys it does not handle", () => {
    for (const key of ["ArrowUp", "Enter", "a", "Tab"]) {
      expect(resolvePanelResizeKey({ ...bounds, key, edge: "left" })).toBeNull();
    }
  });
});
