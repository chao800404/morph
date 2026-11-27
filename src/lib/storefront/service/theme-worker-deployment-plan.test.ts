import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  planThemeWorkerDeployment,
  type ThemeWorkerDeploymentTarget,
} from "./theme-worker-deployment-plan";
import { wranglerDeployConfig } from "./sandbox-wrangler-theme-worker-deployer";
import { NATIVE_START_COMPILER_ID } from "../theme-framework/tanstack-start-native-build";
import type { CanonicalThemeBuildManifest } from "../compiler/theme-build-artifact-store.types";
import emittedConfigs from "./__fixtures__/theme-worker-emitted-configs.json";

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

/**
 * File set and Worker config taken from a real starter-theme build produced by
 * LocalViteThemeBuildRunner, so the plan is verified against bytes the build
 * actually emits rather than an assumed artifact shape.
 */
const REAL_ARTIFACT_FILES: Array<[string, string, number]> = [
  ["runtime/client/.assetsignore", "application/octet-stream", 24],
  ["runtime/client/assets/index-BJuFmkSM.css", "text/css", 15208],
  ["runtime/client/assets/index-CnFAHZmF.js", "application/javascript", 19066],
  ["runtime/client/assets/index-CidNYO-Z.js", "application/javascript", 546892],
  ["runtime/server/index.js", "application/javascript", 195],
  ["runtime/server/wrangler.json", "application/json", 1327],
  ["runtime/server/.vite/manifest.json", "application/json", 2703],
  ["runtime/server/assets/start-BClswEUm.js", "application/javascript", 43],
  [
    "runtime/server/assets/worker-entry-DmJ4QUXB.js",
    "application/javascript",
    543958,
  ],
  ["runtime/server/assets/router-BNemKvUY.js", "application/javascript", 32684],
  ["runtime/server/assets/router-BJuFmkSM.css", "text/css", 15208],
  ["preview/index.html", "text/html", 403],
  ["preview/assets/index-DDg_GX_Y.js", "application/javascript", 526809],
];

