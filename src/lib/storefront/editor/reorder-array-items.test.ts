import { describe, expect, it } from "vitest";
import {
  addArrayRowAtFieldPath,
  parseArrayItemFieldPath,
  removeArrayRowAtFieldPath,
  swapArrayItemsAtFieldPaths,
} from "./reorder-array-items";

describe("reorder array items", () => {
  it("parses only an indexed array item root", () => {
    expect(parseArrayItemFieldPath("items.2")).toEqual({
      arrayPath: "items",
      index: 2,
    });
    expect(parseArrayItemFieldPath("content.items.12")).toEqual({
      arrayPath: "content.items",
      index: 12,
    });
    expect(parseArrayItemFieldPath("items.2.title")).toBeNull();
    expect(parseArrayItemFieldPath("items.__proto__.0")).toBeNull();
  });

  it("swaps two items immutably within the same array", () => {
    const source = {
      items: [
        { id: "one", title: "One" },
        { id: "two", title: "Two" },
        { id: "three", title: "Three" },
      ],
    };
    const result = swapArrayItemsAtFieldPaths(source, "items.0", "items.2");

    expect(result.editable).toBe(true);
    expect(result.value.items.map((item) => item.id)).toEqual([
      "three",
      "two",
      "one",
    ]);
    expect(source.items.map((item) => item.id)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("rejects cross-array and out-of-range swaps", () => {
    const source = { items: ["one", "two"], other: ["three"] };
    expect(
      swapArrayItemsAtFieldPaths(source, "items.0", "other.0"),
    ).toMatchObject({ editable: false, reason: "different-arrays" });
    expect(
      swapArrayItemsAtFieldPaths(source, "items.0", "items.9"),
    ).toMatchObject({ editable: false, reason: "index-out-of-range" });
  });
});

const listField = {
  type: "array" as const,
  label: "Items",
  minRows: 1,
  maxRows: 3,
  fields: {
    title: { type: "text" as const },
    count: { type: "number" as const, min: 2 },
    active: { type: "boolean" as const },
    tone: {
      type: "select" as const,
      options: [
        { label: "Quiet", value: "quiet" },
        { label: "Loud", value: "loud" },
      ],
    },
  },
};

describe("array row mutations", () => {
  it("creates a row with an identity and a value for every declared field", () => {
    // A row of undefined values renders as gaps and is rejected by the next
    // content write, so a new row has to be complete the moment it exists.
    const result = addArrayRowAtFieldPath({ items: [] }, "items", listField, {
      createId: () => "morph-new",
    });

    expect(result.editable).toBe(true);
    if (!result.editable) return;
    expect(result.itemId).toBe("morph-new");
    expect(result.value.items).toEqual([
      { id: "morph-new", title: "", count: 2, active: false, tone: "quiet" },
    ]);
  });

  it("inserts after a given row rather than only appending", () => {
    const result = addArrayRowAtFieldPath(
      { items: [{ id: "a" }, { id: "b" }] },
      "items",
      listField,
      { afterIndex: 0, createId: () => "morph-mid" },
    );

    expect(result.editable).toBe(true);
    if (!result.editable) return;
    expect((result.value.items as any[]).map((row) => row.id)).toEqual([
      "a",
      "morph-mid",
      "b",
    ]);
  });

  it("refuses to exceed the declared maximum", () => {
    const full = { items: [{ id: "a" }, { id: "b" }, { id: "c" }] };

    expect(addArrayRowAtFieldPath(full, "items", listField)).toMatchObject({
      editable: false,
      reason: "max-rows",
    });
  });

  it("removes the addressed row and leaves the rest in order", () => {
    const result = removeArrayRowAtFieldPath(
      { items: [{ id: "a" }, { id: "b" }, { id: "c" }] },
      "items.1",
      listField,
    );

    expect(result.editable).toBe(true);
    if (!result.editable) return;
    expect(result.itemId).toBe("b");
    expect((result.value.items as any[]).map((row) => row.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("refuses to drop below the declared minimum", () => {
    // Enforced here rather than in the UI so a stale button or a replayed
    // message cannot empty a list the Theme requires.
    expect(
      removeArrayRowAtFieldPath({ items: [{ id: "a" }] }, "items.0", listField),
    ).toMatchObject({ editable: false, reason: "min-rows" });
  });

  it("rejects an index that no longer exists", () => {
    expect(
      removeArrayRowAtFieldPath(
        { items: [{ id: "a" }, { id: "b" }] },
        "items.9",
        listField,
      ),
    ).toMatchObject({ editable: false, reason: "index-out-of-range" });
  });

  it("gives every created row a distinct identity", () => {
    const first = addArrayRowAtFieldPath({ items: [] }, "items", listField);
    const second = addArrayRowAtFieldPath({ items: [] }, "items", listField);

    expect(first.editable && second.editable).toBe(true);
    if (!first.editable || !second.editable) return;
    expect(first.itemId).not.toBe(second.itemId);
    expect(first.itemId).toMatch(/^morph-/);
  });
});
