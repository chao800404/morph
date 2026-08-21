import { describe, expect, it } from "vitest";
import {
  classifyTailwindUtility,
  parseTailwindToken,
  patchTailwindClasses,
} from "./tailwind-token-engine";

describe("tailwind-token-engine", () => {
  it("correctly classifies utility tokens into property families", () => {
    expect(classifyTailwindUtility("text-6xl")).toBe("font-size");
    expect(classifyTailwindUtility("text-[100px]")).toBe("font-size");
    expect(classifyTailwindUtility("font-serif")).toBe("font-family");
    expect(classifyTailwindUtility("font-bold")).toBe("font-weight");
    expect(classifyTailwindUtility("text-center")).toBe("text-align");
    expect(classifyTailwindUtility("leading-[1.2]")).toBe("line-height");
    expect(classifyTailwindUtility("leading-tight")).toBe("line-height");
    expect(classifyTailwindUtility("p-8")).toBe("padding");
    expect(classifyTailwindUtility("pt-4")).toBe("padding-top");
    expect(classifyTailwindUtility("pb-6")).toBe("padding-bottom");
    expect(classifyTailwindUtility("pl-2")).toBe("padding-left");
    expect(classifyTailwindUtility("pr-2")).toBe("padding-right");
    expect(classifyTailwindUtility("px-6")).toBe("padding-x");
    expect(classifyTailwindUtility("py-12")).toBe("padding-y");
    expect(classifyTailwindUtility("bg-white")).toBe("background");
    expect(classifyTailwindUtility("bg-[#123456]")).toBe("background");
    expect(classifyTailwindUtility("rounded-2xl")).toBe("border-radius");
    expect(classifyTailwindUtility("rounded-[16px]")).toBe("border-radius");
    expect(classifyTailwindUtility("object-cover")).toBe("object-fit");
    expect(classifyTailwindUtility("object-top-right")).toBe("object-position");
    expect(classifyTailwindUtility("object-[35%_20%]")).toBe("object-position");
    expect(classifyTailwindUtility("aspect-video")).toBe("aspect-ratio");
    expect(classifyTailwindUtility("aspect-[4/3]")).toBe("aspect-ratio");
    expect(classifyTailwindUtility("shadow-lg")).toBe("other");
  });

  it("correctly parses tokens with single and multi-variants", () => {
    const t1 = parseTailwindToken("text-4xl");
    expect(t1.variants).toEqual([]);
    expect(t1.utility).toBe("text-4xl");
    expect(t1.propertyFamily).toBe("font-size");

    const t2 = parseTailwindToken("md:text-6xl");
    expect(t2.variants).toEqual(["md"]);
    expect(t2.utility).toBe("text-6xl");
    expect(t2.propertyFamily).toBe("font-size");

    const t3 = parseTailwindToken("dark:hover:bg-stone-900");
    expect(t3.variants).toEqual(["dark", "hover"]);
    expect(t3.utility).toBe("bg-stone-900");
    expect(t3.propertyFamily).toBe("background");
  });

  it("preserves responsive and state variants when updating base classes", () => {
    const original = "text-4xl md:text-6xl lg:text-8xl hover:text-red-500 font-bold";

    // Update base font size
    const updatedBase = patchTailwindClasses(original, {
      property: "font-size",
      value: "text-[100px]",
      targetVariants: [],
    });

    expect(updatedBase).toBe(
      "text-[100px] md:text-6xl lg:text-8xl hover:text-red-500 font-bold",
    );

    // Update tablet (md) font size only
    const updatedTablet = patchTailwindClasses(updatedBase, {
      property: "font-size",
      value: "text-[72px]",
      targetVariants: ["md"],
    });

    expect(updatedTablet).toBe(
      "text-[100px] md:text-[72px] lg:text-8xl hover:text-red-500 font-bold",
    );
  });

  it("inserts new token if property not present, without clobbering existing classes", () => {
    const original = "font-serif text-stone-900";
    const patched = patchTailwindClasses(original, {
      property: "font-size",
      value: "text-2xl",
    });

    expect(patched).toBe("font-serif text-stone-900 text-2xl");
  });

  it("removes property token cleanly when value is empty string", () => {
    const original = "p-8 pt-4 bg-white";
    const patched = patchTailwindClasses(original, {
      property: "padding-top",
      value: "",
    });

    expect(patched).toBe("p-8 bg-white");
  });

  it("never guesses ambiguous arbitrary utilities as editable presentation slots", () => {
    expect(classifyTailwindUtility("text-[#ff0000]")).toBe("other");
    expect(classifyTailwindUtility("bg-[url(https://example.com/a:b.png)]")).toBe("other");
    expect(classifyTailwindUtility("font-[700]")).toBe("font-weight");
    expect(classifyTailwindUtility("font-[var(--brand-font)]")).toBe("other");
  });

  it("parses arbitrary variants and arbitrary values containing colons", () => {
    const token = parseTailwindToken(
      "[&:nth-child(2)]:hover:bg-[url(https://example.com/a:b.png)]",
    );
    expect(token.variants).toEqual(["[&:nth-child(2)]", "hover"]);
    expect(token.utility).toBe("bg-[url(https://example.com/a:b.png)]");
  });

  it("treats variant order as semantic", () => {
    const original = "md:hover:text-6xl hover:md:text-7xl text-4xl";
    const updated = patchTailwindClasses(original, {
      property: "font-size",
      value: "text-[72px]",
      targetVariants: ["md", "hover"],
    });
    expect(updated).toBe("md:hover:text-[72px] hover:md:text-7xl text-4xl");
  });

  it("preserves unknown arbitrary utilities while changing font size", () => {
    const original =
      "text-[#ff0000] text-4xl bg-[url(https://example.com/a:b.png)]";
    const updated = patchTailwindClasses(original, {
      property: "font-size",
      value: "text-[88px]",
    });
    expect(updated).toContain("text-[#ff0000]");
    expect(updated).toContain("bg-[url(https://example.com/a:b.png)]");
    expect(updated).toContain("text-[88px]");
  });

  it("replaces media utilities without accumulating duplicates", () => {
    const original = "object-cover aspect-video md:object-top object-left";
    const updated = patchTailwindClasses(original, {
      property: "object-fit",
      value: "object-contain",
    });
    expect(updated).toBe("object-contain aspect-video md:object-top object-left");

    const responsive = patchTailwindClasses(updated, {
      property: "object-position",
      value: "object-bottom-right",
      targetVariants: ["md"],
    });
    expect(responsive).toBe("object-contain aspect-video md:object-bottom-right object-left");

    const aspect = patchTailwindClasses(responsive, {
      property: "aspect-ratio",
      value: "aspect-[4/3]",
    });
    expect(aspect).toBe("object-contain aspect-[4/3] md:object-bottom-right object-left");
  });
  it("classifies and replaces Figma-style layout property families independently", () => {
    const classes =
      "flex flex-col gap-[12px] w-[320px] h-[180px] relative top-[8px] left-[4px] z-[2] rotate-[5deg] opacity-[0.8] overflow-hidden";

    expect(classifyTailwindUtility("flex")).toBe("display");
    expect(classifyTailwindUtility("flex-col")).toBe("flex-direction");
    expect(classifyTailwindUtility("gap-[12px]")).toBe("gap");
    expect(classifyTailwindUtility("w-[320px]")).toBe("width");
    expect(classifyTailwindUtility("h-[180px]")).toBe("height");
    expect(classifyTailwindUtility("relative")).toBe("position");
    expect(classifyTailwindUtility("top-[8px]")).toBe("top");
    expect(classifyTailwindUtility("left-[4px]")).toBe("left");
    expect(classifyTailwindUtility("z-[2]")).toBe("z-index");
    expect(classifyTailwindUtility("rotate-[5deg]")).toBe("rotate");
    expect(classifyTailwindUtility("opacity-[0.8]")).toBe("opacity");
    expect(classifyTailwindUtility("overflow-hidden")).toBe("overflow");

    expect(
      patchTailwindClasses(classes, {
        property: "width",
        value: "w-[640px]",
      }),
    ).toContain("w-[640px]");
  });

});
