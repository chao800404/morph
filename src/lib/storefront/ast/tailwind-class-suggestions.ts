export type TailwindClassSuggestion = {
  value: string;
  group: string;
};

const SPACING = [
  "0", "px", "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "5", "6",
  "7", "8", "9", "10", "11", "12", "14", "16", "20", "24", "28", "32",
  "36", "40", "44", "48", "52", "56", "60", "64", "72", "80", "96",
];
const FRACTIONS = ["1/2", "1/3", "2/3", "1/4", "2/4", "3/4", "full", "screen", "min", "max", "fit"];
const COLORS = [
  "slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber",
  "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue",
  "indigo", "violet", "purple", "fuchsia", "pink", "rose",
];
const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];

function entries(group: string, values: string[]): TailwindClassSuggestion[] {
  return values.map((value) => ({ value, group }));
}

function prefixed(prefixes: string[], values: string[]): string[] {
  return prefixes.flatMap((prefix) => values.map((value) => `${prefix}-${value}`));
}

const BASE_SUGGESTIONS: TailwindClassSuggestion[] = [
  ...entries("Layout", [
    "block", "inline-block", "inline", "flex", "inline-flex", "grid", "inline-grid",
    "hidden", "contents", "flow-root", "static", "fixed", "absolute", "relative", "sticky",
    "isolate", "visible", "invisible", "overflow-auto", "overflow-hidden", "overflow-clip",
    "overflow-visible", "overflow-scroll", "overflow-x-auto", "overflow-y-auto", "object-contain",
    "object-cover", "object-fill", "object-none", "object-scale-down", "aspect-auto", "aspect-square",
    "aspect-video", "container", "box-border", "box-content",
  ]),
  ...entries("Position", [
    ...prefixed(["inset", "inset-x", "inset-y", "top", "right", "bottom", "left"], ["0", "1/2", "full", "auto"]),
    ...prefixed(["z"], ["0", "10", "20", "30", "40", "50", "auto"]),
  ]),
  ...entries("Flex & Grid", [
    "flex-row", "flex-row-reverse", "flex-col", "flex-col-reverse", "flex-wrap", "flex-nowrap",
    "flex-1", "flex-auto", "flex-initial", "flex-none", "grow", "grow-0", "shrink", "shrink-0",
    "items-start", "items-end", "items-center", "items-baseline", "items-stretch",
    "justify-normal", "justify-start", "justify-end", "justify-center", "justify-between", "justify-around", "justify-evenly",
    "content-start", "content-end", "content-center", "content-between", "content-around", "content-evenly", "content-stretch",
    "self-auto", "self-start", "self-end", "self-center", "self-stretch", "place-items-center", "place-content-center",
    ...prefixed(["grid-cols", "grid-rows"], ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "none"]),
    ...prefixed(["col-span", "row-span"], ["1", "2", "3", "4", "5", "6", "full"]),
    ...prefixed(["gap", "gap-x", "gap-y"], SPACING),
  ]),
  ...entries("Spacing", [
    ...prefixed(["p", "px", "py", "pt", "pr", "pb", "pl", "m", "mx", "my", "mt", "mr", "mb", "ml", "space-x", "space-y"], SPACING),
    "mx-auto", "my-auto", "mt-auto", "mr-auto", "mb-auto", "ml-auto",
  ]),
  ...entries("Sizing", [
    ...prefixed(["w", "min-w", "max-w", "h", "min-h", "max-h"], [...SPACING, ...FRACTIONS]),
    "w-auto", "h-auto", "size-full", "size-fit", ...prefixed(["size"], SPACING),
  ]),
  ...entries("Typography", [
    "font-sans", "font-serif", "font-mono", "font-thin", "font-extralight", "font-light", "font-normal",
    "font-medium", "font-semibold", "font-bold", "font-extrabold", "font-black", "italic", "not-italic",
    ...prefixed(["text"], ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"]),
    "text-left", "text-center", "text-right", "text-justify", "text-start", "text-end",
    ...prefixed(["leading"], ["none", "tight", "snug", "normal", "relaxed", "loose"]),
    ...prefixed(["tracking"], ["tighter", "tight", "normal", "wide", "wider", "widest"]),
    "uppercase", "lowercase", "capitalize", "normal-case", "underline", "overline", "line-through", "no-underline",
    "truncate", "text-ellipsis", "text-clip", "whitespace-normal", "whitespace-nowrap", "break-words", "break-all",
  ]),
  ...entries("Colors", [
    "bg-transparent", "bg-current", "bg-black", "bg-white", "text-transparent", "text-current", "text-black", "text-white",
    "border-transparent", "border-current", "border-black", "border-white",
    ...["bg", "text", "border", "ring", "outline", "fill", "stroke"].flatMap((prefix) =>
      COLORS.flatMap((color) => SHADES.map((shade) => `${prefix}-${color}-${shade}`)),
    ),
  ]),
  ...entries("Borders & Effects", [
    "border", "border-0", "border-2", "border-4", "border-8", "border-t", "border-r", "border-b", "border-l",
    "rounded-none", "rounded-sm", "rounded", "rounded-md", "rounded-lg", "rounded-xl", "rounded-2xl", "rounded-3xl", "rounded-full",
    "shadow-2xs", "shadow-xs", "shadow-sm", "shadow-md", "shadow-lg", "shadow-xl", "shadow-2xl", "shadow-none",
    ...prefixed(["opacity"], ["0", "5", "10", "20", "25", "30", "40", "50", "60", "70", "75", "80", "90", "95", "100"]),
    "ring", "ring-0", "ring-1", "ring-2", "ring-4", "ring-8", "ring-inset",
  ]),
  ...entries("Motion & Interaction", [
    "transition", "transition-all", "transition-colors", "transition-opacity", "transition-shadow", "transition-transform", "transition-none",
    "duration-75", "duration-100", "duration-150", "duration-200", "duration-300", "duration-500", "duration-700", "duration-1000",
    "ease-linear", "ease-in", "ease-out", "ease-in-out", "animate-none", "animate-spin", "animate-ping", "animate-pulse", "animate-bounce",
    "cursor-auto", "cursor-default", "cursor-pointer", "cursor-wait", "cursor-text", "cursor-move", "cursor-not-allowed",
    "select-none", "select-text", "select-all", "select-auto", "pointer-events-none", "pointer-events-auto",
  ]),
  ...entries("Transforms", [
    "transform", "transform-none", "origin-center", "scale-0", "scale-50", "scale-75", "scale-90", "scale-95", "scale-100", "scale-105", "scale-110", "scale-125", "scale-150",
    ...prefixed(["rotate"], ["0", "1", "2", "3", "6", "12", "45", "90", "180"]),
    ...prefixed(["translate-x", "translate-y"], ["0", "1/2", "full"]),
  ]),
];

