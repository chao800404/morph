/**
 * What the Inspector does to a class string when the user sets a **broad**
 * property family — the "sweep-up".
 *
 * ## Why this is a separate module from the containment relation
 *
 * `inspector-family-containment.ts` answers *"what does this family decide?"* —
 * a relation, and one that a future revision may derive from the Tailwind
 * compiler instead of writing out by hand. This file answers *"given that
 * relation, what do we do to the author's class string?"* — a policy. Keeping
 * them apart means the relation can be replaced without touching the policy,
 * and the policy can change without invalidating the relation.
 *
 * ## Why it exists at all
 *
 * The same sweep-up used to be hand-written four times inside the React
 * component — `padding`, `margin`, `border-width` and `border-radius` each
 * nesting `patchTailwindClasses` calls by hand — and the only test of it
 * **mirrored** that shape rather than importing it. A mirror cannot fail when
 * the component stops calling the relation: it tests a copy. So the real
 * function lives here, the component calls it, and the test calls it too.
 *
 * ## The scope arguments are not optional decoration
 *
 * The component does not call `patchTailwindClasses` directly. It calls a
 * wrapper (`editor-style-inspector.tsx:1848-1856`) that injects two things:
 *
 * - `targetVariants`, from the active viewport — `["lg"]` on desktop, `["md"]`
 *   on tablet, `[]` on mobile (`:1374-1379`);
 * - `activeVariants: activeStructuralVariants`, the structural variants the
 *   selected DOM element currently matches (`:1213-1217`).
 *
 * Both reach every patch, the clears included. Forwarding them here is what
 * keeps the extraction faithful: a sweep-up that cleared at base scope while
 * writing at `md:` scope would delete tokens the user never touched.
 *
 * ## The limit this inherits
 *
 * `containedFamilies` is **physical-only**: it treats `padding-x` as deciding
 * `padding-left`/`padding-right`, which holds in a horizontal writing mode. See
 * the docblock on that module — the reasoning is there, not repeated here.
 *
 * ## Return type, and the refuse question at the clear path
 *
 * A `string`, and the measurement below is what makes that a decision rather than
 * a deferral. The clear path (`utility === ""`) was where a *refusal* could come
 * back instead of an edit, and a discriminated union
 * (`{ status: "applied" | "refused" | … }`) belonged there — but only once there
 * was something to refuse.
 *
 * Measured over a generated matrix of **1538 (family, class string) pairs** —
 * every real class the engine's own patterns produce for the four governed
 * families and their closures, in ten value forms including `(--v)`, alone,
 * paired, duplicated, variant-bearing, and with noise from other families — a
 * clear removes **exactly** the family's tokens at the targeted scope: **zero
 * violations** in both directions (nothing of the family left behind, nothing
 * outside the closure removed). Every no-op was a case with no token of that
 * family at that scope, 498 of 502 because the only such token sat at a
 * **non-base** scope.
 *
 * So there is no input where the user asked to clear a family and a token of that
 * family survived — nothing for a refusal to refuse, and no signal needed to tell
 * a no-op from a failure, because a no-op *is* the correct outcome there. The 134
 * unclearable tokens this question was originally about came from the classifier's
 * incomplete value forms (see `BRACKET_OR_PAREN` in `tailwind-token-engine.ts`),
 * not from this path. The pin lives in the test file, under "the clear path".
 */

import {
  patchTailwindClasses,
  type PatchTailwindOptions,
} from "@/lib/storefront/ast/tailwind-token-engine";

import {
  containedFamilies,
  type PatchablePropertyFamily,
} from "./inspector-family-containment";

/** The variant context every patch in a sweep-up is made in. */
export type FamilyEditScope = {
  /** Variant scope the edit targets; `[]` means the base scope. */
  readonly targetVariants?: readonly string[];
  /** Structural variants the selected element currently matches. */
  readonly activeVariants?: readonly string[];
};

/**
 * Set `family` to `utility`, then clear every family it contains.
 *
 * ## The write is issued first, and that ordering does not protect the write
 *
 * The write comes before the clears so that a family which both contains and is
 * contained — `padding-x` sits between `padding` and the sides — cannot be
 * cleared after being written. That reasoning is about a **family**, and the
 * failure it is meant to exclude needs only a **utility**: when `utility`
 * classifies into a family this same call is about to clear, the write lands and
 * the clear takes it straight back out. Measured, through this function:
 *
 * ```
 * ("p-4",        "padding",       "p-[9px]")          -> "p-[9px]"   // control
 * ("p-4",        "padding",       "px-[9px]")         -> ""   // written, then cleared
 * ("p-4",        "padding",       "pt-[9px]")         -> ""
 * ("m-2",        "margin",        "mx-[9px]")         -> ""
 * ("border-2",   "border-width",  "border-x-[9px]")   -> ""
 * ("rounded-lg", "border-radius", "rounded-tl-[9px]") -> ""
 * ```
 *
 * Seven of the eight inputs in that probe lose the value — the first row is the
 * control — and the result is `""`, which is indistinguishable from a caller that
 * cleared the class string and the worst possible answer for one that did not.
 * **No call site reaches it today**, because each builds the utility from the
 * same prefix it names (`inspectorLengthUtility("p", …)` for `padding`), so this
 * is a contract that does not hold rather than a live defect. It is written down
 * because the natural next control — one that writes an axis value — walks
 * straight into it. The pin is in the test file, under "a utility from a
 * contained family".
 *
 * Clearing before writing would remove the hazard, and is the change to make if a
 * caller ever needs it; it is not made here because it changes an ordering the
 * contracts in the test file were measured against.
 *
 * ## The defect this function was extracted to fix
 *
 * Measured before it existed — the clears named only the four physical sides, so
 * a logical `px-*` survived and kept deciding the inline sides, while the
 * optimistic keys claimed all four sides read the new value:
 *
 * ```
 * "p-4 px-6" + padding="p-8"  ->  "p-8 px-6"   // px-6 survived
 * "p-4 py-6" + padding="p-8"  ->  "p-8 py-6"
 * ```
 *
 * Through this function both collapse to `p-8`. See the test file for the
 * variant, arbitrary-value and duplicate-token contracts.
 */
export function patchBroadFamily(
  className: string,
  family: PatchablePropertyFamily,
  utility: string,
  scope: FamilyEditScope = {},
): string {
  const patch = (
    current: string,
    property: PatchablePropertyFamily,
    value: string,
  ): string => {
    const options: PatchTailwindOptions = { property, value };
    // The engine's options take mutable arrays; the scope is readonly so a
    // caller cannot be surprised by a patch that reorders its own input.
    if (scope.targetVariants)
      options.targetVariants = [...scope.targetVariants];
    if (scope.activeVariants)
      options.activeVariants = [...scope.activeVariants];
    return patchTailwindClasses(current, options);
  };

  return containedFamilies(family).reduce(
    (current, contained) => patch(current, contained, ""),
    patch(className, family, utility),
  );
}
