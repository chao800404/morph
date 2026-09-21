/**
 * Which Inspector module owns each patchable Tailwind property family.
 *
 * `docs/visual-editor-progress.md` Stage C says "對接目前 capability registry 與
 * 所有基本樣式控制", which cannot be answered today because nothing states which
 * families exist, which have a control, and which are deliberately without one.
 * The engine's `TailwindPropertyFamily` union is the authority for the first of
 * those — 75 patchable members once `"other"` is excluded — and this file is the
 * answer to the other two. The count is worth stating because it is the whole
 * gate: `FAMILY_COVERAGE` (17) and `UNDECIDED_FAMILIES` (58) must partition
 * exactly those 75, which is what the two gates at the bottom check.
 *
 * An earlier version of this sentence read "58 members". Measured, that matched
 * the union at no revision: it is **57** at `a8c26dd^~1` and **75** from
 * `a8c26dd^` onward, the 18 the containment work added being the two logical
 * padding edges, the two logical margin edges, `border-width-x`/`-y`, the two
 * logical border edges, the four radius side pairs and the four logical corners.
 * 58 is `UNDECIDED_FAMILIES.length` — the size of a different set, in a sentence
 * about the union. Worth keeping the correction rather than the number: a count
 * that has never been true is the kind of thing this file exists to refuse.
 *
 * **The compiler is the guard, not a test.** `FAMILY_COVERAGE` holds families
 * with a control, `UNDECIDED_FAMILIES` the rest; two gates below fail to compile
 * while any family is in neither map or in both. Adding a family to the engine's
 * union therefore breaks `tsc` until someone records a decision — and `pnpm
 * typecheck` already runs in the required CI job, so this needs no new guard
 * script and cannot deadlock: the fix is a decision on the same branch.
 *
 * **Three states, not two.** A family with a control, a family decided to have
 * none, and a family not yet decided are different facts, and collapsing the
 * last into `{ none }` would encode "not done" as "decided" — the same mistake
 * as a guard that reports `PASS` for an unconfigured deployment.
 *
 * **`UNDECIDED_FAMILIES.length` is not a distance to zero.** That was the
 * original claim here and it is false: 23 of its entries are named only by an
 * inline `patchTailwindClasses(…, { property: "…" })` call, which `ControlModule`
 * cannot represent, so they cannot leave this list however much work is done.
 * See the note on `UNDECIDED_FAMILIES` for the measurement.
 *
 * **"Decided to have none" is a claim, so the reason is checked too.** `{ none:
 * "" }` satisfies `string` and would make leaving the undecided list a
 * one-character edit; `_EveryNoControlReasonSaysSomething` at the bottom rejects
 * it at compile time.
 *
 * **What an entry claims, and what it does not.** `{ control: X }` says that
 * module's own code names this family — a call site that merely reads the family
 * does not qualify, which is why `font-size` is not listed: the evidence for it
 * is `resolveInspectorLength({ sources: [{ property: "font-size" }] })` in
 * `editor-style-inspector.tsx`, a read, not a render. An entry does **not** claim
 * the control works, only that the wiring is where it says it is. Nothing in the
 * repository can currently establish the stronger claim — two rounds of proxy
 * measurement produced false positives, and a third produced false negatives.
 *
 * **Four mechanisms name a family; only one of them is recordable here.** The
 * Inspector reaches families through `sources` descriptors (reads),
 * `props.onCommit(family, …)` inside a module, `patchTailwindClasses(…,
 * { property: "…" })` inline, and — since the containment model landed —
 * `containedFamilies("padding")` in `inspector-family-containment.ts`, whose
 * `FAMILY_CONTAINS` table names a family as **data**. The second is what
 * `ControlModule` can hold. The third covers more families than the other two
 * together and has no representation in this type at all; the fourth is
 * invisible to any search keyed on call sites.
 *
 * **A search for a family name reads four things that are not declarations**: a
 * name inside a *value* list (`"opacity"` among transition values in
 * `box-style-modules.tsx`), a name inside a **comment**, a name inside a *read*
 * descriptor, and — the newest — a name used as **data** rather than written at
 * a call site. The last fails in the opposite direction from the first three: it
 * makes a family look like it has no write path when it has one, which is why
 * the split recorded below is explicitly a statement about the scan.
 */

import type { TailwindPropertyFamily } from "@/lib/storefront/ast/tailwind-token-engine";

