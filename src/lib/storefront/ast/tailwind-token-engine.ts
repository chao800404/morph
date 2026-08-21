export type TailwindPropertyFamily =
  | "font-size"
  | "font-family"
  | "font-weight"
  | "text-align"
  | "line-height"
  | "padding"
  | "padding-top"
  | "padding-bottom"
  | "padding-left"
  | "padding-right"
  | "padding-x"
  | "padding-y"
  | "background"
  | "background-color"
  | "border-radius"
  | "object-fit"
  | "object-position"
  | "aspect-ratio"
  | "display"
  | "flex-direction"
  | "gap"
  | "width"
  | "height"
  | "position"
  | "top"
  | "left"
  | "z-index"
  | "rotate"
  | "opacity"
  | "overflow"
  | "other";

export interface TailwindToken {
  raw: string;
  variants: string[];
  utility: string;
  propertyFamily: TailwindPropertyFamily;
}

export interface PatchTailwindOptions {
  property: Exclude<TailwindPropertyFamily, "other">;
  value: string;
  targetVariants?: string[];
}

const FONT_SIZE_NAMES = new Set([
  "text-xs", "text-sm", "text-base", "text-lg", "text-xl",
  "text-2xl", "text-3xl", "text-4xl", "text-5xl",
  "text-6xl", "text-7xl", "text-8xl", "text-9xl",
]);

const FONT_WEIGHT_NAMES = new Set([
  "font-thin", "font-extralight", "font-light", "font-normal",
  "font-medium", "font-semibold", "font-bold", "font-extrabold", "font-black",
]);

const FONT_FAMILY_NAMES = new Set(["font-sans", "font-serif", "font-mono"]);
const TEXT_ALIGN_NAMES = new Set([
  "text-left", "text-center", "text-right", "text-justify", "text-start", "text-end",
]);
const LINE_HEIGHT_PATTERN =
  /^leading-(none|tight|snug|normal|relaxed|loose|\d+(?:\.\d+)?|\[.+\])$/;
const PADDING_ALL_PATTERN = /^p-(?:\d+(?:\.\d+)?|\[.+\])$/;
const PADDING_TOP_PATTERN = /^pt-(?:\d+(?:\.\d+)?|\[.+\])$/;
const PADDING_BOTTOM_PATTERN = /^pb-(?:\d+(?:\.\d+)?|\[.+\])$/;
const PADDING_LEFT_PATTERN = /^pl-(?:\d+(?:\.\d+)?|\[.+\])$/;
const PADDING_RIGHT_PATTERN = /^pr-(?:\d+(?:\.\d+)?|\[.+\])$/;
const PADDING_X_PATTERN = /^px-(?:\d+(?:\.\d+)?|\[.+\])$/;
const PADDING_Y_PATTERN = /^py-(?:\d+(?:\.\d+)?|\[.+\])$/;
const BORDER_RADIUS_PATTERN =
  /^rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full|\[.+\]))?$/;
const OBJECT_FIT_PATTERN = /^object-(?:contain|cover|fill|none|scale-down)$/;
const OBJECT_POSITION_PATTERN =
  /^object-(?:center|top|right|bottom|left|top-right|top-left|bottom-right|bottom-left|\[.+\])$/;
const ASPECT_RATIO_PATTERN =
  /^aspect-(?:auto|square|video|\[.+\])$/;
const DISPLAY_PATTERN = /^(?:block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden)$/;
const FLEX_DIRECTION_PATTERN = /^flex-(?:row|row-reverse|col|col-reverse)$/;
const GAP_PATTERN = /^gap-(?:\d+(?:\.\d+)?|\[.+\])$/;
const WIDTH_PATTERN = /^w-(?:auto|full|screen|min|max|fit|\d+(?:\.\d+)?|\[.+\])$/;
const HEIGHT_PATTERN = /^h-(?:auto|full|screen|min|max|fit|\d+(?:\.\d+)?|\[.+\])$/;
const POSITION_PATTERN = /^(?:static|relative|absolute|fixed|sticky)$/;
const TOP_PATTERN = /^-?top-(?:auto|full|\d+(?:\.\d+)?|\[.+\])$/;
const LEFT_PATTERN = /^-?left-(?:auto|full|\d+(?:\.\d+)?|\[.+\])$/;
const Z_INDEX_PATTERN = /^-?z-(?:auto|\d+|\[.+\])$/;
const ROTATE_PATTERN = /^-?rotate-(?:\d+(?:\.\d+)?|\[.+\])$/;
const OPACITY_PATTERN = /^opacity-(?:\d+(?:\.\d+)?|\[.+\])$/;
const OVERFLOW_PATTERN = /^overflow-(?:auto|hidden|clip|visible|scroll)$/;

function arbitraryValue(utility: string, prefix: string): string | null {
  const start = `${prefix}-[`;
  if (!utility.startsWith(start) || !utility.endsWith("]")) return null;
  return utility.slice(start.length, -1).trim();
}

