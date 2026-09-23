import { describe, expect, it } from "vitest";
import { previewStructureMatchesRoute } from "./preview-structure-route";

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
