import { describe, expect, it } from "vitest";
import {
  parseAssetEditSelection,
  serializeAssetEditSelection,
} from "./edit-selection";

const assetId = "11111111-1111-4111-8111-111111111111";
const folderId = "22222222-2222-4222-8222-222222222222";

describe("asset edit selection", () => {
  it("round-trips an ordered mixed selection", () => {
    const selection = [
      { id: assetId, itemType: "asset" as const },
      { id: folderId, itemType: "folder" as const },
    ];

    expect(
      parseAssetEditSelection(serializeAssetEditSelection(selection)),
    ).toEqual(selection);
  });

  it("deduplicates selection entries without changing order", () => {
    const serialized = serializeAssetEditSelection([
      { id: assetId, itemType: "asset" },
      { id: assetId, itemType: "asset" },
      { id: folderId, itemType: "folder" },
    ]);

    expect(parseAssetEditSelection(serialized)).toEqual([
      { id: assetId, itemType: "asset" },
      { id: folderId, itemType: "folder" },
    ]);
  });

  it("uses the route record as a fallback for old single-edit links", () => {
    expect(
      parseAssetEditSelection("not-json", {
        id: folderId,
        itemType: "folder",
      }),
    ).toEqual([{ id: folderId, itemType: "folder" }]);
  });
});
