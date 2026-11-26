import { describe, expect, it, vi } from "vitest";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import {
  assertPublishHiddenSections,
  assertSectionHideSupported,
  partitionPublishHiddenItems,
  sectionHideRefusal,
  sectionsNewlyHidden,
} from "./section-hide-check";
import { parseSectionSourceRefusal } from "../theme-write-errors";

const getDb = vi.hoisted(() => vi.fn());
vi.mock("@/db", () => ({ getDb }));

describe("sectionsNewlyHidden", () => {
  const doc = (...sections: Array<[string, boolean | undefined]>) => ({
    sections: sections.map(([id, enabled]) => ({
      id,
      ...(enabled === undefined ? {} : { enabled }),
    })),
  });

  it("names only sections that go from shown (or absent) to hidden", () => {
    expect(
      sectionsNewlyHidden(
        doc(["a", true], ["b", false], ["c", undefined]),
        doc(
          ["a", false],
          ["b", false],
          ["c", false],
          ["d", false],
          ["e", true],
        ),
      ),
    ).toEqual(["a", "c", "d"]);
  });

  it("never names a section being shown, or one that stays hidden", () => {
    expect(
      sectionsNewlyHidden(
        doc(["a", false], ["b", false]),
        doc(["a", true], ["b", false]),
      ),
    ).toEqual([]);
    expect(sectionsNewlyHidden(null, doc(["a", true]))).toEqual([]);
  });
});

describe("the refusal's wire form", () => {
  it("round-trips the reason and the message", () => {
    const error = sectionHideRefusal(
      "early-computation",
      "Morph cannot hide this section yet: x (src/routes/index.tsx:3)",
    );
    expect(error.message).toBe(
      "SECTION_HIDE_UNSUPPORTED: early-computation: Morph cannot hide this section yet: x (src/routes/index.tsx:3)",
    );
    // Read back as the other section-source refusals are (M2 C7's form).
    expect(parseSectionSourceRefusal(`Error: ${error.message}`)).toEqual({
      code: "SECTION_HIDE_UNSUPPORTED",
      reason: "early-computation",
      text: "Morph cannot hide this section yet: x (src/routes/index.tsx:3)",
    });
    expect(parseSectionSourceRefusal("SECTION_SOURCE_UNCONFIRMED: nope")).toEqual(
      { code: "SECTION_SOURCE_UNCONFIRMED", reason: null, text: "nope" },
    );
  });
});

describe("assertSectionHideSupported", () => {
  const route = (
    body: string,
  ) => `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
${body}
}
`;
  const files = (body: string) => [
    ...livePreviewPlatformFiles(),
    {
      path: "src/components/Hero.tsx",
      content: `export const contentFields = { title: { type: "text", label: "Title" } } as const;
export default function Hero({ title = "DEFAULT" }) { return <h1>{title}</h1>; }`,
    },
    { path: "src/routes/index.tsx", content: route(body) },
  ];

  it("passes a supported hide and throws the refusal, with its place, for an unsupported one", () => {
    expect(() =>
      assertSectionHideSupported({
        files: files(`  return <main><Hero {...content("hero")} /></main>;`),
        callSitePath: "src/routes/index.tsx",
        slot: "hero",
        scope: "route",
      }),
    ).not.toThrow();
    expect(() =>
      assertSectionHideSupported({
        files: files(`  const t = String(content("hero").title).toUpperCase();
  return <main><Hero {...content("hero")} title={t} /></main>;`),
        callSitePath: "src/routes/index.tsx",
        slot: "hero",
        scope: "route",
      }),
    ).toThrow(
      /^SECTION_HIDE_UNSUPPORTED: early-computation: .*\(src\/routes\/index\.tsx:6\)$/,
    );
  });

  it("ignores files without text content (binary files) rather than failing", () => {
    expect(() =>
      assertSectionHideSupported({
        files: [
          ...files(`  return <main><Hero {...content("hero")} /></main>;`),
          { path: "public/logo.png", content: null },
        ],
        callSitePath: "src/routes/index.tsx",
        slot: "hero",
        scope: "route",
      }),
    ).not.toThrow();
  });
});