function looksLikeCssLengthExpression(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (/^-?\d*\.?\d+(px|rem|em|vw|vh|vmin|vmax|ch|ex|cm|mm|in|pt|pc|%)$/.test(normalized)) {
    return true;
  }
  if (/^(calc|min|max|clamp)\(/.test(normalized)) return true;
  if (/^(length|size):/.test(normalized)) return true;
  return false;
}

function looksLikeFontWeight(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (/^(100|200|300|400|500|600|700|800|900)$/.test(normalized)) return true;
  return /^weight:/.test(normalized);
}

function looksLikeBackgroundColor(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (/^(color:)/.test(normalized)) return true;
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(normalized)) return true;
  if (/^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(/.test(normalized)) return true;
  if (/^var\(--(?:color|brand|surface|background|bg)-/.test(normalized)) return true;
  return false;
}

export function classifyTailwindUtility(
  utility: string,
): TailwindPropertyFamily {
  if (FONT_SIZE_NAMES.has(utility)) return "font-size";
  const textArbitrary = arbitraryValue(utility, "text");
  if (textArbitrary && looksLikeCssLengthExpression(textArbitrary)) return "font-size";

  if (FONT_FAMILY_NAMES.has(utility)) return "font-family";
  if (FONT_WEIGHT_NAMES.has(utility)) return "font-weight";
  const fontArbitrary = arbitraryValue(utility, "font");
  if (fontArbitrary && looksLikeFontWeight(fontArbitrary)) return "font-weight";

  if (TEXT_ALIGN_NAMES.has(utility)) return "text-align";
  if (LINE_HEIGHT_PATTERN.test(utility)) return "line-height";
  if (PADDING_ALL_PATTERN.test(utility)) return "padding";
  if (PADDING_TOP_PATTERN.test(utility)) return "padding-top";
  if (PADDING_BOTTOM_PATTERN.test(utility)) return "padding-bottom";
  if (PADDING_LEFT_PATTERN.test(utility)) return "padding-left";
  if (PADDING_RIGHT_PATTERN.test(utility)) return "padding-right";
  if (PADDING_X_PATTERN.test(utility)) return "padding-x";
  if (PADDING_Y_PATTERN.test(utility)) return "padding-y";

  const bgArbitrary = arbitraryValue(utility, "bg");
  if (bgArbitrary) {
    return looksLikeBackgroundColor(bgArbitrary) ? "background" : "other";
  }
  if (
    /^bg-(?:transparent|current|black|white)$/.test(utility) ||
    /^bg-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}$/.test(
      utility,
    )
  ) {
    return "background";
  }

  if (BORDER_RADIUS_PATTERN.test(utility)) return "border-radius";
  if (OBJECT_FIT_PATTERN.test(utility)) return "object-fit";
  if (OBJECT_POSITION_PATTERN.test(utility)) return "object-position";
  if (ASPECT_RATIO_PATTERN.test(utility)) return "aspect-ratio";
  if (DISPLAY_PATTERN.test(utility)) return "display";
  if (FLEX_DIRECTION_PATTERN.test(utility)) return "flex-direction";
  if (GAP_PATTERN.test(utility)) return "gap";
  if (WIDTH_PATTERN.test(utility)) return "width";
  if (HEIGHT_PATTERN.test(utility)) return "height";
  if (POSITION_PATTERN.test(utility)) return "position";
  if (TOP_PATTERN.test(utility)) return "top";
  if (LEFT_PATTERN.test(utility)) return "left";
  if (Z_INDEX_PATTERN.test(utility)) return "z-index";
  if (ROTATE_PATTERN.test(utility)) return "rotate";
  if (OPACITY_PATTERN.test(utility)) return "opacity";
  if (OVERFLOW_PATTERN.test(utility)) return "overflow";
  return "other";
}

function splitTopLevel(input: string, separator: ":" | "whitespace"): string[] {
  const parts: string[] = [];
  let current = "";
  let square = 0;
  let round = 0;
  let curly = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const flush = () => {
    if (current) parts.push(current);
    current = "";
  };

  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      current += ch;
      escaped = true;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === "[") square++;
    else if (ch === "]") square = Math.max(0, square - 1);
    else if (ch === "(") round++;
    else if (ch === ")") round = Math.max(0, round - 1);
    else if (ch === "{") curly++;
    else if (ch === "}") curly = Math.max(0, curly - 1);

    const atTopLevel = square === 0 && round === 0 && curly === 0;
    if (separator === ":" && ch === ":" && atTopLevel) {
      flush();
      continue;
    }
    if (separator === "whitespace" && /\s/.test(ch) && atTopLevel) {
      flush();
      continue;
    }
    current += ch;
  }

  flush();
  return parts;
}

export function parseTailwindToken(rawToken: string): TailwindToken {
  const parts = splitTopLevel(rawToken, ":");
  const utility = parts.pop() ?? "";
  return {
    raw: rawToken,
    variants: parts,
    utility,
    propertyFamily: classifyTailwindUtility(utility),
  };
}

export function tokenizeTailwindClasses(className?: string): TailwindToken[] {
  if (!className || typeof className !== "string") return [];
  return splitTopLevel(className.trim(), "whitespace")
    .filter(Boolean)
    .map(parseTailwindToken);
}

function areVariantsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((variant, index) => variant === b[index]);
}

function normalizeReplacementUtility(value: string): string {
  if (!value) return "";
  const parsed = parseTailwindToken(value);
  return parsed.utility || value;
}

export function patchTailwindClasses(
  currentClassName: string,
  options: PatchTailwindOptions,
): string {
  const tokens = tokenizeTailwindClasses(currentClassName);
  const targetVariants = options.targetVariants ?? [];
  const replacementUtility = normalizeReplacementUtility(options.value);
  const result: TailwindToken[] = [];
  let replaced = false;

  for (const token of tokens) {
    const isSameFamily =
      token.propertyFamily === options.property ||
      ((token.propertyFamily === "background" || token.propertyFamily === "background-color") &&
        (options.property === "background" || options.property === "background-color"));
    const matches = isSameFamily && areVariantsEqual(token.variants, targetVariants);

    if (!matches) {
      result.push(token);
      continue;
    }

    if (!replaced && replacementUtility) {
      const raw = [...targetVariants, replacementUtility].join(":");
      result.push(parseTailwindToken(raw));
      replaced = true;
    }
  }

  if (!replaced && replacementUtility) {
    const raw = [...targetVariants, replacementUtility].join(":");
    result.push(parseTailwindToken(raw));
  }

  return result.map((token) => token.raw).join(" ");
}
