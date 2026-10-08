// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createNativePrerenderContent } from "../compiler/theme-prerender-content";
import {
  astroPrerenderRecordsFailure,
  astroRouteRegistry,
} from "./astro-native-prerender";
import {
  DYNAMIC_READING_PAGE,
  READING_PAGES,
  VALUE_DEFAULT,
  VALUE_SEALED,
  astroConfig,
  astroThemeFiles,
  sealedSnapshot,
} from "./astro-native-prerender.fixtures";
import {
  astroToolchainInstalled,
  runAstroPrerenderBuild,
  text,
} from "./astro-native-prerender.test-support";

/**
 * Path and content key agreement for Astro prerendering
 * (docs/astro-theme-plan.md 4.3, 路徑與內容鍵的對應): whatever Astro's
 * `trailingSlash` and `build.format`, the path a page reads with, the sealed
 * content's key and Core's runtime key are one, through Core's own
 * `normalizeRoutePath`. The toolchain check is the other build test file's.
 */
const BUILD = { timeout: 240_000 };

async function build(files: ReturnType<typeof astroThemeFiles>) {
  const registry = astroRouteRegistry(files);
  const run = await runAstroPrerenderBuild({
    files,
    prerenderContent: await createNativePrerenderContent(
      sealedSnapshot(
        registry.routes
          .filter((route) => !route.dynamic && route.path !== "/")
          .map((route) => route.path),
      ),
      registry,
    ),
  });
  return {
    ...run,
    failure:
      run.exitCode === 0
        ? astroPrerenderRecordsFailure(run.outputs, run.nonce)
        : null,
  };
}

const ALL_PAGES = Object.values(READING_PAGES);
const CHINESE = encodeURIComponent("關於");

describe.skipIf(!astroToolchainInstalled)(
  "an Astro build's content paths",
  () => {
    const layouts = [
      {
        name: 'trailingSlash "ignore" (the default)',
        config: astroConfig(),
        files: ["index.html", "about/index.html", `${"關於"}/index.html`],
      },
      {
        name: 'trailingSlash "always"',
        config: astroConfig('trailingSlash: "always",'),
        files: ["index.html", "about/index.html", `${"關於"}/index.html`],
      },
      {
        name: 'trailingSlash "never"',
        config: astroConfig('trailingSlash: "never",'),
        files: ["index.html", "about/index.html", `${"關於"}/index.html`],
      },
    ];

    for (const layout of layouts) {
      it(
        `gives every page its sealed content with ${layout.name}`,
        BUILD,
        async () => {
          const run = await build(
            astroThemeFiles({ config: layout.config, pages: ALL_PAGES }),
          );
          expect(run.exitCode, run.output).toBe(0);
          expect(run.failure).toBeNull();
          for (const file of layout.files) {
            const html = text(run.outputs.get(`dist/client/${file}`));
            expect(html, file).toContain(VALUE_SEALED);
            expect(html, file).not.toContain(VALUE_DEFAULT);
          }
          const stamped = (
            text(run.outputs.get(".morph/prerender-stamped.ndjson")) ?? ""
          )
            .split("\n")
            .filter(Boolean)
            .map((line) => (JSON.parse(line) as { path: string }).path)
            .sort();
          expect(stamped).toEqual(["/", `/${CHINESE}`, "/about"].sort());
        },
      );
    }

    for (const format of ["file", "preserve"]) {
      it(
        `refuses build.format "${format}", whose pages read a key Core never serves`,
        BUILD,
        async () => {
          // A prerendered page there reads "/about.html"; Core keys the same
          // page "/about". Refused rather than mapped by a second rule.
          const run = await build(
            astroThemeFiles({
              config: astroConfig(`build: { format: "${format}" },`),
            }),
          );
          expect(run.exitCode).not.toBe(0);
          expect(run.output).toContain("ASTRO_BUILD_FORMAT_UNSUPPORTED");
        },
      );
    }

    it(
      "refuses a dynamic page that reads content, as a known gap",
      BUILD,
      async () => {
        // getStaticPaths paths are not known before the build, so nothing is
        // sealed for them (docs/astro-theme-plan.md 4.3): the page cannot
        // prerender with content, and the build says why.
        const run = await build(
          astroThemeFiles({
            extra: [
              {
                path: "src/pages/blog/[slug].astro",
                content: DYNAMIC_READING_PAGE,
              },
            ],
          }),
        );
        expect(run.exitCode).not.toBe(0);
        expect(run.output).toContain("refused for /blog/first");
        const refused = text(
          run.outputs.get(".morph/prerender-refused-reads.ndjson"),
        );
        expect(refused).toContain("NATIVE_PRERENDER_PATH_NOT_SEALED");
      },
    );
  },
);
