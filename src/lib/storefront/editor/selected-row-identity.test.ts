// @vitest-environment node
import { describe, expect, it } from "vitest";
import { rebaseSelectedRowPath } from "./selected-row-identity";

const rows = (...ids: Array<string | undefined>) => ({
  items: ids.map((id, index) =>
    id === undefined ? { title: `T${index}` } : { id, title: id.toUpperCase() },
  ),
});

describe("the row a selection points at, confirmed by its id", () => {
  it("keeps the path while the row is still where it was selected", () => {
    expect(
      rebaseSelectedRowPath("items.1.title", "r2", rows("r1", "r2")),
    ).toEqual({ fieldPath: "items.1.title", refused: null });
  });

  it("follows the row to its new index after a reorder", () => {
    // Writing to `items.1.title` as selected would now change r1.
    expect(
      rebaseSelectedRowPath("items.1.title", "r2", rows("r2", "r1")),
    ).toEqual({ fieldPath: "items.0.title", refused: null });
  });

  it("follows the row past an insert above it", () => {
    expect(
      rebaseSelectedRowPath("items.1", "r2", rows("r0", "r1", "r2")),
    ).toEqual({ fieldPath: "items.2", refused: null });
  });

  it("refuses when the row was removed, rather than writing to another", () => {
    expect(
      rebaseSelectedRowPath("items.1.title", "r2", rows("r1", "r3")),
    ).toEqual({ fieldPath: null, refused: "row-lost" });
  });

  it("refuses a row selected without an id, whatever the rows hold", () => {
    // Nothing to confirm the row by: the index alone is what goes stale.
    expect(
      rebaseSelectedRowPath("items.1.title", null, rows("r1", "r2")),
    ).toEqual({ fieldPath: null, refused: "row-id-missing" });
    expect(rebaseSelectedRowPath("items.1.title", undefined, {})).toEqual({
      fieldPath: null,
      refused: "row-id-missing",
    });
  });

  it("refuses an id two rows share", () => {
    expect(
      rebaseSelectedRowPath("items.0.title", "r1", rows("r1", "r1")),
    ).toEqual({ fieldPath: null, refused: "row-id-duplicate" });
  });

  it("refuses an id the stored rows no longer hold, even beside rows without one", () => {
    expect(
      rebaseSelectedRowPath("items.0.title", "r1", rows(undefined, undefined)),
    ).toEqual({ fieldPath: null, refused: "row-lost" });
  });

  it("leaves a top-level field alone: it has no index to go stale", () => {
    expect(rebaseSelectedRowPath("label", null, rows("r1"))).toEqual({
      fieldPath: "label",
      refused: null,
    });
  });

  it("takes rows nothing stores yet as the preview reported them", () => {
    // The component's own defaults: nothing can have reordered them, and the
    // preview reported the id as unique among them when it was clicked.
    expect(rebaseSelectedRowPath("items.1.title", "d2", {})).toEqual({
      fieldPath: "items.1.title",
      refused: null,
    });
  });
});
