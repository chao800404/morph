import { describe, expect, it } from "vitest";
import {
  findSourceLocation,
  parseComponentSource,
  patchComponentDefaultProp,
  patchElementClassName,
  patchElementClassNameResult,
  swapSiblingMorphNodes,
  updateTailwindClass,
} from "./theme-ast-transformer";

const SAMPLE_HERO_CODE = `export type HeroProps = {
  eyebrow?: string;
  heading?: string;
};

export default function Hero({
  eyebrow = "New collection",
  heading = "Objects for everyday rituals.",
}: HeroProps) {
  return (
    <section data-morph-section="hero" className="grid min-h-[42rem] bg-stone-100">
      <p
        data-morph-element="eyebrow"
        className="text-xs font-medium uppercase text-stone-500"
      >
        {eyebrow}
      </p>
      <h1
        data-morph-element="heading"
        className="mt-6 font-serif text-6xl text-stone-950"
      >
        {heading}
      </h1>
    </section>
  );
}
`;

describe("theme-ast-transformer (TSX AST)", () => {
  it("parses default props from component source code", () => {
    const meta = parseComponentSource(SAMPLE_HERO_CODE);
    expect(meta.defaultProps.eyebrow).toBe("New collection");
    expect(meta.defaultProps.heading).toBe("Objects for everyday rituals.");
  });

  it("reuses parsed metadata per source identity and invalidates changed content", () => {
    const first = parseComponentSource(SAMPLE_HERO_CODE, "components/Hero.tsx");
    const sameSource = parseComponentSource(
      SAMPLE_HERO_CODE,
      "components/Hero.tsx",
    );
    const changedSource = parseComponentSource(
      SAMPLE_HERO_CODE.replace("text-6xl", "text-7xl"),
      "components/Hero.tsx",
    );
    const differentFile = parseComponentSource(
      SAMPLE_HERO_CODE,
      "components/Other.tsx",
    );

    expect(sameSource).toBe(first);
    expect(changedSource).not.toBe(first);
    expect(differentFile).not.toBe(first);
    expect(changedSource.elements.heading.className).toContain("text-7xl");
  });

  it("extracts exact tag name, className, and location across multi-line JSX", () => {
    const meta = parseComponentSource(SAMPLE_HERO_CODE);
    expect(meta.elements.heading).toBeDefined();
    expect(meta.elements.heading.elementName).toBe("heading");
    expect(meta.elements.heading.tag).toBe("h1");
    expect(meta.elements.heading.className).toBe(
      "mt-6 font-serif text-6xl text-stone-950",
    );
    expect(meta.elements.heading.location.line).toBe(18);
    expect(meta.elements.heading.startOffset).toBeLessThan(
      meta.elements.heading.endOffset,
    );
    expect(meta.elements.heading.openingStartOffset).toBeLessThan(
      meta.elements.heading.openingEndOffset,
    );
    expect(meta.elements.heading.openingEndOffset).toBeLessThan(
      meta.elements.heading.endOffset,
    );
  });

  it("patches default prop values using AST offsets without breaking quotes", () => {
    const updated = patchComponentDefaultProp(
      SAMPLE_HERO_CODE,
      "heading",
      'Special "Summer" Collection',
    );
    expect(updated).toContain('heading = "Special \\"Summer\\" Collection"');
    expect(updated).not.toContain('heading = "Objects for everyday rituals."');
  });

  it("patches element className using AST offsets cleanly", () => {
    const updated = patchElementClassName(SAMPLE_HERO_CODE, "heading", (prev) =>
      prev.replace("text-6xl", "text-8xl"),
    );
    expect(updated).toContain(
      'className="mt-6 font-serif text-8xl text-stone-950"',
    );
  });

  it("swaps two unique direct Morph JSX siblings without reformatting their content", () => {
    const source = `export default function Example() {
  return (
    <div>
      <h2 data-morph-node="title">Title</h2>
      <p data-morph-node="body">Body</p>
    </div>
  );
}`;
    const result = swapSiblingMorphNodes(source, "title", "body");

    expect(result.editable).toBe(true);
    expect(result.code.indexOf('data-morph-node="body"')).toBeLessThan(
      result.code.indexOf('data-morph-node="title"'),
    );
    expect(result.code).toContain('<h2 data-morph-node="title">Title</h2>');
  });

  it("rejects Morph nodes that are not direct siblings", () => {
    const source = `export default function Example() {
  return <div><div><span data-morph-node="nested" /></div><p data-morph-node="peer" /></div>;
}`;
    const result = swapSiblingMorphNodes(source, "nested", "peer");

    expect(result).toMatchObject({ editable: false, reason: "not-siblings" });
    expect(result.code).toBe(source);
  });

  it("rejects duplicate Morph node identities", () => {
    const source = `export default function Example() {
  return <div><span data-morph-node="item" /><span data-morph-node="item" /><p data-morph-node="peer" /></div>;
}`;
    const result = swapSiblingMorphNodes(source, "item", "peer");

    expect(result).toMatchObject({ editable: false, reason: "not-found" });
    expect(result.code).toBe(source);
  });

  it("replaces Tailwind utility classes accurately", () => {
    const updated = updateTailwindClass(
      "mt-6 font-serif text-6xl text-stone-950",
      /text-\[.*\]|text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)/,
      "text-[64px]",
    );
    expect(updated).toContain("text-[64px]");
    expect(updated).not.toContain("text-6xl");
    expect(updated).toContain("font-serif");
  });

  it("finds source location dynamically for Monaco jump", () => {
    const loc = findSourceLocation(SAMPLE_HERO_CODE, "heading");
    expect(loc).not.toBeNull();
    expect(loc?.line).toBe(18);
  });

  it("handles syntax errors gracefully with parseOk=false and diagnostics", () => {
    const brokenCode = `export default function Broken() { return <div className={; }`;
    const parsed = parseComponentSource(brokenCode);
    expect(parsed.parseOk).toBe(false);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
  });

  it("detects dynamic className expressions and returns editable=false", () => {
    const dynamicCode = `
      export default function DynamicHero() {
        return (
          <h1
            data-morph-element="heading"
            className={cn("text-6xl", isBig && "text-8xl")}
          >
            Hello
          </h1>
        );
      }
    `;
    const res = patchElementClassNameResult(dynamicCode, "heading", (prev) =>
      prev.replace("text-6xl", "text-9xl"),
    );
    expect(res.editable).toBe(false);
    expect(res.reason).toBe("dynamic-classname");
  });

  it("resolves component-local instance class maps for preview rendering", () => {
    const source = `
      const morphInstanceClasses: Record<string, string> = {
        "card-2:title": "text-[54px] text-red-500",
      };
      export default function Cards({ items = [] }) {
        return items.map((item) => (
          <h3
            data-morph-node="title"
            className={cn("text-3xl", morphInstanceClasses[\`\${item.id}:title\`])}
          >{item.title}</h3>
        ));
      }
    `;
    const parsed = parseComponentSource(source);

    expect(parsed.elements.title?.className).toBe("text-3xl");
    expect(parsed.instanceClasses["card-2:title"]).toBe(
      "text-[54px] text-red-500",
    );
    expect(parsed.elements.title?.classNameOffsets?.isExpression).toBe(true);
  });

  it("patches self-closing JSX elements without existing className without breaking syntax", () => {
    const selfClosingCode = `
      export default function ImageHero() {
        return (
          <div>
            <img
              data-morph-element="image"
            />
          </div>
        );
      }
    `;
    const res = patchElementClassNameResult(
      selfClosingCode,
      "image",
      () => "size-full object-cover",
    );
    expect(res.editable).toBe(true);
    expect(res.code).toContain('className="size-full object-cover"');
    // Ensure it didn't inject inside the closing `/>` as `/<className>`
    expect(res.code).toMatch(
      /<img[\s\S]*className="size-full object-cover"[\s\S]*\/>/,
    );
    const reParsed = parseComponentSource(res.code);
    expect(reParsed.parseOk).toBe(true);
    expect(reParsed.elements.image.className).toBe("size-full object-cover");
    expect(reParsed.elements.image.isSelfClosing).toBe(true);
  });

  it("resolves component path from structured manifest sections and returns null for unmapped CMS-only sections", async () => {
    const { getComponentFilePath } = await import("./theme-ast-transformer");
    const files = [
      {
        path: "morph.theme.json",
        content: JSON.stringify({
          sections: {
            hero: { component: "Hero", source: "src/components/Hero.tsx" },
            "custom-banner": { source: "src/components/CustomBanner.tsx" },
          },
        }),
      },
      {
        path: "src/components/Hero.tsx",
        content: "export default () => null;",
      },
      {
        path: "src/components/CustomBanner.tsx",
        content: "export default () => null;",
      },
      { path: "src/pages/index.tsx", content: "export default () => null;" },
    ];

    expect(getComponentFilePath("hero", files)).toBe("src/components/Hero.tsx");
    expect(getComponentFilePath("custom-banner", files)).toBe(
      "src/components/CustomBanner.tsx",
    );
    // Should return null (CMS-only) rather than falling back to index.tsx!
    expect(getComponentFilePath("editorial-intro", files)).toBeNull();
  });

  it("correctly reverse-parses Tailwind classes into presentation style values", async () => {
    const {
      parseTailwindFontSize,
      parseTailwindFontFamily,
      parseTailwindFontWeight,
      parseTailwindTextAlign,
    } = await import("./theme-ast-transformer");

    // Arbitrary & standard font sizes
    expect(parseTailwindFontSize("mt-6 text-[100px] font-sans")).toBe(100);
    expect(parseTailwindFontSize("mt-6 text-[64px] font-serif")).toBe(64);
    expect(parseTailwindFontSize("text-6xl font-bold")).toBe(60);
    expect(parseTailwindFontSize("text-4xl text-center")).toBe(36);
    expect(parseTailwindFontSize("no-size-here")).toBeNull();

    // Font families
    expect(parseTailwindFontFamily("text-xl font-serif text-white")).toBe(
      "serif",
    );
    expect(parseTailwindFontFamily("text-xl font-sans tracking-tight")).toBe(
      "sans",
    );
    expect(parseTailwindFontFamily("font-mono text-sm")).toBe("mono");

    // Font weights
    expect(parseTailwindFontWeight("font-light text-base")).toBe("300");
    expect(parseTailwindFontWeight("font-normal text-base")).toBe("normal");
    expect(parseTailwindFontWeight("font-medium text-base")).toBe("medium");
    expect(parseTailwindFontWeight("font-bold text-base")).toBe("bold");
    expect(parseTailwindFontWeight("font-semibold text-base")).toBe("bold");

    // Text alignment
    expect(parseTailwindTextAlign("mt-4 text-center font-bold")).toBe("center");
    expect(parseTailwindTextAlign("text-right text-stone-600")).toBe("right");
    expect(parseTailwindTextAlign("text-left")).toBe("left");
  });

  it("handles complex clamp/calc font size, line height, padding, background, and radius correctly", async () => {
    const {
      parseTailwindFontSizeDetailed,
      parseTailwindLineHeight,
      parseTailwindPadding,
      parseTailwindBackgroundColor,
      parseTailwindBorderColor,
      parseTailwindBorderRadii,
      parseTailwindBorderRadius,
      parseTailwindBorderStyle,
      parseTailwindBorderWidth,
    } = await import("./theme-ast-transformer");

    // Complex clamp font size
    const complexRes = parseTailwindFontSizeDetailed(
      "mt-6 text-[clamp(3.25rem,7vw,7rem)] font-serif",
    );
    expect(complexRes.type).toBe("complex");
    if (complexRes.type === "complex") {
      expect(complexRes.raw).toBe("clamp(3.25rem,7vw,7rem)");
    }

    const exactRes = parseTailwindFontSizeDetailed("text-[100px] font-sans");
    expect(exactRes.type).toBe("exact");
    if (exactRes.type === "exact") {
      expect(exactRes.value).toBe(100);
    }

    // Line height
    expect(parseTailwindLineHeight("leading-[0.88] text-6xl")).toBe(0.88);
    expect(parseTailwindLineHeight("leading-[1.2] font-sans")).toBe(1.2);
    expect(parseTailwindLineHeight("leading-tight")).toBe(1.25);
    expect(parseTailwindLineHeight("no-leading")).toBeNull();

    // Padding
    expect(parseTailwindPadding("p-[80px] bg-black")).toEqual({ all: 80 });
    expect(parseTailwindPadding("py-20 px-6")).toEqual({ y: 80, x: 24 });
    expect(
      parseTailwindPadding("pt-[40px] pb-[60px] pl-[20px] pr-[30px]"),
    ).toEqual({
      top: 40,
      bottom: 60,
      left: 20,
      right: 30,
    });

    // Background
    expect(parseTailwindBackgroundColor("bg-[#123456] text-white")).toBe(
      "#123456",
    );
    expect(parseTailwindBackgroundColor("bg-stone-100 text-stone-900")).toBe(
      "#f5f5f4",
    );

    // Border radius
    expect(parseTailwindBorderRadius("rounded-[16px] overflow-hidden")).toBe(
      16,
    );
    expect(parseTailwindBorderRadius("rounded-2xl shadow-lg")).toBe(16);
    expect(parseTailwindBorderRadius("rounded-full")).toBe(9999);
    expect(
      parseTailwindBorderRadii("rounded-[8px] rounded-tl-[4px] rounded-br-xl"),
    ).toEqual({
      all: 8,
      topLeft: 4,
      topRight: 8,
      bottomRight: 12,
      bottomLeft: 8,
    });
    expect(parseTailwindBorderWidth("border-[3px] border-solid")).toBe(3);
    expect(parseTailwindBorderStyle("border-[3px] border-dashed")).toBe(
      "dashed",
    );
    expect(parseTailwindBorderColor("border-[#123456]")).toBe("#123456");
    expect(parseTailwindBorderColor("border-stone-100")).toBe("#f5f5f4");
  });

  it("extracts stable data-morph-node IDs and enables precise multi-node patching", async () => {
    const {
      parseComponentSource,
      patchElementClassNameResult,
      getComponentFilePath,
    } = await import("./theme-ast-transformer");

    const multiNodeSource = `
export function MultiCard() {
  return (
    <div>
      <h2 data-morph-node="card-title-1" data-morph-element="heading" className="text-xl">Title 1</h2>
      <h2 data-morph-node="card-title-2" data-morph-element="heading" className="text-2xl">Title 2</h2>
    </div>
  );
}
`;

    const parsed = parseComponentSource(multiNodeSource);
    expect(parsed.parseOk).toBe(true);
    expect(parsed.nodeMap["card-title-1"]?.className).toBe("text-xl");
    expect(parsed.nodeMap["card-title-2"]?.className).toBe("text-2xl");

    // Patch specific node by stable nodeId
    const patchRes = patchElementClassNameResult(
      multiNodeSource,
      "card-title-2",
      () => "text-3xl font-bold",
    );
    expect(patchRes.editable).toBe(true);
    expect(patchRes.code).toContain(
      'data-morph-node="card-title-2" data-morph-element="heading" className="text-3xl font-bold"',
    );
    expect(patchRes.code).toContain(
      'data-morph-node="card-title-1" data-morph-element="heading" className="text-xl"',
    );

    // Test componentRef manifest resolution
    const files = [
      {
        path: "morph.theme.json",
        content: JSON.stringify({
          components: {
            "hero.editorial": { source: "src/components/HeroEditorial.tsx" },
            "hero.video": { source: "src/components/HeroVideo.tsx" },
          },
        }),
      },
      { path: "src/components/HeroEditorial.tsx", content: "" },
      { path: "src/components/HeroVideo.tsx", content: "" },
    ];

    expect(getComponentFilePath("hero", files, "hero.editorial")).toBe(
      "src/components/HeroEditorial.tsx",
    );
    expect(getComponentFilePath("hero", files, "hero.video")).toBe(
      "src/components/HeroVideo.tsx",
    );
  });
});
