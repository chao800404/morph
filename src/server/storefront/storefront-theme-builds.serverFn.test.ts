import { describe, expect, it } from "vitest";
import {
  createPreviewBuild,
  getThemeBuild,
  listThemeBuilds,
} from "./storefront-theme-builds.serverFn";

describe("storefront-theme-builds.serverFn", () => {
  it("exports server functions", () => {
    expect(createPreviewBuild).toBeDefined();
    expect(getThemeBuild).toBeDefined();
    expect(listThemeBuilds).toBeDefined();
  });
});