function splitVariantPrefix(query: string): { prefix: string; utility: string } {
  let bracketDepth = 0;
  let lastColon = -1;
  for (let index = 0; index < query.length; index += 1) {
    const char = query[index];
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (char === ":" && bracketDepth === 0) lastColon = index;
  }
  return lastColon < 0
    ? { prefix: "", utility: query }
    : { prefix: query.slice(0, lastColon + 1), utility: query.slice(lastColon + 1) };
}

function scoreCandidate(candidate: string, query: string): number {
  if (!query) return 4;
  if (candidate === query) return 0;
  if (candidate.startsWith(query)) return 1;
  if (candidate.split("-").some((part) => part.startsWith(query))) return 2;
  if (candidate.includes(query)) return 3;
  return Number.POSITIVE_INFINITY;
}

export function suggestTailwindClasses(
  query: string,
  excluded: ReadonlySet<string> = new Set(),
  limit = 32,
): TailwindClassSuggestion[] {
  const normalized = query.trim();
  const { prefix, utility } = splitVariantPrefix(normalized);
  return BASE_SUGGESTIONS
    .map((suggestion, index) => ({
      ...suggestion,
      value: `${prefix}${suggestion.value}`,
      score: scoreCandidate(suggestion.value, utility),
      index,
    }))
    .filter((suggestion) => Number.isFinite(suggestion.score) && !excluded.has(suggestion.value))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map(({ value, group }) => ({ value, group }));
}
