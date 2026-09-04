/**
 * Width arithmetic for the editor's side panels.
 *
 * Kept separate from the drag plumbing so the part that decides *what* the
 * width should be can be tested without a pointer, and so the drag loop itself
 * stays free of anything that would tempt it back into React state.
 */

/** Which edge of the canvas the panel is docked to. */
export type PanelEdge = "left" | "right";

export interface PanelResizeInput {
  /** Panel width when the drag started. */
  startWidth: number;
  /** Pointer x when the drag started. */
  startX: number;
  /** Pointer x now. */
  clientX: number;
  edge: PanelEdge;
  min: number;
  max: number;
}

/**
 * The panel width for the current pointer position, clamped to its bounds.
 *
 * The left panel grows as the pointer moves right; the right panel grows as it
 * moves left, because its handle sits on its inner edge.
 */
export function resolvePanelResizeWidth({
  startWidth,
  startX,
  clientX,
  edge,
  min,
  max,
}: PanelResizeInput): number {
  const delta = edge === "left" ? clientX - startX : startX - clientX;
  return Math.min(max, Math.max(min, Math.round(startWidth + delta)));
}

/** How far one arrow key press moves a panel edge, in pixels. */
export const PANEL_RESIZE_STEP = 16;
/** The same with a modifier held, for crossing a panel quickly. */
export const PANEL_RESIZE_LARGE_STEP = 64;

/**
 * The panel width a key press asks for, or `null` if the key is not ours.
 *
 * A separator that can be focused but not operated is worse than one that
 * cannot be focused at all: it takes a tab stop and gives nothing back. The
 * arrows follow the same sense as the drag — the key that moves the edge
 * outward widens the panel — so the left panel grows with ArrowRight and the
 * right panel grows with ArrowLeft.
 *
 * `Home` and `End` go to the bounds, which is what the separator role's
 * keyboard contract expects of them.
 */
export function resolvePanelResizeKey({
  key,
  shiftKey = false,
  width,
  edge,
  min,
  max,
}: {
  key: string;
  shiftKey?: boolean;
  width: number;
  edge: PanelEdge;
  min: number;
  max: number;
}): number | null {
  const clamp = (value: number) => Math.min(max, Math.max(min, value));

  if (key === "Home") return clamp(min);
  if (key === "End") return clamp(max);

  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;

  const magnitude = shiftKey ? PANEL_RESIZE_LARGE_STEP : PANEL_RESIZE_STEP;
  const towardsWider = edge === "left" ? "ArrowRight" : "ArrowLeft";
  const delta = key === towardsWider ? magnitude : -magnitude;

  const next = clamp(width + delta);
  // Already against the bound: report no change rather than a width equal to
  // the current one, so the caller can leave the event alone.
  return next === width ? null : next;
}
