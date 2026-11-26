import { describe, expect, it, vi } from "vitest";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import {
  assertPublishHiddenSections,
  assertSectionHideSupported,
  partitionPublishHiddenItems,
  PublishHiddenSectionsError,
  type PublishHiddenSectionProblem,
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
      version: 1,
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
      expectedDraftVersion: 1,
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
    contentId: `${itemType}:${label}`,
    templateType: itemType === "page" ? "page" : "index",
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
      `PUBLISH_HIDDEN_SECTION_UNSUPPORTED: Morph cannot hide a section of a Page yet, so it cannot confirm these hidden sections would be left out of the live site and will not publish them: "promo" on the Page "About" (/pages/about) (no-call-site). The Page editor cannot show a hidden section: if an earlier version of the Page shows it, restore that version as a draft from the Page's revisions, save the Page with Publish page on, then publish the Theme again; otherwise contact support. The live site is unchanged.`,
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
      `PUBLISH_HIDDEN_SECTION_UNSUPPORTED: Morph cannot hide sections on Astro Themes yet, so it cannot confirm these hidden sections would be left out of the live site and will not publish them: "hero" on the index page (framework-not-supported); "promo" on the Page "About" (/pages/about) (framework-not-supported). They cannot be shown again from the editor yet; contact support to show them again. The live site is unchanged.`,
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
            itemType: "template",
            contentId: "template-index",
            templateType: "index",
            label: "the index page",
            sectionId: "early",
            reason: "early-computation",
            message: "m",
          },
        ],
        rebuild: [],
      }),
    ).toThrow(
      `PUBLISH_HIDDEN_SECTION_UNSUPPORTED: Morph cannot hide a section of a Page yet, so it cannot confirm these hidden sections would be left out of the live site and will not publish them: "hero" on the Page "About" (/pages/about) (no-call-site). The Page editor cannot show a hidden section: if an earlier version of the Page shows it, restore that version as a draft from the Page's revisions, save the Page with Publish page on, then publish the Theme again; otherwise contact support. Morph cannot confirm that this Theme's code leaves these hidden sections out of the live site, so it will not publish them: "early" on the index page (early-computation). Show them again in Design, or change the code so Morph can hide them, then publish. The live site is unchanged.`,
    );
  });
});

describe("the publish refusal carries its problems as data (M3 stage 1)", () => {
  const problem = (
    overrides: Partial<PublishHiddenSectionProblem> = {},
  ): PublishHiddenSectionProblem => ({
    itemType: "template",
    contentId: "template-index",
    templateType: "index",
    label: "the index page",
    sectionId: "early",
    reason: "early-computation",
    message: "m",
    ...overrides,
  });
  const thrown = (unsupported: PublishHiddenSectionProblem[]) => {
    try {
      assertPublishHiddenSections({ unsupported, rebuild: [] });
    } catch (error) {
      return error;
    }
    throw new Error("expected a refusal");
  };

  it("names the Page, the template and the layout with what each must publish", () => {
    const { refused } = partitionPublishHiddenItems({
      framework: null,
      items: [
        {
          itemType: "page",
          contentId: "page-about",
          templateType: "page",
          label: 'the Page "About" (/pages/about)',
          document: { sections: [{ id: "newsletter", enabled: false }] },
        },
      ],
    });
    const error = thrown([
      ...refused,
      problem(),
      problem({
        contentId: "template-layout",
        templateType: "layout",
        label: "the layout",
        sectionId: "promo",
        reason: "no-call-site",
        refusedAs: "unlisted",
      }),
    ]);
    expect(error).toBeInstanceOf(PublishHiddenSectionsError);
    expect((error as PublishHiddenSectionsError).details).toEqual({
      kind: "publish-hidden-sections",
      truncated: false,
      problems: [
        {
          itemType: "page",
          contentId: "page-about",
          templateType: "page",
          sectionId: "newsletter",
          reason: "no-call-site",
          refusedAs: "page",
          mustPublish: "page",
          label: 'the Page "About" (/pages/about)',
        },
        {
          itemType: "template",
          contentId: "template-index",
          templateType: "index",
          sectionId: "early",
          reason: "early-computation",
          refusedAs: "source",
          mustPublish: "theme",
          label: "the index page",
        },
        {
          itemType: "template",
          contentId: "template-layout",
          templateType: "layout",
          sectionId: "promo",
          reason: "no-call-site",
          refusedAs: "unlisted",
          mustPublish: "theme",
          label: "the layout",
        },
      ],
    });
  });

  it("keeps the message exactly as the text-only refusal said it", () => {
    const error = thrown([problem()]) as Error;
    expect(error.message).toBe(
      `PUBLISH_HIDDEN_SECTION_UNSUPPORTED: Morph cannot confirm that this Theme's code leaves these hidden sections out of the live site, so it will not publish them: "early" on the index page (early-computation). Show them again in Design, or change the code so Morph can hide them, then publish. The live site is unchanged.`,
    );
  });

  it("carries at most 50 problems and says when there were more", () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        problem({ sectionId: `s${index}` }),
      );
    const at50 = thrown(many(50)) as PublishHiddenSectionsError;
    expect(at50.details.problems).toHaveLength(50);
    expect(at50.details.truncated).toBe(false);
    const at51 = thrown(many(51)) as PublishHiddenSectionsError;
    expect(at51.details.problems).toHaveLength(50);
    expect(at51.details.problems.at(-1)?.sectionId).toBe("s49");
    expect(at51.details.truncated).toBe(true);
  });

  it("never carries section content: the message of a problem is left out", () => {
    const error = thrown([
      problem({ message: "SECRET-CONTENT" }),
    ]) as PublishHiddenSectionsError;
    expect(JSON.stringify(error.details)).not.toContain("SECRET-CONTENT");
  });

  it("leaves the rebuild refusal as it was, with no details", () => {
    let caught: unknown;
    try {
      assertPublishHiddenSections({
        unsupported: [],
        rebuild: [problem({ reason: "rebuild-required" })],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(PublishHiddenSectionsError);
    expect((caught as Error).message).toMatch(/^PUBLISH_HIDE_REBUILD_REQUIRED: /);
  });
});
