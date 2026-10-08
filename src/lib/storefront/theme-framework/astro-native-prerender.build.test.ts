// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createNativePrerenderContent } from "../compiler/theme-prerender-content";
import {
  astroArtifactLeaks,
  astroPrerenderRecordsFailure,
  astroRouteRegistry,
  type AstroPrerenderTestFaults,
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
 * Real `astro build`s with Morph's prerender content (docs/astro-theme-plan.md
 * 4.3, A3), through the pinned Astro toolchain. Whether a build succeeded is
 * decided as a native build decides it: `astro build`'s exit code and the
 * records (`astroPrerenderRecordsFailure`) — never the HTML. The HTML is
 * asserted as the evidence that the decision is right.
 */
const missingToolchain = !astroToolchainInstalled;
if (missingToolchain && process.env.CI) {
  throw new Error(
    "The Astro toolchain is not installed; CI installs it with pnpm toolchain:astro.",
  );
}
if (missingToolchain) {
  console.warn(
    "Skipping the Astro prerender build tests: run pnpm toolchain:astro to install the Astro toolchain.",
  );
}

const BUILD = { timeout: 240_000 };

async function build(
  options: {
    sealed?: boolean;
    faults?: AstroPrerenderTestFaults;
    files?: ReturnType<typeof astroThemeFiles>;
  } = {},
) {
  const files = options.files ?? astroThemeFiles({ plain: true });
  const prerenderContent = options.sealed === false
    ? undefined
    : await createNativePrerenderContent(
        sealedSnapshot(
          astroRouteRegistry(files)
            .routes.filter((route) => !route.dynamic && route.path !== "/")
            .map((route) => route.path),
        ),
        astroRouteRegistry(files),
      );
  const run = await runAstroPrerenderBuild({
    files,
    prerenderContent,
    testFaults: options.faults,
  });
  const failure =
    run.exitCode === 0
      ? astroPrerenderRecordsFailure(run.outputs, run.nonce)
      : null;
  return { ...run, failure };
}

