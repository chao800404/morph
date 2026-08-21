import { describe, expect, it } from "vitest";
import { parseComponentSource } from "./ast/theme-ast-transformer";
import { STARTER_THEME_FILES } from "./starter-theme-files";

describe("starter Principles theme source", () => {
  it("registers the principles component and exposes stable editable nodes", () => {
    const manifest = JSON.parse(
      STARTER_THEME_FILES.find((file) => file.path === "morph.theme.json")!
        .content,
    ) as {
      components: Record<string, { source: string }>;
      sections: Record<string, { componentRef: string; source: string }>;
    };
    expect(manifest.components["principles.default"]).toMatchObject({
      source: "src/components/Principles.tsx",
      sectionType: "principles",
    });
    expect(manifest.sections.principles).toEqual({
      componentRef: "principles.default",
      source: "src/components/Principles.tsx",
    });

    const source = STARTER_THEME_FILES.find(
      (file) => file.path === "src/components/Principles.tsx",
    )!.content;
    const parsed = parseComponentSource(source);
    expect(parsed.parseOk).toBe(true);
    expect(parsed.nodeMap["principles-root"]?.className).toContain("bg-stone-50");
    expect(parsed.nodeMap["principle-card"]?.className).toContain("border-b");
    expect(parsed.nodeMap["principle-title"]?.className).toContain("font-serif");
    expect(parsed.nodeMap["principle-body"]?.className).toContain("leading-6");
  });
});
