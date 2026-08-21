import { patchTailwindClasses } from "@/lib/storefront/ast/tailwind-token-engine";

const GRADIENT_PATTERN = /^(?:linear|radial)-gradient\(/i;
const SOLID_COLOR_PATTERN =
  /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(.+\))$/i;

export function isGradientPaint(value: string) {
  return GRADIENT_PATTERN.test(value.trim());
}

export function isInspectorPaint(value: string, allowGradient = false) {
  const normalized = value.trim();
  return (
    SOLID_COLOR_PATTERN.test(normalized) ||
    (allowGradient && GRADIENT_PATTERN.test(normalized))
  );
}

export function normalizeInspectorPaint(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return isGradientPaint(normalized)
    ? normalized
    : normalized.replace(/\s*,\s*/g, ",");
}

function encodeTailwindArbitraryValue(value: string) {
  return value.replace(/_/g, "\\_").replace(/\s+/g, "_");
}

function decodeTailwindArbitraryValue(value: string) {
  return value
    .replace(/\\_/g, "\u0000")
    .replace(/_/g, " ")
    .replace(/\u0000/g, "_");
}

export function toBackgroundPaintUtility(value: string) {
  const normalized = normalizeInspectorPaint(value);
  return normalized ? `bg-[${encodeTailwindArbitraryValue(normalized)}]` : "";
}

export function toTextColorUtility(value: string) {
  const normalized = normalizeInspectorPaint(value);
  return normalized ? `text-[${encodeTailwindArbitraryValue(normalized)}]` : "";
}

export function toBorderColorUtility(value: string) {
  const normalized = normalizeInspectorPaint(value);
  return normalized
    ? `border-[${encodeTailwindArbitraryValue(normalized)}]`
    : "";
}

export function parseTailwindBackgroundPaint(className?: string) {
  if (!className) return null;
  const match = className.match(
    /(?:^|\s)(?:[a-z0-9-]+:)*bg-\[((?:\\.|[^\]])+)\](?=\s|$)/i,
  );
  if (!match) return null;
  const value = decodeTailwindArbitraryValue(match[1]);
  return isInspectorPaint(value, true) ? value : null;
}

export function parseTailwindTextGradient(className?: string) {
  if (
    !className ||
    !/(?:^|\s)(?:[a-z0-9-]+:)*bg-clip-text(?=\s|$)/i.test(className)
  ) {
    return null;
  }
  const paint = parseTailwindBackgroundPaint(className);
  return paint && isGradientPaint(paint) ? paint : null;
}

export function patchTailwindTextPaint(
  className: string,
  value: string,
  targetVariants: string[] = [],
) {
  const normalized = normalizeInspectorPaint(value);
  const hadGradient = Boolean(parseTailwindTextGradient(className));
  const nextIsGradient = isGradientPaint(normalized);
  let nextClassName = patchTailwindClasses(className, {
    property: "text-color",
    value: nextIsGradient ? "text-transparent" : toTextColorUtility(normalized),
    targetVariants,
  });

  if (nextIsGradient) {
    nextClassName = patchTailwindClasses(nextClassName, {
      property: "background",
      value: toBackgroundPaintUtility(normalized),
      targetVariants,
    });
    return patchTailwindClasses(nextClassName, {
      property: "background-clip",
      value: "bg-clip-text",
      targetVariants,
    });
  }

  if (!hadGradient) return nextClassName;
  nextClassName = patchTailwindClasses(nextClassName, {
    property: "background",
    value: "",
    targetVariants,
  });
  return patchTailwindClasses(nextClassName, {
    property: "background-clip",
    value: "",
    targetVariants,
  });
}

export function paintPreviewStyles(value: string): Record<string, string> {
  const normalized = normalizeInspectorPaint(value);
  return isGradientPaint(normalized)
    ? { "background-color": "", "background-image": normalized }
    : { "background-color": normalized, "background-image": "none" };
}

export function textPaintPreviewStyles(
  value: string,
  previousValue = "",
): Record<string, string> {
  const normalized = normalizeInspectorPaint(value);
  if (isGradientPaint(normalized)) {
    return {
      color: "transparent",
      "background-image": normalized,
      "background-clip": "text",
      "-webkit-background-clip": "text",
    };
  }

  return isGradientPaint(previousValue)
    ? {
        color: normalized,
        "background-image": "none",
        "background-clip": "border-box",
        "-webkit-background-clip": "border-box",
      }
    : { color: normalized };
}
