export type TailwindPropertyFamily =
  | "font-size"
  | "font-family"
  | "font-weight"
  | "text-align"
  | "text-color"
  | "line-height"
  | "padding"
  | "padding-top"
  | "padding-bottom"
  | "padding-left"
  | "padding-right"
  | "padding-x"
  | "padding-y"
  | "padding-inline-start"
  | "padding-inline-end"
  | "margin"
  | "margin-top"
  | "margin-bottom"
  | "margin-left"
  | "margin-right"
  | "margin-x"
  | "margin-y"
  | "margin-inline-start"
  | "margin-inline-end"
  | "background"
  | "background-color"
  | "background-clip"
  | "border-width"
  | "border-width-x"
  | "border-width-y"
  | "border-width-top"
  | "border-width-bottom"
  | "border-width-left"
  | "border-width-right"
  | "border-width-inline-start"
  | "border-width-inline-end"
  | "border-style"
  | "border-color"
  | "border-radius"
  | "border-radius-top"
  | "border-radius-right"
  | "border-radius-bottom"
  | "border-radius-left"
  | "border-radius-start"
  | "border-radius-end"
  | "border-radius-top-left"
  | "border-radius-top-right"
  | "border-radius-bottom-right"
  | "border-radius-bottom-left"
  | "border-radius-start-start"
  | "border-radius-start-end"
  | "border-radius-end-start"
  | "border-radius-end-end"
  | "object-fit"
  | "object-position"
  | "aspect-ratio"
  | "display"
  | "flex-direction"
  | "gap"
  | "width"
  | "height"
  | "min-width"
  | "min-height"
  | "max-width"
  | "max-height"
  | "position"
  | "top"
  | "left"
  | "z-index"
  | "rotate"
  | "opacity"
  | "box-shadow"
  | "cursor"
  | "transition"
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
  /** Structural variants currently matched by the selected DOM element. */
  activeVariants?: string[];
}

const FONT_SIZE_NAMES = new Set([
  "text-xs",
  "text-sm",
  "text-base",
  "text-lg",
  "text-xl",
  "text-2xl",
  "text-3xl",
  "text-4xl",
  "text-5xl",
  "text-6xl",
  "text-7xl",
  "text-8xl",
  "text-9xl",
]);

const FONT_WEIGHT_NAMES = new Set([
  "font-thin",
  "font-extralight",
  "font-light",
  "font-normal",
  "font-medium",
  "font-semibold",
  "font-bold",
  "font-extrabold",
  "font-black",
]);

