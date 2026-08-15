import { describe, expect, it } from "vitest";
import {
  findSourceLocation,
  parseComponentSource,
  patchComponentDefaultProp,
  patchElementClassName,
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

  it("finds source location dynamically for Monaco jump", () => {
    const loc = findSourceLocation(SAMPLE_HERO_CODE, "heading");
    expect(loc).not.toBeNull();
    expect(loc?.line).toBe(18);
  });
});
