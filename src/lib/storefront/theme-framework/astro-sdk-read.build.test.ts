// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createNativePrerenderContent } from "../compiler/theme-prerender-content";
import {
  astroPrerenderRecordsFailure,
  astroRouteRegistry,
} from "./astro-native-prerender";
import {
  VALUE_DEFAULT,
  VALUE_DRAFT,
  VALUE_SEALED,
  astroThemeFiles,
  sealedSnapshot,
} from "./astro-native-prerender.fixtures";
import {
  astroToolchainInstalled,
  runAstroPrerenderBuild,
  text,
} from "./astro-native-prerender.test-support";

/**
 * `@morph/sdk/astro` in a real `astro build` (ROADMAP 1.2's Astro pattern,
 * M2): the author's frontmatter reads with `morph.pages.get(...)` and spreads
 * the section, and writes nothing else — no middleware, no reader. The
 * platform's integration adds its own middleware with `addMiddleware`, so
 * the read gets the source the build names: the sealed snapshot.
 */
const missingToolchain = !astroToolchainInstalled;
if (missingToolchain && process.env.CI) {
  throw new Error(
    "The Astro toolchain is not installed; CI installs it with pnpm toolchain:astro.",
  );
}

const BUILD = { timeout: 240_000 };

/** The Astro case of ROADMAP 1.2, as an author writes it. */
const sdkPage = (path: string) => `---
import { morph } from "@morph/sdk/astro";
import Hero from "../components/Hero.astro";
export const prerender = true;
const home = await morph.pages.get(${JSON.stringify(path)});
const { hero } = home;
---
<html><body><Hero {...hero} /></body></html>
`;

function sdkThemeFiles(home = sdkPage("/"), about = sdkPage("/about")) {
  return astroThemeFiles({
    pages: [],
    extra: [
      { path: "src/pages/index.astro", content: home },
      { path: "src/pages/about.astro", content: about },
    ],
  }).filter((file) => file.path !== "src/pages/ssr.astro");
}

async function build(files: ReturnType<typeof sdkThemeFiles>) {
  const registry = astroRouteRegistry(files);
  const prerenderContent = await createNativePrerenderContent(
    sealedSnapshot(
      registry.routes
        .filter((route) => !route.dynamic && route.path !== "/")
        .map((route) => route.path),
    ),
    registry,
  );
  const run = await runAstroPrerenderBuild({ files, prerenderContent });
  const failure =
    run.exitCode === 0
      ? astroPrerenderRecordsFailure(run.outputs, run.nonce)
      : null;
  return { ...run, failure };
}

describe.skipIf(missingToolchain)(
  "@morph/sdk/astro in a real Astro build",
  () => {
    it(
      "the home page and a non-home route read their sealed content with morph.pages.get, through the platform's middleware",
      BUILD,
      async () => {
        const files = sdkThemeFiles();
        // The author wrote no middleware and no reader of their own.
        expect(files.some((file) => file.path === "src/middleware.ts")).toBe(
          false,
        );

        const run = await build(files);

        expect(run.exitCode, run.output).toBe(0);
        expect(run.failure).toBeNull();
        for (const page of ["index.html", "about/index.html"]) {
          const html = text(run.outputs.get(`dist/client/${page}`));
          expect(html).toContain(VALUE_SEALED);
          expect(html).not.toContain(VALUE_DEFAULT);
          expect(html).not.toContain(VALUE_DRAFT);
        }
      },
    );

    it(
      "a read the sealed content does not hold fails the build; it never renders the default",
      BUILD,
      async () => {
        const run = await build(
          sdkThemeFiles(sdkPage("/"), sdkPage("/not-published")),
        );

        expect(run.exitCode === 0 && run.failure === null).toBe(false);
        const html = text(run.outputs.get("dist/client/about/index.html"));
        expect(html ?? "").not.toContain(VALUE_DEFAULT);
      },
    );
  },
);
