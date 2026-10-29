// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { StorefrontThemeBuildDTO } from "../dto/storefront-theme-build.dto";
import type { StorefrontThemeRevisionDTO } from "../dto/storefront-theme-file.dto";
import { astroWorkspaceFiles } from "../theme-framework/content-read-fixtures.test-support";
import { astroToolchainInstalled } from "../theme-framework/astro-native-prerender.test-support";
import { themeToolchainForFramework } from "../theme-framework/theme-toolchains";
import { LocalViteThemeBuildRunner } from "./local-vite-theme-build-runner";
import { materializeThemeBuildInput } from "./theme-build-materializer";
import type { ThemeBuildRunnerResult } from "./theme-build-runner.types";

/**
 * VALIDATION LEVEL: real framework run (astro build, prerender in workerd).
 * Not production Cloudflare: the built Worker is not run.
 *
 * The pure Astro Theme for case A (fixtures/morph/astro-case-a) through the
 * build runner, as native-astro-runner.build.test.ts builds an Astro Theme:
 * the materializer, the pinned Astro toolchain, Morph's build integration and
 * import guard, the two content passes. Nothing is changed for the fixture.
 *
 * `/` is server-rendered and `/about` prerendered, each reading its own page
 * with `morph.pages.get` through the one TEST PROTOTYPE core
 * (fixtures/morph/content-read-core). The Theme has no src/middleware.ts: the
 * platform wiring's integration adds the middleware with Astro's
 * addMiddleware.
 */
const BUILD = { timeout: 300_000 };
const SEALED = { title: "CASE-A-SEALED-TITLE", subtitle: "CASE-A-SEALED-SUBTITLE" };

function sealedContent() {
  const hero = { id: "hero", type: "hero", enabled: true, props: SEALED };
  return {
    publicationId: "pub",
    storefrontId: "store",
    themeId: "theme",
    documents: [
      {
        item: {
          id: "item-index",
          publicationId: "pub",
          itemType: "template",
          contentId: "index",
          revisionId: "revision",
          metadata: { templateType: "index" },
        },
        document: { version: 1, sections: [hero] },
      },
      {
        item: {
          id: "item-about",
          publicationId: "pub",
          itemType: "template",
          contentId: "page-about",
          revisionId: "revision",
          metadata: { routePath: "/about" },
        },
        document: { version: 1, sections: [hero] },
      },
    ],
  };
}

function caseAInput(id: string, files: readonly { path: string; content: string }[]) {
  const contentSnapshot = sealedContent();
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
      contentPublicationId: contentSnapshot.publicationId,
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
    contentSnapshot: contentSnapshot as never,
    astroThemes: true,
  });
}

const run = (input: ReturnType<typeof caseAInput>) =>
  new LocalViteThemeBuildRunner({ maxDurationMs: 240_000, astroThemes: true }).run(input);

const text = (result: ThemeBuildRunnerResult, path: string) => {
  if (!result.success) throw new Error(result.errorMessage);
  const content = result.artifacts.find((artifact) => artifact.path === path)?.content;
  return content === undefined
    ? undefined
    : typeof content === "string"
      ? content
      : new TextDecoder().decode(content);
};

describe.skipIf(!astroToolchainInstalled)("the case A Astro Theme in a native build", () => {
  it(
    "builds unchanged, and prerenders /about from its sealed content through the reader",
    BUILD,
    async () => {
      const result = await run(caseAInput("case-a", astroWorkspaceFiles()));
      if (!result.success) throw new Error(result.errorMessage);
      // The first pass, with no content, stopped on /about's read (Morph's
      // prerender wrapper records it, whatever the reader does with it); the
      // second sealed it.
      expect(result.contentDependency).toBe("dependent");
      const about = text(result, "runtime/client/about/index.html");
      expect(about).toContain(SEALED.title);
      expect(about).toContain(SEALED.subtitle);
      expect(about).not.toContain("CASE-A-DEFAULT-");
      // `/` is server-rendered: no HTML for it at build time, a Worker entry.
      expect(text(result, "runtime/client/index.html")).toBeUndefined();
      expect(result.manifestJson.artifactEntry).toBe("runtime/server/entry.mjs");
    },
  );

  it(
    "fails, never with the component defaults, when nothing adds the platform's middleware",
    BUILD,
    async () => {
      // The reverse of the case above: the same files without the
      // integration. The core gets no request, refuses, and the prerender of
      // /about fails the build. What made the first case read is the
      // integration's addMiddleware, not something the Theme wrote.
      const result = await run(
        caseAInput("case-a-no-wiring", astroWorkspaceFiles({ integration: false })),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorMessage).toContain(
          "No content source: morph.pages.get ran outside a request the platform wired.",
        );
      }
    },
  );

  it(
    "is refused by the same import guard when one of its files imports an unapproved package",
    BUILD,
    async () => {
      // The reverse of the case above: the guard is on this fixture's path.
      // zod is installed in the Astro toolchain (Astro depends on it) and is
      // not approved.
      const files = astroWorkspaceFiles().map((file) =>
        file.path === "src/components/Hero.astro"
          ? {
              ...file,
              content: file.content.replace(
                "---\ninterface Props",
                '---\nimport { z } from "zod";\nz.string();\ninterface Props',
              ),
            }
          : file,
      );
      expect(files.find((file) => file.path === "src/components/Hero.astro")!.content).toContain(
        'from "zod"',
      );
      const result = await run(caseAInput("case-a-guard", files));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorMessage).toContain('UNAPPROVED_DEPENDENCY: Theme imports "zod"');
      }
    },
  );
});