const FONT_FAMILY_NAMES = new Set(["font-sans", "font-serif", "font-mono"]);
const TEXT_ALIGN_NAMES = new Set([
  "text-left",
  "text-center",
  "text-right",
  "text-justify",
  "text-start",
  "text-end",
]);
/**
 * The two arbitrary-value spellings Tailwind v4 accepts, as one constant.
 *
 * `p-(--gap)` and `p-[var(--gap)]` compile to the same declaration — measured
 * against the installed 4.1.17. The shorthand was missing from the spacing
 * patterns, so every `p-(--gap)` / `mx-(--gap)` classified as `"other"`, which
 * meant the sweep-up could never clear it: a broad `padding` write left the token
 * in place while the optimistic keys recorded all four sides as the new value,
 * and a clear of `padding` removed nothing at all.
 *
 * That was fixed family-by-family twice — spacing, then radius — and each time
 * the limit was written down as deliberate. **The justification for the first
 * limit was false.** It read "kept to the two families whose write path the
 * Inspector governs", but `FAMILY_COVERAGE` names controls for `gap`, `width`,
 * `height`, `min/max-width/height`, `top` and `left` as well.
 *
 * ## What the count actually is, and how it was obtained
 *
 * The hand-written candidate list that produced "fifteen families" was itself the
 * defect: it was assembled from memory, so it could only confirm what I already
 * believed. The list below comes from a generated candidate space — every
 * `^prefix` mentioned in this file's own pattern source, plus every
 * `<prefix>-(--var)` class the repository writes in `src/**` — compiled against
 * 4.1.17 and compared with `classifyTailwindUtility`. **29** of those are real
 * classes that declare a property on the element while the classifier returns
 * `"other"`, in two groups that need different fixes:
 *
 * ```
 * value form, 20 — the bracket twin IS classified, only the spelling is unparsed
 *   aspect bg border cursor gap h left max-h max-w min-h min-w object
 *   opacity rotate shadow text top transition w z
 *
 * upstream of the value form, 9 — both spellings are "other", so this is not
 * the same bug and is not fixed here:
 *   border-b border-e border-l border-r border-s border-t border-x border-y
 *     -> these emit border-<side>-color and the union has no colour family for
 *        a border side, so `border-t-red-500` is "other" too
 *   flex -> emits the `flex` shorthand; the union has `flex-direction` and no
 *        `flex` family, so `flex-[1_1_0%]` is "other" too
 * ```
 *
 * Twelve of the twenty are in families with a control — `cursor`, `gap`,
 * `height`, `max-height`, `max-width`, `min-height`, `min-width`, `opacity`,
 * `box-shadow`, `top`, `transition`, `width` — so for those the lie is reachable
 * today. It is not only reachable with a token someone would have to invent: the
 * repository already writes `w-(--sidebar-width)`,
 * `w-(--radix-dropdown-menu-trigger-width)`, `max-w-(--skeleton-width)`,
 * `min-h-(--hero-h)`, `max-h-(--radix-select-content-available-height)` and
 * `bg-(--brand-color)`, each of which a broad write leaves in place.
 *
 * ## Three things measured while establishing the above
 *
 * The type-hint spelling is not a value form: `text-(length:--s)` and
 * `shadow-(color:--s)` compile to **no rule** in 4.1.17, so there is nothing to
 * parse and the bare `\(.+\)` is the whole form.
 *
 * The variable's *name* decides the verdict for `bg-`, `border-` and `text-`,
 * because `looksLikeBackgroundColor` accepts a `var()` only when it is named
 * `--color*`, `--brand*`, `--surface*`, `--background*` or `--bg*`. Measured:
 * `bg-[var(--color-v)]` is `background` and `bg-[var(--v)]` is `"other"`. So a
 * probe that tests those three with an arbitrary variable name reports an
 * allowlist gap as a value-form gap; the table above used `--color-v`.
 *
 * The shorthand is accepted wherever the bracketed form is, so this constant is
 * the value form for every family that takes one — but it is *not* accepted by
 * `border-` for widths: `border-(--w)` resolves to `border-color: var(--w)`.
 * `RADIUS_VALUE` builds on this constant because it also carries the scale names.
 */
const BRACKET_OR_PAREN = String.raw`\[.+\]|\(.+\)`;
const LENGTH_FORMS = String.raw`\d+(?:\.\d+)?|${BRACKET_OR_PAREN}`;

