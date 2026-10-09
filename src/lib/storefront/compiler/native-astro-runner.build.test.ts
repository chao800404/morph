// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { StorefrontThemeBuildDTO } from "../dto/storefront-theme-build.dto";
import type { StorefrontThemeRevisionDTO } from "../dto/storefront-theme-file.dto";
import {
  VALUE_DEFAULT,
  VALUE_SEALED,
  astroConfig,
  astroThemeFiles,
  sealedSnapshot,
} from "../theme-framework/astro-native-prerender.fixtures";
import { astroToolchainInstalled } from "../theme-framework/astro-native-prerender.test-support";
import { themeToolchainForFramework } from "../theme-framework/theme-toolchains";
import { LocalViteThemeBuildRunner } from "./local-vite-theme-build-runner";
import { materializeThemeBuildInput } from "./theme-build-materializer";
import type { ThemeBuildRunnerResult } from "./theme-build-runner.types";

/**
 * A native Astro build through the build runner, for real (docs/astro-theme-plan.md
 * A4): the input as the materializer makes it, the pinned Astro toolchain,
 * the two passes that prove whether the artifact depends on content, the
 * records decided by `nativeBuildResult`, and the artifact collected by the
 * 5.2 rules. The toolchain check is astro-native-prerender.build.test.ts's.
 */
const BUILD = { timeout: 300_000 };

type Files = ReturnType<typeof astroThemeFiles>;

