// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  assetIdFromDeliveryUrl,
  describeMediaAsset,
  folderPathSegments,
  mediaAssetDetails,
  mediaAssetLocation,
} from "./media-asset-identity";

const ASSET = {
  id: "43a43262-4ff6-46ee-a52b-02cdbafbabc6",
  type: "image" as const,
  name: "hero.png",
  folderId: "folder-1",
  mimeType: "image/png",
  size: 430_080,
  sizeFormatted: "420 KB",
  width: 1920,
  height: 1080,
};

describe("describeMediaAsset", () => {
  it("names the asset by where the library keeps it now", () => {
    const lookup = describeMediaAsset(ASSET, "/Marketing/Home");
    expect(lookup.status).toBe("found");
    if (lookup.status !== "found") return;
    expect(mediaAssetLocation(lookup.asset)).toBe(
      "Marketing / Home / hero.png",
    );
    expect(mediaAssetDetails(lookup.asset)).toBe("1920×1080 · 420 KB · PNG");
  });

  it("shows only the name for an asset at the library root", () => {
    const lookup = describeMediaAsset({ ...ASSET, folderId: null }, null);
    expect(lookup.status === "found" && mediaAssetLocation(lookup.asset)).toBe(
      "hero.png",
    );
  });

  it("reports an asset the library no longer has", () => {
    expect(describeMediaAsset(null, null)).toEqual({ status: "missing" });
  });

  it("leaves out details the library does not know", () => {
    const lookup = describeMediaAsset(
      {
        ...ASSET,
        width: null,
        height: null,
        mimeType: "image/svg+xml",
      },
      null,
    );
    expect(lookup.status === "found" && mediaAssetDetails(lookup.asset)).toBe(
      "420 KB · SVG",
    );
  });
});

describe("assetIdFromDeliveryUrl", () => {
  it("reads the asset id out of a CMS delivery URL", () => {
    expect(
      assetIdFromDeliveryUrl(
        "/assets/43A43262-4ff6-46ee-a52b-02cdbafbabc6.png",
      ),
    ).toBe("43a43262-4ff6-46ee-a52b-02cdbafbabc6");
  });

  it("ignores anything that is not one", () => {
    for (const url of [
      "https://cdn.example.com/assets/43a43262-4ff6-46ee-a52b-02cdbafbabc6.png",
      "/assets/hero.png",
      "/assets/43a43262-4ff6-46ee-a52b-02cdbafbabc6.png/x",
      "",
    ]) {
      expect(assetIdFromDeliveryUrl(url)).toBeNull();
    }
  });
});

describe("folderPathSegments", () => {
  it("drops the leading slash and empty segments", () => {
    expect(folderPathSegments("/Marketing//Home/")).toEqual([
      "Marketing",
      "Home",
    ]);
    expect(folderPathSegments(null)).toEqual([]);
  });
});
