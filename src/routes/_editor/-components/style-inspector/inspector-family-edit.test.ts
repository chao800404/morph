import { describe, expect, it } from "vitest";

import {
  classifyTailwindUtility,
  patchTailwindClasses,
} from "@/lib/storefront/ast/tailwind-token-engine";

import { patchBroadFamily } from "./inspector-family-edit";

/**
 * The write path of the Inspector's broad-family controls — the sweep-up.
 *
 * Every expectation below is a **measurement** of the real function through the
 * real token engine, taken before this file was written. Where a measurement
 * contradicted what the author expected, the comment records the surprise
 * rather than smoothing it over: two of these cases look like bugs and are
 * asserted anyway, so that fixing them has to change this file on purpose.
 *
 * The relation under test lives in `inspector-family-containment.test.ts`. This
 * file is about what the Inspector *does* with it.
 */

describe("patchBroadFamily — the sweep-up", () => {
  /**
   * The original defect. The clears named only the four physical sides, so a
   * logical `px-*` survived a `padding` write and kept deciding the inline
   * sides — while the optimistic keys told the user all four sides read the new
   * value. The control reported a value the element did not have.
   */
  it("removes the covered x/y rank, not only the physical sides", () => {
    expect(patchBroadFamily("p-4 px-6", "padding", "p-[9px]")).toBe("p-[9px]");
    expect(patchBroadFamily("p-4 py-6", "padding", "p-[9px]")).toBe("p-[9px]");
    expect(patchBroadFamily("m-2 mx-4", "margin", "m-[9px]")).toBe("m-[9px]");
  });

  it("removes the physical overrides it always removed", () => {
    expect(patchBroadFamily("p-4 pl-2 pr-3", "padding", "p-[9px]")).toBe(
      "p-[9px]",
    );
  });

  it("clears every rank at once when all three are present", () => {
    expect(patchBroadFamily("p-4 px-6 pt-2", "padding", "p-[9px]")).toBe(
      "p-[9px]",
    );
  });

  it("is order-independent on the input", () => {
    expect(patchBroadFamily("px-6 p-4", "padding", "p-[9px]")).toBe("p-[9px]");
  });

  it("leaves the other groups' tokens alone", () => {
    expect(patchBroadFamily("p-4 mx-2", "padding", "p-[9px]")).toBe(
      "p-[9px] mx-2",
    );
    expect(patchBroadFamily("p-4 px-6 m-2 mx-3", "padding", "p-[9px]")).toBe(
      "p-[9px] m-2 mx-3",
    );
    expect(patchBroadFamily("m-2 mx-3 p-4", "margin", "m-[9px]")).toBe(
      "m-[9px] p-4",
    );
  });

  it("leaves tokens outside every group alone", () => {
    expect(patchBroadFamily("flex items-center", "padding", "")).toBe(
      "flex items-center",
    );
  });
});