function astroInput(
  id: string,
  files: Files,
  sealed: readonly string[] | null,
) {
  const snapshot = sealed ? sealedSnapshot(sealed) : undefined;
  return materializeThemeBuildInput({
    build: {
      id,
      storefrontId: "store",
      themeId: "theme",
      sourceRevisionId: "rev",
      status: "queued",
      inputHash: null,
      compilerId: null,
      compilerVersion: null,
      contentPublicationId: snapshot?.publicationId ?? null,
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
    ...(snapshot
      ? {
          contentSnapshot: {
            ...snapshot,
            storefrontId: "store",
            themeId: "theme",
          },
        }
      : {}),
    astroThemes: true,
  });
}

const run = (
  input: ReturnType<typeof astroInput>,
  options: { astroThemes?: boolean } = { astroThemes: true },
) =>
  new LocalViteThemeBuildRunner({
    maxDurationMs: 240_000,
    ...options,
  }).run(input);

const text = (content: string | Uint8Array | undefined) =>
  content === undefined
    ? undefined
    : typeof content === "string"
      ? content
      : new TextDecoder().decode(content);

const file = (result: ThemeBuildRunnerResult, path: string) => {
  if (!result.success) throw new Error(result.errorMessage);
  return text(result.artifacts.find((artifact) => artifact.path === path)?.content);
};

describe.skipIf(!astroToolchainInstalled)("a native Astro build in the build runner", () => {
  it(
    "prerenders the sealed content and proves the artifact depends on it",
    BUILD,
    async () => {
      const result = await run(
        astroInput("astro-runner", astroThemeFiles({ plain: true }), ["/about"]),
      );
      if (!result.success) throw new Error(result.errorMessage);
      // The first pass, with no content, stopped on a read; the second sealed it.
      expect(result.contentDependency).toBe("dependent");
      for (const page of ["runtime/client/index.html", "runtime/client/about/index.html"]) {
        expect(file(result, page)).toContain(VALUE_SEALED);
        expect(file(result, page)).not.toContain(VALUE_DEFAULT);
      }
      expect(result.manifestJson.artifactEntry).toBe("runtime/server/entry.mjs");
      expect(result.manifestJson.metadata).toMatchObject({
        framework: "astro",
        build: "native",
        runtime: "cloudflare-worker",
        workerEntry: "runtime/server/entry.mjs",
      });
      const paths = result.artifacts.map((artifact) => artifact.path);
      expect(paths).toContain("runtime/server/entry.mjs");
      expect(paths.some((path) => path.includes(".morph"))).toBe(false);
      expect(paths.some((path) => path.includes(".prerender"))).toBe(false);
      const server = result.artifacts
        .filter((artifact) => artifact.path.startsWith("runtime/server/"))
        .map((artifact) => text(artifact.content))
        .join("\n");
      expect(server).not.toContain(VALUE_SEALED);
      expect(server).not.toContain("__MORPH_ASTRO_PRERENDER_WRAPPER__");
    },
  );

  it(
    "proves an artifact independent when nothing prerendered reads content",
    BUILD,
    async () => {
      const files = astroThemeFiles({ pages: [], plain: true });
      const result = await run(astroInput("astro-runner-plain", files, ["/plain"]));
      if (!result.success) throw new Error(result.errorMessage);
      expect(result.contentDependency).toBe("independent");
      expect(file(result, "runtime/client/plain/index.html")).toContain(
        "A3-PLAIN-PAGE",
      );
    },
  );

  it(
    "fails when a prerendered page reads content and nothing is sealed",
    BUILD,
    async () => {
      const result = await run(
        astroInput("astro-runner-unsealed", astroThemeFiles(), null),
      );
      expect(result).toMatchObject({
        success: false,
        diagnosticsJson: { stage: "prerender-content" },
      });
      if (!result.success) {
        expect(result.errorMessage).toMatch(
          /^NATIVE_PRERENDER_CONTENT_UNAVAILABLE: .*NATIVE_PRERENDER_NO_CONTENT_SNAPSHOT/,
        );
      }
    },
  );

  it(
    "is refused for the adapter's default SESSION binding, by name",
    BUILD,
    async () => {
      // The adapter's defaults, as an official example ships them: no
      // `session: false`, so the build adds a SESSION KV binding.
      const config = `import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
  devToolbar: { enabled: false },
  telemetry: false,
});
`;
      const result = await run(
        astroInput("astro-runner-session", astroThemeFiles({ config, pages: [], plain: true }), null),
      );
      expect(result).toMatchObject({
        success: false,
        diagnosticsJson: { stage: "output-collection" },
      });
      if (!result.success) {
        expect(result.errorMessage).toMatch(/^ASTRO_SESSION_BINDING_UNSUPPORTED: /);
      }
    },
  );

  it(
    "is refused for a package the toolchain does not approve",
    BUILD,
    async () => {
      // Installed in the toolchain (Astro depends on it), not approved.
      const page = `---
import { z } from "zod";
export const prerender = true;
const ok = z.string().parse("x");
---
<p>{ok}</p>
`;
      const result = await run(
        astroInput(
          "astro-runner-guard",
          astroThemeFiles({
            pages: [],
            extra: [{ path: "src/pages/zod.astro", content: page }],
          }),
          null,
        ),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorMessage).toContain(
          'UNAPPROVED_DEPENDENCY: Theme imports "zod"',
        );
      }
    },
  );

  it(
    "builds a project with no Wrangler config, on the adapter's defaults",
    BUILD,
    async () => {
      const files = astroThemeFiles().filter(
        (entry) => entry.path !== "wrangler.jsonc",
      );
      const result = await run(
        astroInput("astro-runner-no-wrangler", files, ["/about"]),
      );
      if (!result.success) throw new Error(result.errorMessage);
      expect(file(result, "runtime/client/about/index.html")).toContain(
        VALUE_SEALED,
      );
      const worker = JSON.parse(file(result, "runtime/server/wrangler.json")!) as {
        main?: string;
        compatibility_date?: string;
      };
      expect(worker.main).toBe("entry.mjs");
      expect(worker.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Miniflare's state from the prerender stays in the workspace.
      expect(
        result.artifacts.some((artifact) => artifact.path.includes(".wrangler")),
      ).toBe(false);
    },
  );

  it(
    "is refused for a file outside the workspace",
    BUILD,
    async () => {
      // From src/pages/ in the runner's workspace (.morph-builds/<pass>/),
      // four levels up is this checkout's own package.json.
      const page = `---
import pkg from "../../../../package.json";
export const prerender = true;
---
<p>{pkg.name}</p>
`;
      const result = await run(
        astroInput(
          "astro-runner-escape",
          astroThemeFiles({
            pages: [],
            extra: [{ path: "src/pages/escape.astro", content: page }],
          }),
          null,
        ),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorMessage).toContain(
          'WORKSPACE_PATH_ESCAPE: Import "../../../../package.json" resolves outside the Theme.',
        );
      }
    },
  );

  it(
    "lets Astro's own virtual modules through the import guard",
    BUILD,
    async () => {
      const page = `---
import { getImage } from "astro:assets";
import { defineMiddleware } from "astro:middleware";
export const prerender = true;
const kinds = [typeof getImage, typeof defineMiddleware].join(",");
---
<p>virtual:{kinds}</p>
`;
      const result = await run(
        astroInput(
          "astro-runner-virtual",
          astroThemeFiles({
            pages: [],
            extra: [{ path: "src/pages/virtual.astro", content: page }],
          }),
          null,
        ),
      );
      expect(file(result, "runtime/client/virtual/index.html")).toContain(
        "virtual:function,function",
      );
    },
  );

  it(
    "is refused without the server's Astro switch, before any workspace",
    BUILD,
    async () => {
      const result = await run(
        astroInput("astro-runner-off", astroThemeFiles(), ["/about"]),
        {},
      );
      expect(result).toMatchObject({
        success: false,
        diagnosticsJson: { stage: "framework" },
      });
    },
  );

  it(
    "keeps trailingSlash the author chose, with the sealed content",
    BUILD,
    async () => {
      const result = await run(
        astroInput(
          "astro-runner-always",
          astroThemeFiles({ config: astroConfig('trailingSlash: "always",') }),
          ["/about"],
        ),
      );
      expect(file(result, "runtime/client/about/index.html")).toContain(VALUE_SEALED);
    },
  );
});