const LINE_HEIGHT_PATTERN = new RegExp(
  `^leading-(?:none|tight|snug|normal|relaxed|loose|${LENGTH_FORMS})$`,
);
const PADDING_ALL_PATTERN = new RegExp(`^p-(?:${LENGTH_FORMS})$`);
const PADDING_TOP_PATTERN = new RegExp(`^pt-(?:${LENGTH_FORMS})$`);
const PADDING_BOTTOM_PATTERN = new RegExp(`^pb-(?:${LENGTH_FORMS})$`);
const PADDING_LEFT_PATTERN = new RegExp(`^pl-(?:${LENGTH_FORMS})$`);
const PADDING_RIGHT_PATTERN = new RegExp(`^pr-(?:${LENGTH_FORMS})$`);
const PADDING_X_PATTERN = new RegExp(`^px-(?:${LENGTH_FORMS})$`);
const PADDING_Y_PATTERN = new RegExp(`^py-(?:${LENGTH_FORMS})$`);
const MARGIN_ALL_PATTERN = new RegExp(`^(?:m-auto|-?m-(?:${LENGTH_FORMS}))$`);
const MARGIN_TOP_PATTERN = new RegExp(`^(?:mt-auto|-?mt-(?:${LENGTH_FORMS}))$`);
const MARGIN_BOTTOM_PATTERN = new RegExp(
  `^(?:mb-auto|-?mb-(?:${LENGTH_FORMS}))$`,
);
const MARGIN_LEFT_PATTERN = new RegExp(
  `^(?:ml-auto|-?ml-(?:${LENGTH_FORMS}))$`,
);
const MARGIN_RIGHT_PATTERN = new RegExp(
  `^(?:mr-auto|-?mr-(?:${LENGTH_FORMS}))$`,
);
const MARGIN_X_PATTERN = new RegExp(`^(?:mx-auto|-?mx-(?:${LENGTH_FORMS}))$`);
const MARGIN_Y_PATTERN = new RegExp(`^(?:my-auto|-?my-(?:${LENGTH_FORMS}))$`);
/**
 * The logical inline sides — `padding-inline-start` and friends.
 *
 * Measured against 4.1.17: `ps-4` emits `padding-inline-start`, `pe-4`
 * `padding-inline-end`; `ms-4`/`me-4` are the margin pair, which also accept
 * `auto` and a leading minus. Note the suffix is **glued** (`ps-4`, not
 * `p-s-4`) — a generator that assumes otherwise produces candidates that compile
 * to nothing and reports the prefix as absent.
 *
 * These were absent from the union entirely, so a broad `padding` write could not
 * clear a `ps-4`. The token survived and — Tailwind emitting the longhand after
 * the shorthand — **overrode** the write, while the optimistic keys recorded all
 * four sides as the new value. A clear of `padding` removed nothing at all.
 *
 * Unlike the physical edges, these containment edges need **no writing-mode
 * assumption**: `padding-inline` *is* the shorthand for `padding-inline-start`
 * plus `padding-inline-end`, so it determines them in any writing mode, and
 * `padding` determines them because it sets all four physical sides and a logical
 * side always resolves to one of them. See `inspector-family-containment.ts`.
 */
const PADDING_INLINE_START_PATTERN = /^ps-(?:\d+(?:\.\d+)?|\[.+\]|\(.+\))$/;
const PADDING_INLINE_END_PATTERN = /^pe-(?:\d+(?:\.\d+)?|\[.+\]|\(.+\))$/;
const MARGIN_INLINE_START_PATTERN =
  /^(?:ms-auto|-?ms-(?:\d+(?:\.\d+)?|\[.+\]|\(.+\)))$/;
const MARGIN_INLINE_END_PATTERN =
  /^(?:me-auto|-?me-(?:\d+(?:\.\d+)?|\[.+\]|\(.+\)))$/;
/**
 * The radius scale, in one place.
 *
 * It was previously spelled out in five separate patterns, and the enumeration
 * had drifted from the installed Tailwind. Measured against 4.1.17: `rounded-xs`
 * and `rounded-4xl` are real classes emitting `border-radius: var(--radius-xs)`
 * / `var(--radius-4xl)`, but every pattern stopped at `xl` and `3xl`. The four
 * corner patterns additionally required a `-<value>` suffix, so the bare
 * `rounded-tl` — also a real class, emitting `border-top-left-radius: 0.25rem` —
 * classified as `"other"`.
 *
 * `"other"` is not a harmless label here. `rounded-xs` declares `border-radius`,
 * so a broad radius write cannot clear it and it keeps deciding the rendered
 * corner while the optimistic keys record the new value — the same shape as the
 * `p-(--gap)` gap above, and closed the same way, by asking the compiler for the
 * scale rather than remembering it. Holding the scale in one constant is the part
 * that makes the next extension a one-line change instead of five.
 */
const RADIUS_SCALE = "none|xs|sm|md|lg|xl|2xl|3xl|4xl|full";
/**
 * The value forms the radius utilities accept.
 *
 * `\(.+\)` is the parenthesised CSS-variable shorthand, and it was missing here
 * for a while after the same form was added to the spacing patterns: measured
 * against 4.1.17, `rounded-(--r)` emits `border-radius: var(--r)`,
 * `rounded-t-(--r)` the two top corners, `rounded-ss-(--r)`
 * `border-start-start-radius`. All were classified `"other"`, so a broad radius
 * write could not clear them and they kept deciding the rendered corner.
 *
 * Note the asymmetry with the border family, measured the same way:
 * `border-(--w)` is **not** a width — Tailwind resolves the shorthand to
 * `border-color: var(--w)` — so `border-width` has no parenthesised form to add.
 * The spacing and radius families are the two that do.
 */
