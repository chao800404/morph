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
  | "border-radius"
  | "other";

export interface TailwindToken {
  raw: string;
  variants: string[]; // e.g. ["md"], ["hover"], ["md", "hover"], []
  utility: string;    // e.g. "text-6xl", "text-[100px]", "p-8"
  propertyFamily: TailwindPropertyFamily;
}

const FONT_SIZE_PATTERN = /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl|\[.+\])$/;
const FONT_FAMILY_PATTERN = /^font-(serif|sans|mono|\[.+\])$/;
const FONT_WEIGHT_PATTERN = /^font-(light|normal|medium|semibold|bold|extrabold|black|\[.+\])$/;
const TEXT_ALIGN_PATTERN = /^text-(left|center|right|justify|start|end)$/;
const LINE_HEIGHT_PATTERN = /^leading-(none|tight|snug|normal|relaxed|loose|\[.+\]|\d+)$/;
const PADDING_ALL_PATTERN = /^p-(auto|\d+|\[.+\])$/;
const PADDING_TOP_PATTERN = /^pt-(auto|\d+|\[.+\])$/;
const PADDING_BOTTOM_PATTERN = /^pb-(auto|\d+|\[.+\])$/;
const PADDING_LEFT_PATTERN = /^pl-(auto|\d+|\[.+\])$/;
const PADDING_RIGHT_PATTERN = /^pr-(auto|\d+|\[.+\])$/;
const PADDING_X_PATTERN = /^px-(auto|\d+|\[.+\])$/;
const PADDING_Y_PATTERN = /^py-(auto|\d+|\[.+\])$/;
const BACKGROUND_PATTERN = /^bg-(?!gradient|opacity|repeat|fixed|cover|contain|auto|center|top|bottom|left|right)(.+)$/;
const BORDER_RADIUS_PATTERN = /^rounded(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full|-\[.+\]|\[.+\])?$/;

/**
 * Classifies a Tailwind utility into a property family.
 */
export function classifyTailwindUtility(utility: string): TailwindPropertyFamily {
  if (FONT_SIZE_PATTERN.test(utility)) return "font-size";
  if (FONT_FAMILY_PATTERN.test(utility)) return "font-family";
  if (FONT_WEIGHT_PATTERN.test(utility)) return "font-weight";
  if (TEXT_ALIGN_PATTERN.test(utility)) return "text-align";
  if (LINE_HEIGHT_PATTERN.test(utility)) return "line-height";
  if (PADDING_ALL_PATTERN.test(utility)) return "padding";
  if (PADDING_TOP_PATTERN.test(utility)) return "padding-top";
  if (PADDING_BOTTOM_PATTERN.test(utility)) return "padding-bottom";
  if (PADDING_LEFT_PATTERN.test(utility)) return "padding-left";
  if (PADDING_RIGHT_PATTERN.test(utility)) return "padding-right";
  if (PADDING_X_PATTERN.test(utility)) return "padding-x";
  if (PADDING_Y_PATTERN.test(utility)) return "padding-y";
  if (BACKGROUND_PATTERN.test(utility)) return "background";
  if (BORDER_RADIUS_PATTERN.test(utility)) return "border-radius";
  return "other";
}

/**
 * Parses a single raw class token (e.g. "md:hover:text-[100px]") into structured token components.
 */
export function parseTailwindToken(rawToken: string): TailwindToken {
  const parts = rawToken.split(":");
  const utility = parts[parts.length - 1] ?? "";
  const variants = parts.slice(0, parts.length - 1);
  const propertyFamily = classifyTailwindUtility(utility);

  return {
    raw: rawToken,
    variants,
    utility,
    propertyFamily,
  };
}

/**
 * Parses a full className string into an array of structured TailwindToken objects.
 */
export function tokenizeTailwindClasses(className?: string): TailwindToken[] {
  if (!className || typeof className !== "string") return [];
  const rawTokens = className.trim().split(/\s+/).filter(Boolean);
  return rawTokens.map(parseTailwindToken);
}

export interface PatchTailwindOptions {
  property: TailwindPropertyFamily;
  value: string; // The utility or full token to set (e.g. "text-[100px]" or "p-8", or empty string to remove)
  targetVariants?: string[]; // Empty array for base/mobile class, or e.g. ["md"], ["hover"]
}

function areVariantsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

/**
 * Patches a Tailwind className string with variant awareness.
 * Guarantees that updating a base class will NEVER remove or mutate variant classes like md:text-6xl or hover:text-red-500.
 */
export function patchTailwindClasses(
  currentClassName: string,
  options: PatchTailwindOptions,
): string {
  const tokens = tokenizeTailwindClasses(currentClassName);
  const targetVariants = options.targetVariants ?? [];

  // Determine which tokens match the target property and target variants
  const remainingTokens: TailwindToken[] = [];
  let replaced = false;

  for (const token of tokens) {
    const matchesProperty = token.propertyFamily === options.property;
    const matchesVariants = areVariantsEqual(token.variants, targetVariants);

    if (matchesProperty && matchesVariants) {
      if (!replaced && options.value) {
        // Build replacement token with target variants
        const prefix = targetVariants.length > 0 ? `${targetVariants.join(":")}:` : "";
        const cleanUtility = options.value.includes(":")
          ? options.value.split(":").pop()!
          : options.value;
        const newRaw = `${prefix}${cleanUtility}`;
        remainingTokens.push(parseTailwindToken(newRaw));
        replaced = true;
      }
      // If options.value is empty, token is dropped (removed)
    } else {
      remainingTokens.push(token);
    }
  }

  // If no matching token was found and we have a value to insert
  if (!replaced && options.value) {
    const prefix = targetVariants.length > 0 ? `${targetVariants.join(":")}:` : "";
    const cleanUtility = options.value.includes(":")
      ? options.value.split(":").pop()!
      : options.value;
    const newRaw = `${prefix}${cleanUtility}`;
    remainingTokens.push(parseTailwindToken(newRaw));
  }

  return remainingTokens.map((t) => t.raw).join(" ");
}
