import type { TailwindClassSuggestion } from "./tailwind-class-suggestions";

/**
 * The utilities a Theme's own `@theme` tokens name.
 *
 * Tailwind v4 keeps the design tokens in CSS, and a Theme's `src/styles/*.css`
 * is where they are declared, so that file — not a list maintained here — is
 * what says which `bg-*`, `font-*` and `rounded-*` utilities exist. Deriving
 * them means a token the author adds is offered as soon as it is typed, instead
 * of waiting for someone to remember to update a snapshot of Tailwind's
 * defaults.
 *
 * Derived classes are offered *alongside* the static list, never instead of it:
 * a gap in this derivation then costs the author nothing, where replacing the
 * list would quietly take away suggestions they already had.
 */

/** Token namespaces, and the utility prefixes each one names. */
const TOKEN_UTILITY_PREFIXES: Record<string, readonly string[]> = {
  color: [
    "bg",
    "text",
    "border",
    "ring",
    "fill",
    "stroke",
    "outline",
    "from",
    "via",
    "to",
    "divide",
    "decoration",
    "accent",
    "caret",
  ],
  font: ["font"],
  radius: ["rounded"],
  shadow: ["shadow"],
  text: ["text"],
  tracking: ["tracking"],
  leading: ["leading"],
  blur: ["blur"],
  animate: ["animate"],
  ease: ["ease"],
  container: ["max-w", "w"],
};

/**
 * The body of every `@theme` block, by brace depth.
 *
 * Scanned rather than matched with one expression: Tailwind's own default theme
 * nests `@keyframes` inside the block, and a non-greedy match stops at the
 * first closing brace — which would truncate the token list at the first
 * animation and silently lose every token after it.
 */
function themeBlockBodies(css: string): string[] {
  const bodies: string[] = [];
  const pattern = /@theme\b[^{]*\{/g;
  let match = pattern.exec(css);
  while (match) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (index < css.length && depth > 0) {
      const character = css[index];
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      index += 1;
    }
    // The text before the closing brace the scan consumed.
    bodies.push(css.slice(start, index - 1));
    match = pattern.exec(css);
  }
  return bodies;
}

/**
 * Custom properties a `@theme` block declares, as `namespace` and `name`.
 *
 * Sub-properties (`--text-xl--line-height`) and Tailwind's own bookkeeping
 * (`--default-font-family`) are not tokens anyone writes a utility against.
 */
function themeTokens(css: string): Array<{ namespace: string; name: string }> {
  const tokens: Array<{ namespace: string; name: string }> = [];
  for (const body of themeBlockBodies(css)) {
    for (const declaration of body.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) {
      const trimmed = declaration[1]!.slice(2);
      if (trimmed.startsWith("default-")) continue;
      const separator = trimmed.indexOf("-");
      if (separator <= 0) continue;
      const namespace = trimmed.slice(0, separator);
      const name = trimmed.slice(separator + 1);
      if (!name || name.includes("--")) continue;
      if (!(namespace in TOKEN_UTILITY_PREFIXES)) continue;
      tokens.push({ namespace, name });
    }
  }
  return tokens;
}

/** Every utility the given stylesheets declare tokens for, without duplicates. */
export function deriveThemeTokenClasses(
  css: string,
): TailwindClassSuggestion[] {
  const seen = new Set<string>();
  const suggestions: TailwindClassSuggestion[] = [];

  for (const { namespace, name } of themeTokens(css)) {
    for (const prefix of TOKEN_UTILITY_PREFIXES[namespace] ?? []) {
      const value = `${prefix}-${name}`;
      if (seen.has(value)) continue;
      seen.add(value);
      suggestions.push({ value, group: `Theme ${namespace}` });
    }
  }

  return suggestions;
}
