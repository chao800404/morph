import { describe, expect, it, vi } from "vitest";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import {
  assertSectionHideSupported,
  readSectionHideRefusal,
  sectionHideRefusal,
  sectionsNewlyHidden,
} from "./section-hide-check";

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
      "SECTION_HIDE_UNSUPPORTED:early-computation: Morph cannot hide this section yet: x (src/routes/index.tsx:3)",
    );
    expect(readSectionHideRefusal(`Error: ${error.message}`)).toEqual({
      reason: "early-computation",
      message: "Morph cannot hide this section yet: x (src/routes/index.tsx:3)",
    });
    expect(
      readSectionHideRefusal("SECTION_SOURCE_UNCONFIRMED: nope"),
    ).toBeNull();
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
      /^SECTION_HIDE_UNSUPPORTED:early-computation: .*\(src\/routes\/index\.tsx:6\)$/,
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
      "SECTION_HIDE_UNSUPPORTED:no-call-site",
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
