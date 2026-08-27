import { describe, expect, it } from "vitest";

import {
  DRAG_AUTOSCROLL_MAX_STEP_PX,
  dragAutoScrollStep,
} from "@/lib/storefront/editor/drag-autoscroll";

const viewport = { viewportTop: 100, viewportBottom: 700 };

describe("dragAutoScrollStep", () => {
  it("stays still while the pointer is away from both edges", () => {
    expect(dragAutoScrollStep({ pointerY: 400, ...viewport })).toBe(0);
  });

  it("scrolls down near the bottom edge and up near the top edge", () => {
    expect(
      dragAutoScrollStep({ pointerY: 660, ...viewport }),
    ).toBeGreaterThan(0);
    expect(dragAutoScrollStep({ pointerY: 140, ...viewport })).toBeLessThan(0);
  });

  it("speeds up the deeper into the edge band the pointer goes", () => {
    // 620 is barely inside the band; 690 is almost at the edge itself.
    const shallow = dragAutoScrollStep({ pointerY: 620, ...viewport });
    const deep = dragAutoScrollStep({ pointerY: 690, ...viewport });
    expect(deep).toBeGreaterThan(shallow);
  });

  it("caps at the maximum step once the pointer reaches the edge", () => {
    expect(dragAutoScrollStep({ pointerY: 700, ...viewport })).toBe(
      DRAG_AUTOSCROLL_MAX_STEP_PX,
    );
    // Dragging past the visible area is still just full speed, not faster.
    expect(dragAutoScrollStep({ pointerY: 5_000, ...viewport })).toBe(
      DRAG_AUTOSCROLL_MAX_STEP_PX,
    );
    expect(dragAutoScrollStep({ pointerY: -5_000, ...viewport })).toBe(
      -DRAG_AUTOSCROLL_MAX_STEP_PX,
    );
  });

  it("keeps a resting zone in a viewport shorter than two edge bands", () => {
    // Without shrinking the bands, every pointer position in a short viewport
    // would sit inside one of them and the canvas could never hold still.
    const short = { viewportTop: 0, viewportBottom: 120 };
    expect(dragAutoScrollStep({ pointerY: 60, ...short })).toBe(0);
    expect(dragAutoScrollStep({ pointerY: 118, ...short })).toBeGreaterThan(0);
  });

  it("does nothing for a viewport with no height or an unusable pointer", () => {
    expect(
      dragAutoScrollStep({ pointerY: 10, viewportTop: 50, viewportBottom: 50 }),
    ).toBe(0);
    expect(dragAutoScrollStep({ pointerY: Number.NaN, ...viewport })).toBe(0);
  });
});
