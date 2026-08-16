import { describe, expect, it } from "vitest";
import {
  findSourceLocation,
  parseComponentSource,
  patchComponentDefaultProp,
  patchElementClassName,
  patchElementClassNameResult,
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

  it("extracts exact tag name, className, and location across multi-line JSX", () => {
    const meta = parseComponentSource(SAMPLE_HERO_CODE);
    expect(meta.elements.heading).toBeDefined();
    expect(meta.elements.heading.elementName).toBe("heading");
    expect(meta.elements.heading.tag).toBe("h1");
    expect(meta.elements.heading.className).toBe("mt-6 font-serif text-6xl text-stone-950");
    expect(meta.elements.heading.location.line).toBe(18);
    expect(meta.elements.heading.startOffset).toBeLessThan(meta.elements.heading.endOffset);
    expect(meta.elements.heading.openingStartOffset).toBeLessThan(meta.elements.heading.openingEndOffset);
    expect(meta.elements.heading.openingEndOffset).toBeLessThan(meta.elements.heading.endOffset);
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
    expect(updated).toContain('className="mt-6 font-serif text-8xl text-stone-950"');
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
    const res = patchElementClassNameResult(selfClosingCode, "image", () => "size-full object-cover");
    expect(res.editable).toBe(true);
    expect(res.code).toContain('className="size-full object-cover"');
    // Ensure it didn't inject inside the closing `/>` as `/<className>`
    expect(res.code).toMatch(/<img[\s\S]*className="size-full object-cover"[\s\S]*\/>/);
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
      { path: "src/components/Hero.tsx", content: "export default () => null;" },
      { path: "src/components/CustomBanner.tsx", content: "export default () => null;" },
      { path: "src/pages/index.tsx", content: "export default () => null;" },
    ];

    expect(getComponentFilePath("hero", files)).toBe("src/components/Hero.tsx");
    expect(getComponentFilePath("custom-banner", files)).toBe("src/components/CustomBanner.tsx");
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
    expect(parseTailwindFontFamily("text-xl font-serif text-white")).toBe("serif");
    expect(parseTailwindFontFamily("text-xl font-sans tracking-tight")).toBe("sans");
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
});
