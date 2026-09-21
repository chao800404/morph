/**
 * Which Tailwind property families contain which others.
 *
 * The Inspector has always known this relation on the **read** path —
 * `resolveInspectorLength` walks `sources` most-specific-first and takes the
 * first hit, and `editor-style-inspector.tsx` lists those sources by hand. The
 * **write** path did not know it at all: `isSamePropertyFamily` in the token
 * engine matches identity plus one pair, so editing `padding-left` beside a
 * `p-4` appended a class instead of resolving the overlap.
 *
 * The relation is **directional**, not a symmetric conflict group: `padding`
 * contains `padding-left`, but not the other way round. That direction is what
 * distinguishes "the user set the broad family, so narrower overrides must go"
 * from "the user set a narrow family, so the broad one may need decomposing".
 * Only the first direction is implemented today.
 *
 * ## The physical edges need a horizontal writing mode; the logical ones do not
 *
 * Tailwind v4 does not map `px-*` to `padding-left` + `padding-right`. Its own
 * utility table (`node_modules/tailwindcss/dist/lib.js`) reads:
 *
 * ```js
 * ["p","padding"],["px","padding-inline"],["py","padding-block"],
 * ["ps","padding-inline-start"],["pe","padding-inline-end"],["pt",…
 * ```
 *
 * So `px-6` sets `padding-inline`, which is a shorthand for
 * `padding-inline-start` **and** `padding-inline-end`; given one value, both get
 * it (MDN, "Constituent properties"). Under a **horizontal** writing mode those
 * two are the physical left and right, and `direction` only swaps which of them
 * counts as "start" — so both sides still receive the value under `dir="rtl"`.
 * Treating `padding-x` as containing `padding-left`/`padding-right` therefore
 * holds in both directions. What breaks it is a **vertical** writing mode, where
 * the inline axis is vertical and the same declaration lands on top and bottom.
 * The limit is horizontal-writing-mode, not LTR — stated here rather than left
 * implicit.
 *
 * **The logical edges are not subject to that limit.** `padding-inline` *is* the
 * shorthand for the two logical inline sides, so it determines them in every
 * writing mode; and `padding` determines them because it sets all four physical
 * sides and a logical side always resolves to one of them. The same argument
 * holds for `margin`/`margin-x`, for `border-width`/`border-width-x`, and for
 * `border-radius` over the logical corners. Adding the logical dimension
 * therefore added **no** assumption — only the physical edges carry one.
 *
 * Three consequences worth knowing before extending this file:
 *
 * 1. **`unroll` is not semantics-preserving.** Rewriting `px-6` as `pl-6 pr-6`
 *    *is* equivalent under any horizontal writing mode, but not under a vertical
 *    one, where `px-*` addresses the block sides while `pl-*`/`pr-*` still
 *    address the physical left and right. That is an argument against unrolling
 *    automatically, independent of any preference — and a narrower argument
 *    than "it breaks RTL".
 * 2. **A logical token is cleared, but never read into a physical control.** The
 *    **write** path needs only to know that `ps-4` declares padding, so that a
 *    broad write can remove it; it never needs to know whether that is left or
 *    right. The **read** path is the one that would, and it does not have to:
 *    the Inspector's `sources` lists do not name the logical families, so a
 *    `ps-4` falls through to the element's computed value — which is the truth
 *    under whatever writing mode and direction are actually in effect. Resolving
 *    the mapping here would *replace* a correct answer with a conditional one.
 * 3. **`border-radius-top` does not list the logical corners, on purpose.**
 *    `rounded-t` does cover `rounded-ss`/`rounded-se` under a horizontal writing
 *    mode, but that edge would carry the assumption above, and no control writes
 *    `border-radius-top` — so `containedFamilies("border-radius-top")` is never
 *    called. An unnecessary edge with an assumption attached is worse than a
 *    missing one that is written down.
 *
 * ## What the shadow validation established
 *
 * This relation was checked against the Tailwind compiler's own output before
 * anything was derived from it — the compiler used as a **probe**, not as a build
 * step. Its facts are *properties*; this file's are *families*, and the only
 * bridge between them is `classifyTailwindUtility`, which is itself hand-written.
 * So the comparable object is **property -> the families whose tokens declare
 * it**, and three results are worth keeping:
 *
 * 1. **Four properties are declared by three families each, and in every case two
 *    of those three contain neither the other**: `border-top-left-radius` by
 *    `border-radius-top`, `border-radius-left` and `border-radius-top-left`, with
 *    the other three corners the same way. All four are the lattice above, and they
 *    are the only unordered family pairs the compiler found in the whole
 *    vocabulary. A write of either side pair therefore cannot take effect on the
 *    shared corner. Measured through `patchBroadFamily`:
 *    `("rounded-l-md", "border-radius-top", "rounded-t-lg")` ->
 *    `"rounded-l-md rounded-t-lg"`, and Tailwind emits `rounded-l` after
 *    `rounded-t`, so the surviving token wins the corner. This is the **second
 *    direction** the note at the top says is not implemented — the one that needs
 *    the broad token *decomposed* rather than the narrow one deleted. It is latent
 *    for the reason consequence 3 gives: no control writes a radius side pair.
 *    Every control writes either `border-radius`, which clears all of them, or a
 *    single corner, which Tailwind emits last and which therefore wins.
 * 2. **There is no `border-style` key, and that is correct rather than a gap.**
 *    `border-2` declares `border-style: var(--tw-border-style)` — a *mechanism*
 *    reading a slot, not a second decision — and that slot's `@property`
 *    `initial-value` is `solid`. Removing a style token therefore reverts the
 *    style to `solid` instead of leaving a width that cannot be styled. Measured
 *    in both directions: a `border-style` clear leaves `border-2` alone, and a
 *    `border-width` clear leaves `border-dashed` alone. Each is what a user
 *    setting that one control means.
 * 3. **The slot graph is directional and is not this graph.** `--tw-border-style`
 *    is *set* by `border-style` and *read* by all nine `border-width*` families
 *    (27 real classes); `--tw-leading` is set by `line-height` and read by
 *    `font-size`. That is how one family's value reaches another family's
 *    declaration — a different relation from "a broad write clears a narrow
 *    token", so a generated registry would have to carry both rather than one.
 *
 * What the compiler could **not** establish is the normalisation itself: it has no
 * opinion about which family *should* own a property, and it cannot say whether a
 * shared property is a defect. Those are this file's, which is why the compiler
 * belongs in a probe and not in the build.
 */

