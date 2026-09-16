/**
 * The canvas's geometry: what a pan or a zoom is allowed to be.
 *
 * Pure arithmetic with no React in it, so the rules a gesture obeys can be
 * read — and tested — without standing up the editor around them.
 */

export const MIN_CANVAS_SCALE = 0.25;
export const MAX_CANVAS_SCALE = 2;
export const CANVAS_SCALE_STEP = 0.1;
export const CANVAS_DEFAULT_SCALE = 1;
export const CANVAS_DEFAULT_SCALE_SNAP_THRESHOLD = 0.02;
export const MIN_PREVIEW_WIDTH = 320;
export const MAX_PREVIEW_WIDTH = 1920;
export const PREVIEW_WIDTH_STEP = 16;
export const TABLET_PREVIEW_WIDTH = 768;
export const DESKTOP_PREVIEW_WIDTH = 1024;
export const CANVAS_TOP_INSET = 48;
export const CANVAS_BOTTOM_INSET = 80;
export const CANVAS_VERTICAL_OVERSCROLL = 200;
export const CANVAS_SCROLL_COMMIT_DELAY_MS = 120;

export type CanvasTransform = {
  x: number;
  y: number;
  scale: number;
};

export const initialCanvasTransform: CanvasTransform = {
  x: 0,
  y: 0,
  scale: 1,
};

export function clampCanvasScale(scale: number) {
  return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, scale));
}

export function snapCanvasScaleTowardDefault(
  currentScale: number,
  nextScale: number,
) {
  if (currentScale === CANVAS_DEFAULT_SCALE) return nextScale;

  const isMovingTowardDefault =
    (currentScale < CANVAS_DEFAULT_SCALE && nextScale > currentScale) ||
    (currentScale > CANVAS_DEFAULT_SCALE && nextScale < currentScale);
  const crossedDefault =
    (currentScale < CANVAS_DEFAULT_SCALE &&
      nextScale >= CANVAS_DEFAULT_SCALE) ||
    (currentScale > CANVAS_DEFAULT_SCALE && nextScale <= CANVAS_DEFAULT_SCALE);
  const isWithinSnapThreshold =
    Math.abs(nextScale - CANVAS_DEFAULT_SCALE) <=
    CANVAS_DEFAULT_SCALE_SNAP_THRESHOLD;

  return isMovingTowardDefault && (crossedDefault || isWithinSnapThreshold)
    ? CANVAS_DEFAULT_SCALE
    : nextScale;
}

export function clampPreviewWidth(width: number) {
  return Math.min(MAX_PREVIEW_WIDTH, Math.max(MIN_PREVIEW_WIDTH, width));
}

export function resolvePreviewViewport(width: number) {
  if (width >= DESKTOP_PREVIEW_WIDTH) return "desktop" as const;
  if (width >= TABLET_PREVIEW_WIDTH) return "tablet" as const;
  return "mobile" as const;
}

export function clampCanvasTransform(
  transform: CanvasTransform,
  viewportHeight: number,
  contentHeight: number,
) {
  const minimumY =
    Math.min(
      0,
      viewportHeight -
        CANVAS_TOP_INSET -
        CANVAS_BOTTOM_INSET -
        contentHeight * transform.scale,
    ) - CANVAS_VERTICAL_OVERSCROLL;
  const maximumY = CANVAS_VERTICAL_OVERSCROLL;

  return {
    ...transform,
    y: Math.min(maximumY, Math.max(minimumY, transform.y)),
  };
}

export function normalizeWheelDelta(
  deltaY: number,
  deltaMode: number,
  viewportHeight: number,
) {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * viewportHeight;
  return deltaY;
}

/**
 * The vertical pan that puts one element on the viewport's horizontal midline.
 *
 * The canvas translates rather than scrolls, so bringing something into view is
 * arithmetic on the transform: an element at `top` in the preview's own pixels
 * appears at `y + top * scale`, and centring it means solving for the `y` that
 * places its middle at the middle of the viewport.
 *
 * Returned unclamped. The caller passes it through `clampCanvasTransform`,
 * which owns how far the canvas may travel — an element near either end of a
 * long page cannot be centred, and should come to rest against the edge rather
 * than leaving the page half off-screen.
 */
export function canvasYToCenterElement({
  elementTop,
  elementHeight,
  viewportHeight,
  scale,
}: {
  elementTop: number;
  elementHeight: number;
  viewportHeight: number;
  scale: number;
}): number {
  return viewportHeight / 2 - (elementTop + elementHeight / 2) * scale;
}