describe("patchBroadFamily — the scope reaches the clears, not only the write", () => {
  /**
   * This is the claim the extraction exists to make good on, and it is the
   * reason the scope arguments are not decoration. The component injects
   * `targetVariants` (the active viewport) and `activeVariants` (the structural
   * variants the selected element matches) into **every** patch. If the clears
   * ran at base scope while the write ran at `md:`, a sweep-up on the tablet
   * viewport would delete base tokens the user never touched.
   *
   * The first two rows are the evidence: the write lands at `md:` and the base
   * `px-6` is still there, so the clear looked at `md:` scope and found nothing
   * — it did not silently sweep the base scope.
   */
  it("clears at the requested scope, leaving other scopes intact", () => {
    expect(
      patchBroadFamily("p-4 px-6", "padding", "p-[9px]", {
        targetVariants: ["md"],
      }),
    ).toBe("p-4 px-6 md:p-[9px]");
    expect(
      patchBroadFamily("p-4 px-6", "padding", "p-[9px]", {
        targetVariants: ["lg"],
      }),
    ).toBe("p-4 px-6 lg:p-[9px]");
  });

  it("clears the covered token at that same scope", () => {
    expect(
      patchBroadFamily("md:p-4 md:px-6", "padding", "p-[9px]", {
        targetVariants: ["md"],
      }),
    ).toBe("md:p-[9px]");
    expect(
      patchBroadFamily("p-4 md:px-6", "padding", "p-[9px]", {
        targetVariants: ["md"],
      }),
    ).toBe("p-4 md:p-[9px]");
  });

  it("does not reach a different variant's token", () => {
    // Variant matching is exact equality, so `hover:` is untouched by a base
    // write even though the family is the same.
    expect(patchBroadFamily("p-4 hover:px-6", "padding", "p-[9px]")).toBe(
      "p-[9px] hover:px-6",
    );
    expect(patchBroadFamily("p-4 md:px-6", "padding", "p-[9px]")).toBe(
      "p-[9px] md:px-6",
    );
    expect(
      patchBroadFamily("lg:first:pl-0 lg:p-4", "padding", "p-[9px]", {
        targetVariants: ["lg"],
      }),
    ).toBe("lg:first:pl-0 lg:p-[9px]");
  });

  it("clears a structural conditional the element currently matches", () => {
    // `activeVariants` is what makes this reach `first:px-6`: the engine treats
    // a conditional the element currently matches as the patch target. With no
    // active variants — or a different one — the token survives.
    expect(
      patchBroadFamily("first:px-6 p-4", "padding", "p-[9px]", {
        activeVariants: ["first"],
      }),
    ).toBe("p-[9px]");
    expect(patchBroadFamily("first:px-6 p-4", "padding", "p-[9px]")).toBe(
      "first:px-6 p-[9px]",
    );
    expect(
      patchBroadFamily("first:px-6 p-4", "padding", "p-[9px]", {
        activeVariants: ["last"],
      }),
    ).toBe("first:px-6 p-[9px]");
  });

  it("prefers the target scope over an active variant that does not cover it", () => {
    // Measured, and worth knowing before extending the engine: with both set,
    // the engine looks for a conditional whose variants contain the target —
    // `first:` does not contain `md`, so the fallback is the target scope and
    // the `first:` token survives a tablet-scope sweep-up.
    expect(
      patchBroadFamily("first:px-6 p-4", "padding", "p-[9px]", {
        targetVariants: ["md"],
        activeVariants: ["first"],
      }),
    ).toBe("first:px-6 p-4 md:p-[9px]");
  });
});

