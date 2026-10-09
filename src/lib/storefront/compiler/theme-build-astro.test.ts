// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { StorefrontThemeBuildDTO } from "../dto/storefront-theme-build.dto";
import type { StorefrontThemeRevisionDTO } from "../dto/storefront-theme-file.dto";
import { resolveThemeFramework, themeFramework } from "../theme-framework";
import { collectNativeAstroArtifact } from "../theme-framework/astro-native-build";
import { astroThemeFiles } from "../theme-framework/astro-native-prerender.fixtures";
import { themeToolchainForFramework } from "../theme-framework/theme-toolchains";
import { nativeBuildResult } from "./native-build-result";
import { materializeThemeBuildInput } from "./theme-build-materializer";

// docs/astro-theme-plan.md A4: Astro is built natively, only where the
// server's switch is given, and its artifact is refused at build time for
// what Morph cannot provide (5.2).

const ASTRO = themeToolchainForFramework("astro");

const revision = {
  id: "rev-astro",
  storefrontId: "storefront-1",
  themeId: "theme-1",
  revisionNumber: 1,
  snapshot: astroThemeFiles().map((file) => ({
    path: file.path,
    content: file.content,
  })),
} as unknown as StorefrontThemeRevisionDTO;

const build = (
  overrides: Partial<StorefrontThemeBuildDTO> = {},
): StorefrontThemeBuildDTO =>
  ({
    id: "build-astro",
    storefrontId: "storefront-1",
    themeId: "theme-1",
    sourceRevisionId: "rev-astro",
    status: "queued",
    inputHash: null,
    compilerId: null,
    compilerVersion: null,
    contentPublicationId: null,
    framework: "astro",
    inputHashFormat: 2,
    toolchainId: ASTRO.id,
    ...overrides,
  }) as StorefrontThemeBuildDTO;

describe("the Astro switch", () => {
  it("is off unless a caller passes it", () => {
    expect(resolveThemeFramework("astro")).toMatchObject({
      ok: false,
      code: "THEME_FRAMEWORK_UNAVAILABLE",
    });
    expect(resolveThemeFramework("astro", { astroThemes: false }).ok).toBe(
      false,
    );
    expect(resolveThemeFramework("astro", { astroThemes: true })).toMatchObject(
      { ok: true, framework: { id: "astro" } },
    );
    // It never changes what an unrecorded or Start build is.
    expect(themeFramework(null, { astroThemes: true }).id).toBe(
      "tanstack-start",
    );
  });

  it("has no Live Preview or platform build behind it yet", () => {
    const astro = themeFramework("astro", { astroThemes: true });
    expect(() => astro.planWorkspace({} as never)).toThrow(
      /^THEME_FRAMEWORK_UNAVAILABLE: A Live Preview/,
    );
    expect(() => astro.build.artifactEntry(null)).toThrow(
      /^THEME_FRAMEWORK_UNAVAILABLE: A platform build/,
    );
  });
});

describe("materializing an Astro build", () => {
  it("is refused without the switch, as before Astro had an adapter", () => {
    expect(() =>
      materializeThemeBuildInput({ build: build(), revision }),
    ).toThrow(/^THEME_FRAMEWORK_UNAVAILABLE: /);
  });

  it("is a native build with Astro's identity and toolchain, with the switch", () => {
    const input = materializeThemeBuildInput({
      build: build(),
      revision,
      astroThemes: true,
    });
    expect(input).toMatchObject({
      framework: "astro",
      buildMode: "native",
      compilerId: "astro-native",
      compilerVersion: ASTRO.directDependencies.astro,
      toolchainId: ASTRO.id,
      inputHashFormat: 2,
      entry: "src/pages/index.astro",
    });
    // The project's own configuration is part of the input, and its hash.
    const paths = input.files.map((file) => file.path);
    expect(paths).toContain("astro.config.mjs");
    expect(paths).toContain("wrangler.jsonc");
  });

  it("is refused before it is queued when the project cannot be built", () => {
    const noConfig = {
      ...revision,
      snapshot: (revision.snapshot as { path: string }[]).filter(
        (file) => file.path !== "astro.config.mjs",
      ),
    } as unknown as StorefrontThemeRevisionDTO;
    expect(() =>
      materializeThemeBuildInput({
        build: build(),
        revision: noConfig,
        astroThemes: true,
      }),
    ).toThrow(/^NATIVE_ASTRO_CONFIG: /);
  });
});

const enc = (value: unknown) => JSON.stringify(value);

/** A built Astro workspace, as the Cloudflare plugin leaves it. */
function astroOutputs(
  worker: Record<string, unknown>,
  extra: Record<string, string> = {},
): Map<string, string> {
  return new Map(
    Object.entries({
      ".wrangler/deploy/config.json": enc({
        configPath: "../../dist/server/wrangler.json",
      }),
      "dist/server/wrangler.json": enc({
        main: "entry.mjs",
        assets: { directory: "../client" },
        ...worker,
      }),
      "dist/server/entry.mjs": "export default {}",
      "dist/client/index.html": "<h1>home</h1>",
      ...extra,
    }),
  );
}

