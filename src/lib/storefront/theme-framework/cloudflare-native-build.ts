import { parseJsonc } from "./jsonc";

/**
 * The parts of a native build that belong to the Cloudflare deployment
 * target, not to a framework.
 *
 * docs/astro-theme-plan.md 2.3. Any framework Morph builds natively deploys
 * through the Cloudflare Vite plugin: the project's own Wrangler config is
 * copied for Morph to supply through `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`,
 * bindings Morph cannot map yet are refused, and the plugin's record of what
 * it built (`.wrangler/deploy/config.json`) says where the Worker and its
 * static assets are. None of that depends on how the framework lays out its
 * project, so each framework adapter uses this module instead of carrying a
 * copy. What a framework adds — its config file, its wrapper, its command —
 * stays in that framework's module.
 */

/** Where Morph's copy of the project's Wrangler config goes in the workspace. */
export const NATIVE_WRANGLER_CONFIG_PATH = ".morph/wrangler.json";
/** Where the Cloudflare Vite plugin records the config it built for deploying. */
export const NATIVE_DEPLOY_CONFIG_PATH = ".wrangler/deploy/config.json";

const WRANGLER_CONFIG_FILES = ["wrangler.jsonc", "wrangler.json"] as const;

/**
 * Bindings Morph cannot provide yet. They are mapped to Morph's own resources
 * in a later step (docs/start-native-import-plan.md, 基礎設施對應); until then a
 * project that declares one is refused rather than built against nothing.
 */
const BINDING_KEYS = [
  "d1_databases",
  "kv_namespaces",
  "r2_buckets",
  "durable_objects",
  "queues",
  "services",
  "vectorize",
  "hyperdrive",
  "analytics_engine_datasets",
  "ai",
  "browser",
  "workflows",
  "dispatch_namespaces",
  "mtls_certificates",
  "send_email",
  "secrets_store_secrets",
] as const;

type SourceFile = Readonly<{ path: string; content: string }>;

/** How a native build runs, or why it cannot. */
export type NativeThemeBuildPlan =
  | Readonly<{
      ok: true;
      /** The project's files, prepared for the build, plus Morph's own files. */
      workspaceFiles: readonly SourceFile[];
      /** Environment the build runs with. */
      env: Readonly<Record<string, string>>;
      command: readonly string[];
    }>
  | NativeBuildRefusal;

export type NativeBuildRefusal = Readonly<{
  ok: false;
  code: string;
  message: string;
}>;

export const refuseNativeBuild = (
  code: string,
  message: string,
): NativeBuildRefusal => ({
  ok: false,
  code,
  message: `${code}: ${message}`,
});

/**
 * The bindings a Wrangler config — the project's, or the one a build wrote —
 * declares that Morph cannot map yet. Top level and `previews` alike: both
 * come from the same author setting.
 */
export function unmappedBindings(
  config: Readonly<Record<string, unknown>>,
): readonly string[] {
  const sections = [
    config,
    ...(config.previews && typeof config.previews === "object"
      ? [config.previews as Record<string, unknown>]
      : []),
  ];
  return BINDING_KEYS.filter((key) =>
    sections.some((section) => declaresSomething(section[key])),
  );
}

/**
 * Whether a binding field holds anything. Wrangler writes its normalised
 * config with every field present and empty (`durable_objects: { bindings:
 * [] }`, `queues: { producers: [], consumers: [] }`), so presence is not
 * declaration: an array declares something when it has an entry, an object
 * when any of its values does or is a plain value (`ai: { binding: "AI" }`).
 */
function declaresSomething(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    return Object.values(value).some(
      (inner) =>
        inner !== undefined &&
        inner !== null &&
        (typeof inner !== "object" || declaresSomething(inner)),
    );
  }
  return true;
}

/**
 * Directories a native build's tools and Morph write in the workspace. A
 * project's source never supplies them: `.wrangler/` holds the Cloudflare
 * plugin's record of what it built (which the artifact is collected from) and
 * Miniflare's local state (which a prerender would read as its KV, D1 and
 * R2), and `.morph/` holds Morph's wrapper and the build's records.
 */
const NATIVE_RESERVED_DIRECTORIES = [".wrangler/", ".morph/"] as const;

export function refuseNativeReservedPaths(
  files: readonly Readonly<{ path: string }>[],
): NativeBuildRefusal | null {
  const reserved = files
    .map((file) => file.path)
    .filter((path) =>
      NATIVE_RESERVED_DIRECTORIES.some((directory) =>
        path.toLowerCase().startsWith(directory),
      ),
    );
  return reserved.length > 0
    ? refuseNativeBuild(
        "NATIVE_RESERVED_PATH",
        `The project carries ${reserved.slice(0, 5).join(", ")}${reserved.length > 5 ? ", …" : ""}; .wrangler/ and .morph/ are written by the build itself and cannot come from the Theme's source.`,
      )
    : null;
}

/**
 * Morph's copy of the project's Wrangler config, the file the Cloudflare
 * plugin is pointed at, or why the project's config cannot be supplied.
 *
 * The project has exactly one `wrangler.jsonc` or `wrangler.json`; it is read
 * as written and declares no binding Morph cannot map.
 */