describe("patchBroadFamily — values are matched by family, not by spelling", () => {
  it("clears an arbitrary value in a covered family", () => {
    expect(patchBroadFamily("p-[13px] px-[2rem]", "padding", "p-[9px]")).toBe(
      "p-[9px]",
    );
    expect(patchBroadFamily("p-[13px]", "padding", "p-[9px]")).toBe("p-[9px]");
    expect(
      patchBroadFamily("px-[calc(100%-2rem)] p-4", "padding", "p-[9px]"),
    ).toBe("p-[9px]");
  });

  /**
   * Two cases where **no clear happens at all**, asserted so they are facts in
   * the suite rather than folklore. Both tokens classify as `"other"` in the
   * engine's classifier, and a token of an unknown family is preserved verbatim
   * — so the clear names a family the token does not have and silently finds
   * nothing. The CSS-variable shorthand `p-(--gap)` sets `padding`; the result
   * below therefore keeps two declarations that the broad write was supposed to
   * resolve.
   *
   * This is the same "assert it so adopting the fix must change this file"
   * device used for the `unroll` decision below. When the classifier learns
   * these forms, these expectations are the ones that must move.
   */
  it("clears the axis and side-pair families now that they have entries", () => {
    // Every token below was verified to be a real Tailwind 4.1.17 utility by
    // compiling it. These two rows used to read `"border-[9px] border-x-2"` and
    // `"rounded-[9px] rounded-t-2xl"`: the tokens survived a broad write because
    // the classifier called them `"other"`, so the sweep-up named a family they
    // did not have and silently found nothing. They moved **on purpose** when the
    // axis ranks and the radius side pairs entered the union — if they ever move
    // back, those families were lost again.
    expect(
      patchBroadFamily("border border-x-2", "border-width", "border-[9px]"),
    ).toBe("border-[9px]");
    expect(
      patchBroadFamily(
        "rounded rounded-t-2xl rounded-l-lg",
        "border-radius",
        "rounded-[9px]",
      ),
    ).toBe("rounded-[9px]");
    // `rounded-t` covers two corners, so clearing it needs a family naming the
    // pair — neither corner family reaches it, and it reaches both.
    expect(
      patchBroadFamily("rounded-tl-2xl rounded-t-2xl", "border-radius", ""),
    ).toBe("");
  });

  it("clears the logical families too, so no real class in these four survives", () => {
    // The gap this file used to record is closed. It moved three times — first
    // `p-(--gap)`, then `border-x-2`/`rounded-t-2xl`, then `border-s-2`/
    // `rounded-ss-2xl` — and each move was a measurement of a shrinking set
    // (134 → 120 → 60 → 0 tokens that are real classes, declare the family's
    // property, and survive a clear).
    //
    // Every token below was verified to be a real Tailwind 4.1.17 utility by
    // compiling it. `ps-4` emits `padding-inline-start`, `border-s-2`
    // `border-inline-start-width`, `rounded-ss-2xl` `border-start-start-radius`,
    // and `rounded-s-2xl` the pair `border-start-start-radius` +
    // `border-end-start-radius`.
    expect(patchBroadFamily("ps-4 pe-4", "padding", "")).toBe("");
    expect(patchBroadFamily("ms-4 -me-4", "margin", "")).toBe("");
    expect(patchBroadFamily("border-s-2 border-e-2", "border-width", "")).toBe(
      "",
    );
    expect(
      patchBroadFamily("rounded-ss-2xl rounded-ee-2xl", "border-radius", ""),
    ).toBe("");
    expect(
      patchBroadFamily("rounded-s-2xl rounded-e-2xl", "border-radius", ""),
    ).toBe("");
    // The logical inline sides are decided by `padding-inline` too, so the `x`
    // rank has to clear them — measured, a surviving `ps-4` overrides a `px-*`
    // write because Tailwind emits the longhand after the shorthand.
    expect(patchBroadFamily("px-4 ps-8", "padding-x", "")).toBe("");
  });

  it("now clears the CSS-variable shorthand, which it previously could not", () => {
    // This row used to read `"p-(--gap) px-(--gap-x) p-[9px]"`: the shorthand
    // classified as `"other"`, so the clear named a family the token did not
    // have and silently found nothing. The spacing patterns now accept the
    // parenthesised form, so the row moved **on purpose** — if it ever moves
    // back, the classifier lost the form again.
    expect(
      patchBroadFamily("p-(--gap) px-(--gap-x)", "padding", "p-[9px]"),
    ).toBe("p-[9px]");
    expect(
      patchBroadFamily("m-(--gap) mx-(--gap-x)", "margin", "m-[9px]"),
    ).toBe("m-[9px]");
  });

  it("classifies the shorthand as the family its prefix names", () => {
    // The prefix was never ambiguous — only the value form went unparsed — so
    // each spelling lands in the same family as its numeric twin. `p-(--gap)`
    // compiles to the same declaration as `p-[var(--gap)]`, which is why the
    // bracket form already worked.
    expect(classifyTailwindUtility("p-(--gap)")).toBe("padding");
    expect(classifyTailwindUtility("px-(--gap-x)")).toBe("padding-x");
    expect(classifyTailwindUtility("py-(--gap-y)")).toBe("padding-y");
    expect(classifyTailwindUtility("pt-(--gap)")).toBe("padding-top");
    expect(classifyTailwindUtility("m-(--gap)")).toBe("margin");
    expect(classifyTailwindUtility("mx-(--gap)")).toBe("margin-x");
    expect(classifyTailwindUtility("-m-(--gap)")).toBe("margin");
  });

  it("names the shorthand in every family that takes one", () => {
    // The row that used to live here pinned `gap-(--gap)` and `w-(--gap)` as
    // `"other"` under the reason "only padding and margin were widened". The
    // reason was false and so was the limit. A generated candidate space — every
    // `^prefix` mentioned in the engine's own pattern source, plus every
    // `<prefix>-(--var)` class the repository writes — measured **29** real
    // paren-form classes as `"other"`; **20** of them because the value form was
    // unparsed while their `[var(--v)]` twin was classified, and those 20 are
    // the list below. Seventeen are pattern-matched; the three after the loop go
    // through the value predicates instead.
    for (const [utility, family] of [
      ["gap-(--g)", "gap"],
      ["w-(--w)", "width"],
      ["h-(--h)", "height"],
      ["min-w-(--w)", "min-width"],
      ["min-h-(--h)", "min-height"],
      ["max-w-(--w)", "max-width"],
      ["max-h-(--h)", "max-height"],
      ["top-(--t)", "top"],
      ["left-(--l)", "left"],
      ["z-(--z)", "z-index"],
      ["rotate-(--r)", "rotate"],
      ["opacity-(--o)", "opacity"],
      ["aspect-(--a)", "aspect-ratio"],
      ["cursor-(--c)", "cursor"],
      ["object-(--p)", "object-position"],
      ["shadow-(--s)", "box-shadow"],
      ["transition-(--t)", "transition"],
    ] as const) {
      expect(classifyTailwindUtility(utility)).toBe(family);
    }
    // These three have no pattern of their own: the parenthesised form is routed
    // through the same value predicates as the bracketed one, which is what
    // keeps the two spellings agreeing. The variable's *name* therefore decides
    // the family for them — measured, `bg-[var(--color-v)]` is a background and
    // `bg-[var(--v)]` is not, because the colour test is name-based.
    expect(classifyTailwindUtility("bg-(--brand-color)")).toBe("background");
    expect(classifyTailwindUtility("text-(--color-v)")).toBe("text-color");
    expect(classifyTailwindUtility("border-(--color-v)")).toBe("border-color");
  });

  it("leaves the nine that are not a value-form gap, and says what they are", () => {
    // Both spellings are `"other"` for these, which is how they are known not to
    // belong to the change above: nothing in the union names what they declare,
    // so the fix is a family, not a value form.
    //
    // Eight are the border-side colours. `border-t-(--c)` emits
    // `border-top-color`, and there is no `border-color-top` family — which is
    // also why the longhand spelling `border-t-red-500` is `"other"`, so this is
    // not about the parentheses at all. The ninth is `flex-(--f)`, emitting the
    // `flex` shorthand: the union has `flex-direction` and no `flex`, and
    // `flex-[1_1_0%]` is `"other"` for the same reason.
    expect(classifyTailwindUtility("border-t-(--c)")).toBe("other");
    expect(classifyTailwindUtility("border-t-red-500")).toBe("other");
    expect(classifyTailwindUtility("flex-(--f)")).toBe("other");
    expect(classifyTailwindUtility("flex-[1_1_0%]")).toBe("other");
    // And `border-(--w)` is a border *colour* — measured, it emits
    // `border-color: var(--w)` — which the name-based colour test misses. That
    // is the allowlist's gap rather than the value form's, so it stays `"other"`
    // here deliberately. The gap is not unwritten, though: `onBorderColorCommit`
    // (`editor-style-inspector.tsx:4468`) calls
    // `commitContainerProperty("border-color", …)`, which forwards the name into
    // `patchTailwindClasses`, and `onBorderColorClear` at `:4477` is a real
    // clear. So what is missing is this classifier's reach over the value form,
    // not a control.
    expect(classifyTailwindUtility("border-(--w)")).toBe("other");
  });

  it("clears every radius corner form, physical and logical alike", () => {
    // This test used to be the contrast that made the row above a *classifier*
    // gap: `rounded-tl-*` was cleared while `rounded-t-*` and `rounded-ss-*`
    // survived. All three are families now, so the contrast is gone and what is
    // asserted is the closure — every corner form a broad write has to clear.
    // Each was verified to be a real class by compiling it.
    for (const corner of [
      "rounded-tl-2xl",
      "rounded-tr-2xl",
      "rounded-br-2xl",
      "rounded-bl-2xl",
      "rounded-ss-2xl",
      "rounded-se-2xl",
      "rounded-es-2xl",
      "rounded-ee-2xl",
    ]) {
      expect(
        patchBroadFamily(`rounded ${corner}`, "border-radius", "rounded-[9px]"),
      ).toBe("rounded-[9px]");
    }
  });
});

