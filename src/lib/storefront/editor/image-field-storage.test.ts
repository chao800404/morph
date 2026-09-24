// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  canStoreLibraryAsset,
  imageFieldStorage,
  imageFieldValue,
} from "./image-field-storage";

const ASSET = {
  source: "asset" as const,
  mediaType: "image" as const,
  assetId: "43a43262-4ff6-46ee-a52b-02cdbafbabc6",
  url: "/assets/43a43262-4ff6-46ee-a52b-02cdbafbabc6.png",
};
const EXTERNAL = {
  source: "external" as const,
  mediaType: "image" as const,
  url: "https://cdn.example.com/hero.png",
};

describe("imageFieldStorage", () => {
  it("follows the shape the value is saved in", () => {
    expect(
      imageFieldStorage({ usesGroupedImage: true, definitionType: "text" }),
    ).toBe("grouped");
    expect(
      imageFieldStorage({ usesGroupedImage: false, definitionType: "image" }),
    ).toBe("media");
    for (const definitionType of ["text", "url", undefined]) {
      expect(
        imageFieldStorage({ usesGroupedImage: false, definitionType }),
      ).toBe("url");
    }
  });

  it("offers the Asset library only where the asset survives saving", () => {
    expect(canStoreLibraryAsset("grouped")).toBe(true);
    expect(canStoreLibraryAsset("media")).toBe(true);
    expect(canStoreLibraryAsset("url")).toBe(false);
  });
});

describe("imageFieldValue", () => {
  it("keeps the asset reference where the field can hold one", () => {
    expect(
      imageFieldValue("grouped", { src: "/old.png", alt: "Old" }, ASSET),
    ).toEqual({ src: ASSET, alt: "Old" });
    expect(imageFieldValue("media", "/old.png", ASSET)).toBe(ASSET);
  });

  it("stores an external URL in a string field", () => {
    expect(imageFieldValue("url", "/old.png", EXTERNAL)).toBe(EXTERNAL.url);
  });

  it("refuses to reduce a library asset to its URL", () => {
    expect(imageFieldValue("url", "/old.png", ASSET)).toBeUndefined();
  });
});
