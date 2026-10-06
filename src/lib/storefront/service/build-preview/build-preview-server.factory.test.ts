import { describe, expect, it } from "vitest";
import { createBuildPreviewServer } from "./build-preview-server.factory";

const LOCAL = {
  MORPH_LOCAL_THEME_PREVIEW_ORIGIN: "http://127.0.0.1:5199",
  MORPH_LOCAL_THEME_PREVIEW_TOKEN: "t".repeat(48),
};

describe("which Build Preview executor an environment has", () => {
  it("is the container when BuildPreviewSandbox is bound, even beside local settings", () => {
    const selection = createBuildPreviewServer({
      BuildPreviewSandbox: {},
      Sandbox: {},
      ...LOCAL,
    });
    expect(selection.enabled && selection.server.kind).toBe(
      "cloudflare-sandbox",
    );
  });

  it.each([{ Sandbox: {} }, { PreviewSandbox: {} }])(
    "is refused when containers are bound but not its class",
    (bindings) => {
      const selection = createBuildPreviewServer({ ...bindings, ...LOCAL });
      expect(selection).toMatchObject({
        enabled: false,
        reason: "BUILD_PREVIEW_SANDBOX_UNBOUND",
      });
    },
  );

  it("is the local helper without containers, outside production", () => {
    const selection = createBuildPreviewServer({ ...LOCAL });
    expect(selection.enabled && selection.server.kind).toBe("local-sidecar");
  });

  it("is nothing in production without containers", () => {
    const selection = createBuildPreviewServer({
      ...LOCAL,
      ENVIRONMENT: "production",
    });
    expect(selection.enabled).toBe(false);
  });
});
