import { describe, expect, it } from "vitest";
import {
  buildContentFieldOrder,
  orderContentBlocks,
  resolveContentFieldOrder,
  type ContentFieldOrderNode,
} from "./content-field-order";

const node = (
  sectionId: string,
  target?: { fieldKey?: string; fieldPath?: string },
): ContentFieldOrderNode => ({ sectionId, target });

describe("buildContentFieldOrder", () => {
  // The case from the Principles section: the label renders above the grid,
  // but the props declare `items` first.
  it("records fields in document order, not declaration order", () => {
    const order = buildContentFieldOrder(
      [
        node("s1", { fieldKey: "label", fieldPath: "label" }),
        node("s1", { fieldKey: "title", fieldPath: "items.0.title" }),
        node("s1", { fieldKey: "body", fieldPath: "items.0.body" }),
      ],
      "s1",
    );

    expect(order.get("label")).toBe(0);
    expect(order.get("items")).toBe(1);
  });

  it("groups an array's row fields under the array key", () => {
    const order = buildContentFieldOrder(
      [
        node("s1", { fieldKey: "title", fieldPath: "items.0.title" }),
        node("s1", { fieldKey: "body", fieldPath: "items.1.body" }),
        node("s1", { fieldKey: "heading", fieldPath: "heading" }),
      ],
      "s1",
    );

    // One position for the whole array, taken from its first row field.
    expect(order.get("items")).toBe(0);
    expect(order.get("heading")).toBe(1);
    expect(order.has("title")).toBe(false);
  });

  it("keeps the first appearance when a field is bound more than once", () => {
    const order = buildContentFieldOrder(
      [
        node("s1", { fieldKey: "heading", fieldPath: "heading" }),
        node("s1", { fieldKey: "body", fieldPath: "body" }),
        node("s1", { fieldKey: "heading", fieldPath: "heading" }),
      ],
      "s1",
    );

    expect(order.get("heading")).toBe(0);
    expect(order.get("body")).toBe(1);
  });

  it("ignores nodes from other sections", () => {
    const order = buildContentFieldOrder(
      [
        node("other", { fieldKey: "heading", fieldPath: "heading" }),
        node("s1", { fieldKey: "label", fieldPath: "label" }),
      ],
      "s1",
    );

    expect(order.get("label")).toBe(0);
    expect(order.has("heading")).toBe(false);
  });

  it("falls back to fieldKey when there is no path", () => {
    const order = buildContentFieldOrder([node("s1", { fieldKey: "body" })], "s1");
    expect(order.get("body")).toBe(0);
  });

  it("is empty without nodes or without a section", () => {
    expect(buildContentFieldOrder(undefined, "s1").size).toBe(0);
    expect(buildContentFieldOrder([node("s1", { fieldKey: "a" })], null).size).toBe(0);
    expect(buildContentFieldOrder([node("s1", {})], "s1").size).toBe(0);
  });
});

describe("orderContentBlocks", () => {
  const blocks = [
    { key: "items" },
    { key: "eyebrow" },
    { key: "label" },
    { key: "body" },
  ];

  it("sorts blocks into document order", () => {
    const order = new Map([
      ["eyebrow", 0],
      ["label", 1],
      ["items", 2],
      ["body", 3],
    ]);

    expect(orderContentBlocks(blocks, order).map((b) => b.key)).toEqual([
      "eyebrow",
      "label",
      "items",
      "body",
    ]);
  });

  // A preview that has not reported yet must not reshuffle the panel.
  it("leaves the order untouched when nothing is known", () => {
    expect(orderContentBlocks(blocks, new Map()).map((b) => b.key)).toEqual([
      "items",
      "eyebrow",
      "label",
      "body",
    ]);
  });

  it("keeps unplaced blocks in their original order, after the placed ones", () => {
    const order = new Map([
      ["label", 0],
      ["items", 1],
    ]);

    expect(orderContentBlocks(blocks, order).map((b) => b.key)).toEqual([
      "label",
      "items",
      // `eyebrow` and `body` were never reported; their relative order holds.
      "eyebrow",
      "body",
    ]);
  });

  it("is stable for blocks sharing a position", () => {
    const order = new Map([
      ["items", 0],
      ["eyebrow", 0],
    ]);
    const result = orderContentBlocks(blocks, order).map((b) => b.key);
    expect(result.slice(0, 2)).toEqual(["items", "eyebrow"]);
  });

  it("does not mutate the input", () => {
    const input = [...blocks];
    orderContentBlocks(input, new Map([["body", 0]]));
    expect(input.map((b) => b.key)).toEqual([
      "items",
      "eyebrow",
      "label",
      "body",
    ]);
  });
});

describe("resolveContentFieldOrder", () => {
  // The author's declaration is an intent; the markup's nesting is not.
  it("lets a declaration override document order", () => {
    const order = resolveContentFieldOrder({
      declaredKeys: ["label", "items"],
      documentOrder: new Map([
        ["items", 0],
        ["label", 1],
      ]),
    });

    expect(order.get("label")).toBe(0);
    expect(order.get("items")).toBe(1);
  });

  it("uses document order when nothing is declared", () => {
    const documentOrder = new Map([
      ["label", 0],
      ["items", 1],
    ]);
    expect(resolveContentFieldOrder({ declaredKeys: [], documentOrder })).toBe(
      documentOrder,
    );
  });

  // A component can render `heading`/`body` without declaring them; those must
  // not be spliced into the middle of the order the author chose.
  it("appends undeclared fields in document order, after the declared ones", () => {
    const order = resolveContentFieldOrder({
      declaredKeys: ["items"],
      documentOrder: new Map([
        ["heading", 0],
        ["items", 1],
        ["body", 2],
      ]),
    });

    expect(order.get("items")).toBe(0);
    expect(order.get("heading")).toBe(1);
    expect(order.get("body")).toBe(2);
  });

  it("is empty when neither source knows anything", () => {
    expect(
      resolveContentFieldOrder({ declaredKeys: [], documentOrder: new Map() })
        .size,
    ).toBe(0);
  });

  it("ignores a duplicated declaration key", () => {
    const order = resolveContentFieldOrder({
      declaredKeys: ["a", "b", "a"],
      documentOrder: new Map(),
    });
    expect(order.get("a")).toBe(0);
    expect(order.get("b")).toBe(1);
  });
});
