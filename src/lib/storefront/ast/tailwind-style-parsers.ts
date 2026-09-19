/**
 * Tailwind utility parsers used by the visual style inspector.
 *
 * These parsers are intentionally separate from the JSX AST transformer: they
 * interpret class tokens, while the transformer owns source locations and
 * source edits. Keeping the boundary explicit prevents compiler changes from
 * silently changing inspector semantics.
 */

const TAILWIND_FONT_SIZE_MAP: Record<string, number> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
  "5xl": 48,
  "6xl": 60,
  "7xl": 72,
  "8xl": 96,
  "9xl": 128,
};

export type TailwindFontSizeResult =
  | { type: "exact"; value: number }
  | { type: "complex"; raw: string }
  | { type: "none" };

/**
 * Detailed parser for font size from Tailwind className string, supporting complex clamp()/calc() expressions.
 */
export function parseTailwindFontSizeDetailed(
  className?: string,
): TailwindFontSizeResult {
  if (!className) return { type: "none" };

  // Check complex arbitrary expressions first e.g. text-[clamp(3.25rem,7vw,7rem)]
  const complexMatch = className.match(
    /\btext-\[(clamp\(.+?\)|calc\(.+?\)|min\(.+?\)|max\(.+?\))\]/,
  );
  if (complexMatch) {
    return { type: "complex", raw: complexMatch[1] };
  }

  // Check exact pixel values e.g. text-[100px] or text-[64]
  const arbitraryMatch = className.match(/\btext-\[(\d+)(?:px)?\]/);
  if (arbitraryMatch) {
    return { type: "exact", value: parseInt(arbitraryMatch[1], 10) };
  }

  // Check standard token scale e.g. text-6xl
  const tokenMatch = className.match(
    /\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/,
  );
  if (tokenMatch && TAILWIND_FONT_SIZE_MAP[tokenMatch[1]]) {
    return { type: "exact", value: TAILWIND_FONT_SIZE_MAP[tokenMatch[1]] };
  }

  return { type: "none" };
}

/**
 * Parses font size in pixels from Tailwind className string. Returns null if missing or complex.
 */
export function parseTailwindFontSize(className?: string): number | null {
  const res = parseTailwindFontSizeDetailed(className);
  return res.type === "exact" ? res.value : null;
}

/**
 * Parses font family from Tailwind className string.
 */
export function parseTailwindFontFamily(className?: string): string | null {
  if (!className) return null;
  const match = className.match(/\bfont-(serif|sans|mono)\b/);
  return match ? match[1] : null;
}

/**
 * Parses font weight from Tailwind className string.
 */
export function parseTailwindFontWeight(className?: string): string | null {
  if (!className) return null;
  const match = className.match(/\bfont-(light|normal|medium|semibold|bold)\b/);
  if (!match) return null;
  switch (match[1]) {
    case "light":
      return "300";
    case "normal":
      return "normal";
    case "medium":
      return "medium";
    case "semibold":
    case "bold":
      return "bold";
    default:
      return null;
  }
}

/**
 * Parses text alignment from Tailwind className string.
 */
export function parseTailwindTextAlign(
  className?: string,
): "left" | "center" | "right" | null {
  if (!className) return null;
  const match = className.match(/\btext-(left|center|right)\b/);
  return match ? (match[1] as "left" | "center" | "right") : null;
}

/**
 * Parses line height multiplier from Tailwind className string.
 */
export function parseTailwindLineHeight(className?: string): number | null {
  if (!className) return null;
  const arbitraryMatch = className.match(/\bleading-\[(\d+(?:\.\d+)?)\]/);
  if (arbitraryMatch) {
    return parseFloat(arbitraryMatch[1]);
  }
  const tokenMatch = className.match(
    /\bleading-(none|tight|snug|normal|relaxed|loose)\b/,
  );
  if (tokenMatch) {
    switch (tokenMatch[1]) {
      case "none":
        return 1;
      case "tight":
        return 1.25;
      case "snug":
        return 1.375;
      case "normal":
        return 1.5;
      case "relaxed":
        return 1.625;
      case "loose":
        return 2;
    }
  }
  return null;
}

const TAILWIND_SPACING_SCALE: Record<string, number> = {
  "0": 0,
  "1": 4,
  "2": 8,
  "3": 12,
  "4": 16,
  "5": 20,
  "6": 24,
  "8": 32,
  "10": 40,
  "12": 48,
  "16": 64,
  "20": 80,
  "24": 96,
  "32": 128,
};

/**
 * Parses padding values in pixels from Tailwind className string.
 */
