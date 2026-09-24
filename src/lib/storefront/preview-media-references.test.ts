// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  applyPreviewMediaUrls,
  collectPreviewMediaAssetIds,
} from "./preview-media-references";

const A = "43a43262-4ff6-46ee-a52b-02cdbafbabc6";
const B = "14e384d3-67ea-47e9-891c-23882d59554d";
const SIGNED_A = `https://morph.example/_morph/preview-media/${A}?sig=a`;
const SIGNED_B = `https://morph.example/_morph/preview-media/${B}?sig=b`;
const URLS = new Map([
  [A, SIGNED_A],
  [B, SIGNED_B],
]);

describe("preview media references", () => {
  it("finds library media in a resolved snapshot", () => {
    const snapshot = {
      templates: {
        index: {
          slots: {
            hero: {
              imageSrc: `/assets/${A}.png`,
              image: {
                src: `/_storefront-media/${B}?version=assets%2F${B}.png`,
                alt: "",
              },
              heading: "Hello",
            },
          },
        },
      },
    };
    expect(collectPreviewMediaAssetIds(snapshot)).toEqual(new Set([A, B]));
    expect(applyPreviewMediaUrls(snapshot, URLS)).toEqual({
      templates: {
        index: {
          slots: {
            hero: {
              imageSrc: SIGNED_A,
              image: { src: SIGNED_B, alt: "" },
              heading: "Hello",
            },
          },
        },
      },
    });
  });

  it("turns asset references in a live edit into addresses", () => {
    const props = {
      image: {
        src: {
          source: "asset",
          mediaType: "image",
          assetId: B,
          url: `/assets/${B}.png`,
        },
        alt: "Sensor",
      },
      gallery: [`/assets/${A}.png`],
    };
    expect(collectPreviewMediaAssetIds(props)).toEqual(new Set([B, A]));
    expect(applyPreviewMediaUrls(props, URLS)).toEqual({
      image: { src: SIGNED_B, alt: "Sensor" },
      gallery: [SIGNED_A],
    });
  });

  it("leaves external media and unsigned assets as they were", () => {
    const props = {
      external: "https://cdn.example.com/hero.png",
      unsigned: {
        source: "asset",
        mediaType: "image",
        assetId: "00000000-0000-4000-8000-000000000000",
        url: "/assets/00000000-0000-4000-8000-000000000000.png",
      },
      text: `See /assets/${A}.png for details`,
    };
    expect(applyPreviewMediaUrls(props, URLS)).toEqual({
      external: "https://cdn.example.com/hero.png",
      unsigned: "/assets/00000000-0000-4000-8000-000000000000.png",
      text: `See /assets/${A}.png for details`,
    });
  });
});