const RADIUS_VALUE = `(?:${RADIUS_SCALE}|\\[.+\\]|\\(.+\\))`;
const BORDER_RADIUS_PATTERN = new RegExp(`^rounded(?:-${RADIUS_VALUE})?$`);
const BORDER_RADIUS_TOP_LEFT_PATTERN = new RegExp(
  `^rounded-tl(?:-${RADIUS_VALUE})?$`,
);
const BORDER_RADIUS_TOP_RIGHT_PATTERN = new RegExp(
  `^rounded-tr(?:-${RADIUS_VALUE})?$`,
);
const BORDER_RADIUS_BOTTOM_RIGHT_PATTERN = new RegExp(
  `^rounded-br(?:-${RADIUS_VALUE})?$`,
);
const BORDER_RADIUS_BOTTOM_LEFT_PATTERN = new RegExp(
  `^rounded-bl(?:-${RADIUS_VALUE})?$`,
);
/**
 * The side pairs, which cover **two corners each** rather than one.
 *
 * Measured against 4.1.17: `rounded-t-2xl` emits `border-top-left-radius` *and*
 * `border-top-right-radius`, so `rounded-t` is not a rank between `rounded` and
 * the corners — it is a set that crosses the corner chain. The same holds for
 * `rounded-r`, `rounded-b` and `rounded-l`. A broad radius write therefore has to
 * clear them, which is why they need their own families rather than a place in a
 * chain.
 *
 * Tested after the two-letter corners: `rounded-tl` cannot be read as `rounded-t`
 * plus a value (no radius value starts with `l`), so the order is for readability
 * rather than to resolve an ambiguity — but the ambiguity is the thing a future
 * editor will wonder about, and this note is the answer.
 */
const BORDER_RADIUS_TOP_PATTERN = new RegExp(
  `^rounded-t(?:-${RADIUS_VALUE})?$`,
);
const BORDER_RADIUS_RIGHT_PATTERN = new RegExp(
  `^rounded-r(?:-${RADIUS_VALUE})?$`,
);
const BORDER_RADIUS_BOTTOM_PATTERN = new RegExp(
  `^rounded-b(?:-${RADIUS_VALUE})?$`,
);
const BORDER_RADIUS_LEFT_PATTERN = new RegExp(
  `^rounded-l(?:-${RADIUS_VALUE})?$`,
);
/**
 * The logical corners, and the two logical sides that cover them in pairs.
 *
 * Measured against 4.1.17: `rounded-ss-2xl` emits `border-start-start-radius`,
 * `rounded-se-*` `border-start-end-radius`, `rounded-es-*`
 * `border-end-start-radius` and `rounded-ee-*` `border-end-end-radius` — one
 * corner each. `rounded-s-2xl` emits `border-start-start-radius` **and**
 * `border-end-start-radius`, and `rounded-e-*` the other two, so those are pairs
 * like `rounded-t`.
 *
 * `rounded-s`/`rounded-e` were missing from the candidate list the first time
 * this set was enumerated, which is why they are here rather than in a follow-up:
 * a prefix list written by hand is a list that drifts, and this one already had.
 *
 * Longer forms are tested first. `rounded-ss` cannot be read as `rounded-s` plus a
 * value (no radius value starts with `s`), so that is readability rather than a
 * resolved ambiguity — but it is the ambiguity a reader will look for.
 */
const BORDER_RADIUS_START_START_PATTERN = new RegExp(
  `^rounded-ss(?:-${RADIUS_VALUE})?$`,
);
const BORDER_RADIUS_START_END_PATTERN = new RegExp(
  `^rounded-se(?:-${RADIUS_VALUE})?$`,
);
const BORDER_RADIUS_END_START_PATTERN = new RegExp(
  `^rounded-es(?:-${RADIUS_VALUE})?$`,
);
const BORDER_RADIUS_END_END_PATTERN = new RegExp(
  `^rounded-ee(?:-${RADIUS_VALUE})?$`,
);
const BORDER_RADIUS_START_PATTERN = new RegExp(
  `^rounded-s(?:-${RADIUS_VALUE})?$`,
);
const BORDER_RADIUS_END_PATTERN = new RegExp(
  `^rounded-e(?:-${RADIUS_VALUE})?$`,
);
const BORDER_STYLE_PATTERN =
  /^border-(?:solid|dashed|dotted|double|hidden|none)$/;