export function parseTailwindPadding(className?: string): {
  all?: number;
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  x?: number;
  y?: number;
} {
  if (!className) return {};
  const res: {
    all?: number;
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
    x?: number;
    y?: number;
  } = {};

  const allMatch = className.match(/\bp-\[(\d+)(?:px)?\]/);
  if (allMatch) res.all = parseInt(allMatch[1], 10);
  else {
    const token = className.match(/\bp-(\d+)\b/);
    if (token && TAILWIND_SPACING_SCALE[token[1]] !== undefined) {
      res.all = TAILWIND_SPACING_SCALE[token[1]];
    }
  }

  const yMatch = className.match(/\bpy-\[(\d+)(?:px)?\]/);
  if (yMatch) res.y = parseInt(yMatch[1], 10);
  else {
    const token = className.match(/\bpy-(\d+)\b/);
    if (token && TAILWIND_SPACING_SCALE[token[1]] !== undefined) {
      res.y = TAILWIND_SPACING_SCALE[token[1]];
    }
  }

  const xMatch = className.match(/\bpx-\[(\d+)(?:px)?\]/);
  if (xMatch) res.x = parseInt(xMatch[1], 10);
  else {
    const token = className.match(/\bpx-(\d+)\b/);
    if (token && TAILWIND_SPACING_SCALE[token[1]] !== undefined) {
      res.x = TAILWIND_SPACING_SCALE[token[1]];
    }
  }

  const topMatch = className.match(/\bpt-\[(\d+)(?:px)?\]/);
  if (topMatch) res.top = parseInt(topMatch[1], 10);

  const bottomMatch = className.match(/\bpb-\[(\d+)(?:px)?\]/);
  if (bottomMatch) res.bottom = parseInt(bottomMatch[1], 10);

  const leftMatch = className.match(/\bpl-\[(\d+)(?:px)?\]/);
  if (leftMatch) res.left = parseInt(leftMatch[1], 10);

  const rightMatch = className.match(/\bpr-\[(\d+)(?:px)?\]/);
  if (rightMatch) res.right = parseInt(rightMatch[1], 10);

  return res;
}

const TAILWIND_COLOR_MAP: Record<string, string> = {
  "bg-white": "#ffffff",
  "bg-black": "#000000",
  "bg-stone-50": "#fafaf9",
  "bg-stone-100": "#f5f5f4",
  "bg-stone-200": "#e7e5e4",
  "bg-stone-900": "#1c1917",
  "bg-stone-950": "#0c0a09",
  "bg-slate-50": "#f8fafc",
  "bg-slate-100": "#f1f5f9",
  "bg-slate-900": "#0f172a",
  "bg-zinc-50": "#fafafa",
  "bg-zinc-100": "#f4f4f5",
  "bg-zinc-900": "#18181b",
};

/**
 * Parses background color hex from Tailwind className string.
 */