function manifest(
  overrides: Partial<CanonicalThemeBuildManifest> = {},
): CanonicalThemeBuildManifest {
  return {
    buildId: "bld_1",
    storefrontId: "sf_1",
    themeId: "th_1",
    sourceRevisionId: "rev_1",
    revisionNumber: 1,
    inputHash: "a".repeat(64),
    compilerId: "tailwind-v4-build",
    compilerVersion: "4.1.17",
    sourceEntry: "src/routes/index.tsx",
    artifactEntry: "preview/index.html",
    runtime: {
      kind: "cloudflare-worker",
      workerEntry: "runtime/server/index.js",
      clientAssetsDirectory: "runtime/client",
      previewEntry: "preview/index.html",
    },
    filesCount: REAL_ARTIFACT_FILES.length,
    totalSizeBytes: 0,
    files: REAL_ARTIFACT_FILES.map(([path, contentType, sizeBytes]) => ({
      path,
      contentType,
      sizeBytes,
      sha256: "0".repeat(64),
    })),
    cssChunks: [],
    jsChunks: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** The Worker config the Cloudflare Vite plugin actually generates. */
const REAL_WORKER_CONFIG = {
  name: "morph-theme-bld-1",
  main: "index.js",
  compatibility_date: "2025-09-02",
  compatibility_flags: ["nodejs_compat"],
  assets: { directory: "../client" },
  no_bundle: true,
  vars: {},
  durable_objects: { bindings: [] },
  kv_namespaces: [],
  r2_buckets: [],
  d1_databases: [],
  services: [],
  dispatch_namespaces: [],
  queues: { producers: [], consumers: [] },
};

/**
 * The file list of build 1b5fbcd9 (astro-native 7.3.5, framework astro),
 * copied from the `getThemeBuild` response in the M2 case E2E run of
 * 2026-11-02 (`handoff/2026-11-02/m2-astro-case-e2e-b86a72d-run2`). The
 * Theme is two server-rendered pages and a Hero: no `public/`, no islands,
 * no prerendered pages, so the client directory holds only the adapter's
 * `_headers` and `.assetsignore`. Its publish was refused with
 * RELEASE_DEPLOYMENT_FAILED and no reason.
 */
const ASTRO_SSR_ONLY_FILES: Array<[string, string, number]> = [
  ["runtime/server/entry.mjs", "application/javascript", 5085],
  [
    "runtime/server/virtual_astro_middleware.mjs",
    "application/javascript",
    554,
  ],
  [
    "runtime/server/chunks/sequence_DTSdHy0I.mjs",
    "application/javascript",
    45907,
  ],
  [
    "runtime/server/chunks/rolldown-runtime_D7vh-g_o.mjs",
    "application/javascript",
    418,
  ],
  ["runtime/server/chunks/index_DjbXKkUC.mjs", "application/javascript", 1092],
  [
    "runtime/server/chunks/remote_C4g_SDQC.mjs",
    "application/javascript",
    24528,
  ],
  [
    "runtime/server/chunks/static-image-collection_B7a_3QHU.mjs",
    "application/javascript",
    2568,
  ],
  ["runtime/server/chunks/path_Dip7U3GC.mjs", "application/javascript", 17132],
  [
    "runtime/server/chunks/noop-entrypoint_BYLrzUxc.mjs",
    "application/javascript",
    157,
  ],
  [
    "runtime/server/chunks/image-passthrough-endpoint_B7Pm3YhY.mjs",
    "application/javascript",
    2318,
  ],
  [
    "runtime/server/chunks/console_B6RZXqok.mjs",
    "application/javascript",
    297980,
  ],
  [
    "runtime/server/chunks/_virtual_astro_server-island-manifest_q0HM18kM.mjs",
    "application/javascript",
    275,
  ],
  ["runtime/server/chunks/about_CSe0sutn.mjs", "application/javascript", 1123],
  ["runtime/server/chunks/astro_D3q60h5k.mjs", "application/javascript", 16737],
  ["runtime/server/chunks/Hero_C5-F9J1l.mjs", "application/javascript", 743],
  [
    "runtime/server/chunks/compiler_ieHWJfig.mjs",
    "application/javascript",
    1247,
  ],
  ["runtime/server/chunks/noop_CsmV5BFc.mjs", "application/javascript", 704],
  [
    "runtime/server/chunks/_virtual_astro_session-driver_DIk1nzQP.mjs",
    "application/javascript",
    223,
  ],
  [
    "runtime/server/chunks/entrypoints_Dx0rolSO.mjs",
    "application/javascript",
    170896,
  ],
  [
    "runtime/server/chunks/service_DUAfAxsp.mjs",
    "application/javascript",
    43763,
  ],
  ["runtime/client/_headers", "application/octet-stream", 63],
  ["runtime/client/.assetsignore", "application/octet-stream", 24],
  ["runtime/server/wrangler.json", "application/json; charset=utf-8", 1579],
];

function astroSsrOnlyManifest(
  files: Array<[string, string, number]> = ASTRO_SSR_ONLY_FILES,
): CanonicalThemeBuildManifest {
  return manifest({
    compilerId: "astro-native",
    compilerVersion: "7.3.5+morph-sdk.a262c1272c6303b4",
    sourceEntry: "src/pages/index.astro",
    artifactEntry: "runtime/server/entry.mjs",
    runtime: {
      kind: "cloudflare-worker",
      workerEntry: "runtime/server/entry.mjs",
      clientAssetsDirectory: "runtime/client",
    },
    filesCount: files.length,
    files: files.map(([path, contentType, sizeBytes]) => ({
      path,
      contentType,
      sizeBytes,
      sha256: "0".repeat(64),
    })),
  });
}

/**
 * The shape the Astro Cloudflare adapter writes (see
 * `astro-native-build.test.ts`). The run's own 1579-byte config was not
 * captured; only its file list was.
 */
const ASTRO_WORKER_CONFIG = {
  main: "entry.mjs",
  compatibility_date: "2026-03-24",
  compatibility_flags: ["nodejs_compat"],
  assets: { binding: "ASSETS", directory: "../client" },
  kv_namespaces: [],
};

describe("an all-SSR Astro build with no client files (M2 case, 2026-11-02)", () => {
  // Before D92-C this build was refused with MISSING_CLIENT_ASSETS (see the
  // reproduction commit). The refusal was wrong for it: a server-rendered
  // site with no static files is a complete Worker, and the client
  // directory it wrote holds only files the platform never deploys.
  it("is planned with an empty asset set, its whole module graph and its assets binding", () => {
    const result = planThemeWorkerDeployment({
      target: "production",
      storefrontId: "sf_1",
      manifest: astroSsrOnlyManifest(),
      workerConfig: ASTRO_WORKER_CONFIG,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan.assets).toEqual([]);
    expect(result.plan.mainModule).toBe("entry.mjs");
    expect(result.plan.modules.map((m) => m.modulePath)).toHaveLength(20);
    expect(result.plan.modules.map((m) => m.modulePath)).not.toContain(
      "wrangler.json",
    );
    expect(result.plan.assetsBinding).toBe("ASSETS");
  });

  const without = (path: string) =>
    ASTRO_SSR_ONLY_FILES.filter(([p]) => p !== path);

  it("still refuses it when the client output is missing altogether", () => {
    const result = planThemeWorkerDeployment({
      target: "production",
      storefrontId: "sf_1",
      manifest: astroSsrOnlyManifest(
        ASTRO_SSR_ONLY_FILES.filter(([p]) => !p.startsWith("runtime/client/")),
      ),
      workerConfig: ASTRO_WORKER_CONFIG,
    });
    expect(result).toMatchObject({
      success: false,
      reason: "MISSING_CLIENT_ASSETS",
    });
  });

  it("still refuses it when the Worker entry is missing from the files", () => {
    expect(
      planThemeWorkerDeployment({
        target: "production",
        storefrontId: "sf_1",
        manifest: astroSsrOnlyManifest(without("runtime/server/entry.mjs")),
        workerConfig: ASTRO_WORKER_CONFIG,
      }),
    ).toMatchObject({ success: false, reason: "MISSING_WORKER_ENTRY" });
  });

  it("still refuses it when no Worker entry is declared", () => {
    const base = astroSsrOnlyManifest();
    expect(
      planThemeWorkerDeployment({
        target: "production",
        storefrontId: "sf_1",
        manifest: { ...base, runtime: undefined },
        workerConfig: ASTRO_WORKER_CONFIG,
      }),
    ).toMatchObject({ success: false, reason: "MISSING_WORKER_ENTRY" });
  });

  it("still refuses it when the entry has no server directory, so no module graph", () => {
    const base = astroSsrOnlyManifest([
      ["entry.mjs", "application/javascript", 5085],
      ...ASTRO_SSR_ONLY_FILES.filter(([p]) => p.startsWith("runtime/client/")),
    ]);
    expect(
      planThemeWorkerDeployment({
        target: "production",
        storefrontId: "sf_1",
        manifest: {
          ...base,
          runtime: { ...base.runtime!, workerEntry: "entry.mjs" },
        },
        workerConfig: ASTRO_WORKER_CONFIG,
      }),
    ).toMatchObject({ success: false, reason: "MISSING_WORKER_ENTRY" });
  });

  it("still refuses it when the entry is excluded from the module graph", () => {
    // The entry names a file the module graph never takes.
    const base = astroSsrOnlyManifest();
    expect(
      planThemeWorkerDeployment({
        target: "production",
        storefrontId: "sf_1",
        manifest: {
          ...base,
          runtime: {
            ...base.runtime!,
            workerEntry: "runtime/server/wrangler.json",
          },
        },
        workerConfig: ASTRO_WORKER_CONFIG,
      }),
    ).toMatchObject({ success: false, reason: "MISSING_WORKER_ENTRY" });
  });

  it("still refuses it when the Worker config is missing or incomplete", () => {
    for (const workerConfig of [
      null,
      "{}",
      { ...ASTRO_WORKER_CONFIG, compatibility_date: undefined },
    ]) {
      expect(
        planThemeWorkerDeployment({
          target: "production",
          storefrontId: "sf_1",
          manifest: astroSsrOnlyManifest(),
          workerConfig,
        }),
      ).toMatchObject({ success: false, reason: "INVALID_WORKER_CONFIG" });
    }
  });

  it("still refuses it when the Worker config requests a platform binding", () => {
    expect(
      planThemeWorkerDeployment({
        target: "production",
        storefrontId: "sf_1",
        manifest: astroSsrOnlyManifest(),
        workerConfig: {
          ...ASTRO_WORKER_CONFIG,
          kv_namespaces: [{ binding: "SESSION", id: "x" }],
        },
      }),
    ).toMatchObject({ success: false, reason: "FORBIDDEN_BINDING" });
  });

  it("deploys a real client file as an asset once there is one", () => {
    const result = planThemeWorkerDeployment({
      target: "production",
      storefrontId: "sf_1",
      manifest: astroSsrOnlyManifest([
        ...ASTRO_SSR_ONLY_FILES,
        ["runtime/client/robots.txt", "text/plain", 20],
      ]),
      workerConfig: ASTRO_WORKER_CONFIG,
    });
    expect(
      result.success && result.plan.assets.map((a) => a.servedPath),
    ).toEqual(["/robots.txt"]);
  });
});

describe("planThemeWorkerDeployment", () => {
  it("plans a deployable Worker from a real build artifact", () => {
    const result = planThemeWorkerDeployment({
      target: "production",
      storefrontId: "sf_1",
      manifest: manifest(),
      workerConfig: REAL_WORKER_CONFIG,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.plan.scriptName).toBe("morph-theme-sf-1");
    expect(result.plan.mainModule).toBe("index.js");
    expect(result.plan.compatibilityDate).toBe("2025-09-02");
    expect(result.plan.compatibilityFlags).toEqual(["nodejs_compat"]);
  });

  it("targets the storefront-stable script name, ignoring the name baked into the artifact", () => {
    const result = planThemeWorkerDeployment({
      target: "production",
      storefrontId: "sf_1",
      manifest: manifest(),
      workerConfig: { ...REAL_WORKER_CONFIG, name: "morph-theme-bld-1" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan.scriptName).toBe("morph-theme-sf-1");
    expect(result.plan.scriptName).not.toContain("bld");
  });

  it("collects the whole server module graph and excludes build bookkeeping", () => {
    const result = planThemeWorkerDeployment({
      target: "production",
      storefrontId: "sf_1",
      manifest: manifest(),
      workerConfig: REAL_WORKER_CONFIG,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const modulePaths = result.plan.modules.map((m) => m.modulePath).sort();
    expect(modulePaths).toContain("index.js");
    expect(modulePaths).toContain("assets/worker-entry-DmJ4QUXB.js");
    expect(modulePaths).toContain("assets/router-BNemKvUY.js");
    // Vite metadata and the generated config are not part of the module graph.
    expect(modulePaths).not.toContain(".vite/manifest.json");
    expect(modulePaths).not.toContain("wrangler.json");
  });

  it("collects client assets at their served paths and never the editor preview bundle", () => {
    const result = planThemeWorkerDeployment({
      target: "production",
      storefrontId: "sf_1",
      manifest: manifest(),
      workerConfig: REAL_WORKER_CONFIG,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const served = result.plan.assets.map((a) => a.servedPath).sort();
    expect(served).toContain("/assets/index-CnFAHZmF.js");
    expect(served).toContain("/assets/index-BJuFmkSM.css");
    expect(served.some((p) => p.includes("index-DDg_GX_Y"))).toBe(false);
    expect(served.some((p) => p.includes(".assetsignore"))).toBe(false);
  });

  it("refuses an artifact that is not a deployable Worker runtime", () => {
    const result = planThemeWorkerDeployment({
      target: "production",
      storefrontId: "sf_1",
      manifest: manifest({ runtime: undefined }),
      workerConfig: REAL_WORKER_CONFIG,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("MISSING_WORKER_ENTRY");
  });

  it("refuses a Worker config that requests a platform binding", () => {
    for (const [key, value] of [
      ["d1_databases", [{ binding: "DB", database_id: "x" }]],
      ["r2_buckets", [{ binding: "B", bucket_name: "x" }]],
      ["kv_namespaces", [{ binding: "KV", id: "x" }]],
      ["services", [{ binding: "S", service: "morph" }]],
      ["durable_objects", { bindings: [{ name: "DO", class_name: "C" }] }],
    ] as Array<[string, unknown]>) {
      const result = planThemeWorkerDeployment({
        target: "production",
        storefrontId: "sf_1",
        manifest: manifest(),
        workerConfig: { ...REAL_WORKER_CONFIG, [key]: value },
      });
      expect(result.success, `expected ${key} to be refused`).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe("FORBIDDEN_BINDING");
      expect(result.message).toContain(key);
    }
  });

  it("carries the assets binding the Worker reads its own assets through, and no other", () => {
    // Astro's entry falls back to env.ASSETS for every path it does not
    // route; the adapter's Worker config names it.
    const astro = planThemeWorkerDeployment({
      target: "production",
      storefrontId: "sf_1",
      manifest: manifest(),
      workerConfig: {
        ...REAL_WORKER_CONFIG,
        assets: { directory: "../client", binding: "ASSETS" },
      },
    });
    expect(astro.success && astro.plan.assetsBinding).toBe("ASSETS");

    const start = planThemeWorkerDeployment({
      target: "production",
      storefrontId: "sf_1",
      manifest: manifest(),
      workerConfig: REAL_WORKER_CONFIG,
    });
    expect(start.success && "assetsBinding" in start.plan).toBe(false);

    for (const binding of ["", "ASSETS; rm", 42]) {
      expect(
        planThemeWorkerDeployment({
          target: "production",
          storefrontId: "sf_1",
          manifest: manifest(),
          workerConfig: {
            ...REAL_WORKER_CONFIG,
            assets: { directory: "../client", binding },
          },
        }),
      ).toMatchObject({ success: false, reason: "INVALID_WORKER_CONFIG" });
    }
  });

  it("refuses a Worker config with no compatibility date", () => {
    const { compatibility_date: _omitted, ...withoutDate } = REAL_WORKER_CONFIG;
    const result = planThemeWorkerDeployment({
      target: "production",
      storefrontId: "sf_1",
      manifest: manifest(),
      workerConfig: withoutDate,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("INVALID_WORKER_CONFIG");
  });

  it("refuses an artifact whose declared worker entry is absent from the manifest", () => {
    const base = manifest();
    const result = planThemeWorkerDeployment({
      target: "production",
      storefrontId: "sf_1",
      manifest: {
        ...base,
        files: base.files.filter((f) => f.path !== "runtime/server/index.js"),
      },
      workerConfig: REAL_WORKER_CONFIG,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("MISSING_WORKER_ENTRY");
  });

  it("refuses a build that wrote no client output at all", () => {
    const base = manifest();
    const result = planThemeWorkerDeployment({
      target: "production",
      storefrontId: "sf_1",
      manifest: {
        ...base,
        files: base.files.filter((f) => !f.path.startsWith("runtime/client/")),
      },
      workerConfig: REAL_WORKER_CONFIG,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("MISSING_CLIENT_ASSETS");
  });

  it("never deploys a build's own _headers or _redirects", () => {
    const base = manifest();
    const result = planThemeWorkerDeployment({
      target: "production",
      storefrontId: "sf_1",
      manifest: {
        ...base,
        files: [
          ...base.files,
          ...["runtime/client/_headers", "runtime/client/_redirects"].map(
            (path) => ({
              path,
              contentType: "text/plain",
              sizeBytes: 10,
              sha256: "0".repeat(64),
            }),
          ),
        ],
      },
      workerConfig: REAL_WORKER_CONFIG,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const served = result.plan.assets.map((asset) => asset.servedPath);
    expect(served).not.toContain("/_headers");
    expect(served).not.toContain("/_redirects");
  });
});

describe("registered static pages in the Theme Worker manifest", () => {
  const HOME = "1".repeat(64);
  const ABOUT = "2".repeat(64);
  const html = (path: string, sha256: string) => ({
    path,
    contentType: "text/html",
    sizeBytes: 100,
    sha256,
  });
  const withPages = (
    staticPages: unknown = [
      { path: "/", artifactPath: "runtime/client/index.html", sha256: HOME },
      {
        path: "/about",
        artifactPath: "runtime/client/about/index.html",
        sha256: ABOUT,
      },
    ],
  ): CanonicalThemeBuildManifest => {
    const base = manifest();
    return {
      ...base,
      files: [
        ...base.files,
        html("runtime/client/index.html", HOME),
        html("runtime/client/about/index.html", ABOUT),
        // Prerendered but not registered: not this rule's to drop.
        html("runtime/client/landing/index.html", "3".repeat(64)),
      ],
      runtime: { ...base.runtime!, staticPages } as never,
    };
  };
  const withoutPages = (): CanonicalThemeBuildManifest => {
    const registered = withPages();
    const { staticPages: _dropped, ...runtime } = registered.runtime!;
    return { ...registered, runtime };
  };
  const plan = (
    target: "production" | "build-preview",
    built: CanonicalThemeBuildManifest,
  ) => {
    const result = planThemeWorkerDeployment({
      target,
      storefrontId: "sf_1",
      manifest: built,
      workerConfig: REAL_WORKER_CONFIG,
    });
    if (!result.success) throw new Error(result.message);
    return result.plan;
  };

  it("leaves exactly the registered HTML out of a production deployment", () => {
    const production = plan("production", withPages());
    const everything = plan("production", withoutPages());
    const served = production.assets.map((asset) => asset.artifactPath);
    expect(served).not.toContain("runtime/client/index.html");
    expect(served).not.toContain("runtime/client/about/index.html");
    expect(served).toContain("runtime/client/landing/index.html");
    expect(
      everything.assets
        .map((asset) => asset.artifactPath)
        .filter((path) => !served.includes(path)),
    ).toEqual([
      "runtime/client/index.html",
      "runtime/client/about/index.html",
    ]);
    expect(production.assets).toEqual(
      everything.assets.filter(
        (asset) =>
          asset.artifactPath !== "runtime/client/index.html" &&
          asset.artifactPath !== "runtime/client/about/index.html",
      ),
    );
    // JS, CSS and the module graph are unchanged.
    expect(production.modules).toEqual(everything.modules);
    expect(production.mainModule).toBe(everything.mainModule);
  });

  it("leaves a Build Preview deployment unchanged", () => {
    expect(plan("build-preview", withPages())).toEqual(
      plan("build-preview", withoutPages()),
    );
    expect(
      plan("build-preview", withPages()).assets.map((asset) => asset.artifactPath),
    ).toContain("runtime/client/about/index.html");
  });

  it("refuses a production deployment whose registration names a file the build does not hold", () => {
    expect(
      planThemeWorkerDeployment({
        target: "production",
        storefrontId: "sf_1",
        manifest: withPages([
          {
            path: "/contact",
            artifactPath: "runtime/client/contact/index.html",
            sha256: HOME,
          },
        ]),
        workerConfig: REAL_WORKER_CONFIG,
      }),
    ).toMatchObject({ success: false, reason: "INVALID_STATIC_PAGES" });
  });
});

/**
 * The Wrangler key contract's admission boundary (render plan v2 step 1):
 * the strict contract applies only to an artifact whose immutable
 * `manifest.compilerId` is the native Start build's. Every other artifact —
 * the platform's Starter builds, old and new, and Astro's — deploys with the
 * config it deployed with before the contract, byte for byte.
 *
 * The inputs are real outputs of the Cloudflare plugin
 * (`__fixtures__/theme-worker-emitted-configs.json`; each entry says how it
 * was made, machine paths replaced by `/workspace/`). `mainAt76efa42` is
 * what this function and `wranglerDeployConfig` produced for them on main
 * 76efa42, before the contract, recorded by running that code unchanged.
 */
describe("the Wrangler key contract's admission boundary", () => {
  type Fixture = {
    compilerId: string;
    compilerVersion: string;
    workerEntry: string;
    config: string;
    files: Array<[string, string, number]>;
    mainAt76efa42: Record<
      ThemeWorkerDeploymentTarget,
      {
        deployConfig: string;
        planSha256: string;
        moduleCount: number;
        assetCount: number;
      }
    >;
  };
  const fixtures = emittedConfigs as unknown as Record<string, Fixture>;

  const fixtureManifest = (fixture: Fixture): CanonicalThemeBuildManifest =>
    manifest({
      buildId: "bld_fixture",
      storefrontId: "sf_fixture",
      themeId: "th_fixture",
      sourceRevisionId: "rev_fixture",
      compilerId: fixture.compilerId,
      compilerVersion: fixture.compilerVersion,
      artifactEntry: fixture.workerEntry,
      runtime: {
        kind: "cloudflare-worker",
        workerEntry: fixture.workerEntry,
        clientAssetsDirectory: "runtime/client",
      },
      filesCount: fixture.files.length,
      files: fixture.files.map(([path, contentType, sizeBytes]) => ({
        path,
        contentType,
        sizeBytes,
        sha256: "0".repeat(64),
      })),
    });

  const planFor = (
    fixture: Fixture,
    target: ThemeWorkerDeploymentTarget,
    workerConfig: unknown = JSON.parse(fixture.config),
  ) =>
    planThemeWorkerDeployment({
      target,
      storefrontId: "sf_fixture",
      manifest: fixtureManifest(fixture),
      workerConfig,
    });

  const LEGACY = [
    "starter-v11",
    "starter-v15",
    "starter-v20",
    "starter-v26",
    "starter-v28",
    "starter-v29",
    "starter-v32",
    "platform-saved-2026-09-28",
    "astro-native",
  ];
  const TARGETS = ["production", "build-preview"] as const;

  it.each(LEGACY.flatMap((id) => TARGETS.map((target) => [id, target] as const)))(
    "%s (%s) deploys with exactly the config it had before the contract",
    (id, target) => {
      const fixture = fixtures[id]!;
      expect(fixture.compilerId).not.toBe(NATIVE_START_COMPILER_ID);
      const result = planFor(fixture, target);
      if (!result.success) throw new Error(result.message);
      const expected = fixture.mainAt76efa42[target];
      expect(JSON.stringify(wranglerDeployConfig(result.plan), null, 2)).toBe(
        expected.deployConfig,
      );
      expect(sha256(JSON.stringify(result.plan))).toBe(expected.planSha256);
      expect(result.plan.modules).toHaveLength(expected.moduleCount);
      expect(result.plan.assets).toHaveLength(expected.assetCount);
      expect(result.plan.native).toBeUndefined();
    },
  );

  it("keeps the old checks, and only those, for an artifact outside the boundary", () => {
    // A platform artifact carrying what the contract refuses deploys as it
    // did: the contract does not reach back into artifacts it did not admit.
    const fixture = fixtures["starter-v32"]!;
    const config = {
      ...JSON.parse(fixture.config),
      vars: { MORPH_X: "1" },
      observability: { enabled: true, head_sampling_rate: 0.5 },
      placement: { mode: "smart" },
      some_future_key: true,
    };
    const result = planFor(fixture, "production", config);
    if (!result.success) throw new Error(result.message);
    expect(JSON.stringify(wranglerDeployConfig(result.plan), null, 2)).toBe(
      fixture.mainAt76efa42.production.deployConfig,
    );
    // ...and is refused for what it was refused for before.
    expect(
      planFor(fixture, "production", {
        ...config,
        kv_namespaces: [{ binding: "KV", id: "x" }],
      }),
    ).toMatchObject({ success: false, reason: "FORBIDDEN_BINDING" });
  });

  it("is decided by the manifest's compiler identity, not by the config", () => {
    const native = fixtures["start-native-guide"]!;
    const result = planFor(
      { ...native, compilerId: "tailwind-v4-build" },
      "production",
    );
    if (!result.success) throw new Error(result.message);
    expect(result.plan.native).toBeUndefined();
    expect(JSON.stringify(wranglerDeployConfig(result.plan), null, 2)).toBe(
      native.mainAt76efa42.production.deployConfig,
    );
  });

  describe("a native Start artifact", () => {
    const fixture = fixtures["start-native-guide"]!;

    it("deploys the author's vars and observability.enabled, and nothing else of the build's config", () => {
      expect(fixture.compilerId).toBe(NATIVE_START_COMPILER_ID);
      for (const target of TARGETS) {
        const result = planFor(fixture, target);
        if (!result.success) throw new Error(result.message);
        expect(result.plan.native).toEqual({
          vars: { STORE_LABEL: "probe", FEATURES: { a: 1 } },
          observabilityEnabled: true,
        });
        // The modules and assets are what they were before the contract;
        // the deploy config gains exactly the kept settings.
        const { native: _native, ...withoutNative } = result.plan;
        expect(sha256(JSON.stringify(withoutNative))).toBe(
          fixture.mainAt76efa42[target].planSha256,
        );
        expect(wranglerDeployConfig(result.plan)).toEqual({
          ...JSON.parse(fixture.mainAt76efa42[target].deployConfig),
          vars: { STORE_LABEL: "probe", FEATURES: { a: 1 } },
          keep_vars: false,
          observability: { enabled: true },
        });
      }
    });

    it("writes empty vars and observability off when the build has none, so a removed var is removed", () => {
      const config = JSON.parse(fixture.config);
      config.vars = {};
      delete config.observability;
      const result = planFor(fixture, "production", config);
      if (!result.success) throw new Error(result.message);
      expect(wranglerDeployConfig(result.plan)).toMatchObject({
        vars: {},
        keep_vars: false,
        observability: { enabled: false },
      });
    });

    it("never copies the build's other settings into the deploy config", () => {
      const result = planFor(fixture, "production", {
        ...JSON.parse(fixture.config),
        dev: { ip: "0.0.0.0", port: 1 },
        workers_dev: true,
        preview_urls: true,
        name: "authors-own-name",
      });
      if (!result.success) throw new Error(result.message);
      const config = wranglerDeployConfig(result.plan);
      expect(Object.keys(config)).toEqual([
        "name",
        "main",
        "compatibility_date",
        "compatibility_flags",
        "assets",
        "no_bundle",
        "rules",
        "workers_dev",
        "preview_urls",
        "vars",
        "keep_vars",
        "observability",
      ]);
      expect(config).toMatchObject({
        name: "morph-theme-sf-fixture",
        workers_dev: false,
        preview_urls: false,
      });
    });

    it.each([
      ["a route", { routes: ["shop.example.com/*"] }, "NATIVE_ROUTE_CLAIM"],
      [
        "a queue producer",
        { queues: { producers: [{ binding: "Q", queue: "q" }], consumers: [] } },
        "NATIVE_BINDINGS_UNMAPPED",
      ],
      ["an AI binding", { ai: { binding: "AI" } }, "NATIVE_BINDINGS_UNMAPPED"],
      [
        "version metadata",
        { version_metadata: { binding: "V" } },
        "NATIVE_BINDINGS_UNMAPPED",
      ],
      [
        "observability sampling",
        { observability: { enabled: true, head_sampling_rate: 0.1 } },
        "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
      ],
      ["placement", { placement: { mode: "smart" } }, "NATIVE_WRANGLER_SETTING_UNSUPPORTED"],
      ["limits", { limits: { cpu_ms: 10 } }, "NATIVE_WRANGLER_SETTING_UNSUPPORTED"],
      ["a reserved var", { vars: { MORPH_BUILD_ID: "x" } }, "NATIVE_BINDING_NAME_CLASH"],
      ["an unknown key", { some_future_key: [] }, "NATIVE_WRANGLER_SETTING_UNKNOWN"],
      ["a changed adapter default", { rules: [] }, "NATIVE_WRANGLER_SETTING_UNSUPPORTED"],
    ])("is refused at deploy when its Worker config carries %s", (_label, override, code) => {
      const result = planFor(fixture, "production", {
        ...JSON.parse(fixture.config),
        ...override,
      });
      expect(result).toMatchObject({
        success: false,
        reason: "INVALID_WORKER_CONFIG",
        message: expect.stringMatching(
          new RegExp(`^${code}: runtime/server/wrangler\\.json`),
        ),
      });
    });
  });
});