const OBJECT_FIT_PATTERN = /^object-(?:contain|cover|fill|none|scale-down)$/;
const OBJECT_POSITION_PATTERN = new RegExp(
  `^object-(?:center|top|right|bottom|left|top-right|top-left|bottom-right|bottom-left|${BRACKET_OR_PAREN})$`,
);
const ASPECT_RATIO_PATTERN = new RegExp(
  `^aspect-(?:auto|square|video|${BRACKET_OR_PAREN})$`,
);
const DISPLAY_PATTERN =
  /^(?:block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden)$/;
const FLEX_DIRECTION_PATTERN = /^flex-(?:row|row-reverse|col|col-reverse)$/;
const GAP_PATTERN = new RegExp(`^gap-(?:${LENGTH_FORMS})$`);
const WIDTH_PATTERN = new RegExp(
  `^w-(?:auto|full|screen|min|max|fit|px|\\d+\\/\\d+|${LENGTH_FORMS})$`,
);
const HEIGHT_PATTERN = new RegExp(
  `^h-(?:auto|full|screen|min|max|fit|${LENGTH_FORMS})$`,
);
const MIN_WIDTH_PATTERN = new RegExp(
  `^min-w-(?:0|full|min|max|fit|${LENGTH_FORMS})$`,
);
const MIN_HEIGHT_PATTERN = new RegExp(
  `^min-h-(?:0|full|screen|min|max|fit|${LENGTH_FORMS})$`,
);
const MAX_WIDTH_PATTERN = new RegExp(
  `^max-w-(?:none|full|screen|min|max|fit|prose|3xs|2xs|xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|${LENGTH_FORMS})$`,
);
const MAX_HEIGHT_PATTERN = new RegExp(
  `^max-h-(?:none|full|screen|min|max|fit|${LENGTH_FORMS})$`,
);
const POSITION_PATTERN = /^(?:static|relative|absolute|fixed|sticky)$/;
const TOP_PATTERN = new RegExp(`^-?top-(?:auto|full|${LENGTH_FORMS})$`);
const LEFT_PATTERN = new RegExp(`^-?left-(?:auto|full|${LENGTH_FORMS})$`);
const Z_INDEX_PATTERN = new RegExp(`^-?z-(?:auto|\\d+|${BRACKET_OR_PAREN})$`);
const ROTATE_PATTERN = new RegExp(`^-?rotate-(?:${LENGTH_FORMS})$`);
const OPACITY_PATTERN = new RegExp(`^opacity-(?:${LENGTH_FORMS})$`);
/**
 * The keyword scale, and an arbitrary cursor, which may be a `url()`.
 */
const CURSOR_PATTERN = new RegExp(
  `^cursor-(?:auto|default|pointer|wait|text|move|help|not-allowed|none|context-menu|progress|cell|crosshair|vertical-text|alias|copy|no-drop|grab|grabbing|all-scroll|col-resize|row-resize|n-resize|e-resize|s-resize|w-resize|ne-resize|nw-resize|se-resize|sw-resize|ew-resize|ns-resize|nesw-resize|nwse-resize|zoom-in|zoom-out|${BRACKET_OR_PAREN})$`,
);
/**
 * Bare `transition` is the common case and means "the default set", so the
 * suffix is optional. `duration-*` and `ease-*` are separate utilities and stay
 * out: replacing a transition must not silently drop the timing an author set
 * beside it.
 */