import { BorderRadiusInspectorModule } from "./border-radius-inspector-module";
import {
  AppearanceInspectorModule,
  EffectsInspectorModule,
  InteractionInspectorModule,
  LayoutInspectorModule,
  PositionInspectorModule,
  SizingInspectorModule,
} from "./box-style-modules";
import { InspectorLengthControl } from "./inspector-length-control";

/**
 * Every family a patch can name.
 *
 * `other` is excluded by the engine itself — `PatchTailwindOptions.property` is
 * `Exclude<TailwindPropertyFamily, "other">` — so the catch-all needs no entry
 * here and cannot be patched at all. The type already says so; this alias only
 * gives it a name to key against.
 */
export type PatchablePropertyFamily = Exclude<TailwindPropertyFamily, "other">;

/** A module that renders a control for a family. */
export type ControlModule =
  | typeof InspectorLengthControl
  | typeof BorderRadiusInspectorModule
  | typeof LayoutInspectorModule
  | typeof SizingInspectorModule
  | typeof PositionInspectorModule
  | typeof InteractionInspectorModule
  | typeof EffectsInspectorModule
  | typeof AppearanceInspectorModule;

/**
 * A module reference rather than its name: a string would be a second copy of a
 * fact the compiler already knows, and it would survive a rename of the module.
 */
export type FamilyCoverage =
  { readonly control: ControlModule } | { readonly none: string };

/**
 * Families whose owning module is established by that module's own code.
 *
 * Every entry cites the `props.onCommit(family, utility, optimisticKey, …)` call
 * it rests on, so a reader can check the claim rather than trust it. All of them
 * live in `box-style-modules.tsx`, which holds all six layout modules.
 *
 * Each citation was read individually. That is not ceremony: a scan for these
 * calls reported a transition *value* list and a *comment* as declarations, so a
 * citation nobody has looked at is not evidence.
 */
export const FAMILY_COVERAGE = {
  // `props.onCommit("display", …)` — box-style-modules.tsx:126,128
  display: { control: LayoutInspectorModule },
  // `props.onCommit("flex-direction", "flex-" + value.replace("column", "col"), …)`
  // — box-style-modules.tsx:142-145
  "flex-direction": { control: LayoutInspectorModule },
  // `props.onCommit("gap", `gap-[${value}px]`, "gap", …)` — box-style-modules.tsx:161
  gap: { control: LayoutInspectorModule },
  // `props.onCommit("width", inspectorLengthUtility("w", cssValue), "width", …)`
  // — box-style-modules.tsx:252-255
  width: { control: SizingInspectorModule },
  // `props.onCommit("height", inspectorLengthUtility("h", cssValue), …)` — :271-274
  height: { control: SizingInspectorModule },
  // `props.onCommit("min-width", inspectorLengthUtility("min-w", cssValue), …)`
  // — box-style-modules.tsx:289-292
  "min-width": { control: SizingInspectorModule },
  // `props.onCommit("min-height", inspectorLengthUtility("min-h", cssValue), …)`
  // — box-style-modules.tsx:307-310
  "min-height": { control: SizingInspectorModule },
  // `props.onCommit("max-width", inspectorLengthUtility("max-w", cssValue), …)`
  // — box-style-modules.tsx:326-329
  "max-width": { control: SizingInspectorModule },
  // `props.onCommit("max-height", inspectorLengthUtility("max-h", cssValue), …)`
  // — box-style-modules.tsx:345-348
  "max-height": { control: SizingInspectorModule },
  // `props.onCommit("position", value, "position", value)` — box-style-modules.tsx:377
  position: { control: PositionInspectorModule },
  // `props.onCommit("left", `left-[${value}px]`, "left", value)` — box-style-modules.tsx:389
  left: { control: PositionInspectorModule },
  // `props.onCommit("top", `top-[${value}px]`, "top", value)` — box-style-modules.tsx:399
  top: { control: PositionInspectorModule },
  // `props.onCommit("cursor", `cursor-${value}`, "cursor", …)` — box-style-modules.tsx:476
  cursor: { control: InteractionInspectorModule },
  // `props.onCommit("transition", `transition-${value}`, "transition", …)` — :496-501
  transition: { control: InteractionInspectorModule },
  // `props.onCommit("box-shadow", utility, "boxShadow", …)` — box-style-modules.tsx:533
  "box-shadow": { control: EffectsInspectorModule },
  // `props.onCommit("opacity", `opacity-[${value / 100}]`, "opacity", …)` — :565-568
  //
  // The entry a text search gets wrong twice. An earlier note claimed two
  // referrers and cited `InteractionInspectorModule:487`, which lists "opacity"
  // among transition *values* (`"none", "all", "colors", "opacity", …`). That is
  // a value, not a declaration: there is exactly one referrer, this one. See the
  // value-list trap in the module docblock.
  opacity: { control: AppearanceInspectorModule },
  // `props.onCommit("overflow", "overflow-" + value, "overflow", value)` — :581
  overflow: { control: AppearanceInspectorModule },
} as const satisfies Partial<Record<PatchablePropertyFamily, FamilyCoverage>>;

