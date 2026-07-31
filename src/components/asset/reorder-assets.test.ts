import { describe, expect, it } from "vitest";
import type { SelectedAsset } from "./asset-tile";
import { reorderAssets } from "./reorder-assets";

const asset = (id: string): SelectedAsset => ({
  id,
  name: id,
  url: `/${id}.png`,
});

const ASSETS = ["a", "b", "c", "d"].map(asset);
const ids = (list: SelectedAsset[]) => list.map((item) => item.id);

describe("reorderAssets", () => {
  it("moves an item backwards to the dropped position", () => {
    expect(ids(reorderAssets(ASSETS, "d", "b"))).toEqual(["a", "d", "b", "c"]);
  });

  it("moves an item forwards to the dropped position", () => {
    // The naive version splices the target index before removing the source,
    // which lands one slot short when dragging forwards.
    expect(ids(reorderAssets(ASSETS, "a", "c"))).toEqual(["b", "c", "a", "d"]);
  });

  it("promotes a dropped item to first, which is what sets the thumbnail", () => {
    expect(ids(reorderAssets(ASSETS, "c", "a"))).toEqual(["c", "a", "b", "d"]);
  });

  it("leaves the list alone for a drop on itself", () => {
    expect(reorderAssets(ASSETS, "b", "b")).toBe(ASSETS);
  });

  it("leaves the list alone when either id is gone", () => {
    // A drop can resolve after the gallery changed underneath it.
    expect(reorderAssets(ASSETS, "zz", "b")).toBe(ASSETS);
    expect(reorderAssets(ASSETS, "b", "zz")).toBe(ASSETS);
  });

  it("does not mutate the input", () => {
    const original = ids(ASSETS);
    reorderAssets(ASSETS, "d", "a");

    expect(ids(ASSETS)).toEqual(original);
  });
});