const TRANSITION_PATTERN = new RegExp(
  `^transition(?:-(?:none|all|colors|opacity|shadow|transform|${BRACKET_OR_PAREN}))?$`,
);
/**
 * The size scale only, never a shadow colour.
 *
 * `shadow-red-500` sets a colour and leaves the size alone, so matching it here
 * would let a size change delete a colour — the two are separate utilities that
 * happen to share a prefix. Listing the sizes explicitly keeps them apart; an
 * arbitrary value is a full shadow and does belong to this family.
 *
 * `shadow-(--s)` is a shadow rather than a colour, measured: it emits the
 * composed `box-shadow` with `--tw-shadow: var(--s)`. The type-hinted
 * `shadow-(color:--s)` compiles to nothing at all in 4.1.17, so there is no
 * colour spelling of the parenthesised form to keep out.
 */
const BOX_SHADOW_PATTERN = new RegExp(
  `^shadow(?:-(?:none|2xs|xs|sm|md|lg|xl|2xl|inner|${BRACKET_OR_PAREN}))?$`,
);
const OVERFLOW_PATTERN = /^overflow-(?:auto|hidden|clip|visible|scroll)$/;
const BACKGROUND_CLIP_PATTERN = /^bg-clip-(?:border|padding|content|text)$/;

/**
 * The value the utility declares, for either arbitrary-value spelling.
 *
 * `p-[13px]` declares `13px`; `bg-(--brand)` declares `var(--brand)`. Both are
 * returned in the same shape so the `looksLike…` predicates downstream judge
 * them identically — which is the point: the bracketed form was already reaching
 * those predicates, and the parenthesised form was not reaching anything, so
 * `bg-(--brand-color)` was `"other"` while `bg-[var(--brand-color)]` was a
 * background. Routing both through one function is what keeps them together.
 *
 * Returns `null` for a bare `-` prefix with nothing after it, so a malformed
 * token falls through rather than matching on an empty value.
 */
function declaredValue(utility: string, prefix: string): string | null {
  const bracketed = `${prefix}-[`;
  if (utility.startsWith(bracketed) && utility.endsWith("]")) {
    return utility.slice(bracketed.length, -1).trim();
  }
  const parenthesised = `${prefix}-(`;
  if (utility.startsWith(parenthesised) && utility.endsWith(")")) {
    const inner = utility.slice(parenthesised.length, -1).trim();
    return inner ? `var(${inner})` : null;
  }
  return null;
}