/**
 * Families not yet recorded in `FAMILY_COVERAGE`.
 *
 * **This list is not "undecided", and its length is not the distance.**
 * Measured against the bar above, **27 of its 58 entries have mechanical
 * evidence**:
 *
 * - **23** are named only by a write call site — `patchTailwindClasses(…,
 *   { property: "…" })` — in `editor-style-inspector.tsx` or
 *   `inspector-paint-utils.ts`. `ControlModule` names eight *module components*
 *   and has no member that can represent a control rendered inline, so these
 *   cannot be recorded at all until that type grows.
 * - **4** (`border-radius-*`) are named by `BORDER_RADIUS_CORNER_CONFIG` in
 *   `editor-style-inspector.tsx`; `border-radius-inspector-module.tsx` takes the
 *   corners as props and does not reference that record itself.
 *
 * The remaining **31** have no *literal* write call site — a fact about the
 * scan, not about the code, and the two differ by twenty-eight families.
 * `padding-x`, `padding-y`, `margin-x`, `margin-y`, the four `border-width`
 * sides, `border-width-x`/`border-width-y`, the four `border-radius` side pairs,
 * and every logical family (`padding-inline-*`, `margin-inline-*`,
 * `border-width-inline-*`, `border-radius-start`/`-end` and the four logical
 * corners) are all cleared by the containment sweep-up, which reaches them as
 * **data** through `containedFamilies(…)` and never names them at a call site.
 * Only **3** have no write path at all: `background-color` is a union member
 * `classifyTailwindUtility` never returns — the `["background",
 * "background-color"]` list at `editor-style-inspector.tsx:4357` is an argument
 * to `resolveResponsivePaintClearUtility`, which **reads** with it and then
 * writes `property: "background"` — and `z-index` and `rotate`, which no `.tsx`
 * under `-components` names anywhere.
 *
 * `border-style` and `border-color` are the two this count was wrong about. Both
 * **are** written: `commitContainerProperty("border-style", …)` at `:4457` and
 * `commitContainerProperty("border-color", …)` at `:4468`, and that helper
 * forwards the name straight into `patchTailwindClasses({ property })`. They sit
 * in `UNDECIDED_FAMILIES` because the criterion there is narrower than "a control
 * names it" — it is "a *module component* names it", and `ControlModule` cannot
 * represent an inline control. *Implemented but unrecordable* and *not
 * implemented* are two different statements, and the count above is only about
 * the second.
 *
 * Before the containment model landed this read "27 / 4 / 9". The move to
 * "23 / 4 / 13" is that model becoming visible to the scan as a blind spot: the
 * four `border-width` sides lost their only literal write when the sweep-up
 * started passing `family`, and the four padding/margin `x`/`y` levels were
 * already in the last bucket for the same reason. Adding the six side-pair and
 * axis families took it to "23 / 4 / 19", and the twelve logical families to
 * "23 / 4 / 31" — every one of them reached as data, so not one of them moved the
 * first number. A scan cannot tell a family named as data from one named
 * nowhere — so read the counts below as a floor on the work, and the docblock
 * above as the list of ways this search goes wrong.
 *
 * So `UNDECIDED_FAMILIES.length` reaches zero only once `ControlModule` can name
 * an inline control. Until then this is a work list, not a metric.
 */
