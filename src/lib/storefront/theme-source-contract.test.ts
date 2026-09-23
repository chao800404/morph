import { describe, expect, it } from "vitest";
import { STARTER_THEME_FILES } from "./starter-theme-files";
import { deriveThemeSourceContract } from "./theme-source-contract";

const starterFiles = STARTER_THEME_FILES.map((file) => ({
  path: file.path,
  content: file.content,
  isEntry: file.isEntry,
}));

describe("deriveThemeSourceContract", () => {
  it("derives the route, router, layout and slots without the manifest", () => {
    const result = deriveThemeSourceContract(
      starterFiles.filter((file) => file.path !== "morph.theme.json"),
    );

    expect(result.complete).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.contract.entry).toBe("src/routes/index.tsx");
    expect(result.contract.router).toEqual({
      framework: "tanstack-start",
      previewAdapter: "tanstack-router-client",
      routesDirectory: "src/routes",
      rootRoute: "src/routes/__root.tsx",
      generatedRouteTree: "src/routeTree.gen.ts",
    });
    expect(result.contract.documentLayout).toEqual({
      source: "src/layouts/StorefrontLayout.tsx",
      export: "default",
    });
    expect(result.contract.sections.map((section) => section.slotId)).toEqual([
      "starter-hero",
      "starter-introduction",
      "starter-categories",
      "starter-story",
      "starter-principles",
      "starter-newsletter",
      "starter-header",
      "starter-footer",
    ]);
  });

  it("fails closed when two entry files are explicitly declared", () => {
    const result = deriveThemeSourceContract([
      ...starterFiles.filter((file) => file.path !== "morph.theme.json"),
      { path: "src/routes/other.tsx", content: "export default null;", isEntry: true },
    ]);

    expect(result.complete).toBe(false);
    expect(result.contract.entry).toBe(null);
    expect(result.categories.entry).toBe("unsupported");
    expect(result.diagnostics[0]).toContain("multiple entry files");
  });
});
