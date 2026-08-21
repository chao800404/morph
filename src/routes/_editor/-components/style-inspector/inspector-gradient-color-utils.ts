import { isGradientPaint } from "./inspector-paint-utils";

const GRADIENT_COLOR_PATTERN = /(?:rgba?|hsla?)\([^)]*\)|#[0-9a-f]{3,8}/gi;

function gradientColorMatches(value: string) {
  return Array.from(value.matchAll(GRADIENT_COLOR_PATTERN));
}

function selectedColorIndex(matches: RegExpMatchArray[]) {
  const markedIndex = matches.findIndex((match) => /^[A-Z]/.test(match[0]));
  return markedIndex >= 0 ? markedIndex : 0;
}

export function getInspectorEditablePaintColor(value: string) {
  if (!isGradientPaint(value)) return value;
  const matches = gradientColorMatches(value);
  return matches[selectedColorIndex(matches)]?.[0] ?? value;
}

export function updateInspectorEditablePaintColor(
  value: string,
  nextColor: string,
) {
  if (!isGradientPaint(value)) return nextColor;
  const matches = gradientColorMatches(value);
  if (matches.length === 0) return value;
  const selectedIndex = selectedColorIndex(matches);
  let colorIndex = 0;

  return value.replace(GRADIENT_COLOR_PATTERN, (color) => {
    const replacement =
      colorIndex === selectedIndex
        ? nextColor.toUpperCase()
        : color.toLowerCase();
    colorIndex += 1;
    return replacement;
  });
}