export const UNDECIDED_FAMILIES = [
  "font-size",
  "font-family",
  "font-weight",
  "text-align",
  "text-color",
  "line-height",
  "padding",
  "padding-top",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-x",
  "padding-y",
  "padding-inline-start",
  "padding-inline-end",
  "margin",
  "margin-top",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-x",
  "margin-y",
  "margin-inline-start",
  "margin-inline-end",
  "background",
  "background-color",
  "background-clip",
  "border-width",
  // The axis ranks, the side pairs and the logical families have no control of
  // their own. They exist so the sweep-up can clear them: without an entry here
  // the union gate below would not compile, and without an entry in
  // `FAMILY_CONTAINS` a broad write would leave them in place while the
  // optimistic keys claimed the new value for every side.
  "border-width-x",
  "border-width-y",
  "border-width-top",
  "border-width-bottom",
  "border-width-left",
  "border-width-right",
  "border-width-inline-start",
  "border-width-inline-end",
  "border-style",
  "border-color",
  "border-radius",
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
  "object-fit",
  "object-position",
  "aspect-ratio",
  "z-index",
  "rotate",
] as const satisfies readonly PatchablePropertyFamily[];

type CoveredFamily =
  keyof typeof FAMILY_COVERAGE | (typeof UNDECIDED_FAMILIES)[number];

type AssertNever<T extends never> = T;

/**
 * The gate: every patchable family must appear in **at least one** of the two
 * maps, and no family may appear in both.
 *
 * "At least one" is all `Exclude` can express, because `CoveredFamily` is a
 * union — a family sitting in *both* maps is invisible to it. That is not
 * hypothetical: adding twelve entries above while forgetting to remove them
 * below produced exactly that state, and this gate stayed green. Hence the
 * second gate below, and hence the correction to this sentence — an earlier
 * version claimed "exactly one", which `Exclude` never enforced.
 *
 * **Inline the union at the assertion site; do not pass a name to it.** Measured
 * against this compiler: when the argument is a named type — an alias or a
 * generic instantiation — TypeScript preserves the name and prints **one**
 * example member, as in `Type 'UnaccountedForFamilies' does not satisfy the
 * constraint 'never'. Type '"top"' …`. Written out at the site it prints the
 * whole union, `Type '"top" | "z-index"' …`, which is the work list. Both fail
 * the build identically; only the second says what to fix. So there is
 * deliberately no `UnaccountedForFamilies` alias left to pass — naming it would
 * cost the message.
 */
export type _EveryFamilyIsAccountedFor = AssertNever<
  Exclude<PatchablePropertyFamily, CoveredFamily>
>;

/**
 * The other half: a family must not be in both maps.
 *
 * A family in both is accounted for twice, and the two entries can disagree
 * about whether a control exists. `Exclude` cannot see it, because it asks
 * whether a family is in *neither* list.
 *
 * Written out rather than named, for the reason given on
 * `_EveryFamilyIsAccountedFor`: a name here would cost the error message its
 * list of offending families.
 */
export type _NoFamilyIsInBothLists = AssertNever<
  Extract<keyof typeof FAMILY_COVERAGE, (typeof UNDECIDED_FAMILIES)[number]>
>;

/**
 * A `{ none: "…" }` entry whose reason is blank is not a decision.
 *
 * `{ none: "" }` type-checks against `string`, so without this the cheapest way
 * to move a family out of the undecided list would be to type two quote marks —
 * adding a name to "deliberately not doing this" becomes a one-character edit.
 * A type cannot judge whether a reason is *good*; it can refuse to accept one
 * that says nothing, which is the failure this list is most exposed to.
 *
 * Deliberately a type rather than a test: it costs nothing at runtime, and
 * `pnpm typecheck` already runs in the required CI job.
 */
type Whitespace = " " | "\n" | "\t" | "\r";

type IsBlank<T extends string> = T extends ""
  ? true
  : T extends `${Whitespace}${infer Rest}`
    ? IsBlank<Rest>
    : false;

/**
 * The keys whose `none` reason is blank. Resolves to `never` while every
 * recorded reason carries something, otherwise to the offending families.
 *
 * Caveat, measured: this is a generic instantiation, so the compiler preserves
 * its name and prints only **one** example member rather than the whole union —
 * see the note on `_EveryFamilyIsAccountedFor`. With a single blank reason, the
 * case the mutation exercised, the message names it exactly; with several it
 * names the first and you re-run to find the next.
 */
type BlankReasonFamilies<T> = {
  [K in keyof T]: T[K] extends { readonly none: infer Reason }
    ? Reason extends string
      ? IsBlank<Reason> extends true
        ? K
        : never
      : never
    : never;
}[keyof T];

export type _EveryNoControlReasonSaysSomething = AssertNever<
  BlankReasonFamilies<typeof FAMILY_COVERAGE>
>;
