import { describe, expect, it } from "vitest";
import {
  normalizeThemeMediaValue,
  normalizeThemeImageValue,
  resolveThemeMediaInSlotValues,
  withThemeImageSource,
} from "./theme-media";

describe("Theme media values", () => {
  it("promotes a legacy URL to an external media value", () => {
    expect(normalizeThemeMediaValue("/hero.webp", "image")).toEqual({
      source: "external",
      mediaType: "image",
      url: "/hero.webp",
    });
  });

  it("resolves Asset references and repeated-row media to delivery URLs", () => {
    expect(
      resolveThemeMediaInSlotValues({
        hero: {
          source: "asset",
          mediaType: "image",
          assetId: "asset-1",
          url: "/cdn/hero.webp",
        },
        slides: [
          {
            video: {
              source: "external",
              mediaType: "video",
              url: "https://cdn.example.com/intro.mp4",
            },
          },
        ],
      }),
    ).toEqual({
      hero: "/cdn/hero.webp",
      slides: [{ video: "https://cdn.example.com/intro.mp4" }],
    });
  });

  it("resolves a grouped image source without separating its alt text", () => {
    expect(
      resolveThemeMediaInSlotValues({
        image: {
          src: {
            source: "asset",
            mediaType: "image",
            assetId: "asset-1",
            url: "/cdn/hero.webp",
          },
          alt: "A hero image",
        },
      }),
    ).toEqual({
      image: { src: "/cdn/hero.webp", alt: "A hero image" },
    });
  });

  it("keeps the grouped image shape when a picker replaces its source", () => {
    const value = withThemeImageSource(
      { src: "/old.webp", alt: "Existing description" },
      {
        source: "asset",
        mediaType: "image",
        assetId: "asset-2",
        url: "/cdn/new.webp",
      },
    );

    expect(value).toEqual({
      src: {
        source: "asset",
        mediaType: "image",
        assetId: "asset-2",
        url: "/cdn/new.webp",
      },
      alt: "Existing description",
    });
    expect(normalizeThemeImageValue(value).alt).toBe("Existing description");
  });

  it("fails closed when a stored media URL is unsafe", () => {
    expect(
      resolveThemeMediaInSlotValues({
        image: {
          source: "external",
          mediaType: "image",
          url: "javascript:alert(1)",
        },
      }),
    ).toEqual({ image: "" });
  });
});
