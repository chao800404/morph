import { describe, expect, it } from "vitest";
import {
  planSectionDragEnd,
  planSectionDragOver,
} from "./section-reorder-gesture";

/**
 * The invariant a reorder drag has to keep.
 *
 * Not "does it reorder" — the panel's own tests cover that. These state the
 * thing that has no other witness: a drag in flight never reaches the server,
 * and the end of one reaches it at most once. `onDragOver` fires on every
 * pointer movement, so the first of those is the difference between one write
 * and several dozen, and nothing about the result would look wrong if it broke.
 */

const sections = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("what a drag-over does to the working order", () => {
  it("moves the source to the target", () => {
    expect(
      planSectionDragOver({
        sections,
        sourceId: "a",
        targetId: "c",
        busy: false,
      }),
    ).toEqual([{ id: "b" }, { id: "c" }, { id: "a" }]);
  });

  /**
   * Every one of these is a pointer event that would otherwise re-render the
   * panel for no change. `null` is the whole point of the return type.
   */
  it.each([
    ["a drop on itself", { sourceId: "a", targetId: "a", busy: false }],
    ["no source", { sourceId: null, targetId: "b", busy: false }],
    ["no target", { sourceId: "a", targetId: null, busy: false }],
    ["an id this order does not hold", { sourceId: "a", targetId: "zz", busy: false }],
    ["a write already in flight", { sourceId: "a", targetId: "c", busy: true }],
  ])("does nothing for %s", (_name, options) => {
    expect(planSectionDragOver({ sections, ...options })).toBeNull();
  });
});

describe("what the end of a drag commits", () => {
  it("commits the ids once when the order changed", () => {
    expect(
      planSectionDragEnd({
        initial: sections,
        next: [{ id: "b" }, { id: "a" }, { id: "c" }],
        canceled: false,
        busy: false,
      }),
    ).toEqual({ kind: "commit", ids: ["b", "a", "c"] });
  });

  /**
   * Dragged and put back is not an edit. Without this, "commits at most once"
   * would be satisfied by committing on every release.
   */
  it("commits nothing when the order came back to where it started", () => {
    expect(
      planSectionDragEnd({
        initial: sections,
        next: [...sections],
        canceled: false,
        busy: false,
      }),
    ).toEqual({ kind: "none" });
  });

  it("restores without committing when the drag was cancelled", () => {
    expect(
      planSectionDragEnd({
        initial: sections,
        next: [{ id: "c" }, { id: "b" }, { id: "a" }],
        canceled: true,
        busy: false,
      }),
    ).toEqual({ kind: "restore", sections });
  });

  it.each([
    ["no drag ever began", { initial: null, busy: false }],
    ["a write is already in flight", { initial: sections, busy: true }],
  ])("commits nothing when %s", (_name, options) => {
    expect(
      planSectionDragEnd({
        next: [{ id: "c" }, { id: "b" }, { id: "a" }],
        canceled: false,
        ...options,
      }),
    ).toEqual({ kind: "none" });
  });

  /**
   * The count, said directly: a whole drag is one commit, not one per move.
   * `planSectionDragOver` cannot commit — it has no way to — and this walks a
   * realistic gesture to show that the only commit comes from the end.
   */
  it("produces exactly one commit across a twenty-step drag", () => {
    let working: readonly { id: string }[] = sections;
    const commits: string[][] = [];

    for (let step = 0; step < 20; step += 1) {
      const target = step % 2 === 0 ? "c" : "a";
      const next = planSectionDragOver({
        sections: working,
        sourceId: "b",
        targetId: target,
        busy: false,
      });
      if (next) working = next;
    }

    const plan = planSectionDragEnd({
      initial: sections,
      next: working,
      canceled: false,
      busy: false,
    });
    if (plan.kind === "commit") commits.push(plan.ids);

    expect(commits).toHaveLength(1);
  });
});