describe("patchBroadFamily — duplicate tokens", () => {
  it("collapses repeated tokens to a single value", () => {
    expect(patchBroadFamily("p-4 p-4", "padding", "p-[9px]")).toBe("p-[9px]");
    expect(patchBroadFamily("px-6 px-6", "padding", "p-[9px]")).toBe("p-[9px]");
    expect(patchBroadFamily("pl-2 pl-3", "padding", "p-[9px]")).toBe("p-[9px]");
    expect(patchBroadFamily("p-4 p-4 px-6", "padding", "p-[9px]")).toBe(
      "p-[9px]",
    );
  });
});

describe("a utility from a contained family, which the sweep-up takes back", () => {
  /**
   * Measured, and the reason the module docblock no longer claims the ordering
   * protects the write. `patchBroadFamily` writes `utility` first and then clears
   * every family `family` contains. When `utility` belongs to one of those
   * contained families, the clear removes what the write just added and the
   * function returns `""`.
   *
   * `""` is the worst available answer: it is exactly what a caller gets when it
   * asked to *clear*, so nothing downstream can tell the two apart. Seven of the
   * eight inputs below lose the value; the first is the control, and it has the
   * shape every real call site has — each builds the utility from the prefix it
   * names (`inspectorLengthUtility("p", …)` for `padding`) — which is why this is
   * a contract that does not hold rather than a live defect.
   *
   * Asserted rather than fixed: clearing before writing would remove the hazard,
   * but it changes an ordering the rest of this file was measured against. These
   * rows are the ones that must move if that change is made.
   */
  it("returns an empty class string instead of the value it was given", () => {
    // The control: a utility from the family named, which survives.
    expect(patchBroadFamily("p-4", "padding", "p-[9px]")).toBe("p-[9px]");
    // The axis rank and the physical sides are both contained by `padding`.
    expect(patchBroadFamily("p-4", "padding", "px-[9px]")).toBe("");
    expect(patchBroadFamily("p-4", "padding", "pt-[9px]")).toBe("");
    expect(patchBroadFamily("", "padding", "px-[9px]")).toBe("");
    expect(patchBroadFamily("m-2", "margin", "mx-[9px]")).toBe("");
    // The same shape in the other two governed groups.
    expect(patchBroadFamily("border-2", "border-width", "border-x-[9px]")).toBe(
      "",
    );
    expect(
      patchBroadFamily("rounded-lg", "border-radius", "rounded-tl-[9px]"),
    ).toBe("");
    expect(patchBroadFamily("", "border-radius", "rounded-tl-[9px]")).toBe("");
  });

  it("classifies each lost utility into a family the call is about to clear", () => {
    // The mechanism, named, so the rows above are not an artifact of spelling:
    // every lost value is a utility whose family is a **descendant** of the
    // family the caller named.
    expect(classifyTailwindUtility("px-[9px]")).toBe("padding-x");
    expect(classifyTailwindUtility("pt-[9px]")).toBe("padding-top");
    expect(classifyTailwindUtility("mx-[9px]")).toBe("margin-x");
    expect(classifyTailwindUtility("border-x-[9px]")).toBe("border-width-x");
    expect(classifyTailwindUtility("rounded-tl-[9px]")).toBe(
      "border-radius-top-left",
    );
  });
});