export function parseTailwindBackgroundColor(
  className?: string,
): string | null {
  if (!className) return null;
  const arbitraryMatch = className.match(/\bbg-\[(#\w{3,8}|rgba?\(.+?\))\]/);
  if (arbitraryMatch) {
    return arbitraryMatch[1];
  }
  for (const [token, hex] of Object.entries(TAILWIND_COLOR_MAP)) {
    if (new RegExp(`\\b${token}\\b`).test(className)) {
      return hex;
    }
  }
  return null;
}

const TAILWIND_TEXT_COLOR_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(TAILWIND_COLOR_MAP).map(([token, color]) => [
    token.replace(/^bg-/, "text-"),
    color,
  ]),
);

/** Parses text color hex from a Tailwind className string. */
export function parseTailwindTextColor(className?: string): string | null {
  if (!className) return null;
  const arbitraryMatch = className.match(/\btext-\[(#\w{3,8}|rgba?\(.+?\))\]/);
  if (arbitraryMatch) return arbitraryMatch[1];
  for (const [token, hex] of Object.entries(TAILWIND_TEXT_COLOR_MAP)) {
    if (new RegExp("\\b" + token + "\\b").test(className)) return hex;
  }
  return null;
}

const TAILWIND_RADIUS_MAP: Record<string, number> = {
  none: 0,
  sm: 2,
  DEFAULT: 4,
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  "3xl": 24,
  full: 9999,
};

/**
 * Parses border radius in pixels from Tailwind className string.
 */
export function parseTailwindBorderRadius(className?: string): number | null {
  if (!className) return null;
  const arbitraryMatch = className.match(
    /(?:^|\s)(?:[a-z0-9-]+:)*rounded-\[(-?\d+(?:\.\d+)?)(?:px)?\](?=\s|$)/i,
  );
  if (arbitraryMatch) {
    return Number.parseFloat(arbitraryMatch[1]);
  }
  const tokenMatch = className.match(
    /(?:^|\s)(?:[a-z0-9-]+:)*rounded-(none|sm|md|lg|xl|2xl|3xl|full)(?=\s|$)/,
  );
  if (tokenMatch && TAILWIND_RADIUS_MAP[tokenMatch[1]] !== undefined) {
    return TAILWIND_RADIUS_MAP[tokenMatch[1]];
  }
  if (/(?:^|\s)(?:[a-z0-9-]+:)*rounded(?=\s|$)/.test(className)) {
    return TAILWIND_RADIUS_MAP.DEFAULT;
  }
  return null;
}

export type TailwindBorderRadii = {
  all: number | null;
  topLeft: number | null;
  topRight: number | null;
  bottomRight: number | null;
  bottomLeft: number | null;
};

function parseTailwindCornerRadius(
  className: string,
  corner: "tl" | "tr" | "br" | "bl",
): number | null {
  const arbitraryMatch = className.match(
    new RegExp(`\\brounded-${corner}-\\[(-?\\d+(?:\\.\\d+)?)(?:px)?\\]`),
  );
  if (arbitraryMatch) return Number.parseFloat(arbitraryMatch[1]);
  const tokenMatch = className.match(
    new RegExp(`\\brounded-${corner}-(none|sm|md|lg|xl|2xl|3xl|full)\\b`),
  );
  return tokenMatch && TAILWIND_RADIUS_MAP[tokenMatch[1]] !== undefined
    ? TAILWIND_RADIUS_MAP[tokenMatch[1]]
    : null;
}

export function parseTailwindBorderRadii(
  className?: string,
): TailwindBorderRadii {
  const source = className ?? "";
  const all = parseTailwindBorderRadius(source);
  return {
    all,
    topLeft: parseTailwindCornerRadius(source, "tl") ?? all,
    topRight: parseTailwindCornerRadius(source, "tr") ?? all,
    bottomRight: parseTailwindCornerRadius(source, "br") ?? all,
    bottomLeft: parseTailwindCornerRadius(source, "bl") ?? all,
  };
}

export function parseTailwindBorderWidth(className?: string): number | null {
  if (!className) return null;
  const arbitraryMatch = className.match(
    /(?:^|\s)(?:[a-z0-9-]+:)*border-\[(-?\d+(?:\.\d+)?)px\](?=\s|$)/i,
  );
  if (arbitraryMatch) return Number.parseFloat(arbitraryMatch[1]);
  const namedMatch = className.match(
    /(?:^|\s)(?:[a-z0-9-]+:)*border(?:-(0|2|4|8))?(?=\s|$)/,
  );
  if (!namedMatch) return null;
  return namedMatch[1] ? Number.parseInt(namedMatch[1], 10) : 1;
}

/**
 * The shadow size on a class list, or `null` when it sets none.
 *
 * Only the size utilities. `shadow-red-500` sets a colour and leaves the size
 * where it was, so reporting it as a size would make the control show a shadow
 * the element does not have — and committing from that reading would delete the
 * colour. An arbitrary `shadow-[...]` is a full shadow this control cannot
 * represent, so it reads as `null` and the element keeps it until something
 * else is chosen.
 */
export function parseTailwindBoxShadow(className?: string): string | null {
  if (!className) return null;
  return (
    className.match(
      /(?:^|\s)(?:[a-z0-9-]+:)*shadow-(none|2xs|xs|sm|md|lg|xl|2xl|inner)(?=\s|$)/,
    )?.[1] ?? null
  );
}

export function parseTailwindBorderStyle(className?: string): string | null {
  if (!className) return null;
  return (
    className.match(
      /(?:^|\s)(?:[a-z0-9-]+:)*border-(solid|dashed|dotted|double|hidden|none)(?=\s|$)/,
    )?.[1] ?? null
  );
}

const TAILWIND_BORDER_COLOR_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(TAILWIND_COLOR_MAP).map(([token, color]) => [
    token.replace(/^bg-/, "border-"),
    color,
  ]),
);

export function parseTailwindBorderColor(className?: string): string | null {
  if (!className) return null;
  const arbitraryMatch = className.match(
    /(?:^|\s)(?:[a-z0-9-]+:)*border-\[((?:#(?:[0-9a-f]{3,8})|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(.+?\)))\](?=\s|$)/i,
  );
  if (arbitraryMatch) return arbitraryMatch[1];
  for (const [token, color] of Object.entries(TAILWIND_BORDER_COLOR_MAP)) {
    if (
      new RegExp(`(?:^|\\s)(?:[a-z0-9-]+:)*${token}(?=\\s|$)`).test(className)
    ) {
      return color;
    }
  }
  return null;
}
