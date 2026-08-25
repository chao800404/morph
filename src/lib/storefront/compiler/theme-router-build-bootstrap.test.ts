import { describe, expect, it } from "vitest";
import { createThemeBuildBootstrap } from "./theme-router-build-bootstrap";

describe("Theme router build bootstrap", () => {
  it("generates a temporary route tree for TanStack Start theme sources", () => {
    const result = createThemeBuildBootstrap({
      entry: "src/routes/index.tsx",
      cssFiles: ["src/styles/global.css"],
      files: [
        {
          path: "morph.theme.json",
          content: JSON.stringify({
            entry: "src/routes/index.tsx",
            router: { framework: "tanstack-start" },
          }),
        },
        {
          path: "src/routes/__root.tsx",
          content: "export const Route = createRootRoute({});",
        },
        {
          path: "src/routes/index.tsx",
          content: 'export const Route = createFileRoute("/")({});',
        },
      ],
    });

    expect(result.routeRegistry?.valid).toBe(true);
    expect(result.content).toContain("createRouter");
    expect(result.content).toContain("rootRouteImport.addChildren([route0])");
    expect(result.content).toContain('import "./src/styles/global.css"');
  });

  it("retains the legacy component bootstrap for themes without router metadata", () => {
    const result = createThemeBuildBootstrap({
      entry: "src/pages/index.tsx",
      cssFiles: [],
      files: [],
    });
    expect(result.routeRegistry).toBeNull();
    expect(result.content).toContain(
      'import EntryComponent from "./src/pages/index.tsx"',
    );
  });

  it("preserves nested route parent layout composition in the generated tree", () => {
    const result = createThemeBuildBootstrap({
      entry: "src/routes/index.tsx",
      cssFiles: [],
      files: [
        {
          path: "morph.theme.json",
          content: JSON.stringify({ router: { framework: "tanstack-start" } }),
        },
        {
          path: "src/routes/__root.tsx",
          content: "export const Route = createRootRoute({});",
        },
        {
          path: "src/routes/blog.tsx",
          content: 'export const Route = createFileRoute("/blog")({});',
        },
        {
          path: "src/routes/blog/$slug.tsx",
          content:
            'export const Route = createFileRoute("/blog/$slug")({});',
        },
      ],
    });

    expect(result.content).toContain("getParentRoute: () => route0");
    expect(result.content).toContain('path: "/$slug"');
    expect(result.content).toContain(
      "rootRouteImport.addChildren([route0.addChildren([route1])])",
    );
  });
});