describe("a CMS Page write (storefrontPageDal.update)", () => {
  const page = (enabled: boolean) => ({
    version: 1 as const,
    handle: "about",
    sections: [
      { id: "intro", type: "rich-text", enabled, props: { body: "Hi" } },
    ],
  });
  const update = async (stored: boolean, next: boolean) => {
    const { storefrontPageDal } = await import("../dal/storefront-page.dal");
    vi.spyOn(storefrontPageDal, "findDetail").mockResolvedValue({
      document: page(stored),
    } as never);
    return storefrontPageDal.update({
      id: "page-1",
      title: "About",
      handle: "about",
      document: page(next) as never,
      publish: false,
      hasPublishedVersion: false,
      createdBy: "user-1",
      storefrontId: "storefront-1",
    });
  };

  it("refuses a section going hidden before anything is written", async () => {
    getDb.mockReset();
    await expect(update(true, false)).rejects.toThrow(
      "SECTION_HIDE_UNSUPPORTED: no-call-site",
    );
    expect(getDb).not.toHaveBeenCalled();
  });

  it("lets Show through to the write", async () => {
    getDb.mockReset();
    getDb.mockRejectedValue(new Error("reached the write"));
    await expect(update(false, true)).rejects.toThrow("reached the write");
    expect(getDb).toHaveBeenCalled();
  });
});

describe("partitionPublishHiddenItems and the publish refusal (M3 Hide step 1)", () => {
  const item = (
    itemType: "template" | "page",
    label: string,
    hidden: readonly string[],
  ) => ({
    itemType,
    label,
    document: {
      sections: ["hero", "promo"].map((id) => ({
        id,
        enabled: !hidden.includes(id),
      })),
    },
  });
  const refusal = (problems: ReturnType<typeof partitionPublishHiddenItems>) => {
    try {
      assertPublishHiddenSections({
        unsupported: problems.refused,
        rebuild: [],
      });
    } catch (error) {
      return (error as Error).message;
    }
    return null;
  };

  it("sends a Start template to the source check and refuses a Page's hidden section", () => {
    const template = item("template", "the index page", ["hero"]);
    const result = partitionPublishHiddenItems({
      framework: null,
      items: [
        template,
        item("page", 'the Page "About" (/pages/about)', ["promo"]),
        item("page", 'the Page "FAQ" (/pages/faq)', []),
      ],
    });
    expect(result.sourceChecked).toEqual([template]);
    expect(refusal(result)).toBe(
      'PUBLISH_HIDDEN_SECTION_UNSUPPORTED: Morph cannot hide a section of a Page yet, so the live site would still show these hidden sections with their default content: "promo" on the Page "About" (/pages/about) (no-call-site). Show them again on the Page, publish the Page, then publish the Theme again. The live site is unchanged.',
    );
  });

  it("refuses every hidden section of a Theme that is not Start, Pages included", () => {
    const result = partitionPublishHiddenItems({
      framework: "astro",
      items: [
        item("template", "the index page", ["hero"]),
        item("page", 'the Page "About" (/pages/about)', ["promo"]),
      ],
    });
    expect(result.sourceChecked).toEqual([]);
    expect(refusal(result)).toBe(
      'PUBLISH_HIDDEN_SECTION_UNSUPPORTED: Morph cannot hide sections on Astro Themes yet, so the live site would still show these hidden sections with their default content: "hero" on the index page (framework-not-supported); "promo" on the Page "About" (/pages/about) (framework-not-supported). Clear their hidden flag so they are shown again, then publish. The live site is unchanged.',
    );
  });

  it("refuses nothing and checks nothing when nothing is hidden, on any framework", () => {
    for (const framework of [null, "tanstack-start", "astro", "other"]) {
      expect(
        partitionPublishHiddenItems({
          framework,
          items: [
            item("template", "the index page", []),
            item("page", 'the Page "About" (/pages/about)', []),
          ],
        }),
      ).toEqual({ refused: [], sourceChecked: [] });
    }
  });

  it("says each kind of refusal with its own way out, source refusals as before", () => {
    const { refused } = partitionPublishHiddenItems({
      framework: "tanstack-start",
      items: [item("page", 'the Page "About" (/pages/about)', ["hero"])],
    });
    expect(() =>
      assertPublishHiddenSections({
        unsupported: [
          ...refused,
          {
            label: "the index page",
            sectionId: "early",
            reason: "early-computation",
            message: "m",
          },
        ],
        rebuild: [],
      }),
    ).toThrow(
      'PUBLISH_HIDDEN_SECTION_UNSUPPORTED: Morph cannot hide a section of a Page yet, so the live site would still show these hidden sections with their default content: "hero" on the Page "About" (/pages/about) (no-call-site). Show them again on the Page, publish the Page, then publish the Theme again. These hidden sections cannot be hidden by this Theme\'s code yet, so the live site would still show them or break: "early" on the index page (early-computation). Show them again in Design, or change the code so Morph can hide them, then publish. The live site is unchanged.',
    );
  });
});
