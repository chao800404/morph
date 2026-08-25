export const PREVIEW_SPACING_OVERLAY_MODES = [
  "off",
  "selected",
  "all",
] as const;

export type PreviewSpacingOverlayMode =
  (typeof PREVIEW_SPACING_OVERLAY_MODES)[number];

export type SpacingOverlaySide = "top" | "right" | "bottom" | "left";
export type SpacingOverlayKind = "margin" | "padding";

export type SpacingOverlayRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type SpacingOverlayBoxMetrics = Readonly<{
  margin: Readonly<Record<SpacingOverlaySide, number>>;
  padding: Readonly<Record<SpacingOverlaySide, number>>;
  border: Readonly<Record<SpacingOverlaySide, number>>;
}>;

export type SpacingOverlayStrip = Readonly<{
  kind: SpacingOverlayKind;
  side: SpacingOverlaySide;
  value: number;
  negative: boolean;
  rect: SpacingOverlayRect;
}>;

export const SPACING_OVERLAY_TARGET_SELECTOR = [
  "[data-morph-node]",
  "[data-morph-element]",
  "[data-storefront-component]",
  "[data-storefront-section-id]",
  "[data-morph-section]",
].join(", ");

export function isPreviewSpacingOverlayMode(
  value: unknown,
): value is PreviewSpacingOverlayMode {
  return PREVIEW_SPACING_OVERLAY_MODES.some((mode) => mode === value);
}

export function cssPixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): SpacingOverlayRect {
  return {
    left,
    top,
    width: Math.max(0, width),
    height: Math.max(0, height),
  };
}

export function buildSpacingOverlayStrips(
  box: SpacingOverlayRect,
  metrics: SpacingOverlayBoxMetrics,
): SpacingOverlayStrip[] {
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  const strips: SpacingOverlayStrip[] = [];

  const addMargin = (side: SpacingOverlaySide) => {
    const value = metrics.margin[side];
    const size = Math.abs(value);
    if (size < 0.25) return;
    const negative = value < 0;
    const marginRect =
      side === "top"
        ? rect(box.left, negative ? box.top : box.top - size, box.width, size)
        : side === "right"
          ? rect(negative ? right - size : right, box.top, size, box.height)
          : side === "bottom"
            ? rect(box.left, negative ? bottom - size : bottom, box.width, size)
            : rect(
                negative ? box.left : box.left - size,
                box.top,
                size,
                box.height,
              );
    strips.push({ kind: "margin", side, value, negative, rect: marginRect });
  };

  (["top", "right", "bottom", "left"] as const).forEach(addMargin);

  const innerLeft = box.left + metrics.border.left;
  const innerTop = box.top + metrics.border.top;
  const innerRight = right - metrics.border.right;
  const innerBottom = bottom - metrics.border.bottom;
  const innerWidth = Math.max(0, innerRight - innerLeft);
  const innerHeight = Math.max(0, innerBottom - innerTop);
  const verticalContentHeight = Math.max(
    0,
    innerHeight - metrics.padding.top - metrics.padding.bottom,
  );

  const paddingRects: Record<SpacingOverlaySide, SpacingOverlayRect> = {
    top: rect(innerLeft, innerTop, innerWidth, metrics.padding.top),
    right: rect(
      innerRight - metrics.padding.right,
      innerTop + metrics.padding.top,
      metrics.padding.right,
      verticalContentHeight,
    ),
    bottom: rect(
      innerLeft,
      innerBottom - metrics.padding.bottom,
      innerWidth,
      metrics.padding.bottom,
    ),
    left: rect(
      innerLeft,
      innerTop + metrics.padding.top,
      metrics.padding.left,
      verticalContentHeight,
    ),
  };

  (["top", "right", "bottom", "left"] as const).forEach((side) => {
    const value = metrics.padding[side];
    if (value < 0.25) return;
    strips.push({
      kind: "padding",
      side,
      value,
      negative: false,
      rect: paddingRects[side],
    });
  });

  return strips;
}

export function formatSpacingOverlayValue(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
