// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  findLegacyMediaReferences,
  legacyMediaPlaces,
} from "./legacy-media-references";

const ID = "43a43262-4ff6-46ee-a52b-02cdbafbabc6";
const ASSET_REF = {
  source: "asset",
  mediaType: "image",
  assetId: ID,
  url: `/assets/${ID}.png`,
};

describe("findLegacyMediaReferences", () => {
  it("finds bare library URLs anywhere in section content", () => {
    expect(
      findLegacyMediaReferences({
        sections: [
          {
            id: "starter-hero",
            type: "hero",
            props: { heading: "Hi", imageSrc: `/assets/${ID}.png` },
          },
          {
            id: "showcase",
            type: "category-showcase",
            props: {
              items: [
                { imageSrc: "https://cdn.example.com/a.png" },
                { image: { src: `/assets/${ID}.webp`, alt: "" } },
              ],
            },
          },
        ],
      }),
    ).toEqual([
      { sectionId: "starter-hero", sectionType: "hero", fieldPath: "imageSrc" },
      {
        sectionId: "showcase",
        sectionType: "category-showcase",
        fieldPath: "items.1.image.src",
      },
    ]);
  });

  it("ignores asset references, external images and prose", () => {
    expect(
      findLegacyMediaReferences({
        sections: [
          {
            id: "hero",
            type: "hero",
            props: {
              image: { src: ASSET_REF, alt: "" },
              heroBackground: "https://cdn.example.com/hero.png",
              body: `See /assets/${ID}.png`,
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  it("ignores legacy image keys a grouped image has replaced", () => {
    expect(
      findLegacyMediaReferences({
        sections: [
          {
            id: "starter-hero",
            type: "hero",
            props: {
              image: { src: ASSET_REF, alt: "Ceramics" },
              imageSrc: `/assets/${ID}.png`,
              imageAlt: "Ceramics",
            },
          },
          {
            id: "showcase",
            type: "category-showcase",
            props: {
              items: [
                {
                  image: { src: ASSET_REF, alt: "" },
                  imageSrc: `/assets/${ID}.png`,
                },
                { imageSrc: `/assets/${ID}.png` },
              ],
            },
          },
        ],
      }),
    ).toEqual([
      {
        sectionId: "showcase",
        sectionType: "category-showcase",
        fieldPath: "items.1.imageSrc",
      },
    ]);
  });

  it("tolerates documents that are not what it expects", () => {
    expect(findLegacyMediaReferences(null)).toEqual([]);
    expect(findLegacyMediaReferences({ sections: "nope" })).toEqual([]);
  });
});

describe("legacyMediaPlaces", () => {
  it("names each place as page › section › field", () => {
    expect(
      legacyMediaPlaces([
        {
          label: "Home",
          references: [
            {
              sectionId: "starter-hero",
              sectionType: "hero",
              fieldPath: "imageSrc",
            },
          ],
        },
        {
          label: "/pages/about",
          references: [
            { sectionId: "intro", sectionType: "", fieldPath: "imageSrc" },
          ],
        },
      ]),
    ).toEqual(["Home › hero › imageSrc", "/pages/about › intro › imageSrc"]);
  });
});
