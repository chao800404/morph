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
  ["runtime/server/assets/worker-entry-DmJ4QUXB.js", "application/javascript", 543958],
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

  it("refuses a build that produced no client assets", () => {
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
});