function looksLikeCssLengthExpression(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (
    /^-?\d*\.?\d+(px|rem|em|vw|vh|vmin|vmax|ch|ex|cm|mm|in|pt|pc|%)$/.test(
      normalized,
    )
  ) {
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
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(normalized))
    return true;
  if (/^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(/.test(normalized))
    return true;
  if (/^var\(--(?:color|brand|surface|background|bg)-/.test(normalized))
    return true;
  return false;
}

function looksLikeBackgroundImage(value: string): boolean {
  const normalized = value.trim().toLowerCase().replaceAll("_", " ");
  return /^(?:linear|radial)-gradient\(/.test(normalized);
}

export function classifyTailwindUtility(
  utility: string,
): TailwindPropertyFamily {
  if (FONT_SIZE_NAMES.has(utility)) return "font-size";
  const textArbitrary = declaredValue(utility, "text");
  if (textArbitrary && looksLikeCssLengthExpression(textArbitrary))
    return "font-size";
  if (textArbitrary && looksLikeBackgroundColor(textArbitrary))
    return "text-color";
  if (
    /^text-(?:transparent|current|black|white)(?:\/(?:\d{1,3}|\[.+\]))?$/.test(
      utility,
    ) ||
    /^text-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/(?:\d{1,3}|\[.+\]))?$/.test(
      utility,
    )
  ) {
    return "text-color";
  }

  if (FONT_FAMILY_NAMES.has(utility)) return "font-family";
  if (FONT_WEIGHT_NAMES.has(utility)) return "font-weight";
  const fontArbitrary = declaredValue(utility, "font");
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
  // The logical inline sides. `ps-`/`pe-` cannot collide with `p-`, which
  // requires a hyphen immediately after the `p`.
  if (PADDING_INLINE_START_PATTERN.test(utility)) return "padding-inline-start";
  if (PADDING_INLINE_END_PATTERN.test(utility)) return "padding-inline-end";

  if (MARGIN_ALL_PATTERN.test(utility)) return "margin";
  if (MARGIN_TOP_PATTERN.test(utility)) return "margin-top";
  if (MARGIN_BOTTOM_PATTERN.test(utility)) return "margin-bottom";
  if (MARGIN_LEFT_PATTERN.test(utility)) return "margin-left";
  if (MARGIN_RIGHT_PATTERN.test(utility)) return "margin-right";
  if (MARGIN_X_PATTERN.test(utility)) return "margin-x";
  if (MARGIN_Y_PATTERN.test(utility)) return "margin-y";
  if (MARGIN_INLINE_START_PATTERN.test(utility)) return "margin-inline-start";
  if (MARGIN_INLINE_END_PATTERN.test(utility)) return "margin-inline-end";

  const bgArbitrary = declaredValue(utility, "bg");
  if (bgArbitrary) {
    return looksLikeBackgroundColor(bgArbitrary) ||
      looksLikeBackgroundImage(bgArbitrary)
      ? "background"
      : "other";
  }
  if (BACKGROUND_CLIP_PATTERN.test(utility)) return "background-clip";
  if (
    /^bg-(?:transparent|current|black|white)(?:\/(?:\d{1,3}|\[.+\]))?$/.test(
      utility,
    ) ||
    /^bg-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/(?:\d{1,3}|\[.+\]))?$/.test(
      utility,
    )
  ) {
    return "background";
  }

  if (BORDER_RADIUS_TOP_LEFT_PATTERN.test(utility))
    return "border-radius-top-left";
  if (BORDER_RADIUS_TOP_RIGHT_PATTERN.test(utility))
    return "border-radius-top-right";
  if (BORDER_RADIUS_BOTTOM_RIGHT_PATTERN.test(utility))
    return "border-radius-bottom-right";
  if (BORDER_RADIUS_BOTTOM_LEFT_PATTERN.test(utility))
    return "border-radius-bottom-left";
  if (BORDER_RADIUS_PATTERN.test(utility)) return "border-radius";
  // After the corners, so a two-letter corner is never read as a side pair.
  if (BORDER_RADIUS_TOP_PATTERN.test(utility)) return "border-radius-top";
  if (BORDER_RADIUS_RIGHT_PATTERN.test(utility)) return "border-radius-right";
  if (BORDER_RADIUS_BOTTOM_PATTERN.test(utility)) return "border-radius-bottom";
  if (BORDER_RADIUS_LEFT_PATTERN.test(utility)) return "border-radius-left";
  // The logical corners before the logical sides, longest first.
  if (BORDER_RADIUS_START_START_PATTERN.test(utility))
    return "border-radius-start-start";
  if (BORDER_RADIUS_START_END_PATTERN.test(utility))
    return "border-radius-start-end";
  if (BORDER_RADIUS_END_START_PATTERN.test(utility))
    return "border-radius-end-start";
  if (BORDER_RADIUS_END_END_PATTERN.test(utility))
    return "border-radius-end-end";
  if (BORDER_RADIUS_START_PATTERN.test(utility)) return "border-radius-start";
  if (BORDER_RADIUS_END_PATTERN.test(utility)) return "border-radius-end";
  if (CURSOR_PATTERN.test(utility)) return "cursor";
  if (TRANSITION_PATTERN.test(utility)) return "transition";
  if (BOX_SHADOW_PATTERN.test(utility)) return "box-shadow";
  if (BORDER_STYLE_PATTERN.test(utility)) return "border-style";
  /**
   * The physical sides, the two axes, and the two logical sides.
   *
   * `border-x-*` sets `border-inline-width` and `border-y-*` sets
   * `border-block-width` — measured, each covering **two** sides — so they are
   * ranks between `border-width` and the physical sides, exactly as `padding-x`
   * sits between `padding` and `padding-left`. Reading `border-x` as the inline
   * axis also means the containment edge to left/right carries the same
   * horizontal-writing-mode assumption the padding model documents.
   *
   * `border-s-*`/`border-e-*` name `border-inline-start-width` / `-end-width`,
   * one side each, and which physical side that is depends on `direction`. They
   * are classified anyway: the **write** path does not need to resolve a logical
   * side to a physical one, it only needs to know the token declares border
   * width so a broad write can clear it. Measured, they override a broad write
   * (emitted after the shorthand), so leaving them `"other"` is what made the
   * write lie. The read path is unaffected — see `inspector-family-containment.ts`.
   */
  for (const [prefix, family] of [
    ["border-t", "border-width-top"],
    ["border-b", "border-width-bottom"],
    ["border-l", "border-width-left"],
    ["border-r", "border-width-right"],
    ["border-x", "border-width-x"],
    ["border-y", "border-width-y"],
    ["border-s", "border-width-inline-start"],
    ["border-e", "border-width-inline-end"],
  ] as const) {
    const arbitrary = declaredValue(utility, prefix);
    if (arbitrary && looksLikeCssLengthExpression(arbitrary)) return family;
    if (new RegExp(`^${prefix}(?:-(?:0|2|4|8))?$`).test(utility)) {
      return family;
    }
  }
  const borderArbitrary = declaredValue(utility, "border");
  if (borderArbitrary) {
    if (looksLikeCssLengthExpression(borderArbitrary)) return "border-width";
    if (looksLikeBackgroundColor(borderArbitrary)) return "border-color";
  }
  if (/^border(?:-(?:0|2|4|8))?$/.test(utility)) return "border-width";
  if (
    /^border-(?:transparent|current|black|white)(?:\/(?:\d{1,3}|\[.+\]))?$/.test(
      utility,
    ) ||
    /^border-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/(?:\d{1,3}|\[.+\]))?$/.test(
      utility,
    )
  ) {
    return "border-color";
  }
  if (OBJECT_FIT_PATTERN.test(utility)) return "object-fit";
  if (OBJECT_POSITION_PATTERN.test(utility)) return "object-position";
  if (ASPECT_RATIO_PATTERN.test(utility)) return "aspect-ratio";
  if (DISPLAY_PATTERN.test(utility)) return "display";
  if (FLEX_DIRECTION_PATTERN.test(utility)) return "flex-direction";
  if (GAP_PATTERN.test(utility)) return "gap";
  if (WIDTH_PATTERN.test(utility)) return "width";
  if (HEIGHT_PATTERN.test(utility)) return "height";
  if (MIN_WIDTH_PATTERN.test(utility)) return "min-width";
  if (MIN_HEIGHT_PATTERN.test(utility)) return "min-height";
  if (MAX_WIDTH_PATTERN.test(utility)) return "max-width";
  if (MAX_HEIGHT_PATTERN.test(utility)) return "max-height";
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
  return (
    a.length === b.length && a.every((variant, index) => variant === b[index])
  );
}

