import { describe, expect, it } from "vitest";
import type { SelectedAsset } from "./asset-tile";
import { moveAsset } from "./reorder-assets";

const asset = (id: string): SelectedAsset => ({
  id,
  name: id,
  url: `/${id}.png`,
});

const ASSETS = ["a", "b", "c", "d"].map(asset);
const ids = (list: SelectedAsset[]) => list.map((item) => item.id);

describe("moveAsset", () => {
  it("moves an item backwards to the dropped position", () => {
    expect(ids(moveAsset(ASSETS, 3, 1))).toEqual(["a", "d", "b", "c"]);
  });

  it("moves an item forwards to the dropped position", () => {
    // Splicing the target in before removing the source lands one slot short
    // when dragging forwards.
    expect(ids(moveAsset(ASSETS, 0, 2))).toEqual(["b", "c", "a", "d"]);
  });

  it("promotes a dropped item to first, which is what sets the thumbnail", () => {
    expect(ids(moveAsset(ASSETS, 2, 0))).toEqual(["c", "a", "b", "d"]);
  });

  it("leaves the list alone when the item did not move", () => {
    expect(moveAsset(ASSETS, 1, 1)).toBe(ASSETS);
  });

  it("leaves the list alone for an index outside the list", () => {
    // A drop can resolve after the gallery changed underneath it.
    expect(moveAsset(ASSETS, -1, 2)).toBe(ASSETS);
    expect(moveAsset(ASSETS, 1, 9)).toBe(ASSETS);
  });

  it("does not mutate the input", () => {
    const original = ids(ASSETS);
    moveAsset(ASSETS, 3, 0);

    expect(ids(ASSETS)).toEqual(original);
  });
});