describe("the clear path this function already provides", () => {
  /**
   * `patchBroadFamily(…, "")` is a full clear of the broad family and everything
   * it decides — the write's sweep-up semantics with no replacement.
   *
   * ## The clear-time *refuse* question, and why it is closed
   *
   * The module docblock says a discriminated return type belongs at the clear
   * path "and not before that policy exists", and this block carried the
   * question: the return value is a bare `string`, so a caller cannot tell
   * "removed everything" from "removed nothing". **Measured, the question has no
   * input**, which is why nothing was added:
   *
   * - A generated matrix of **1538 (family, class string) pairs** — every real
   *   class the engine's own patterns can produce for these four families and
   *   their closures, in ten value forms including `(--v)`, alone, paired,
   *   duplicated, variant-bearing, and with noise from other families — was
   *   driven through `patchBroadFamily(…, "")`. **Zero violations in both
   *   directions**: every base-scope token in the family's closure is gone
   *   afterwards, and nothing outside the closure is gone. (The generator was a
   *   throwaway probe; the counts are the durable part, and the loop below is the
   *   pin.)
   * - So there is no input where the user asked to clear a family and a token of
   *   that family survived. There is nothing for a refusal to refuse.
   * - Of the 502 no-op clears in that matrix, **498** had a token of the family at
   *   a **non-base scope only** — so clearing at the base scope correctly left it
   *   — and **4** had no token of the family at all. In both, "cleared" is an
   *   accurate report rather than a silent failure.
   *
   * The 134 unclearable tokens this question was originally about were a symptom
   * of the classifier's incomplete value forms, not of the clear path, and they
   * are gone. A signal would now describe a case that cannot occur.
   */
  it("removes the whole family group and nothing else", () => {
    expect(patchBroadFamily("p-4 px-6", "padding", "")).toBe("");
    expect(patchBroadFamily("p-4 px-6 pl-2", "padding", "")).toBe("");
    expect(patchBroadFamily("p-4 px-6 flex", "padding", "")).toBe("flex");
    expect(patchBroadFamily("p-4 px-6", "margin", "")).toBe("p-4 px-6");
    expect(patchBroadFamily("", "padding", "")).toBe("");
  });

  it("clears the axis and side-pair tokens along with the physical ones", () => {
    // These rows used to read `"border-x-2"` and `"rounded-t-2xl"`: the axis and
    // side-pair tokens survived a broad clear because no family named them. They
    // are families now, so the clear reaches them through the rank rather than
    // only through the direct edge.
    expect(patchBroadFamily("border-x-2", "border-width", "")).toBe("");
    expect(patchBroadFamily("border-y-2", "border-width", "")).toBe("");
    expect(patchBroadFamily("rounded-t-2xl", "border-radius", "")).toBe("");
    expect(
      patchBroadFamily("rounded-l-lg rounded-tl-2xl", "border-radius", ""),
    ).toBe("");
    // And it still leaves another group alone.
    expect(patchBroadFamily("border-x-2 p-4", "border-width", "")).toBe("p-4");
  });

  it("clears every real class these families can produce, and leaves the rest", () => {
    // The pin for the measurement in the docblock: one real class per shape the
    // four families can take, including every value form that used to be
    // unparsed. Each was verified to be a real 4.1.17 class and to classify into
    // the family named here — the three `border-<side>-(--w)` forms are
    // deliberately *not* in the list, and are asserted below instead.
    //
    // This list is hand-written and that is not a defect: it is a pin, and the
    // generator is the probe. The two have different jobs — a hand-list is only
    // wrong when it is mistaken for the generator.
    for (const [family, token] of [
      ["padding", "p-4"],
      ["padding", "px-6"],
      ["padding", "pl-2"],
      ["padding", "pt-[13px]"],
      ["padding", "p-(--gap)"],
      ["padding", "px-(--gap-x)"],
      ["padding", "ps-4"],
      ["padding", "pe-4"],
      ["margin", "m-4"],
      ["margin", "-m-4"],
      ["margin", "mx-2"],
      ["margin", "mt-auto"],
      ["margin", "me-auto"],
      ["margin", "ms-(--gap)"],
      ["margin", "my-4"],
      ["margin", "mr-2"],
      ["border-width", "border"],
      ["border-width", "border-4"],
      ["border-width", "border-x-2"],
      ["border-width", "border-y-2"],
      ["border-width", "border-t-2"],
      ["border-width", "border-l-[3px]"],
      ["border-width", "border-s-2"],
      ["border-radius", "rounded"],
      ["border-radius", "rounded-2xl"],
      ["border-radius", "rounded-xs"],
      ["border-radius", "rounded-t-2xl"],
      ["border-radius", "rounded-l-lg"],
      ["border-radius", "rounded-tl-2xl"],
      ["border-radius", "rounded-ss-2xl"],
      ["border-radius", "rounded-e-2xl"],
      ["border-radius", "rounded-(--r)"],
      ["border-radius", "rounded-t-(--r)"],
    ] as const) {
      expect(patchBroadFamily(token, family, "")).toBe("");
    }

    // The boundary of the claim, asserted rather than left implicit. These three
    // are real classes and share a border-side prefix, but they declare
    // `border-<side>-color` — measured — so a **width** clear must leave them,
    // and does. They are `"other"` to the classifier for a reason that has
    // nothing to do with the value form: the union has no colour family for a
    // single border side. `border-t-red-500` is `"other"` for the same reason.
    for (const token of [
      "border-t-(--w)",
      "border-e-(--w)",
      "border-x-(--w)",
    ]) {
      expect(patchBroadFamily(token, "border-width", "")).toBe(token);
    }

    // And the other direction: another family's token is never touched.
    expect(patchBroadFamily("gap-4", "border-width", "")).toBe("gap-4");
    expect(patchBroadFamily("gap-4", "border-radius", "")).toBe("gap-4");
    expect(patchBroadFamily("text-sm", "padding", "")).toBe("text-sm");
  });

  it("clears nothing when the family is absent at that scope, which is correct", () => {
    // These rows used to carry the open policy question. It is closed by the
    // measurement in the docblock: every no-op clear in the generated matrix was
    // a case with no token of that family at the targeted scope — 498 of them
    // because the only such token sat at a **non-base** scope. Removing nothing
    // there is the right answer, so the return type needs no signal to
    // distinguish it from a failure.
    expect(patchBroadFamily("border-s-2 border-e-2", "border-width", "")).toBe(
      "",
    );
    expect(patchBroadFamily("gap-4", "border-width", "")).toBe("gap-4");
    expect(
      patchBroadFamily("rounded-ss-2xl rounded-ee-2xl", "border-radius", ""),
    ).toBe("");
    expect(patchBroadFamily("gap-4", "border-radius", "")).toBe("gap-4");
    // The non-base case, which is what almost every no-op actually is: the token
    // is real, it is this family's, and it is simply not at the scope being
    // cleared.
    expect(patchBroadFamily("md:p-4", "padding", "")).toBe("md:p-4");
    expect(patchBroadFamily("hover:rounded-lg", "border-radius", "")).toBe(
      "hover:rounded-lg",
    );
  });
});

