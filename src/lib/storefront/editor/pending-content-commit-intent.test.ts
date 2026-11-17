import { describe, expect, it } from "vitest";
import {
  draftIsAsCommitted,
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
