import { describe, expect, it } from "vitest";
import { planThemeWorkerDeployment } from "./theme-worker-deployment-plan";
import type { CanonicalThemeBuildManifest } from "../compiler/theme-build-artifact-store.types";

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
      storefrontId: "sf_1",
      manifest: manifest(),
      workerConfig: {
        ...REAL_WORKER_CONFIG,
        assets: { directory: "../client", binding: "ASSETS" },
      },
    });
    expect(astro.success && astro.plan.assetsBinding).toBe("ASSETS");

    const start = planThemeWorkerDeployment({
      storefrontId: "sf_1",
      manifest: manifest(),
      workerConfig: REAL_WORKER_CONFIG,
    });
    expect(start.success && "assetsBinding" in start.plan).toBe(false);

    for (const binding of ["", "ASSETS; rm", 42]) {
      expect(
        planThemeWorkerDeployment({
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