import type { TailwindPropertyFamily } from "@/lib/storefront/ast/tailwind-token-engine";

export type PatchablePropertyFamily = Exclude<TailwindPropertyFamily, "other">;

/**
 * Direct containment edges: each key contains each listed family.
 *
 * `padding-x`/`padding-y` and `border-width-x`/`border-width-y` are keys as well
 * as values — they sit between the broad family and the physical sides, which is
 * the precedence rank the read path already encodes. They are the reason this
 * relation cannot be flattened into a single list per group.
 *
 * **The radius side pairs make this a lattice, not a chain.** `border-radius-top`
 * contains `border-radius-top-left` *and* `border-radius-top-right`; so does
 * `border-radius-left` contain `border-radius-top-left`. A corner therefore has
 * two parents, and `containedFamilies` is a graph traversal with a visited set
 * rather than a walk down a tree — which is why the visited set is load-bearing
 * here and not just cycle protection.
 *
 * **The axis families carry the same assumption as `padding-x`.** `border-x-*`
 * sets `border-inline-width`, which under a horizontal writing mode is the
 * physical left and right; `border-y-*` sets `border-block-width`, the top and
 * bottom. That is the horizontal-writing-mode assumption documented at the top of
 * this file, applied to the second family that needs it.
 */
export const FAMILY_CONTAINS = {
  padding: [
    "padding-x",
    "padding-y",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "padding-inline-start",
    "padding-inline-end",
  ],
  "padding-x": [
    "padding-left",
    "padding-right",
    "padding-inline-start",
    "padding-inline-end",
  ],
  "padding-y": ["padding-top", "padding-bottom"],
  margin: [
    "margin-x",
    "margin-y",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "margin-inline-start",
    "margin-inline-end",
  ],
  "margin-x": [
    "margin-left",
    "margin-right",
    "margin-inline-start",
    "margin-inline-end",
  ],
  "margin-y": ["margin-top", "margin-bottom"],
  "border-width": [
    "border-width-x",
    "border-width-y",
    "border-width-top",
    "border-width-right",
    "border-width-bottom",
    "border-width-left",
    "border-width-inline-start",
    "border-width-inline-end",
  ],
  "border-width-x": [
    "border-width-left",
    "border-width-right",
    "border-width-inline-start",
    "border-width-inline-end",
  ],
  "border-width-y": ["border-width-top", "border-width-bottom"],
  "border-radius": [
    "border-radius-top",
    "border-radius-right",
    "border-radius-bottom",
    "border-radius-left",
    "border-radius-top-left",
    "border-radius-top-right",
    "border-radius-bottom-right",
    "border-radius-bottom-left",
    "border-radius-start",
    "border-radius-end",
    "border-radius-start-start",
    "border-radius-start-end",
    "border-radius-end-start",
    "border-radius-end-end",
  ],
  "border-radius-top": ["border-radius-top-left", "border-radius-top-right"],
  "border-radius-right": [
    "border-radius-top-right",
    "border-radius-bottom-right",
  ],
  "border-radius-bottom": [
    "border-radius-bottom-right",
    "border-radius-bottom-left",
  ],
  "border-radius-left": ["border-radius-top-left", "border-radius-bottom-left"],
  // `rounded-s` sets `border-start-start-radius` and `border-end-start-radius` —
  // the two corners on the inline-start axis — and `rounded-e` the other two.
  "border-radius-start": [
    "border-radius-start-start",
    "border-radius-end-start",
  ],
  "border-radius-end": ["border-radius-start-end", "border-radius-end-end"],
} as const satisfies Partial<
  Record<PatchablePropertyFamily, readonly PatchablePropertyFamily[]>
