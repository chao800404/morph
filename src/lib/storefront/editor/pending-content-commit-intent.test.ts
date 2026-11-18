import { describe, expect, it } from "vitest";
import {
  discardPendingContentPath,
  draftIsAsCommitted,
  inputEndsCommit,
  rebaseFieldBasis,
  stageContentFields,
  type PendingContentEntry,
} from "./pending-content-write";

/**
 * A commit the author made by leaving a field is bound to the draft as it
 * was left: the very field edits it held. Any later input, to that field or
 * to a sibling never left, makes it another draft, which the commit does not
 * cover.
 */
describe("whether a held draft is still the one the author left", () => {
  const stored = { heading: "Old heading", subheading: "Old subheading" };
  const stage = (
    pending: PendingContentEntry | undefined,
    next: Record<string, unknown>,
  ) =>
    stageContentFields({
      pending,
      sectionId: "hero",
      stored,
      next,
      sourceForPath: () => 1,
      basisDraftGeneration: 2,
    })!;

  const left = stage(undefined, { heading: "Typed" });
  const committed = left.fields!;

  it("is, while nothing was typed since", () => {
    expect(draftIsAsCommitted(left, committed)).toBe(true);
  });

  it("is, when a field only re-emits the value it holds", () => {
    const reemitted = stage(left, { heading: "Typed" });
    expect(reemitted).toBe(left);
    expect(draftIsAsCommitted(reemitted, committed)).toBe(true);
  });

  it("is not, once the field left is typed into again", () => {
    expect(draftIsAsCommitted(stage(left, { heading: "Typed more" }), committed)).toBe(
      false,
    );
  });

  it("is not, once a sibling field the author never left is typed into", () => {
    const sibling = stage(left, { subheading: "Never left" });
    expect(sibling.fields!.heading).toBe(committed.heading);
    expect(draftIsAsCommitted(sibling, committed)).toBe(false);
  });

  it("is not, for a draft replaced by one with the same values", () => {
    const replaced = stage(undefined, { heading: "Typed" });
    expect(draftIsAsCommitted(replaced, committed)).toBe(false);
  });

  it("is not, for a draft discarded or without fields", () => {
    expect(draftIsAsCommitted(undefined, committed)).toBe(false);
    expect(
      draftIsAsCommitted({ sectionId: "hero", props: { heading: "Typed" } }, committed),
    ).toBe(false);
  });
});

/**
 * Input after the author left a field ends that commit, whatever it touched:
 * the field left, or a sibling the commit never held. Ended, it does not come
 * back when the draft later holds the very edits that were left again (a
 * sibling's edit dropped by a list discard, say). Only leaving a field again
 * commits the draft as it is then.
 */
describe("whether input ends a commit the author made by leaving a field", () => {
  const stored = {
    heading: "Old heading",
    items: [{ id: "row-1", title: "Old row" }],
  };
  const stage = (
    pending: PendingContentEntry | undefined,
    next: Record<string, unknown>,
    inputPath?: string,
  ) =>
    stageContentFields({
      pending,
      sectionId: "hero",
      stored,
      next,
      inputPath,
      sourceForPath: () => 1,
      basisDraftGeneration: 2,
    })!;

  const left = stage(undefined, { heading: "Typed" }, "heading");
  const committed = left.fields!;

  it("does not, for a field that only re-emits the value it holds", () => {
    const reemitted = stage(left, { heading: "Typed" }, "heading");
    expect(inputEndsCommit(reemitted, committed)).toBe(false);
  });

  it("does, for new input to the field left", () => {
    expect(
      inputEndsCommit(stage(left, { heading: "Typed more" }, "heading"), committed),
    ).toBe(true);
  });

  it("does, for input to a sibling the commit never held, even though the edit left is untouched", () => {
    const sibling = stage(
      left,
      { items: [{ id: "row-1", title: "New row" }] },
      "items.0.title",
    );
    expect(sibling.fields!.heading).toBe(committed.heading);
    expect(inputEndsCommit(sibling, committed)).toBe(true);

    // Why it must end there: once that sibling's edit is dropped again, the
    // draft holds exactly the edits that were left, and nothing later could
    // tell the commit had ended.
    const dropped = discardPendingContentPath({
      entry: sibling,
      baseline: stored,
      incoming: stored,
      fieldPath: "items",
    }).pending;
    expect(draftIsAsCommitted(dropped ?? undefined, committed)).toBe(true);
  });

  // The commit is bound to the basis each edit was made on: a draft moved
  // onto a later copy holds other edits, with the same values.
  it("a draft whose basis was moved (keep mine) is not the one left", () => {
    const rebased = rebaseFieldBasis(left, 5);
    expect(rebased.fields!.heading!.value).toBe("Typed");
    expect(rebased.fields!.heading!.basisDraftGeneration).toBe(5);
    expect(draftIsAsCommitted(rebased, committed)).toBe(false);
  });
});
