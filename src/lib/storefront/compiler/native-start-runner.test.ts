// @vitest-environment node
import { describe, expect, it } from "vitest";
import { STARTER_THEME_FILES } from "../starter-theme-files";
import { NATIVE_START_COMPILER_ID } from "./theme-build-materializer";
import { LocalViteThemeBuildRunner } from "./local-vite-theme-build-runner";
import type { ThemeBuildRunnerInput } from "./theme-build-runner.types";
import { THEME_START_TOOLCHAIN } from "./theme-start-toolchain";

/**
 * A native Start build through the build runner, for real: the project's own
 * vite.config.ts decides what is prerendered, and the prerendered page reads
 * the build's frozen content — not drafts, not component defaults — through
 * Morph's wrapper, without the snapshot reaching the Worker.
 */
const OWN_VITE_CONFIG = (prerenderPaths: readonly string[]) => `
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart({
      prerender: { enabled: true, crawlLinks: false, autoStaticPathsDiscovery: false },
      pages: ${JSON.stringify(prerenderPaths.map((path) => ({ path })))},
    }),
    viteReact(),
  ],
});
`;
const OWN_WRANGLER = `{
  "name": "native-runner",
  "compatibility_date": "2025-09-02",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry",
}`;
const LANDING = `import { createFileRoute } from '@tanstack/react-router';
import { content } from '../morph/content';
export const Route = createFileRoute('/landing')({
  component: () => <><h1>{String(content('prerender-field').title || 'WRONG_DEFAULT')}</h1></>,
});
`;

function nativeInput(prerenderPaths: readonly string[]): ThemeBuildRunnerInput {
  return {
    buildId: "native-runner",
    storefrontId: "store",
    themeId: "theme",
    sourceRevisionId: "source",
    revisionNumber: 1,
    entry: "src/routes/index.tsx",
    inputHash: "b".repeat(64),
    compilerId: NATIVE_START_COMPILER_ID,
    compilerVersion: THEME_START_TOOLCHAIN.reactStart,
    buildMode: "native",
    files: [
      ...STARTER_THEME_FILES,
      { path: "src/routes/landing.tsx", content: LANDING },
      { path: "vite.config.ts", content: OWN_VITE_CONFIG(prerenderPaths) },
      { path: "wrangler.jsonc", content: OWN_WRANGLER },
    ],
    contentSnapshot: {
      publicationId: "pub",
      storefrontId: "store",
      themeId: "theme",
      documents: [
        {
          item: {
            id: "item",
            publicationId: "pub",
            itemType: "template",
            contentId: "page",
            revisionId: "revision",
            metadata: { routePath: "/landing" },
          },
          document: {
            version: 1,
            sections: [
              {
                id: "prerender-field",
                type: "hero",
                enabled: true,
                props: { title: "native-sealed-sentinel" },
              },
            ],
            renderPolicy: { mode: "ssg" },
          },
        },
      ],
    } as never,
  };
}

const text = (content: string | Uint8Array | undefined) =>
  typeof content === "string" ? content : new TextDecoder().decode(content);

describe("a native Start build in the build runner", () => {
  it(
    "prerenders with the build's frozen content, by the project's own config",
    { timeout: 240_000 },
    async () => {
      const result = await new LocalViteThemeBuildRunner({
        maxDurationMs: 200_000,
      }).run(nativeInput(["/landing"]));
      if (!result.success) throw new Error(result.errorMessage);

      const page = result.artifacts.find(
        (file) => file.path === "runtime/client/landing/index.html",
      );
      expect(text(page?.content)).toContain("<h1>native-sealed-sentinel</h1>");
      expect(text(page?.content)).not.toContain("WRONG_DEFAULT");

      // Described as the native artifact it is, previewed by its Worker.
      expect(result.manifestJson.artifactEntry).toBe("runtime/server/index.js");
      expect(result.manifestJson.metadata).toMatchObject({
        build: "native",
        runtime: "cloudflare-worker",
        workerEntry: "runtime/server/index.js",
      });
      expect(result.manifestJson.metadata).not.toHaveProperty("previewEntry");

      // The snapshot, the wrapper and Morph's config copy stay out of it.
      const paths = result.artifacts.map((file) => file.path);
      expect(paths.some((path) => path.includes("prerender-content"))).toBe(
        false,
      );
      expect(paths.some((path) => path.includes(".morph/"))).toBe(false);
      const server = result.artifacts
        .filter((file) => file.path.startsWith("runtime/server/"))
        .map((file) => text(file.content))
        .join("\n");
      expect(server).not.toContain("native-sealed-sentinel");
      expect(server).not.toContain("morph:native-import-guard");
    },
  );

  it(
    "is refused when the project's config does not prerender a page its content requires",
    { timeout: 240_000 },
    async () => {
      const result = await new LocalViteThemeBuildRunner({
        maxDurationMs: 200_000,
      }).run({ ...nativeInput([]), buildId: "native-runner-missing" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.diagnosticsJson?.stage).toBe("artifact-verification");
      }
    },
  );
});