describe("the narrow path is not this function", () => {
  /**
   * Per-side controls call `patchTailwindClasses` directly with the specific
   * property (`editor-style-inspector.tsx:3701` and neighbours) — no sweep-up.
   * Pinned here so the two paths stay distinguishable: the broad path
   * **resolves** the overlap by deleting, the narrow path **appends** and lets
   * Tailwind's cascade decide.
   */
  it("appends rather than decomposing when a narrow family is edited", () => {
    expect(
      patchTailwindClasses("p-4", {
        property: "padding-left",
        value: "pl-[20px]",
      }),
    ).toBe("p-4 pl-[20px]");
    expect(
      patchTailwindClasses("pl-2", {
        property: "padding-left",
        value: "pl-[20px]",
      }),
    ).toBe("pl-[20px]");
    expect(
      patchTailwindClasses("pl-2 pl-3", {
        property: "padding-left",
        value: "pl-[20px]",
      }),
    ).toBe("pl-[20px]");
  });

  it("does not unroll a broad token into the physical sides", () => {
    // Current, deliberate behaviour: `unroll` is not semantics-preserving —
    // rewriting `px-6` as two physical declarations changes the result under a
    // vertical writing mode. Asserted so adopting it must change this test.
    expect(
      patchTailwindClasses("px-6", {
        property: "padding-left",
        value: "pl-[20px]",
      }),
    ).toBe("px-6 pl-[20px]");
  });

  it("honours the target scope on the narrow path too", () => {
    expect(
      patchTailwindClasses("p-4", {
        property: "padding-left",
        value: "pl-[20px]",
        targetVariants: ["md"],
      }),
    ).toBe("p-4 md:pl-[20px]");
    expect(
      patchTailwindClasses("md:pl-2", {
        property: "padding-left",
        value: "pl-[20px]",
        targetVariants: ["md"],
      }),
    ).toBe("md:pl-[20px]");
  });
});
