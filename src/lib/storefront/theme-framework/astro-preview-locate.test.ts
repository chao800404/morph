import { describe, expect, it } from "vitest";
import {
  ASTRO_PREVIEW_BOUNDARY_MARKER,
  astroPreviewLocatePluginSource,
  astroPreviewMarkerNonce,
  astroPreviewSourceHash,
} from "./astro-preview-locate";
import { planAstroPreviewWorkspace } from "./astro-preview-workspace";
import { THEME_PREVIEW_START_CLIENT_PATH } from "../compiler/theme-preview-start-runtime";

// L1.5a (docs/astro-theme-plan.md 3.6.2.2). The transform itself runs on
// Astro's compiler in the container; it is exercised by the container E2E.

describe("the Astro preview locate pass", () => {
  it("derives a fixed-format nonce per preview", () => {
    const nonce = astroPreviewMarkerNonce("preview-1");
    expect(nonce).toMatch(/^[0-9a-f]{16}$/);
    expect(astroPreviewMarkerNonce("preview-1")).toBe(nonce);
    expect(astroPreviewMarkerNonce("preview-2")).not.toBe(nonce);
    expect(
      ASTRO_PREVIEW_BOUNDARY_MARKER.test(`morph:s ${nonce}:0badf00d:12`),
    ).toBe(true);
    expect(ASTRO_PREVIEW_BOUNDARY_MARKER.test(`morph:s ${nonce}:x:1`)).toBe(
      false,
    );
  });

  it("hashes source text in UTF-16 units", () => {
    expect(astroPreviewSourceHash("")).toBe("811c9dc5");
    expect(astroPreviewSourceHash("😀")).not.toBe(astroPreviewSourceHash("😁"));
  });

  it("emits plugin source that evaluates, and refuses a malformed nonce", () => {
    const source = astroPreviewLocatePluginSource(astroPreviewMarkerNonce("p"));
    const plugin = new Function(
      "fs",
      "path",
      "workspaceRoot",
      `return ${source}`,
    )({}, {}, "/workspace") as { name: string; enforce: string; load: unknown };
    expect(plugin).toMatchObject({
      name: "morph:astro-preview-locate",
      enforce: "pre",
    });
    expect(typeof plugin.load).toBe("function");
    expect(() => astroPreviewLocatePluginSource('x"); evil();//')).toThrow();
  });

  it("is added to every Astro Live Preview's integration and client", () => {
    const result = planAstroPreviewWorkspace({
      files: [
        { path: "astro.config.mjs", content: "export default {};" },
        { path: "src/pages/index.astro", content: "<p>x</p>" },
      ],
      entry: "src/pages/index.astro",
      buildId: "preview-1",
      dependencies: {},
      approvedDependencies: [],
      mode: "preview-server",
    } as unknown as Parameters<typeof planAstroPreviewWorkspace>[0]);
    if (!result.ok) throw new Error(result.errorMessage);
    const text = (suffix: string) =>
      (
        result.workspaceFiles.find((entry) => entry.path.endsWith(suffix)) as
          { content?: string } | undefined
      )?.content ?? "";
    expect(text(".morph/astro-preview-integration.mjs")).toContain(
      "previewLocatePlugin,",
    );
    expect(text(THEME_PREVIEW_START_CLIENT_PATH)).toContain(
      `__morphPreviewSourceSelection = { nonce: "${astroPreviewMarkerNonce("preview-1")}" }`,
    );
  });
});