export function planNativeWranglerConfig(
  byPath: ReadonlyMap<string, string>,
): Readonly<{ ok: true; file: SourceFile }> | NativeBuildRefusal {
  const wranglerConfigs = WRANGLER_CONFIG_FILES.filter((path) =>
    byPath.has(path),
  );
  if (wranglerConfigs.length !== 1) {
    return refuseNativeBuild(
      "NATIVE_WRANGLER_CONFIG",
      wranglerConfigs.length === 0
        ? "The project has no wrangler.jsonc."
        : "The project has both wrangler.jsonc and wrangler.json.",
    );
  }
  let wrangler: Record<string, unknown>;
  try {
    const parsed = parseJsonc(byPath.get(wranglerConfigs[0]!)!);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    wrangler = parsed as Record<string, unknown>;
  } catch (error) {
    return refuseNativeBuild(
      "NATIVE_WRANGLER_CONFIG",
      `${wranglerConfigs[0]} could not be read (${error instanceof Error ? error.message : "invalid"}).`,
    );
  }
  const declaredBindings = unmappedBindings(wrangler);
  if (declaredBindings.length > 0) {
    return refuseNativeBuild(
      "NATIVE_BINDINGS_UNMAPPED",
      `${wranglerConfigs[0]} declares ${declaredBindings.join(", ")}, which Morph cannot map to its own resources yet.`,
    );
  }
  return {
    ok: true,
    file: {
      path: NATIVE_WRANGLER_CONFIG_PATH,
      content: `${JSON.stringify(wrangler, null, 2)}\n`,
    },
  };
}

export type NativeThemeArtifact = Readonly<{
  /** Files in Morph's artifact layout: `runtime/server/…`, `runtime/client/…`. */
  files: ReadonlyMap<string, Uint8Array | string>;
  workerEntry: string;
  clientAssetsDirectory: string;
}>;

const SERVER_PREFIX = "runtime/server";
const CLIENT_PREFIX = "runtime/client";

/** `a/b/../c` → `a/c`; `null` if it climbs out of the workspace. */
function normalizeRelative(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

const text = (content: Uint8Array | string) =>
  typeof content === "string" ? content : new TextDecoder().decode(content);

/**
 * Reads where the Cloudflare plugin put the Worker and its assets, and moves
 * them into Morph's artifact layout. Anything the build wrote outside those
 * two directories is left out.
 *
 * `outputs` are the workspace's files after the build, by workspace-relative
 * path.
 */
export function collectNativeCloudflareArtifact(
  outputs: ReadonlyMap<string, Uint8Array | string>,
): NativeThemeArtifact {
  const deploy = outputs.get(NATIVE_DEPLOY_CONFIG_PATH);
  if (deploy === undefined) {
    throw new Error(
      `NATIVE_ARTIFACT_INCOMPLETE: the build wrote no ${NATIVE_DEPLOY_CONFIG_PATH}.`,
    );
  }
  const configPathValue = (JSON.parse(text(deploy)) as { configPath?: unknown })
    .configPath;
  const serverConfigPath =
    typeof configPathValue === "string"
      ? normalizeRelative(`.wrangler/deploy/${configPathValue}`)
      : null;
  const serverConfig = serverConfigPath
    ? outputs.get(serverConfigPath)
    : undefined;
  if (!serverConfigPath || serverConfig === undefined) {
    throw new Error(
      `NATIVE_ARTIFACT_INCOMPLETE: ${NATIVE_DEPLOY_CONFIG_PATH} names a Worker config the build did not write.`,
    );
  }
  const serverDir = serverConfigPath.slice(
    0,
    serverConfigPath.lastIndexOf("/"),
  );
  const worker = JSON.parse(text(serverConfig)) as {
    main?: unknown;
    assets?: { directory?: unknown };
  };
  const main =
    typeof worker.main === "string"
      ? normalizeRelative(`${serverDir}/${worker.main}`)
      : null;
  if (!main || !main.startsWith(`${serverDir}/`) || !outputs.has(main)) {
    throw new Error(
      "NATIVE_ARTIFACT_INCOMPLETE: the Worker config names an entry the build did not write.",
    );
  }
  const clientDir =
    typeof worker.assets?.directory === "string"
      ? normalizeRelative(`${serverDir}/${worker.assets.directory}`)
      : null;
  if (
    !clientDir ||
    clientDir === serverDir ||
    clientDir.startsWith(`${serverDir}/`)
  ) {
    throw new Error(
      "NATIVE_ARTIFACT_INCOMPLETE: the Worker config names no separate static assets directory.",
    );
  }

  const files = new Map<string, Uint8Array | string>();
  for (const [path, content] of outputs) {
    if (path === serverConfigPath) continue;
    if (path.startsWith(`${serverDir}/`)) {
      files.set(
        `${SERVER_PREFIX}/${path.slice(serverDir.length + 1)}`,
        content,
      );
    } else if (path.startsWith(`${clientDir}/`)) {
      files.set(
        `${CLIENT_PREFIX}/${path.slice(clientDir.length + 1)}`,
        content,
      );
    }
  }
  if (![...files.keys()].some((path) => path.startsWith(`${CLIENT_PREFIX}/`))) {
    throw new Error(
      "NATIVE_ARTIFACT_INCOMPLETE: the build wrote no static assets.",
    );
  }
  // The Worker config moves with the Worker; its assets now sit beside it at
  // the same relative place as in Morph's own builds.
  files.set(
    `${SERVER_PREFIX}/wrangler.json`,
    `${JSON.stringify({ ...worker, assets: { ...worker.assets, directory: "../client" } }, null, 2)}\n`,
  );
  return {
    files,
    workerEntry: `${SERVER_PREFIX}/${main.slice(serverDir.length + 1)}`,
    clientAssetsDirectory: CLIENT_PREFIX,
  };
}