const records = (
  run: Awaited<ReturnType<typeof build>>,
  file: string,
): Record<string, unknown>[] =>
  (text(run.outputs.get(file)) ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

const html = (run: Awaited<ReturnType<typeof build>>, file: string) =>
  text(run.outputs.get(`dist/client/${file}`));

describe.skipIf(missingToolchain)("an Astro build's prerendered content", () => {
  it(
    "prerenders the sealed value, not the default or the current draft",
    BUILD,
    async () => {
      const run = await build();
      expect(run.exitCode, run.output).toBe(0);
      expect(run.failure).toBeNull();
      for (const page of ["index.html", "about/index.html"]) {
        expect(html(run, page)).toContain(VALUE_SEALED);
        expect(html(run, page)).not.toContain(VALUE_DEFAULT);
        expect(html(run, page)).not.toContain(VALUE_DRAFT);
      }
      expect(html(run, "plain/index.html")).toContain("A3-PLAIN-PAGE");
      expect(astroArtifactLeaks(run.outputs)).toEqual([]);
      // Astro removed its prerender bundle, and with it the wrapper.
      expect(
        [...run.outputs.keys()].some((path) => path.includes(".prerender/")),
      ).toBe(false);

      // Every prerendered page has its stamp; the plain page read nothing.
      const stamps = records(run, ".morph/prerender-stamped.ndjson");
      expect(stamps.map((stamp) => stamp.path).sort()).toEqual([
        "/",
        "/about",
        "/plain",
      ]);
      expect(stamps.find((stamp) => stamp.path === "/plain")).toMatchObject({
        reads: 0,
        failures: 0,
      });
      expect(stamps.find((stamp) => stamp.path === "/about")).toMatchObject({
        reads: 1,
        failures: 0,
        refused: 0,
      });
      expect(stamps.every((stamp) => stamp.nonce === run.nonce)).toBe(true);
    },
  );

  it(
    "builds with the records alone deciding, when fail-fast is off",
    BUILD,
    async () => {
      const run = await build({ faults: { failFast: false } });
      expect(run.exitCode, run.output).toBe(0);
      expect(run.failure).toBeNull();
      expect(html(run, "about/index.html")).toContain(VALUE_SEALED);
    },
  );

  // Each failure, once with fail-fast and once with only the records: either
  // defence alone must stop it (docs/astro-theme-plan.md 0.4 item 1).
  const failures: readonly {
    name: string;
    options: Parameters<typeof build>[0];
    failFast: string;
    records: string;
  }[] = [
    {
      name: "no sealed content",
      options: { sealed: false },
      failFast: "refused for /about",
      records: "NATIVE_PRERENDER_CONTENT_UNAVAILABLE",
    },
    {
      name: "the content server answering 500",
      options: { faults: { contentServer: "http-500" } },
      failFast: "non-2xx 500 for /about",
      records: "NATIVE_PRERENDER_CONTENT_READ_FAILED",
    },
    {
      name: "no content server (connection refused)",
      options: { faults: { contentServer: "absent" } },
      failFast: "connect-failed for /about",
      records: "NATIVE_PRERENDER_CONTENT_ORIGIN_MISSING",
    },
    {
      name: "the wrapper missing the adapter's entry",
      options: { faults: { entry: "@astrojs/cloudflare/entrypoints/moved" } },
      failFast: "ASTRO_ADAPTER_INCOMPATIBLE",
      records: "NATIVE_PRERENDER_CONTENT_ORIGIN_MISSING",
    },
  ];

  for (const failure of failures) {
    it(
      `fails with ${failure.name}, by fail-fast`,
      BUILD,
      async () => {
        const run = await build(failure.options);
        expect(run.exitCode).not.toBe(0);
        expect(run.output).toContain(failure.failFast);
        // No page holds the defaults: the failed page was never written.
        expect(html(run, "about/index.html")).toBeUndefined();
      },
    );

    it(
      `fails with ${failure.name}, by the records alone`,
      BUILD,
      async () => {
        const run = await build({
          ...failure.options,
          faults: { ...failure.options?.faults, failFast: false },
        });
        // astro build itself succeeds, with the defaults in the HTML; only
        // the records stop it.
        expect(run.exitCode, run.output).toBe(0);
        expect(html(run, "about/index.html")).toContain(VALUE_DEFAULT);
        expect(run.failure?.code).toBe(failure.records);
      },
    );
  }

  it(
    "leaves the prerender bundle, wrapper included, when prerendering fails",
    BUILD,
    async () => {
      const run = await build({ sealed: false });
      expect(run.exitCode).not.toBe(0);
      const leaks = astroArtifactLeaks(run.outputs);
      expect(leaks.some((leak) => leak.includes("/.prerender/"))).toBe(true);
    },
  );

  it(
    "accepts no record of another build",
    BUILD,
    async () => {
      const run = await build();
      expect(run.failure).toBeNull();
      // The same records, read for another build's nonce.
      expect(
        astroPrerenderRecordsFailure(run.outputs, "f".repeat(32))?.code,
      ).toBe("NATIVE_PRERENDER_RECORD_INVALID");
      // A stale stamp left in the workspace by another build.
      const stale = new Map<string, Uint8Array | string>(run.outputs);
      stale.set(
        ".morph/prerender-stamped.ndjson",
        `${text(run.outputs.get(".morph/prerender-stamped.ndjson"))}${JSON.stringify({ nonce: "0".repeat(32), path: "/about", reads: 1, failures: 0 })}\n`,
      );
      expect(astroPrerenderRecordsFailure(stale, run.nonce)?.code).toBe(
        "NATIVE_PRERENDER_RECORD_INVALID",
      );
      // A stamp lost, or one too many.
      const stampLines = text(
        run.outputs.get(".morph/prerender-stamped.ndjson"),
      )!
        .trim()
        .split("\n");
      const lost = new Map<string, Uint8Array | string>(run.outputs);
      lost.set(
        ".morph/prerender-stamped.ndjson",
        `${stampLines.slice(1).join("\n")}\n`,
      );
      expect(astroPrerenderRecordsFailure(lost, run.nonce)?.code).toBe(
        "NATIVE_PRERENDER_CONTENT_ORIGIN_MISSING",
      );
      const extra = new Map<string, Uint8Array | string>(run.outputs);
      extra.set(
        ".morph/prerender-stamped.ndjson",
        `${[...stampLines, stampLines[0]].join("\n")}\n`,
      );
      expect(astroPrerenderRecordsFailure(extra, run.nonce)?.code).toBe(
        "NATIVE_PRERENDER_CONTENT_ORIGIN_MISSING",
      );
      // No record of the prerendered pages at all.
      const unrecorded = new Map<string, Uint8Array | string>(run.outputs);
      unrecorded.delete(".morph/prerender-pages.ndjson");
      expect(astroPrerenderRecordsFailure(unrecorded, run.nonce)?.code).toBe(
        "NATIVE_PRERENDER_RECORD_INVALID",
      );
    },
  );
});
