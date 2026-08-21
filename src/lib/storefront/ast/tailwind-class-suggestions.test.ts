import { describe, expect, it } from "vitest";
import { suggestTailwindClasses } from "./tailwind-class-suggestions";

describe("suggestTailwindClasses", () => {
  it("ranks matching utility classes and excludes applied classes", () => {
    const results = suggestTailwindClasses("bg-red", new Set(["bg-red-50"]));
    expect(results[0]?.value).toBe("bg-red-100");
    expect(results.some(({ value }) => value === "bg-red-50")).toBe(false);
  });

  it("preserves responsive and state variant prefixes", () => {
    const results = suggestTailwindClasses("lg:hover:bg-red-5");
    expect(results[0]?.value).toBe("lg:hover:bg-red-50");
  });
});
