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

describe("theme-ast-transformer", () => {
  it("parses default props from component source code", () => {
    const meta = parseComponentSource(SAMPLE_HERO_CODE);
    expect(meta.defaultProps.eyebrow).toBe("New collection");
    expect(meta.defaultProps.heading).toBe("Objects for everyday rituals.");
  });

  it("locates data-morph-elements in source code", () => {
    const meta = parseComponentSource(SAMPLE_HERO_CODE);
    expect(meta.elements.heading).toBeDefined();
    expect(meta.elements.heading.elementName).toBe("heading");
    expect(meta.elements.heading.location.line).toBeGreaterThan(0);
  });

  it("patches default prop values cleanly", () => {
    const updated = patchComponentDefaultProp(
      SAMPLE_HERO_CODE,
      "heading",
      "Handcrafted ceramics for your home.",
    );
    expect(updated).toContain('heading = "Handcrafted ceramics for your home."');
    expect(updated).not.toContain('heading = "Objects for everyday rituals."');
  });

  it("patches element className cleanly", () => {
    const updated = patchElementClassName(SAMPLE_HERO_CODE, "heading", (prev) =>
      prev.replace("text-6xl", "text-8xl"),
    );
    expect(updated).toContain('className="mt-6 font-serif text-8xl text-stone-950"');
  });

  it("finds source location for Monaco jump", () => {
    const loc = findSourceLocation(SAMPLE_HERO_CODE, "heading");
    expect(loc).not.toBeNull();
    expect(loc?.line).toBe(19);
  });
});
