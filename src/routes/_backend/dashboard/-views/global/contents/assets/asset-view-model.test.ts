import { describe, expect, it } from "vitest";
import type { AssetDTO } from "@/lib/asset/dto/asset.dto";
import type { Asset } from "./assets.types";
import {
  toAssetCardAsset,
  toAssetTableItem,
  toPreviewAsset,
  toSelectedAssetFromTable,
} from "./asset-view-model";

const asset: Asset = {
  id: "asset-1",
  name: "hero.png",
  createdAt: "2026-07-26",
  updatedAt: "2026-07-27",
  size: 1024,
  type: "image/png",
  url: "/uploads/hero.png",
  alt: "Hero",
  caption: "Homepage hero",
  tags: ["homepage", "hero"],
  extension: "png",
};

const rapidsaveAsset: AssetDTO = {
  id: "asset-video",
  folderId: null,
  type: "video",
  name: "rapidsave.com_-q5avlkvsgura1",
  originalName: "rapidsave.com_-q5avlkvsgura1.mp4",
  alt: null,
  caption: null,
  tags: [],
  mimeType: "video/mp4",
  size: 5_696_114,
  sizeFormatted: "5.43 MB",
  url: "/assets/asset-video.mp4",
  width: null,
  height: null,
  duration: null,
  thumbnailUrl: null,
  metadata: { version: 1, r2Key: "assets/asset-video.mp4" },
  uploadedBy: "user-1",
  updatedBy: "user-1",
  createdAt: new Date("2026-07-23T00:00:00.000Z"),
  updatedAt: new Date("2026-07-23T00:00:00.000Z"),
};

describe("asset view model", () => {
  it("preserves structured tags between the card and table", () => {
    expect(toAssetTableItem(asset).tags).toEqual(["homepage", "hero"]);
  });

  it("builds one selected-item shape from a table asset", () => {
    const selected = toSelectedAssetFromTable(toAssetTableItem(asset));

    expect(selected).toMatchObject({
      id: "asset-1",
      type: "asset",
      fileType: "image",
      extension: "png",
      tags: ["homepage", "hero"],
    });
  });

  it("uses the original filename instead of a dot in the display name", () => {
    expect(toAssetCardAsset(rapidsaveAsset).extension).toBe("mp4");
    expect(toPreviewAsset(rapidsaveAsset).extension).toBe("mp4");
  });
});
