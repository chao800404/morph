import { describe, expect, it } from "vitest";
import {
  parseArrayItemFieldPath,
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
