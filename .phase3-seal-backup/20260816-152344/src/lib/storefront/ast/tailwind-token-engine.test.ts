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
});
