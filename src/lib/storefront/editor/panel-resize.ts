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
