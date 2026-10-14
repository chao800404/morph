import { describe, expect, it } from "vitest";
import {
  acceptOwnSnapshot,
  acceptReadSnapshot,
  basisWithinOwnRange,
  rowIdentitiesAt,
  rowsStillMatch,
  type ContentSnapshot,
} from "./content-write-snapshot";

const sections = (heading: string) => [{ id: "hero", props: { heading } }];
const at = (
  draftGeneration: number,
  heading: string,
  ownSince = draftGeneration,
): ContentSnapshot => ({
  draftGeneration,
  sections: sections(heading),
  ownSince,
});

describe("a content write's snapshot", () => {
  it("is replaced whole, and only by a newer read", () => {
    const current = at(3, "Three");
    expect(
      acceptReadSnapshot(
        current,
        { draftGeneration: 3, sections: sections("Other") },
        new Map(),
      ),
    ).toBe(current);
    expect(
      acceptReadSnapshot(
        current,
        { draftGeneration: 2, sections: sections("Older") },
        new Map(),
      ),
    ).toBe(current);
    expect(
      acceptReadSnapshot(
        current,
        { draftGeneration: 4, sections: sections("Four") },
        new Map(),
      ),
    ).toEqual(at(4, "Four"));
    expect(
      acceptReadSnapshot(
        current,
        { draftGeneration: undefined, sections: sections("x") },
        new Map(),
      ),
    ).toBe(current);
  });

  it("keeps its own range when a read only catches up with our own writes", () => {
    const current = at(3, "Three", 2);
    const steps = new Map([
      [3, 4],
      [4, 5],
    ]);
    expect(
      acceptReadSnapshot(
        current,
        { draftGeneration: 5, sections: sections("Five") },
        steps,
      ),
    ).toEqual(at(5, "Five", 2));
  });

  it("starts its own range again when a read brings someone else's change", () => {
    const current = at(3, "Three", 1);
    // Our write took 3 to 4; the read is at 6.
    expect(
      acceptReadSnapshot(
        current,
        { draftGeneration: 6, sections: sections("Six") },
        new Map([[3, 4]]),
      ),
    ).toEqual(at(6, "Six", 6));
  });

  it("takes our own acknowledged write as the direct successor only", () => {
    const current = at(3, "Three", 1);
    expect(
      acceptOwnSnapshot(current, {
        sentAt: 3,
        draftGeneration: 4,
        sections: sections("Mine"),
      }),
    ).toEqual(at(4, "Mine", 1));
  });

  it("ignores a late answer, or one without the document", () => {
    const current = at(5, "Read later");
    // An answer to a write sent at 3 arrives after the read at 5.
    expect(
      acceptOwnSnapshot(current, {
        sentAt: 3,
        draftGeneration: 4,
        sections: sections("Late"),
      }),
    ).toBe(current);
    expect(
      acceptOwnSnapshot(current, {
        sentAt: 5,
        draftGeneration: 6,
        sections: undefined,
      }),
    ).toBe(current);
    expect(
      acceptOwnSnapshot(current, {
        sentAt: 5,
        draftGeneration: 5,
        sections: sections("Same"),
      }),
    ).toBe(current);
    // Newer, but not composed on this snapshot: taking it would count the
    // steps from 5 as our own.
    expect(
      acceptOwnSnapshot(current, {
        sentAt: 4,
        draftGeneration: 6,
        sections: sections("Not on this one"),
      }),
    ).toBe(current);
  });

  it("composes an input only inside its own range", () => {
    const snapshot = at(5, "Five", 3);
    expect(basisWithinOwnRange(snapshot, 3)).toBe(true);
    expect(basisWithinOwnRange(snapshot, 5)).toBe(true);
    expect(basisWithinOwnRange(snapshot, 2)).toBe(false);
    expect(basisWithinOwnRange(snapshot, 6)).toBe(false);
    expect(basisWithinOwnRange(snapshot, undefined)).toBe(true);
  });
});

describe("the rows a field was made in", () => {
  const props = {
    items: [
      { id: "a", title: "A", tags: [{ id: "t1" }] },
      { id: "b", title: "B" },
    ],
  };

  it("are read by id along the field's path", () => {
    expect(rowIdentitiesAt(props, "items.1.title")).toEqual([
      { rowPath: "items.1", id: "b" },
    ]);
    expect(rowIdentitiesAt(props, "items.0.tags.0.label")).toEqual([
      { rowPath: "items.0", id: "a" },
      { rowPath: "items.0.tags.0", id: "t1" },
    ]);
    expect(rowIdentitiesAt(props, "heading")).toEqual([]);
  });

  it("still match only while the same rows are at those paths", () => {
    const made = rowIdentitiesAt(props, "items.1.title");
    expect(rowsStillMatch(props, "items.1.title", made)).toBe(true);
    const reordered = { items: [props.items[1], props.items[0]] };
    expect(rowsStillMatch(reordered, "items.1.title", made)).toBe(false);
    const shorter = { items: [props.items[0]] };
    expect(rowsStillMatch(shorter, "items.1.title", made)).toBe(false);
    expect(rowsStillMatch({}, "items.1.title", made)).toBe(false);
    expect(rowsStillMatch(reordered, "heading", undefined)).toBe(true);
  });

  it("never match a row that had no id of its own when it was typed", () => {
    for (const row of [
      { title: "A" },
      { id: "", title: "A" },
      { id: "  ", title: "A" },
    ]) {
      const unnamed = { items: [row, { id: "b", title: "B" }] };
      const made = rowIdentitiesAt(unnamed, "items.0.title");
      expect(made).toEqual([{ rowPath: "items.0", id: null }]);
      // Not even against the very same rows: nothing says it is that row.
      expect(rowsStillMatch(unnamed, "items.0.title", made)).toBe(false);
    }
    const shared = {
      items: [
        { id: "a", title: "A" },
        { id: "a", title: "B" },
      ],
    };
    const made = rowIdentitiesAt(shared, "items.1.title");
    expect(made).toEqual([{ rowPath: "items.1", id: null }]);
    expect(rowsStillMatch(shared, "items.1.title", made)).toBe(false);
  });

  it("never match a row that has lost its own id since", () => {
    const made = rowIdentitiesAt(props, "items.1.title");
    for (const now of [
      { items: [props.items[0], { title: "B" }] },
      { items: [props.items[0], { id: "", title: "B" }] },
      // Another row took the same id: the one at the path is no longer
      // the only row it could be.
      { items: [{ ...props.items[0], id: "b" }, props.items[1]] },
    ]) {
      expect(rowsStillMatch(now, "items.1.title", made)).toBe(false);
    }
  });
});
