import type { CanonicalThemeBuildManifest } from "../compiler/theme-build-artifact-store.types";
import { themeWorkerScriptNameForStorefront } from "./theme-runtime.types";

/**
 * Bindings a Theme Worker may never request.
 *
 * The build writes this config from a platform-owned template, so a populated
 * binding list means the artifact does not match what the platform generates.
 * Refusing to deploy is the only safe response: uploading it would grant
 * customer code a resource the platform never intended to expose.
 */
const FORBIDDEN_BINDING_KEYS = [
  "d1_databases",
  "r2_buckets",
  "kv_namespaces",
  "durable_objects",
  "services",
  "dispatch_namespaces",
  "queues",
  "hyperdrive",
  "vectorize",
  "mtls_certificates",
  "secrets_store_secrets",
  "analytics_engine_datasets",
  "workflows",
  "pipelines",
  "browser",
  "ai",
] as const;

export type ThemeWorkerModule = Readonly<{
  /** Path inside the Worker module graph, e.g. `assets/worker-entry-x.js`. */
  modulePath: string;
  /** Path inside the immutable build artifact. */
  artifactPath: string;
  contentType: string;
}>;

export type ThemeWorkerAsset = Readonly<{
  /** Public path the asset is served at, e.g. `/assets/index-x.js`. */
  servedPath: string;
  artifactPath: string;
  contentType: string;
}>;

export type ThemeWorkerDeploymentPlan = Readonly<{
  scriptName: string;
  mainModule: string;
  modules: readonly ThemeWorkerModule[];
  assets: readonly ThemeWorkerAsset[];
  compatibilityDate: string;
  compatibilityFlags: readonly string[];
}>;

export type ThemeWorkerDeploymentPlanFailureReason =
  | "MISSING_WORKER_ENTRY"
  | "MISSING_CLIENT_ASSETS"
  | "INVALID_WORKER_CONFIG"
  | "FORBIDDEN_BINDING"
  | "INVALID_SCRIPT_NAME";

export type ThemeWorkerDeploymentPlanResult =
  | { success: true; plan: ThemeWorkerDeploymentPlan }
  | {
      success: false;
      reason: ThemeWorkerDeploymentPlanFailureReason;
      message: string;
    };