function isSamePropertyFamily(
  tokenFamily: TailwindPropertyFamily,
  property: PatchTailwindOptions["property"],
): boolean {
  return (
    tokenFamily === property ||
    ((tokenFamily === "background" || tokenFamily === "background-color") &&
      (property === "background" || property === "background-color"))
  );
}

function resolvePatchVariants(
  tokens: readonly TailwindToken[],
  options: PatchTailwindOptions,
): string[] {
  const targetVariants = options.targetVariants ?? [];
  const activeVariants = new Set(options.activeVariants ?? []);
  if (activeVariants.size === 0) return targetVariants;

  const matchingConditional = tokens
    .filter((token) => {
      if (!isSamePropertyFamily(token.propertyFamily, options.property)) {
        return false;
      }
      const remaining = [...token.variants];
      for (const target of targetVariants) {
        const index = remaining.indexOf(target);
        if (index < 0) return false;
        remaining.splice(index, 1);
      }
      return (
        remaining.length > 0 &&
        remaining.every((variant) => activeVariants.has(variant))
      );
    })
    .sort((a, b) => b.variants.length - a.variants.length)[0];

  return matchingConditional?.variants ?? targetVariants;
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
  const targetVariants = resolvePatchVariants(tokens, options);
  const replacementUtility = normalizeReplacementUtility(options.value);
  const result: TailwindToken[] = [];
  let replaced = false;

  for (const token of tokens) {
    const isSameFamily = isSamePropertyFamily(
      token.propertyFamily,
      options.property,
    );
    const matches =
      isSameFamily && areVariantsEqual(token.variants, targetVariants);

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