describe("an Astro artifact (docs/astro-theme-plan.md 5.2)", () => {
  it("is collected into Morph's layout", () => {
    const artifact = collectNativeAstroArtifact(astroOutputs({}));
    expect(artifact.workerEntry).toBe("runtime/server/entry.mjs");
    expect([...artifact.files.keys()].sort()).toEqual([
      "runtime/client/index.html",
      "runtime/server/entry.mjs",
      "runtime/server/wrangler.json",
    ]);
  });

  const refusals: [string, Record<string, unknown>, string][] = [
    [
      "a SESSION KV binding",
      { kv_namespaces: [{ binding: "SESSION" }] },
      "ASTRO_SESSION_BINDING_UNSUPPORTED",
    ],
    [
      "a SESSION KV binding under previews",
      { previews: { kv_namespaces: [{ binding: "SESSION" }] } },
      "ASTRO_SESSION_BINDING_UNSUPPORTED",
    ],
    ["an Images binding", { images: { binding: "IMAGES" } }, "ASTRO_IMAGES_BINDING_UNSUPPORTED"],
    [
      "an Images binding under previews",
      { previews: { images: { binding: "IMAGES" } } },
      "ASTRO_IMAGES_BINDING_UNSUPPORTED",
    ],
    ["the Worker's own cache", { cache: { enabled: true } }, "ASTRO_WORKER_CACHE_UNSUPPORTED"],
  ];
  for (const [name, worker, code] of refusals) {
    it(`is refused with ${name}`, () => {
      expect(() => collectNativeAstroArtifact(astroOutputs(worker))).toThrow(
        new RegExp(`^${code}: `),
      );
    });
  }

  it("accepts the settings the plan names as the way out", () => {
    expect(() =>
      collectNativeAstroArtifact(
        astroOutputs({ kv_namespaces: [], previews: {}, cache: { enabled: false } }),
      ),
    ).not.toThrow();
  });

  it("is refused with anything of the prerender machinery in it", () => {
    for (const extra of <Record<string, string>[]>[
      { "dist/server/.prerender/entry.mjs": "x" },
      { "dist/server/chunk.mjs": 'const m = "__MORPH_ASTRO_PRERENDER_WRAPPER__";' },
      { "dist/client/.morph/prerender-stamped.ndjson": "{}" },
    ]) {
      expect(() => collectNativeAstroArtifact(astroOutputs({}, extra))).toThrow(
        /^NATIVE_PRERENDER_SHIM_LEAKED: /,
      );
    }
  });
});

describe("an Astro build's result", () => {
  const input = materializeThemeBuildInput({
    build: build(),
    revision,
    astroThemes: true,
  });
  const NONCE = "b".repeat(32);
  const result = (
    outputs: Map<string, string>,
    extra: Partial<Parameters<typeof nativeBuildResult>[0]> = {},
  ) =>
    nativeBuildResult({
      input,
      outputs,
      routeRegistry: null,
      limits: { maxOutputFiles: 50, maxOutputSizeBytes: 1_000_000 },
      mimeType: () => "text/plain",
      isText: () => true,
      logs: [],
      addLog: () => {},
      startTime: Date.now(),
      nonce: NONCE,
      frameworks: { astroThemes: true },
      ...extra,
    });
  const pages = (...paths: string[]) =>
    [...paths.map((path) => enc({ nonce: NONCE, path })), enc({ nonce: NONCE, done: true })]
      .join("\n") + "\n";

  it("is refused without the switch", () => {
    const refused = result(astroOutputs({}), { frameworks: {} });
    expect(refused.success).toBe(false);
    if (!refused.success) {
      expect(refused.errorMessage).toMatch(/^THEME_FRAMEWORK_UNAVAILABLE: /);
    }
  });

  it("succeeds when every prerendered page has its stamp", () => {
    const built = result(
      astroOutputs({}, {
        ".morph/prerender-pages.ndjson": pages("/"),
        ".morph/prerender-stamped.ndjson": `${enc({ nonce: NONCE, path: "/", reads: 0, failures: 0 })}\n`,
      }),
    );
    expect(built.success).toBe(true);
    if (built.success) {
      expect(built.manifestJson.metadata).toMatchObject({
        framework: "astro",
        build: "native",
        workerEntry: "runtime/server/entry.mjs",
      });
    }
  });

  it("is refused by the records, whatever the build's exit code said", () => {
    const missing = result(
      astroOutputs({}, { ".morph/prerender-pages.ndjson": pages("/") }),
    );
    expect(missing).toMatchObject({
      success: false,
      diagnosticsJson: { stage: "prerender-records" },
    });
    // Without the pass's nonce nothing is accepted.
    const noNonce = result(
      astroOutputs({}, {
        ".morph/prerender-pages.ndjson": pages("/"),
        ".morph/prerender-stamped.ndjson": `${enc({ nonce: NONCE, path: "/", reads: 0, failures: 0 })}\n`,
      }),
      { nonce: undefined },
    );
    expect(noNonce.success).toBe(false);
  });

  it("says a failed build stopped on a refused read, so the passes rebuild with content", () => {
    const stopped = result(
      new Map([
        [
          ".morph/prerender-refused-reads.ndjson",
          `${enc({ nonce: NONCE, path: "/about", reason: "NATIVE_PRERENDER_NO_CONTENT_SNAPSHOT" })}\n`,
        ],
      ]),
      { buildFailure: { stage: "compiler", message: "NATIVE_BUILD_FAILED: x" } },
    );
    expect(stopped).toMatchObject({
      success: false,
      diagnosticsJson: { stage: "prerender-content" },
    });
    // A record of another build says nothing: the build's own failure stands.
    const foreign = result(
      new Map([
        [
          ".morph/prerender-refused-reads.ndjson",
          `${enc({ nonce: "c".repeat(32), path: "/about", reason: "x" })}\n`,
        ],
      ]),
      { buildFailure: { stage: "compiler", message: "NATIVE_BUILD_FAILED: x" } },
    );
    expect(foreign).toMatchObject({
      success: false,
      errorMessage: "NATIVE_BUILD_FAILED: x",
      diagnosticsJson: { stage: "compiler" },
    });
  });
});
