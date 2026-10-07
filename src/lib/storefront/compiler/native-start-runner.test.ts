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
 * Morph's wrapper, without the snapshot reaching the Worker. Whether the CMS
 * marks the page SSG does not decide that; a content read the build cannot
 * answer fails the build rather than leaving defaults in static HTML.
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
  component: () => <><h1>{String(content('prerender-field').title || 'COMPONENT_DEFAULT')}</h1></>,
});
`;
/** A root that reads no content, and a page that reads none either. */
const PLAIN_ROOT = `import type { ReactNode } from "react";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({
  component: () => <Outlet />,
  shellComponent: ({ children }: { children: ReactNode }) => (
    <html lang="en"><head><HeadContent /></head><body>{children}<Scripts /></body></html>
  ),
});
`;
const PLAIN = `import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/plain')({
  component: () => <h1>plain-static-page</h1>,
});
`;

type Sealed = "none" | { renderPolicy: "ssg" | "ssr"; title?: string };

function nativeInput(
  buildId: string,
  prerenderPaths: readonly string[],
  sealed: Sealed,
  files: ThemeBuildRunnerInput["files"] = [],
): ThemeBuildRunnerInput {
  const own = new Map(files.map((file) => [file.path, file]));
  return {
    buildId,
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
      ...STARTER_THEME_FILES.filter((file) => !own.has(file.path)),
      { path: "src/routes/landing.tsx", content: LANDING },
      { path: "vite.config.ts", content: OWN_VITE_CONFIG(prerenderPaths) },
      { path: "wrangler.jsonc", content: OWN_WRANGLER },
      ...files,
    ],
    ...(sealed === "none"
      ? {}
      : {
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
                      props:
                        sealed.title === undefined
                          ? {}
                          : { title: sealed.title },
                    },
                  ],
                  renderPolicy: { mode: sealed.renderPolicy },
                },
              },
            ],
          } as never,
        }),
  };
}

const text = (content: string | Uint8Array | undefined) =>
  typeof content === "string" ? content : new TextDecoder().decode(content);

const run = (input: ThemeBuildRunnerInput) =>
  new LocalViteThemeBuildRunner({ maxDurationMs: 200_000 }).run(input);

const page = (
  result: Awaited<ReturnType<typeof run>>,
  path: string,
): string | undefined => {
  if (!result.success) throw new Error(result.errorMessage);
  const file = result.artifacts.find(
    (artifact) => artifact.path === `runtime/client${path}/index.html`,
  );
  return file ? text(file.content) : undefined;
};

describe("a native Start build in the build runner", () => {
  it(
    "prerenders with the build's frozen content, by the project's own config",
    { timeout: 240_000 },
    async () => {
      const result = await run(
        nativeInput("native-runner", ["/landing"], {
          renderPolicy: "ssg",
          title: "native-sealed-sentinel",
        }),
      );
      const html = page(result, "/landing");
      expect(html).toContain("<h1>native-sealed-sentinel</h1>");
      expect(html).not.toContain("COMPONENT_DEFAULT");
      if (!result.success) return;

      // Described as the native artifact it is, previewed by its Worker.
      expect(result.manifestJson.artifactEntry).toBe("runtime/server/index.js");
      expect(result.manifestJson.metadata).toMatchObject({
        build: "native",
        runtime: "cloudflare-worker",
        workerEntry: "runtime/server/index.js",
      });
      expect(result.manifestJson.metadata).not.toHaveProperty("previewEntry");

      // The snapshot, the wrapper, Morph's config copy and the prerender's
      // record stay out of it.
      const paths = result.artifacts.map((file) => file.path);
      expect(paths.some((path) => path.includes("prerender-content"))).toBe(
        false,
      );
      expect(paths.some((path) => path.includes("prerender-refused"))).toBe(
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
    "prerenders a page the CMS marks SSR with the sealed content too",
    { timeout: 240_000 },
    async () => {
      // The project prerenders it; the CMS policy does not get a say in
      // whether the sealed content reaches that page.
      const html = page(
        await run(
          nativeInput("native-runner-ssr-policy", ["/landing"], {
            renderPolicy: "ssr",
            title: "native-sealed-under-ssr",
          }),
        ),
        "/landing",
      );
      expect(html).toContain("<h1>native-sealed-under-ssr</h1>");
      expect(html).not.toContain("COMPONENT_DEFAULT");
    },
  );

  it(
    "keeps a field's own default when the sealed content has no value for it",
    { timeout: 240_000 },
    async () => {
      // Sealed, with the section present but no title: the component's
      // default is the right answer, as it is on the storefront.
      const html = page(
        await run(
          nativeInput("native-runner-empty-field", ["/landing"], {
            renderPolicy: "ssr",
          }),
        ),
        "/landing",
      );
      expect(html).toContain("<h1>COMPONENT_DEFAULT</h1>");
    },
  );

  it(
    "fails when a prerendered page reads content and the build has none sealed",
    { timeout: 240_000 },
    async () => {
      const result = await run(
        nativeInput("native-runner-unsealed", ["/landing"], "none"),
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.diagnosticsJson?.stage).toBe("prerender-content");
      expect(result.errorMessage).toContain(
        "NATIVE_PRERENDER_CONTENT_UNAVAILABLE",
      );
      expect(result.errorMessage).toContain(
        "/landing (NATIVE_PRERENDER_NO_CONTENT_SNAPSHOT",
      );
    },
  );

  it(
    "builds a prerendered page that reads no content, with nothing sealed",
    { timeout: 240_000 },
    async () => {
      const html = page(
        await run(
          nativeInput("native-runner-plain", ["/plain"], "none", [
            { path: "src/routes/__root.tsx", content: PLAIN_ROOT },
            { path: "src/routes/plain.tsx", content: PLAIN },
          ]),
        ),
        "/plain",
      );
      expect(html).toContain("<h1>plain-static-page</h1>");
    },
  );

  it(
    "is refused when the project's config does not prerender a page its content requires",
    { timeout: 240_000 },
    async () => {
      const result = await run(
        nativeInput("native-runner-missing", [], {
          renderPolicy: "ssg",
          title: "native-sealed-sentinel",
        }),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.diagnosticsJson?.stage).toBe("artifact-verification");
      }
    },
  );
});
