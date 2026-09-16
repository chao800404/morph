/**
 * The rules a canvas gesture obeys.
 *
 * These lived inside a six-thousand-line component, where the only way to ask
 * what a zoom does at the edge of its range was to open the editor and try it.
 */
import { describe, expect, it } from "vitest";
import {
  CANVAS_DEFAULT_SCALE,
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE,
  canvasYToCenterElement,
  clampCanvasScale,
  clampCanvasTransform,
  clampPreviewWidth,
  normalizeWheelDelta,
  resolvePreviewViewport,
  snapCanvasScaleTowardDefault,
} from "./editor-canvas-geometry";

describe("zoom", () => {
  it("stays within its range", () => {
    expect(clampCanvasScale(5)).toBe(MAX_CANVAS_SCALE);
    expect(clampCanvasScale(0.01)).toBe(MIN_CANVAS_SCALE);
    expect(clampCanvasScale(1.5)).toBe(1.5);
  });

  it("catches on 100% when approaching it", () => {
    // Passing 100% without stopping makes the one scale anybody wants back the
    // hardest to land on.
    expect(snapCanvasScaleTowardDefault(0.9, 1.05)).toBe(CANVAS_DEFAULT_SCALE);
    expect(snapCanvasScaleTowardDefault(1.2, 0.99)).toBe(CANVAS_DEFAULT_SCALE);
  });

  it("does not catch when moving away from it", () => {
    expect(snapCanvasScaleTowardDefault(1.05, 1.2)).toBe(1.2);
    expect(snapCanvasScaleTowardDefault(0.9, 0.8)).toBe(0.8);
  });

  it("leaves a scale that already is the default alone", () => {
    expect(snapCanvasScaleTowardDefault(CANVAS_DEFAULT_SCALE, 1.4)).toBe(1.4);
  });
});

describe("preview width", () => {
  it("stays within its range", () => {
    expect(clampPreviewWidth(10_000)).toBeLessThanOrEqual(1920);
    expect(clampPreviewWidth(10)).toBeGreaterThanOrEqual(320);
  });

  it("names the viewport a width belongs to", () => {
    expect(resolvePreviewViewport(1440)).toBe("desktop");
    expect(resolvePreviewViewport(800)).toBe("tablet");
    expect(resolvePreviewViewport(390)).toBe("mobile");
    // The boundaries themselves belong to the larger viewport.
    expect(resolvePreviewViewport(1024)).toBe("desktop");
    expect(resolvePreviewViewport(768)).toBe("tablet");
  });
});

describe("panning", () => {
  it("allows a little overscroll past the end, and no more", () => {
    const far = clampCanvasTransform(
      { x: 0, y: -100_000, scale: 1 },
      900,
      4000,
    );
    expect(far.y).toBeGreaterThan(-100_000);

    const up = clampCanvasTransform({ x: 0, y: 100_000, scale: 1 }, 900, 4000);
    expect(up.y).toBe(200);
  });

  it("leaves the horizontal position alone", () => {
    expect(clampCanvasTransform({ x: -321, y: 0, scale: 1 }, 900, 4000).x).toBe(
      -321,
    );
  });

  it("reads a wheel in lines or pages as pixels", () => {
    expect(normalizeWheelDelta(3, 0, 900)).toBe(3);
    expect(normalizeWheelDelta(3, 1, 900)).toBe(48);
    expect(normalizeWheelDelta(2, 2, 900)).toBe(1800);
  });
});

describe("bringing a selection to the middle of the canvas", () => {
  const viewportHeight = 1172;

  /**
   * The canvas translates rather than scrolls, so this is where an element
   * ends up: `y + top * scale`. Centring is the `y` that puts its middle on
   * the viewport's own middle, which is the whole of the arithmetic.
   */
  const centreOnScreen = (
    elementTop: number,
    elementHeight: number,
    scale = 1,
  ) =>
    canvasYToCenterElement({
      elementTop,
      elementHeight,
      viewportHeight,
      scale,
    }) +
    (elementTop + elementHeight / 2) * scale;

  it("puts the element's middle on the viewport's middle", () => {
    for (const [top, height] of [
      [64, 1900],
      [2586, 700],
      [4015, 601],
    ]) {
      expect(centreOnScreen(top!, height!)).toBeCloseTo(viewportHeight / 2);
    }
  });

  // Zoom scales the distance travelled, not the destination.
  it("holds at any zoom", () => {
    for (const scale of [0.5, 1, 1.75]) {
      expect(centreOnScreen(3418, 597, scale)).toBeCloseTo(viewportHeight / 2);
    }
  });

  /**
   * An element near either end cannot be centred without leaving the page half
   * off-screen. The clamp owns that, which is why the centring itself is
   * returned unclamped.
   */
  it("is left to the clamp to keep the page on screen", () => {
    const contentHeight = 5000;
    const top = canvasYToCenterElement({
      elementTop: 0,
      elementHeight: 100,
      viewportHeight,
      scale: 1,
    });
    expect(top).toBeGreaterThan(0);
    expect(
      clampCanvasTransform(
        { x: 0, y: top, scale: 1 },
        viewportHeight,
        contentHeight,
      ).y,
    ).toBeLessThan(top);
  });
});
