// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  describeLegacyMediaFindings,
  findLegacyMediaReferences,
} from "./legacy-media-references";

const ID = "43a43262-4ff6-46ee-a52b-02cdbafbabc6";

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
              image: {
                src: {
                  source: "asset",
                  mediaType: "image",
                  assetId: ID,
                  url: `/assets/${ID}.png`,
                },
                alt: "",
              },
              imageSrc: "https://cdn.example.com/hero.png",
              body: `See /assets/${ID}.png`,
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  it("tolerates documents that are not what it expects", () => {
    expect(findLegacyMediaReferences(null)).toEqual([]);
    expect(findLegacyMediaReferences({ sections: "nope" })).toEqual([]);
  });
});

describe("describeLegacyMediaFindings", () => {
  it("names each place an author has to fix", () => {
    expect(
      describeLegacyMediaFindings([
        {
          label: "/",
          references: [
            {
              sectionId: "starter-hero",
              sectionType: "hero",
              fieldPath: "imageSrc",
            },
          ],
        },
        { label: "/pages/about", references: [] },
      ]),
    ).toBe(
      "An image will not show to visitors, because the field stores a library image as a CMS URL the storefront cannot serve: / › hero › imageSrc.",
    );
  });

  it("says nothing when there is nothing to fix", () => {
    expect(describeLegacyMediaFindings([])).toBeNull();
  });

  it("lists a few and counts the rest", () => {
    const references = Array.from({ length: 7 }, (_, index) => ({
      sectionId: `s${index}`,
      sectionType: "hero",
      fieldPath: "imageSrc",
    }));
    expect(describeLegacyMediaFindings([{ label: "/", references }])).toMatch(
      /^7 images .* and 2 more\.$/,
    );
  });
});
