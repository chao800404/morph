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
    expect(classifyTailwindUtility("text-stone-900")).toBe("text-color");
    expect(classifyTailwindUtility("text-rose-700/75")).toBe("text-color");
    expect(classifyTailwindUtility("text-[#123456]")).toBe("text-color");
    expect(classifyTailwindUtility("leading-[1.2]")).toBe("line-height");
    expect(classifyTailwindUtility("leading-tight")).toBe("line-height");
    expect(classifyTailwindUtility("p-8")).toBe("padding");
    expect(classifyTailwindUtility("pt-4")).toBe("padding-top");
    expect(classifyTailwindUtility("pb-6")).toBe("padding-bottom");
    expect(classifyTailwindUtility("pl-2")).toBe("padding-left");
    expect(classifyTailwindUtility("pr-2")).toBe("padding-right");
    expect(classifyTailwindUtility("px-6")).toBe("padding-x");
    expect(classifyTailwindUtility("py-12")).toBe("padding-y");
    expect(classifyTailwindUtility("m-[12px]")).toBe("margin");
    expect(classifyTailwindUtility("-mt-[8px]")).toBe("margin-top");
    expect(classifyTailwindUtility("m-auto")).toBe("margin");
    expect(classifyTailwindUtility("ml-auto")).toBe("margin-left");
    expect(classifyTailwindUtility("mx-6")).toBe("margin-x");
    expect(parseTailwindToken("md:mr-4").propertyFamily).toBe("margin-right");
    expect(parseTailwindToken("md:mr-auto").propertyFamily).toBe(
      "margin-right",
    );
    expect(classifyTailwindUtility("bg-white")).toBe("background");
    expect(classifyTailwindUtility("bg-[#123456]")).toBe("background");
    expect(
      classifyTailwindUtility(
        "bg-[linear-gradient(90deg,_#fafaf9_0%,_#1c1917_100%)]",
      ),
    ).toBe("background");
    expect(classifyTailwindUtility("rounded-2xl")).toBe("border-radius");
    expect(classifyTailwindUtility("rounded-[16px]")).toBe("border-radius");
    expect(classifyTailwindUtility("rounded-tl-[4px]")).toBe(
      "border-radius-top-left",
    );
    expect(classifyTailwindUtility("rounded-br-xl")).toBe(
      "border-radius-bottom-right",
    );
    expect(classifyTailwindUtility("border-[2px]")).toBe("border-width");
    expect(classifyTailwindUtility("border-dashed")).toBe("border-style");
    expect(classifyTailwindUtility("border-[#123456]")).toBe("border-color");
    expect(classifyTailwindUtility("bg-blue-500/80")).toBe("background");
    expect(classifyTailwindUtility("border-emerald-400/[.35]")).toBe(
      "border-color",
    );
    expect(classifyTailwindUtility("object-cover")).toBe("object-fit");
    expect(classifyTailwindUtility("object-top-right")).toBe("object-position");
    expect(classifyTailwindUtility("object-[35%_20%]")).toBe("object-position");
    expect(classifyTailwindUtility("aspect-video")).toBe("aspect-ratio");
    expect(classifyTailwindUtility("aspect-[4/3]")).toBe("aspect-ratio");
    // `other` until the Inspector had a control for it. A family the engine
    // does not recognise is one it cannot replace, so setting a shadow would
    // have appended a second `shadow-*` beside the first.
    expect(classifyTailwindUtility("shadow-lg")).toBe("box-shadow");
    expect(classifyTailwindUtility("shadow-none")).toBe("box-shadow");
    // A colour is a different utility that happens to share the prefix, and
    // must stay out of the size family: classifying it here would let a size
    // change delete the colour.
    expect(classifyTailwindUtility("shadow-red-500")).toBe("other");
  });

  // Measured against the installed tailwindcss 4.1.17 with
  // `compile(...).build([...])`: every value below emits a radius declaration, so
  // every one is a class the Inspector has to be able to clear. `xs` and `4xl`
  // were missing from the enumeration and the corner patterns required a
  // `-<value>` suffix, which left four real classes classified as `other` — and
  // `other` is exactly what lets a broad radius write leave a token behind that
  // keeps deciding the rendered corner while the optimistic keys report the new
  // value.
  it("knows the whole radius scale, including the bare corner form", () => {
    for (const value of [
      "none",
      "xs",
      "sm",
      "md",
      "lg",
      "xl",
      "2xl",
      "3xl",
      "4xl",
      "full",
    ]) {
      expect(classifyTailwindUtility(`rounded-${value}`)).toBe("border-radius");
      expect(classifyTailwindUtility(`rounded-tl-${value}`)).toBe(
        "border-radius-top-left",
      );
      expect(classifyTailwindUtility(`rounded-br-${value}`)).toBe(
        "border-radius-bottom-right",
      );
    }
    // The suffix is optional upstream: `rounded-tl` alone is
    // `border-top-left-radius: 0.25rem`.
    expect(classifyTailwindUtility("rounded-tl")).toBe(
      "border-radius-top-left",
    );
    expect(classifyTailwindUtility("rounded-tr")).toBe(
      "border-radius-top-right",
    );
    expect(classifyTailwindUtility("rounded-br")).toBe(
      "border-radius-bottom-right",
    );
    expect(classifyTailwindUtility("rounded-bl")).toBe(
      "border-radius-bottom-left",
    );
    // The side pairs cover two corners each, so they are sets rather than ranks
    // on a chain: measured, `rounded-t-2xl` emits `border-top-left-radius` *and*
    // `border-top-right-radius`. Clearing them needs one family per pair.
    expect(classifyTailwindUtility("rounded-t-2xl")).toBe("border-radius-top");
    expect(classifyTailwindUtility("rounded-r-2xl")).toBe(
      "border-radius-right",
    );
    expect(classifyTailwindUtility("rounded-b-2xl")).toBe(
      "border-radius-bottom",
    );
    expect(classifyTailwindUtility("rounded-l-2xl")).toBe("border-radius-left");
    expect(classifyTailwindUtility("rounded-t")).toBe("border-radius-top");
    // The axes: `border-x-*` is `border-inline-width` and `border-y-*` is
    // `border-block-width`, each covering two physical sides under a horizontal
    // writing mode.
    expect(classifyTailwindUtility("border-x-2")).toBe("border-width-x");
    expect(classifyTailwindUtility("border-y-2")).toBe("border-width-y");
    expect(classifyTailwindUtility("border-x")).toBe("border-width-x");
    expect(classifyTailwindUtility("border-x-[3px]")).toBe("border-width-x");
    // The logical families, which closed the last of the gap. Every one of these
    // was verified to be a real class by compiling it: `border-s-2` emits
    // `border-inline-start-width`, `rounded-ss-2xl` `border-start-start-radius`,
    // and `rounded-s-2xl` the *pair* `border-start-start-radius` +
    // `border-end-start-radius`. Classifying them is what lets a broad write
    // clear them; it does not require resolving which physical side they are,
    // which is why the model did not need a `direction` input.
    expect(classifyTailwindUtility("ps-4")).toBe("padding-inline-start");
    expect(classifyTailwindUtility("pe-4")).toBe("padding-inline-end");
    expect(classifyTailwindUtility("ms-4")).toBe("margin-inline-start");
    expect(classifyTailwindUtility("-me-4")).toBe("margin-inline-end");
    expect(classifyTailwindUtility("ms-auto")).toBe("margin-inline-start");
    expect(classifyTailwindUtility("border-s-2")).toBe(
      "border-width-inline-start",
    );
    expect(classifyTailwindUtility("border-e-2")).toBe(
      "border-width-inline-end",
    );
    expect(classifyTailwindUtility("rounded-ss-2xl")).toBe(
      "border-radius-start-start",
    );
    expect(classifyTailwindUtility("rounded-se-2xl")).toBe(
      "border-radius-start-end",
    );
    expect(classifyTailwindUtility("rounded-es-2xl")).toBe(
      "border-radius-end-start",
    );
    expect(classifyTailwindUtility("rounded-ee-2xl")).toBe(
      "border-radius-end-end",
    );
    expect(classifyTailwindUtility("rounded-s-2xl")).toBe(
      "border-radius-start",
    );
    expect(classifyTailwindUtility("rounded-e-2xl")).toBe("border-radius-end");
    // The glued spelling must not be confused with the hyphenated one: `ps-` is
    // the logical padding side, while `p-s-…` is not a utility at all.
    expect(classifyTailwindUtility("p-s-4")).toBe("other");
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
    const original =
      "text-4xl md:text-6xl lg:text-8xl hover:text-red-500 font-bold";

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

  it("updates the active structural variant instead of leaving an override in effect", () => {
    const original =
      "border-b py-8 lg:border-b-0 lg:border-r lg:px-8 lg:first:pl-0 lg:last:border-r-0";

    expect(
      patchTailwindClasses(original, {
        property: "padding-left",
        value: "pl-[28px]",
        targetVariants: ["lg"],
        activeVariants: ["first", "odd"],
      }),
    ).toBe(
      "border-b py-8 lg:border-b-0 lg:border-r lg:px-8 lg:first:pl-[28px] lg:last:border-r-0",
    );

    expect(
      patchTailwindClasses(original, {
        property: "padding-left",
        value: "pl-[28px]",
        targetVariants: ["lg"],
        activeVariants: ["even"],
      }),
    ).toBe(
      "border-b py-8 lg:border-b-0 lg:border-r lg:px-8 lg:first:pl-0 lg:last:border-r-0 lg:pl-[28px]",
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

  /**
   * The point of teaching the engine this family: a size it cannot classify is
   * a size it cannot replace, so before this the Inspector's shadow control
   * would have left `shadow-sm shadow-lg` on the element and let the cascade
   * decide.
   */
  it("replaces an existing shadow size rather than appending beside it", () => {
    expect(
      patchTailwindClasses("rounded-lg shadow-sm bg-white", {
        property: "box-shadow",
        value: "shadow-lg",
      }),
    ).toBe("rounded-lg shadow-lg bg-white");
  });

  it("leaves a shadow colour alone when the size changes", () => {
    const patched = patchTailwindClasses("shadow-sm shadow-red-500", {
      property: "box-shadow",
      value: "shadow-xl",
    });

    expect(patched).toContain("shadow-red-500");
    expect(patched).toContain("shadow-xl");
    expect(patched).not.toContain("shadow-sm");
  });

  it("classifies the interaction families the Inspector now writes", () => {
    expect(classifyTailwindUtility("cursor-pointer")).toBe("cursor");
    expect(classifyTailwindUtility("cursor-not-allowed")).toBe("cursor");
    // Bare `transition` is the common form in this codebase and means the
    // default set, so it has to classify or a change would append beside it.
    expect(classifyTailwindUtility("transition")).toBe("transition");
    expect(classifyTailwindUtility("transition-colors")).toBe("transition");
    // Timing is a separate utility. Folding it in here would make a change of
    // set silently drop the duration someone put beside it.
    expect(classifyTailwindUtility("duration-150")).toBe("other");
    expect(classifyTailwindUtility("ease-out")).toBe("other");
  });

  it("replaces a transition set while leaving its timing in place", () => {
    const patched = patchTailwindClasses(
      "transition-colors duration-150 ease-out cursor-pointer",
      { property: "transition", value: "transition-transform" },
    );

    expect(patched).toContain("transition-transform");
    expect(patched).not.toContain("transition-colors");
    expect(patched).toContain("duration-150");
    expect(patched).toContain("ease-out");
    // A different family, untouched by this write.
    expect(patched).toContain("cursor-pointer");
  });

  it("removes property token cleanly when value is empty string", () => {
    const original = "p-8 pt-4 bg-white";
    const patched = patchTailwindClasses(original, {
      property: "padding-top",
      value: "",
    });

    expect(patched).toBe("p-8 bg-white");
  });

  it("recognizes explicit text colors without guessing unrelated arbitrary utilities", () => {
    expect(classifyTailwindUtility("text-[#ff0000]")).toBe("text-color");
    expect(
      classifyTailwindUtility("bg-[url(https://example.com/a:b.png)]"),
    ).toBe("other");
    expect(classifyTailwindUtility("font-[700]")).toBe("font-weight");
    expect(classifyTailwindUtility("font-[var(--brand-font)]")).toBe("other");
  });

  it("replaces text color without changing font size or state variants", () => {
    expect(
      patchTailwindClasses("text-stone-900 text-4xl hover:text-red-500", {
        property: "text-color",
        value: "text-[#123456]",
      }),
    ).toBe("text-[#123456] text-4xl hover:text-red-500");
  });

  it("replaces solid and gradient background paints without accumulating utilities", () => {
    const gradient = "bg-[linear-gradient(90deg,_#fafaf9_0%,_#1c1917_100%)]";

    expect(
      patchTailwindClasses("relative bg-white px-4", {
        property: "background",
        value: gradient,
      }),
    ).toBe(`relative ${gradient} px-4`);

    expect(
      patchTailwindClasses(`relative ${gradient} px-4`, {
        property: "background",
        value: "bg-[#d8d0c3]",
      }),
    ).toBe("relative bg-[#d8d0c3] px-4");
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
    expect(updated).toBe(
      "object-contain aspect-video md:object-top object-left",
    );

    const responsive = patchTailwindClasses(updated, {
      property: "object-position",
      value: "object-bottom-right",
      targetVariants: ["md"],
    });
    expect(responsive).toBe(
      "object-contain aspect-video md:object-bottom-right object-left",
    );

    const aspect = patchTailwindClasses(responsive, {
      property: "aspect-ratio",
      value: "aspect-[4/3]",
    });
    expect(aspect).toBe(
      "object-contain aspect-[4/3] md:object-bottom-right object-left",
    );
  });

  it("patches border sides and individual corner families independently", () => {
    const original =
      "border border-t-[1px] border-r-2 border-solid border-stone-200 rounded-[8px] rounded-tl-[4px]";
    const width = patchTailwindClasses(original, {
      property: "border-width",
      value: "border-[3px]",
    });
    const topWidth = patchTailwindClasses(width, {
      property: "border-width-top",
      value: "border-t-[5px]",
    });
    const rightWidth = patchTailwindClasses(topWidth, {
      property: "border-width-right",
      value: "border-r-[6px]",
    });
    const color = patchTailwindClasses(rightWidth, {
      property: "border-color",
      value: "border-[#123456]",
    });
    const corner = patchTailwindClasses(color, {
      property: "border-radius-top-left",
      value: "rounded-tl-[12px]",
    });

    expect(corner).toBe(
      "border-[3px] border-t-[5px] border-r-[6px] border-solid border-[#123456] rounded-[8px] rounded-tl-[12px]",
    );
  });
  it("patches min and max sizing families independently", () => {
    const original =
      "w-[100px] h-auto min-w-[12rem] min-h-0 max-w-xl max-h-[80vh]";
    const minWidth = patchTailwindClasses(original, {
      property: "min-width",
      value: "min-w-[16rem]",
    });
    const maxHeight = patchTailwindClasses(minWidth, {
      property: "max-height",
      value: "max-h-none",
    });

    expect(maxHeight).toBe(
      "w-[100px] h-auto min-w-[16rem] min-h-0 max-w-xl max-h-none",
    );
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
    expect(classifyTailwindUtility("bg-clip-text")).toBe("background-clip");

    expect(
      patchTailwindClasses(classes, {
        property: "width",
        value: "w-[640px]",
      }),
    ).toContain("w-[640px]");
  });
});