>;

type AssertNever<T extends never> = T;

/**
 * No family may list itself. A direct self-loop would make `containedFamilies`
 * return the family it was asked about, so the sweep-up would clear the value it
 * had just written. Transitive cycles are not caught here — the visited set in
 * `containedFamilies` makes them terminate instead — so this gate is a floor,
 * not a proof.
 */
export type _NoFamilyContainsItself = AssertNever<
  {
    [
      K in keyof typeof FAMILY_CONTAINS
    ]: K extends (typeof FAMILY_CONTAINS)[K][number] ? K : never;
  }[keyof typeof FAMILY_CONTAINS]
>;

/** The literal above, widened so it can be looked up by a computed family. */
const DIRECT: Partial<
  Record<PatchablePropertyFamily, readonly PatchablePropertyFamily[]>
> = FAMILY_CONTAINS;

/**
 * Every family contained by `family`, transitively, in declaration order.
 *
 * This is the list a "the user set the broad family" write must clear, which is
 * why it is transitive: setting `padding` has to remove `padding-x` as well as
 * `padding-left`, or the surviving `px-*` keeps deciding the inline sides and
 * the control reports a value it does not have.
 *
 * Measured before this existed, on the real engine:
 *
 * ```
 * "p-4 px-6" + padding="p-8"  ->  "p-8 px-6"   // px-6 survived; sides undecided
 * "p-4 py-6" + padding="p-8"  ->  "p-8 py-6"
 * ```
 *
 * With `padding-x`/`padding-y` included in the clears both collapse to `p-8`.
 *
 * A family with no entry returns `[]` — a leaf, or a family outside the groups.
 */
export function containedFamilies(
  family: PatchablePropertyFamily,
): PatchablePropertyFamily[] {
  const seen = new Set<PatchablePropertyFamily>();
  const visit = (current: PatchablePropertyFamily): void => {
    for (const child of DIRECT[current] ?? []) {
      if (seen.has(child)) continue; // also terminates a transitive cycle
      seen.add(child);
      visit(child);
    }
  };
  visit(family);
  return [...seen];
}
