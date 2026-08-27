/** How close to the edge of the visible canvas a drag starts scrolling it. */
export const DRAG_AUTOSCROLL_EDGE_PX = 96;

/** Fastest one scroll step, reached once the pointer is at or past the edge. */
export const DRAG_AUTOSCROLL_MAX_STEP_PX = 24;

/**
 * How far to scroll the canvas for one frame of a drag near its edge.
 *
 * Positive scrolls down. The speed ramps with how deep into the edge band the
 * pointer is, so resting just inside it creeps and holding at the very edge
 * moves at full speed — a single fixed speed is either too slow to cross a long
 * page or too fast to stop where you meant to.
 */
export function dragAutoScrollStep(input: {
  pointerY: number;
  viewportTop: number;
  viewportBottom: number;
  edge?: number;
  maxStep?: number;
}): number {
  const { pointerY, viewportTop, viewportBottom } = input;
  const height = viewportBottom - viewportTop;
  if (!Number.isFinite(pointerY) || height <= 0) return 0;

  const maxStep = input.maxStep ?? DRAG_AUTOSCROLL_MAX_STEP_PX;
  // Both bands have to fit inside the viewport with something left between
  // them, or the whole canvas would scroll no matter where the pointer rests.
  const edge = Math.min(input.edge ?? DRAG_AUTOSCROLL_EDGE_PX, height / 3);
  if (edge <= 0) return 0;

  const ramp = (depth: number) =>
    Math.round(maxStep * Math.min(1, depth / edge));

  const fromTop = pointerY - viewportTop;
  if (fromTop < edge) return -ramp(edge - fromTop);

  const fromBottom = viewportBottom - pointerY;
  if (fromBottom < edge) return ramp(edge - fromBottom);

  return 0;
}
