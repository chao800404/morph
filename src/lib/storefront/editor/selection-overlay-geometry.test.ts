import { describe, expect, it } from "vitest";
import {
  INLINE_EDIT_OUTSET_PX,
  OVERLAY_OUTSET_PX,
  outsetOverlayBounds,
  selectionOverlayGeometry,
} from "./selection-overlay-geometry";

const bounds = { left: 12, top: 20, width: 180, height: 0 };

function geometry(
  overrides: Partial<Parameters<typeof selectionOverlayGeometry>[0]> = {},
) {
  return selectionOverlayGeometry({
    bounds,
    kind: "paragraph",
    content: "",
    lineHeight: "24px",
    fontSize: "16px",
    display: "block",
    inlineHeight: "",
    inlineMaxHeight: "",
    ...overrides,
  });
}

describe("selectionOverlayGeometry", () => {
  it("uses the computed line height for an empty paragraph", () => {
    expect(geometry({ bounds: new DOMRect(12, 20, 180, 0) })).toEqual({
      left: 12,
      top: 20,
      width: 180,
      height: 24,
    });
  });

  it("derives a bounded line height from font size when line-height is normal", () => {
    expect(
      geometry({ lineHeight: "normal", fontSize: "20px" }).height,
    ).toBe(24);
    expect(
      geometry({ lineHeight: "normal", fontSize: "10000px" }).height,
    ).toBe(512);
  });

  it("does not change non-empty text or an existing positive height", () => {
    expect(geometry({ content: "Rendered copy" })).toBe(bounds);

    const positiveBounds = { ...bounds, height: 18 };
    expect(geometry({ bounds: positiveBounds })).toBe(positiveBounds);
  });

  it("does not add text height to non-text selections", () => {
    expect(geometry({ kind: "container" })).toBe(bounds);
    expect(geometry({ kind: "input" })).toBe(bounds);
    expect(geometry({ kind: "image" })).toBe(bounds);
  });

  it("preserves a reliably detectable explicit zero height", () => {
    expect(geometry({ inlineHeight: "0px" })).toBe(bounds);
    expect(geometry({ inlineMaxHeight: "0" })).toBe(bounds);
  });
});

describe("outsetOverlayBounds", () => {
  it("expands evenly so the ring clears the element's own edge", () => {
    expect(
      outsetOverlayBounds({ left: 100, top: 50, width: 200, height: 40 }),
    ).toEqual({
      left: 100 - OVERLAY_OUTSET_PX,
      top: 50 - OVERLAY_OUTSET_PX,
      width: 200 + OVERLAY_OUTSET_PX * 2,
      height: 40 + OVERLAY_OUTSET_PX * 2,
    });
  });

  it("keeps a zero-size box from being pushed inside out", () => {
    // An element measured at zero still gets a ring; a negative width would
    // make the overlay vanish instead of marking where the element is.
    const ring = outsetOverlayBounds({ left: 0, top: 0, width: 0, height: 0 });
    expect(ring.width).toBeGreaterThan(0);
    expect(ring.height).toBeGreaterThan(0);
  });
});

describe("clearance while editing text in place", () => {
  it("gives the caret more room than a resting selection does", () => {
    // The caret is drawn on the content box's own edge. At the resting
    // clearance the two overlap and read as one smudged line.
    expect(INLINE_EDIT_OUTSET_PX).toBeGreaterThan(OVERLAY_OUTSET_PX);
  });

  it("moves only the ring, never the element", () => {
    const bounds = { left: 100, top: 50, width: 200, height: 40 };
    const editing = outsetOverlayBounds(bounds, INLINE_EDIT_OUTSET_PX);

    expect(editing.left + editing.width / 2).toBe(
      bounds.left + bounds.width / 2,
    );
    expect(editing.top + editing.height / 2).toBe(bounds.top + bounds.height / 2);
  });
});


