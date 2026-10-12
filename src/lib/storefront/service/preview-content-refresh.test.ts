import { describe, expect, it } from "vitest";
import { previewContentRefresh } from "./preview-content-refresh";

describe("how a preview's canvas shows a saved content edit", () => {
  it("syncs nothing into the client-only preview", () => {
    expect(
      previewContentRefresh({ previewRuntime: undefined, devServer: false }),
    ).toBeNull();
  });

  it("re-runs the router's loaders once Start's server reads the sync", () => {
    expect(
      previewContentRefresh({ previewRuntime: "start", devServer: false }),
    ).toBe("router");
  });

  it("loads a dev server's page again, whichever runtime switch is set", () => {
    expect(
      previewContentRefresh({ previewRuntime: undefined, devServer: true }),
    ).toBe("reload");
    expect(
      previewContentRefresh({ previewRuntime: "start", devServer: true }),
    ).toBe("reload");
  });
});
