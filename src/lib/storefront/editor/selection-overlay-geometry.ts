import type { SelectionKind } from "./selection-taxonomy";
import { shouldReservePreviewEmptyTextLine } from "./preview-empty-text-layout";

const NEAR_ZERO_HEIGHT_PX = 0.5;
const DEFAULT_FONT_SIZE_PX = 16;
const NORMAL_LINE_HEIGHT_RATIO = 1.2;
const MIN_FALLBACK_HEIGHT_PX = 1;
const MAX_FALLBACK_HEIGHT_PX = 512;

export type SelectionOverlayBounds = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

type SelectionOverlayFallbackCandidateInput = Readonly<{
  bounds: SelectionOverlayBounds;
  kind: SelectionKind;
  content: string;
  /** Inline height is the only authored `height: 0` signal DOM APIs expose reliably. */
  inlineHeight: string;
  inlineMaxHeight: string;
}>;

type SelectionOverlayGeometryInput = SelectionOverlayFallbackCandidateInput &
  Readonly<{
    lineHeight: string;
    fontSize: string;
    display: string;
  }>;

function finitePositive(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function cssPixelValue(value: string): number | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.endsWith("px")) return null;
  return finitePositive(Number.parseFloat(trimmed));
}

function fallbackLineHeight(lineHeight: string, fontSize: string): number {
  const parsedFontSize =
    cssPixelValue(fontSize) ?? finitePositive(Number.parseFloat(fontSize));
  const boundedFontSize = Math.min(
    Math.max(parsedFontSize ?? DEFAULT_FONT_SIZE_PX, MIN_FALLBACK_HEIGHT_PX),
    MAX_FALLBACK_HEIGHT_PX,
  );
  const trimmedLineHeight = lineHeight.trim().toLowerCase();
  const pixelLineHeight = cssPixelValue(trimmedLineHeight);
  const unitlessLineHeight =
    pixelLineHeight === null && trimmedLineHeight !== "normal"
      ? finitePositive(Number(trimmedLineHeight))
      : null;
  const candidate =
    pixelLineHeight ??
    (unitlessLineHeight === null
      ? boundedFontSize * NORMAL_LINE_HEIGHT_RATIO
      : boundedFontSize * unitlessLineHeight);

  return Math.min(
    Math.max(candidate, MIN_FALLBACK_HEIGHT_PX),
    MAX_FALLBACK_HEIGHT_PX,
  );
}

/** Lets the preview avoid computed-style reads for ordinary positive boxes. */
export function isSelectionOverlayTextFallbackCandidate(
  input: SelectionOverlayFallbackCandidateInput,
): boolean {
  return (
    input.bounds.height <= NEAR_ZERO_HEIGHT_PX &&
    shouldReservePreviewEmptyTextLine(input)
  );
}

/**
 * Gives a naturally empty text node a selectable one-line overlay without
 * changing the rendered Theme element itself.
 */
/**
 * How far the selection and hover rings sit outside the element they mark.
 *
 * Drawn exactly on the element's edge, the ring reads as part of the design
 * rather than as a tool: it covers the element's own border and hides the very
 * pixel someone is looking at when they adjust a border or a radius.
 */
export const OVERLAY_OUTSET_PX = 1.5;

/**
 * Clearance while the element's text is being edited in place.
 *
 * The caret sits on the content box's own edge, so at the resting clearance it
 * touches the ring and the two read as one smudged line. Moving the ring keeps
 * the text exactly where it is — padding the element would push the text
 * instead, changing the layout being edited.
 */
export const INLINE_EDIT_OUTSET_PX = 5;

/** Expands bounds evenly, keeping the element's centre in place. */
export function outsetOverlayBounds(
  bounds: SelectionOverlayBounds,
  outset = OVERLAY_OUTSET_PX,
): SelectionOverlayBounds {
  return {
    left: bounds.left - outset,
    top: bounds.top - outset,
    // A zero-size box must not be pushed negative by its own outset.
    width: Math.max(0, bounds.width + outset * 2),
    height: Math.max(0, bounds.height + outset * 2),
  };
}

export function selectionOverlayGeometry(
  input: SelectionOverlayGeometryInput,
): SelectionOverlayBounds {
  if (
    !isSelectionOverlayTextFallbackCandidate(input) ||
    input.display === "none"
  ) {
    return input.bounds;
  }

  return {
    left: input.bounds.left,
    top: input.bounds.top,
    width: input.bounds.width,
    height: fallbackLineHeight(input.lineHeight, input.fontSize),
  };
}