/** Files the assets upload must never expose, mirroring `.assetsignore`. */
const ASSET_EXCLUSIONS = new Set([
  "wrangler.json",
  "wrangler.jsonc",
  ".dev.vars",
  ".assetsignore",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(
  reason: ThemeWorkerDeploymentPlanFailureReason,
  message: string,
): ThemeWorkerDeploymentPlanResult {
  return { success: false, reason, message };
}

function normalizeDirectory(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/**
 * Derives everything needed to upload one immutable build as a Theme Worker.
 *
 * The plan is computed from the manifest and the build's generated Worker
 * config, never from the mutable theme workspace, so a deployment can only ever
 * describe bytes that a build actually produced.
 *
 * The script name is derived from the storefront rather than the build: the
 * service binding points at a stable name, and which build sits behind it is
 * reconciled from `storefronts.active_release_id`. The name embedded in the
 * artifact's own config is deliberately ignored — an immutable artifact must
 * not carry a deployment target.
 */
export function planThemeWorkerDeployment(args: {
  storefrontId: string;
  manifest: CanonicalThemeBuildManifest;
  workerConfig: unknown;
}): ThemeWorkerDeploymentPlanResult {
  let scriptName: string;
  try {
    scriptName = themeWorkerScriptNameForStorefront(args.storefrontId);
  } catch (error) {
    return fail(
      "INVALID_SCRIPT_NAME",
      error instanceof Error ? error.message : "Invalid storefront id.",
    );
  }

  // Canonical manifest shape: the artifact store maps the runner's `metadata`
  // onto `runtime` before persisting, and D1 stores the canonical form.
  const runtime = args.manifest?.runtime;
  const workerEntry =
    runtime && typeof runtime.workerEntry === "string"
      ? runtime.workerEntry.replace(/\\/g, "/")
      : null;
  if (!workerEntry) {
    return fail(
      "MISSING_WORKER_ENTRY",
      "Build manifest declares no Worker entry; this artifact is not a deployable Theme runtime.",
    );
  }

  const files = Array.isArray(args.manifest?.files) ? args.manifest.files : [];
  if (!files.some((file) => file.path === workerEntry)) {
    return fail(
      "MISSING_WORKER_ENTRY",
      `Worker entry "${workerEntry}" is not present in the build manifest.`,
    );
  }

  const serverDirectory = workerEntry.includes("/")
    ? workerEntry.slice(0, workerEntry.lastIndexOf("/"))
    : "";
  const clientDirectory = normalizeDirectory(
    runtime && typeof runtime.clientAssetsDirectory === "string"
      ? runtime.clientAssetsDirectory
      : "runtime/client",
  );

  if (!isRecord(args.workerConfig)) {
    return fail(
      "INVALID_WORKER_CONFIG",
      "Generated Worker config is missing or is not a JSON object.",
    );
  }

  for (const key of FORBIDDEN_BINDING_KEYS) {
    const value = args.workerConfig[key];
    const declared = Array.isArray(value)
      ? value.length > 0
      : isRecord(value) &&
        Array.isArray((value as Record<string, unknown>).bindings)
        ? ((value as Record<string, unknown>).bindings as unknown[]).length > 0
        : false;
    if (declared) {
      return fail(
        "FORBIDDEN_BINDING",
        `Theme Worker config requests the forbidden binding "${key}".`,
      );
    }
  }

  const compatibilityDate = args.workerConfig.compatibility_date;
  if (typeof compatibilityDate !== "string" || compatibilityDate.trim() === "") {
    return fail(
      "INVALID_WORKER_CONFIG",
      "Generated Worker config declares no compatibility_date.",
    );
  }

  const compatibilityFlags = Array.isArray(args.workerConfig.compatibility_flags)
    ? args.workerConfig.compatibility_flags.filter(
        (flag): flag is string => typeof flag === "string",
      )
    : [];

  const modules: ThemeWorkerModule[] = [];
  const assets: ThemeWorkerAsset[] = [];

  for (const file of files) {
    const path = file.path.replace(/\\/g, "/");

    if (serverDirectory && path.startsWith(`${serverDirectory}/`)) {
      const modulePath = path.slice(serverDirectory.length + 1);
      if (ASSET_EXCLUSIONS.has(modulePath)) continue;
      // Vite metadata is build bookkeeping, not part of the module graph.
      if (modulePath.startsWith(".vite/")) continue;
      modules.push({
        modulePath,
        artifactPath: path,
        contentType: file.contentType || "application/javascript",
      });
      continue;
    }

    if (clientDirectory && path.startsWith(`${clientDirectory}/`)) {
      const servedPath = path.slice(clientDirectory.length + 1);
      if (ASSET_EXCLUSIONS.has(servedPath)) continue;
      assets.push({
        servedPath: `/${servedPath}`,
        artifactPath: path,
        contentType: file.contentType || "application/octet-stream",
      });
    }
  }

  const mainModule = workerEntry.slice(serverDirectory.length + 1);
  if (!modules.some((module) => module.modulePath === mainModule)) {
    return fail(
      "MISSING_WORKER_ENTRY",
      `Worker entry "${mainModule}" was excluded from the module graph.`,
    );
  }

  if (assets.length === 0) {
    return fail(
      "MISSING_CLIENT_ASSETS",
      `Build produced no client assets under "${clientDirectory}".`,
    );
  }

  return {
    success: true,
    plan: {
      scriptName,
      mainModule,
      modules,
      assets,
      compatibilityDate,
      compatibilityFlags,
    },
  };
}
