import { describe, expect, it } from "vitest";
import {
  pageSectionRouteKey,
  prepareDuplicateThemeFile,
  preparePageSectionCopy,
} from "./duplicate-theme-file";

describe("prepareDuplicateThemeFile", () => {
  it("uses the first available copy name", () => {
    const result = prepareDuplicateThemeFile("src/components/Hero.tsx", [
      "src/components/Hero.tsx",
    ]);

    expect(result).toMatchObject({
      ok: true,
      path: "src/components/Hero-copy.tsx",
      mimeType: "text/typescript",
    });
  });

  it("increments the copy suffix when earlier copies exist", () => {
    const result = prepareDuplicateThemeFile("src/components/Hero.tsx", [
      "src/components/Hero.tsx",
      "src/components/Hero-copy.tsx",
      "src/components/Hero-copy-2.tsx",
    ]);

    expect(result).toMatchObject({
      ok: true,
      path: "src/components/Hero-copy-3.tsx",
    });
  });

  it("preserves extensionless paths for validation", () => {
    const result = prepareDuplicateThemeFile("src/components/Hero", [
      "src/components/Hero",
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("can be created");
  });
});

describe("page-specific component paths", () => {
  it("derives stable route keys for static and dynamic routes", () => {
    expect(pageSectionRouteKey("/")).toBe("home");
    expect(pageSectionRouteKey("/about-us")).toBe("about-us");
    expect(pageSectionRouteKey("/products/$slug")).toBe("products-slug");
  });

  it("places a detached component under the page-sections convention", () => {
    const result = preparePageSectionCopy(
      "src/components/sections/Hero.tsx",
      "/",
      ["src/components/sections/Hero.tsx"],
      "export default function Hero() { return null; }",
    );

    expect(result).toMatchObject({
      ok: true,
      path: "src/components/page-sections/home/Hero.tsx",
      content: "export default function Hero() { return null; }",
    });
  });

  it("keeps page copies from overwriting an existing same-name component", () => {
    const result = preparePageSectionCopy(
      "src/components/sections/Hero.tsx",
      "/about",
      [
        "src/components/sections/Hero.tsx",
        "src/components/page-sections/about/Hero.tsx",
      ],
    );

    expect(result).toMatchObject({
      ok: true,
      path: "src/components/page-sections/about/Hero-copy.tsx",
    });
  });
});
