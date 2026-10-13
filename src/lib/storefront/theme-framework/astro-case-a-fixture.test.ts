// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseColocatedContentFields } from "../ast/theme-content-fields-source";
import { materializeThemeBuildInput } from "../compiler/theme-build-materializer";
import type { StorefrontThemeBuildDTO } from "../dto/storefront-theme-build.dto";
import type { StorefrontThemeRevisionDTO } from "../dto/storefront-theme-file.dto";
import {
  CONTENT_WORKSPACE_PATH,
  astroWorkspaceFiles,
  caseAFixtureFiles,
  pureAstroViolations,
  withPlatformWiring,
} from "./content-read-fixtures.test-support";
import { planNativeAstroBuild } from "./astro-native-build";
import { planAstroPreviewWorkspace } from "./astro-preview-workspace";
import { themeToolchainForFramework } from "./theme-toolchains";

/**
 * The pure Astro Theme for case A (fixtures/morph/astro-case-a), read from
 * disk as committed: that it is pure Astro, that it is only what an author
 * writes (no reader, no middleware), and that the existing gates take it,
 * with the platform's wiring installed, unchanged. The shared core is
 * content-read-core.test.ts; the real preview and build are
 * local-vite-preview-server.content-read-parity.test.ts and
 * native-astro-case-a.build.test.ts.
 */

/** The files as a stored source revision, through the build materializer. */
function materialize(files: readonly { path: string; content: string }[]) {
  return materializeThemeBuildInput({
    build: {
      id: "case-a",
      storefrontId: "store",
      themeId: "theme",
      sourceRevisionId: "rev",
      status: "queued",
      inputHash: null,
      compilerId: null,
      compilerVersion: null,
      contentPublicationId: null,
      framework: "astro",
      inputHashFormat: 2,
      toolchainId: themeToolchainForFramework("astro").id,
    } as StorefrontThemeBuildDTO,
    revision: {
      id: "rev",
      storefrontId: "store",
      themeId: "theme",
      revisionNumber: 1,
      snapshot: files.map((file) => ({ path: file.path, content: file.content })),
    } as unknown as StorefrontThemeRevisionDTO,
    astroThemes: true,
  });
}

const files = caseAFixtureFiles();
const file = (path: string) => files.find((entry) => entry.path === path)!.content;

describe("the case A fixture is a pure Astro Theme", () => {
  it("is only the files an author writes, with case A's shape", () => {
    expect(files.map((entry) => entry.path)).toEqual([
      "astro.config.mjs",
      "package.json",
      "src/components/Hero.astro",
      "src/components/Hero.fields.ts",
      "src/pages/about.astro",
      "src/pages/index.astro",
      "wrangler.jsonc",
    ]);
    // Case A's shape, verbatim (content-binding-contract-design.md §6).
    expect(file("src/pages/index.astro")).toContain(
      'const home = await morph.pages.get("/");\nconst { hero } = home;',
    );
    expect(file("src/pages/index.astro")).toContain("<Hero {...hero} />");
    // The pages import `morph` from the module the platform installs.
    expect(file("src/pages/index.astro")).toContain('import { morph } from "../morph/content";');
    expect(file("astro.config.mjs")).not.toMatch(/\bintegrations\s*:/);
  });

  it("imports nothing but Theme files, Node built-ins, Astro and the Cloudflare adapter", () => {
    // With the platform's files, every import resolves.
    expect(pureAstroViolations(astroWorkspaceFiles())).toEqual([]);
    // Without them, the only unresolved import is the module it installs.
    expect(pureAstroViolations(files)).toEqual([
      `src/pages/about.astro: "../morph/content" is not a file of this Theme`,
      `src/pages/index.astro: "../morph/content" is not a file of this Theme`,
    ]);
  });

  it("is told apart from a project that is not pure Astro", () => {
    const withFile = (path: string, content: string) =>
      withPlatformWiring("astro", [...files.filter((entry) => entry.path !== path), { path, content }]);
    expect(
      pureAstroViolations(withFile("src/components/Island.tsx", "export default () => null;\n")),
    ).toEqual(["src/components/Island.tsx: not a file this framework's Theme is written in"]);
    // React is in the Astro toolchain, so the import guards would let it
    // through; pure Astro does not.
    expect(
      pureAstroViolations(
        withFile("src/components/Hero.astro", `---\nimport { useState } from "react";\n---\n<h1 />\n`),
      ),
    ).toEqual(['src/components/Hero.astro: imports "react" from package "react"']);
    expect(
      pureAstroViolations(withFile("src/pages/x.ts", 'const clsx = await import("clsx");\n')),
    ).toEqual(['src/pages/x.ts: imports "clsx" from package "clsx"']);
    expect(
      pureAstroViolations(withFile("src/pages/x.ts", 'export { a } from "../../outside";\n')),
    ).toEqual(['src/pages/x.ts: "../../outside" is not a file of this Theme']);
    expect(
      pureAstroViolations(
        withFile("package.json", '{ "dependencies": { "astro": "7.3.5", "@astrojs/react": "7.0.0" } }\n'),
      ),
    ).toEqual(['package.json: depends on "@astrojs/react"']);
  });

  it("refuses to install the platform's files over a Theme's own", () => {
    expect(() =>
      withPlatformWiring("astro", [...files, { path: CONTENT_WORKSPACE_PATH, content: "" }]),
    ).toThrow(`The Theme already has ${CONTENT_WORKSPACE_PATH}; the platform installs it.`);
  });

  it("passes the build materializer, the native build plan and the Live Preview plan unchanged", () => {
    const workspace = astroWorkspaceFiles();
    const input = materialize(workspace);
    expect(input.framework).toBe("astro");
    expect(input.files.map((entry) => entry.path).sort()).toEqual(
      workspace.map((entry) => entry.path).sort(),
    );
    const build = planNativeAstroBuild(workspace);
    expect(build.ok, build.ok ? "" : build.message).toBe(true);
    const preview = planAstroPreviewWorkspace({
      files: workspace,
      entry: "",
      buildId: "case-a",
      approvedDependencies: new Set(),
      mode: "preview-server",
    });
    expect(preview.ok, preview.ok ? "" : preview.errorMessage).toBe(true);
    // The one warning: the preview runs its own adapter call. The build needs
    // imageService "passthrough" (no Images binding), so the config keeps it.
    if (preview.ok) {
      expect(preview.previewWarnings).toEqual([
        {
          path: "astro.config.mjs",
          message: expect.stringMatching(/so imageService from this config do not apply/),
        },
      ]);
    }
  });

  it("declares Hero's fields in a sidecar the field parser reads", () => {
    expect(parseColocatedContentFields(file("src/components/Hero.fields.ts"))).toMatchObject({
      declaration: "valid",
      fields: { title: { type: "text" }, subtitle: { type: "text" } },
    });
  });
});
