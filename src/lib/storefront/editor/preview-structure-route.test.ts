import { describe, expect, it } from "vitest";
import type { ThemeRouteRecord } from "@/lib/storefront/compiler/theme-route-registry";
import {
  previewFrameNavigationRoute,
  previewStructureMatchesRoute,
} from "./preview-structure-route";

describe("previewStructureMatchesRoute", () => {
  it("sets aside a report sent before the preview reached the route", () => {
    // The preview boots on `/`; its first report is the home page's.
    expect(previewStructureMatchesRoute("/", "/aboutus")).toBe(false);
    expect(previewStructureMatchesRoute("/", "/products/$slug")).toBe(false);
  });

  it("accepts the report from the route that is selected", () => {
    expect(previewStructureMatchesRoute("/aboutus", "/aboutus")).toBe(true);
    expect(previewStructureMatchesRoute("/products/$slug", "/products/$slug")).toBe(true);
    // The router spells an index route with a trailing slash; the registry does not.
    expect(previewStructureMatchesRoute("/products/", "/products")).toBe(true);
    expect(previewStructureMatchesRoute("/", undefined)).toBe(true);
  });

  it("takes a report that names no route at its word", () => {
    expect(previewStructureMatchesRoute(undefined, "/aboutus")).toBe(true);
  });
});

describe("previewFrameNavigationRoute", () => {
  const record = (
    path: string,
    overrides: Partial<ThemeRouteRecord> = {},
  ): ThemeRouteRecord => ({
    id: path,
    path,
    sourcePath: `src/routes${path === "/" ? "/index" : path}.tsx`,
    kind: "route",
    dynamic: path.includes("$"),
    routeType: "route",
    isPathless: false,
    isServerOnly: false,
    componentName: null,
    ...overrides,
  });

  it("names the one static page a report names, by the registry's path", () => {
    const about = record("/about");
    const routes = [record("/"), about, record("/__root", { kind: "root" })];
    expect(previewFrameNavigationRoute("/about", routes)).toBe(about);
    // An index route as the router spells it.
    expect(previewFrameNavigationRoute("/about/", routes)).toBe(about);
    expect(previewFrameNavigationRoute("/", routes)?.path).toBe("/");
  });

  it("names nothing the editor could not show as that page", () => {
    const routes = [
      record("/products/$handle"),
      record("/deals", { isPathless: true, routeType: "pathless_layout" }),
      record("/shop", { routeType: "layout" }),
      record("/api", { isServerOnly: true }),
      record("/root-only", { kind: "root" }),
    ];
    for (const path of [
      "/products/$handle",
      "/deals",
      "/shop",
      "/api",
      "/root-only",
      "/nowhere",
    ]) {
      expect(previewFrameNavigationRoute(path, routes), path).toBeNull();
    }
  });

  it("names nothing when two pages claim the path", () => {
    expect(
      previewFrameNavigationRoute("/twice", [
        record("/twice"),
        record("/twice", { sourcePath: "src/routes/twice/index.tsx" }),
      ]),
    ).toBeNull();
  });
});
