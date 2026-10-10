import { describe, expect, it } from "vitest";

import { THEME_PREVIEW_BRIDGE_PATH } from "../compiler/theme-preview-bridge-entry";
import {
  THEME_PREVIEW_START_CLIENT_PATH,
  THEME_PREVIEW_START_WORKER_PATH,
} from "../compiler/theme-preview-start-runtime";
import type { PlanThemeWorkspaceInput } from "../compiler/theme-sandbox-workspace";
import { astroConfig, astroThemeFiles } from "./astro-native-prerender.fixtures";
import {
  ASTRO_PREVIEW_CONFIG_PATH,
  ASTRO_PREVIEW_DEV_SERVER,
  ASTRO_PREVIEW_INTEGRATION_PATH,
  ASTRO_PREVIEW_WRANGLER_PATH,
  planAstroPreviewWorkspace,
} from "./astro-preview-workspace";

const input = (
  files: PlanThemeWorkspaceInput["files"],
  overrides: Partial<PlanThemeWorkspaceInput> = {},
): PlanThemeWorkspaceInput => ({
  files,
  entry: null,
  buildId: "preview-1",
  approvedDependencies: new Set(),
  mode: "preview-server",
  ...overrides,
});

const planned = (files: PlanThemeWorkspaceInput["files"]) => {
  const plan = planAstroPreviewWorkspace(input(files));
  if (!plan.ok) throw new Error(plan.errorMessage);
  return {
    plan,
    file: (path: string) =>
      (
        plan.workspaceFiles.find((file) => file.path === `/workspace/${path}`) as
          | { content: string }
          | undefined
      )?.content,
  };
};

describe("an Astro Live Preview workspace", () => {
  it("is the project's files unchanged, plus Morph's own beside them", () => {
    const files = astroThemeFiles();
    const { plan, file } = planned(files);
    for (const authored of files) {
      expect(file(authored.path), authored.path).toBe(authored.content);
    }
    for (const path of [
      ASTRO_PREVIEW_CONFIG_PATH,
      ASTRO_PREVIEW_INTEGRATION_PATH,
      ASTRO_PREVIEW_WRANGLER_PATH,
      THEME_PREVIEW_START_WORKER_PATH,
      THEME_PREVIEW_START_CLIENT_PATH,
      THEME_PREVIEW_BRIDGE_PATH,
    ]) {
      expect(file(path), path).toBeTruthy();
    }
    expect(plan.workspaceFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("imports the project's config and replaces only the adapter, for the preview", () => {
    const { file } = planned(astroThemeFiles());
    const wrapper = file(ASTRO_PREVIEW_CONFIG_PATH)!;
    expect(wrapper).toContain('import themeConfig from "../astro.config.mjs";');
    expect(wrapper).toContain(
      "cloudflare({ inspectorPort: false, persistState: false, remoteBindings: false })",
    );
    expect(wrapper).toContain("devToolbar: { enabled: false }");
    expect(wrapper).toContain("morphAstroPreview()");
  });

  it("enters through the preview Worker entry wrapping Astro's own server entry", () => {
    const { file } = planned(astroThemeFiles());
    expect(JSON.parse(file(ASTRO_PREVIEW_WRANGLER_PATH)!)).toMatchObject({
      main: `../${THEME_PREVIEW_START_WORKER_PATH}`,
    });
    expect(JSON.parse(file(ASTRO_PREVIEW_WRANGLER_PATH)!)).not.toHaveProperty(
      "kv_namespaces",
    );
    expect(file(THEME_PREVIEW_START_WORKER_PATH)).toContain(
      'import startEntry from "@astrojs/cloudflare/entrypoints/server";',
    );
    // The dev server finds that config the way the Cloudflare plugin reads it.
    expect(ASTRO_PREVIEW_DEV_SERVER.env).toMatchObject({
      CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: ASTRO_PREVIEW_WRANGLER_PATH,
      ASTRO_TELEMETRY_DISABLED: "1",
    });
  });

  it("loads the bridge as a document, with no router", () => {
    const client = planned(astroThemeFiles()).file(THEME_PREVIEW_START_CLIENT_PATH)!;
    expect(client).toContain("DOMContentLoaded");
    expect(client).not.toContain("__TSR_ROUTER__");
    expect(client).not.toContain("__morphPreviewRouter");
  });

  it("guards imports, relays HMR over HTTP and states what the dev server may read", () => {
    const integration = planned(astroThemeFiles()).file(
      ASTRO_PREVIEW_INTEGRATION_PATH,
    )!;
    expect(integration).toContain("morph:astro-preview-import-guard");
    expect(integration).toContain('name: "morph-preview-http-hmr"');
    expect(integration).toContain("fs: { strict: true, allow: [");
    expect(integration).toContain('"astro"');
    // Never the shared toolchain's own cache.
    expect(integration).toContain(
      'const depsCacheDir = path.join(workspaceRoot, ".vite");',
    );
    expect(integration).toContain("cacheDir: depsCacheDir,");
  });

  it("is refused without exactly one Astro config, and for a build", () => {
    const withoutConfig = astroThemeFiles().filter(
      (file) => file.path !== "astro.config.mjs",
    );
    expect(planAstroPreviewWorkspace(input(withoutConfig))).toMatchObject({
      ok: false,
      errorMessage: expect.stringMatching(/^NATIVE_ASTRO_CONFIG: /),
    });
    expect(
      planAstroPreviewWorkspace(
        input([...astroThemeFiles(), { path: "astro.config.ts", content: "" }]),
      ),
    ).toMatchObject({ ok: false });
    expect(
      planAstroPreviewWorkspace(input(astroThemeFiles(), { mode: "build" })),
    ).toMatchObject({ ok: false });
  });

  it("never lets an authored file stand in for one Morph writes", () => {
    expect(
      planAstroPreviewWorkspace(
        input([
          ...astroThemeFiles(),
          { path: THEME_PREVIEW_START_WORKER_PATH, content: "export default {}" },
        ]),
      ),
    ).toMatchObject({
      ok: false,
      errorMessage: expect.stringMatching(/^NATIVE_RESERVED_PATH: /),
    });
  });

  it("says which adapter options the preview does not carry over", () => {
    const plan = planAstroPreviewWorkspace(
      input(
        astroThemeFiles({
          config: astroConfig().replace(
            'imageService: "passthrough"',
            'imageService: "compile"',
          ),
        }),
      ),
    );
    expect(plan.ok && plan.previewWarnings).toEqual([
      expect.objectContaining({
        path: "astro.config.mjs",
        message: expect.stringContaining("imageService"),
      }),
    ]);
  });

  it("changes its fingerprint with any byte of the project", () => {
    const one = planned(astroThemeFiles()).plan.workspaceFingerprint;
    const two = planned(
      astroThemeFiles({ extra: [{ path: "src/pages/x.astro", content: "<p/>" }] }),
    ).plan.workspaceFingerprint;
    expect(one).not.toBe(two);
  });
});
