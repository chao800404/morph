import { describe, expect, it } from "vitest";
import {
  DEFAULT_ELEMENT_TARGET_KEY,
  domElementMatchesTarget,
  resolveElementMeta,
  resolveElementTargetKey,
  sourceLocationKey,
} from "./element-target";
import { parseComponentSource } from "./theme-ast-transformer";

describe("sourceLocationKey", () => {
  it("keeps only the position, since the AST indexes within one file", () => {
    expect(sourceLocationKey("src/components/Promo.tsx:10:7")).toBe("10:7");
    expect(sourceLocationKey("src/a:b.tsx:4:2")).toBe("4:2");
  });

  it("returns null for anything that is not a position", () => {
    for (const value of [null, undefined, "", "Promo.tsx", "a:b:c"]) {
      expect(sourceLocationKey(value as string), String(value)).toBeNull();
    }
  });
});

describe("resolveElementTargetKey", () => {
  it("prefers an authored marker over a position", () => {
    // A position shifts whenever the file above it is edited, so it can only
    // ever be the fallback.
    expect(
      resolveElementTargetKey({
        nodeId: "hero-heading",
        elementKey: "heading",
        sourceLocation: "src/components/Hero.tsx:10:7",
      }),
    ).toBe("hero-heading");

    expect(
      resolveElementTargetKey({
        elementKey: "heading",
        sourceLocation: "src/components/Hero.tsx:10:7",
      }),
    ).toBe("heading");
  });

  it("falls back to the position for an element with no markers", () => {
    expect(
      resolveElementTargetKey({
        sourceLocation: "src/components/Promo.tsx:10:7",
      }),
    ).toBe("10:7");
  });

  it("falls back to the legacy default when nothing identifies the element", () => {
    expect(resolveElementTargetKey(null)).toBe(DEFAULT_ELEMENT_TARGET_KEY);
    expect(resolveElementTargetKey({})).toBe(DEFAULT_ELEMENT_TARGET_KEY);
  });
});

describe("resolveElementMeta", () => {
  const marked = parseComponentSource(`export default function Hero() {
  return <section data-morph-node="hero-root" className="a" />;
}`);
  const unmarked = parseComponentSource(`export default function Promo() {
  return (
    <section className="px-6">
      <h2 className="text-2xl" />
    </section>
  );
}`);

  it("resolves a marked element by its marker", () => {
    expect(resolveElementMeta(marked, "hero-root")?.tag).toBe("section");
  });

  it("resolves an unmarked element by its position", () => {
    expect(resolveElementMeta(unmarked, "4:7")?.tag).toBe("h2");
  });

  it("returns nothing for a target that matches no element", () => {
    expect(resolveElementMeta(unmarked, "99:1")).toBeUndefined();
    expect(resolveElementMeta(null, "4:7")).toBeUndefined();
  });
});

describe("domElementMatchesTarget", () => {
  const el = (dataset: Record<string, string>) => ({ dataset });

  it("matches a marked element by its marker", () => {
    expect(domElementMatchesTarget(el({ morphNode: "x" }), "x")).toBe(true);
    expect(domElementMatchesTarget(el({ morphElement: "y" }), "y")).toBe(true);
  });

  it("matches an unmarked element by its full compiled position", () => {
    // The DOM carries the file too, so the AST's `line:column` key alone
    // cannot address a rendered element.
    const element = el({ morphLoc: "src/components/Promo.tsx:10:7" });
    expect(
      domElementMatchesTarget(element, "10:7", "src/components/Promo.tsx:10:7"),
    ).toBe(true);
    expect(domElementMatchesTarget(element, "10:7")).toBe(false);
  });

  it("does not match an unrelated element", () => {
    expect(
      domElementMatchesTarget(
        el({ morphLoc: "src/components/Other.tsx:10:7" }),
        "10:7",
        "src/components/Promo.tsx:10:7",
      ),
    ).toBe(false);
  });
});

