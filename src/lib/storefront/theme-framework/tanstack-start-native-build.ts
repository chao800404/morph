import { prepareSourcesForBuild } from "../source-language/tsx-source-language";
import { parseJsonc } from "./jsonc";

/**
 * Building a TanStack Start project with its own configuration.
 *
 * docs/start-native-import-plan.md, step 1b. The project's `vite.config.ts`
 * and `wrangler.jsonc` are used as written: no Morph Vite plugin is added and
 * the config files are not rewritten. Morph supplies only what differs by
 * deployment target — here, the Wrangler config the Cloudflare plugin reads,
 * through `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH` — and normalises the output
 * into the artifact layout the artifact store and release already read.
 *
 * Not yet enabled for real builds (the materializer still refuses a Theme
 * carrying its own build configuration): a native build has no client-only
 * `preview/index.html`, so Build Preview has nothing to open until it can run
 * the built Worker. See the plan's step 1b notes.
 */

/** Where Morph's copy of the project's Wrangler config goes in the workspace. */
export const NATIVE_WRANGLER_CONFIG_PATH = ".morph/wrangler.json";
/** Where the Cloudflare Vite plugin records the config it built for deploying. */
export const NATIVE_DEPLOY_CONFIG_PATH = ".wrangler/deploy/config.json";

const WRANGLER_CONFIG_FILES = ["wrangler.jsonc", "wrangler.json"] as const;
const VITE_CONFIG_FILES = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
] as const;

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

export type NativeStartBuildPlan =
  | Readonly<{
      ok: true;
      /** The project's files, with editor markers removed, plus Morph's config copy. */
      workspaceFiles: readonly SourceFile[];
      /** Environment the build runs with. */
      env: Readonly<Record<string, string>>;
      /** Phase 0: Morph runs `vite build`; the project's own script comes later. */
      command: readonly string[];
    }>
  | Readonly<{ ok: false; code: string; message: string }>;

const refuse = (code: string, message: string): NativeStartBuildPlan => ({
  ok: false,
  code,
  message: `${code}: ${message}`,
});

export function planNativeStartBuild(
  files: readonly SourceFile[],
): NativeStartBuildPlan {
  const byPath = new Map(files.map((file) => [file.path, file.content]));

  const viteConfigs = VITE_CONFIG_FILES.filter((path) => byPath.has(path));
  if (viteConfigs.length !== 1) {
    return refuse(
      "NATIVE_VITE_CONFIG",
      viteConfigs.length === 0
        ? "The project has no vite.config.ts."
        : `The project has more than one Vite config (${viteConfigs.join(", ")}).`,
    );
  }
  // A config path written into the plugin call takes precedence over the
  // environment variable Morph uses to supply its own copy, so the build would
  // silently ignore it. Refused until Morph maps that case too.
  if (/\bconfigPath\s*:/.test(byPath.get(viteConfigs[0]!)!)) {
    return refuse(
      "NATIVE_CUSTOM_CONFIG_PATH",
      `${viteConfigs[0]} passes configPath to the Cloudflare plugin; Morph cannot supply its deployment config to that build yet.`,
    );
  }

  const wranglerConfigs = WRANGLER_CONFIG_FILES.filter((path) =>
    byPath.has(path),
  );
  if (wranglerConfigs.length !== 1) {
    return refuse(
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
    return refuse(
      "NATIVE_WRANGLER_CONFIG",
      `${wranglerConfigs[0]} could not be read (${error instanceof Error ? error.message : "invalid"}).`,
    );
  }
  const declaredBindings = BINDING_KEYS.filter((key) => {
    const value = wrangler[key];
    return Array.isArray(value)
      ? value.length > 0
      : value !== undefined && value !== null;
  });
  if (declaredBindings.length > 0) {
    return refuse(
      "NATIVE_BINDINGS_UNMAPPED",
      `${wranglerConfigs[0]} declares ${declaredBindings.join(", ")}, which Morph cannot map to its own resources yet.`,
    );
  }

  const stripped = prepareSourcesForBuild(files);
  const workspaceFiles: SourceFile[] = stripped.files.filter(
    (file) => file.path !== NATIVE_WRANGLER_CONFIG_PATH,
  );
  workspaceFiles.push({
    path: NATIVE_WRANGLER_CONFIG_PATH,
    content: `${JSON.stringify(wrangler, null, 2)}\n`,
  });

  return {
    ok: true,
    workspaceFiles,
    env: { CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: NATIVE_WRANGLER_CONFIG_PATH },
    command: ["vite", "build"],
  };
}

export type NativeStartArtifact = Readonly<{
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
export function collectNativeStartArtifact(
  outputs: ReadonlyMap<string, Uint8Array | string>,
): NativeStartArtifact {
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
