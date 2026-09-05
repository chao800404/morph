import { describe, expect, it } from "vitest";
import {
  normalizeThemeMediaValue,
  resolveThemeMediaInSlotValues,
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
