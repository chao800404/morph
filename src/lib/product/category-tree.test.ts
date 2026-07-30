import { describe, expect, it } from "vitest";
import {
  ancestorIdsOf,
  categoryDepth,
  sortCategoryTree,
} from "./category-tree";
import type { ProductCategoryDTO } from "./dto/product-taxonomy.dto";

const category = (
  id: string,
  name: string,
  parentCategoryId: string | null,
  mpath: string,
): ProductCategoryDTO => ({
  id,
  name,
  description: "",
  handle: name.toLowerCase(),
  mpath,
  parentCategoryId,
  isActive: true,
  isInternal: false,
  rank: 0,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("categoryDepth", () => {
  it("treats a top-level category as depth zero", () => {
    expect(categoryDepth("/root")).toBe(0);
  });

  it("counts one level per ancestor", () => {
    expect(categoryDepth("/root/child")).toBe(1);
    expect(categoryDepth("/root/child/grandchild")).toBe(2);
  });

  it("never returns a negative depth for an unexpected path", () => {
    expect(categoryDepth("")).toBe(0);
    expect(categoryDepth("/")).toBe(0);
  });
});

describe("ancestorIdsOf", () => {
  it("excludes the row's own id", () => {
    expect(ancestorIdsOf("/root/child")).toEqual(["root"]);
    expect(ancestorIdsOf("/root")).toEqual([]);
  });
});

describe("sortCategoryTree", () => {
  /**
   * Regression: ordering by `mpath` in SQL grouped subtrees correctly but sorted
   * siblings by uuid, so the picker listed them arbitrarily. Ids here are
   * deliberately in the opposite order to the names.
   */
  it("puts each parent before its children and sorts siblings by name", () => {
    const ordered = sortCategoryTree([
      category("z", "Trousers", "a", "/a/z"),
      category("a", "Clothing", null, "/a"),
      category("m", "Shirts", "a", "/a/m"),
      category("b", "Footwear", null, "/b"),
    ]);

    expect(ordered.map((entry) => entry.name)).toEqual([
      "Clothing",
      "Shirts",
      "Trousers",
      "Footwear",
    ]);
  });

  it("keeps a row whose parent is missing from the input", () => {
    // A bounded read can cut off mid-tree; dropping the orphan would hide it
    // from the picker entirely.
    const ordered = sortCategoryTree([
      category("child", "Orphan", "absent-parent", "/absent-parent/child"),
    ]);

    expect(ordered.map((entry) => entry.name)).toEqual(["Orphan"]);
  });

  it("returns an empty list unchanged", () => {
    expect(sortCategoryTree([])).toEqual([]);
  });
});
