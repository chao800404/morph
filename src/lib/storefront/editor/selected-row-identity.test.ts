// @vitest-environment node
import { describe, expect, it } from "vitest";
import { rebaseSelectedRowPath } from "./selected-row-identity";

const rows = (...ids: string[]) => ({
  items: ids.map((id) => ({ id, title: id.toUpperCase() })),
});

describe("the row a selection points at, confirmed by its id", () => {
  it("keeps the path while the row is still where it was selected", () => {
    expect(
      rebaseSelectedRowPath("items.1.title", "r2", rows("r1", "r2")),
    ).toEqual({ fieldPath: "items.1.title", lost: false });
  });

  it("follows the row to its new index after a reorder", () => {
    // Writing to `items.1.title` as selected would now change r1.
    expect(
      rebaseSelectedRowPath("items.1.title", "r2", rows("r2", "r1")),
    ).toEqual({ fieldPath: "items.0.title", lost: false });
  });

  it("follows the row past an insert above it", () => {
    expect(
      rebaseSelectedRowPath("items.1", "r2", rows("r0", "r1", "r2")),
    ).toEqual({ fieldPath: "items.2", lost: false });
  });

  it("reports the row lost when it was removed, rather than any other row", () => {
    expect(
      rebaseSelectedRowPath("items.1.title", "r2", rows("r1", "r3")),
    ).toEqual({ fieldPath: null, lost: true });
  });

  it("uses the path as given when there is nothing to confirm it against", () => {
    // No id when selected; a top-level field; rows nothing stores yet.
    expect(
      rebaseSelectedRowPath("items.1.title", null, rows("r2", "r1")),
    ).toEqual({ fieldPath: "items.1.title", lost: false });
    expect(rebaseSelectedRowPath("label", "r2", rows("r1"))).toEqual({
      fieldPath: "label",
      lost: false,
    });
    expect(rebaseSelectedRowPath("items.1.title", "r2", {})).toEqual({
      fieldPath: "items.1.title",
      lost: false,
    });
  });
});
