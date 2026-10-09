import {
  NATIVE_PRERENDER_REFUSED_READS_PATH,
  THEME_PRERENDER_CONTENT_FILE,
  type NativePrerenderContent,
} from "../compiler/theme-prerender-content";
import {
  NATIVE_DEPLOY_CONFIG_PATH,
  NATIVE_WRANGLER_CONFIG_PATH,
  collectNativeCloudflareArtifact,
  planNativeWranglerConfig,
  refuseNativeBuild,
  refuseNativeReservedPaths,
  unmappedBindings,
  type NativeThemeArtifact,
  type NativeThemeBuildPlan,
} from "./cloudflare-native-build";
import {
  ASTRO_BUILD_INTEGRATION_PATH,
  ASTRO_PRERENDER_SHIM_MARKER,
  ASTRO_WRAPPER_CONFIG_PATH,
  NATIVE_PRERENDER_PAGES_PATH,
  NATIVE_PRERENDER_STAMPS_PATH,
  astroPrerenderWorkspaceFiles,
} from "./astro-native-prerender";
import {
  NATIVE_BUILD_HOOKS_PATH,
  NATIVE_BUILD_LOADER_PATH,
  NATIVE_BUILD_NODE_OPTIONS,
  nativeBuildHooksSource,
  nativeBuildLoaderSource,
} from "./tanstack-start-native-wrapper";
import { parseJsonc } from "./jsonc";
import { themeToolchainForFramework } from "./theme-toolchains";

/**
 * Building an Astro project with its own configuration.
 *
 * docs/astro-theme-plan.md 5 (A4). The project's `astro.config.*` and
 * `wrangler.jsonc` are used as written. Morph supplies, beside them in
 * `.morph/`:
 *
 * - the Wrangler config copy the Cloudflare plugin reads
 *   (`CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`), shared with Start
 *   (cloudflare-native-build.ts);
 * - a wrapper config that imports the project's unchanged and adds Morph's
 *   integration last: the import guard, and the sealed content for
 *   prerendering (astro-native-prerender.ts);
 * - the module hook Start's build loads first, which gives every
 *   `cloudflare(...)` from `@cloudflare/vite-plugin` `inspectorPort: false`
 *   for this build. The adapter calls that plugin for the server it
 *   prerenders through, so the debugger port docs/astro-theme-plan.md 7.2
 *   names is not opened, and the author's `inspectorPort` is not rewritten;
 *   whether the artifact is the same either way is a build test.
 *
 * The artifact is the Cloudflare plugin's, collected by the shared rule, after
 * the Astro-specific refusals of 5.2: Morph refuses at build time what it
 * would otherwise drop or reject only at deploy time.
 */

export const NATIVE_ASTRO_COMPILER_ID = "astro-native";

const ASTRO_CONFIG_FILES = [
  "astro.config.mjs",
  "astro.config.js",
  "astro.config.ts",
  "astro.config.mts",
] as const;

type SourceFile = Readonly<{ path: string; content: string }>;

/** The pinned Astro toolchain's compiler identity: Astro's own version. */
export function nativeAstroCompilerIdentity(): Readonly<{
  id: string;
  version: string;
}> {
  const version = themeToolchainForFramework("astro").directDependencies.astro;
  if (!version) {
    throw new Error("ASTRO_TOOLCHAIN_INCOMPLETE: the Astro toolchain has no astro.");
  }
  return { id: NATIVE_ASTRO_COMPILER_ID, version };
}

/**
 * Packages an Astro build may import: the Astro toolchain's own direct
 * dependencies — the only ones its container can resolve — plus `extra`.
 */
export function nativeAstroAllowedPackages(
  extra: Iterable<string> = [],
): readonly string[] {
  return [
    ...new Set([
      ...Object.keys(themeToolchainForFramework("astro").directDependencies),
      ...extra,
    ]),
  ].sort();
}

/** Morph's own paths in an Astro build's workspace. */
const MORPH_OWNED = new Set<string>([
  NATIVE_WRANGLER_CONFIG_PATH,
  ASTRO_WRAPPER_CONFIG_PATH,
  ASTRO_BUILD_INTEGRATION_PATH,
  NATIVE_BUILD_HOOKS_PATH,
  NATIVE_BUILD_LOADER_PATH,
  THEME_PRERENDER_CONTENT_FILE,
  NATIVE_PRERENDER_REFUSED_READS_PATH,
  NATIVE_PRERENDER_STAMPS_PATH,
  NATIVE_PRERENDER_PAGES_PATH,
]);

export function planNativeAstroBuild(
  files: readonly SourceFile[],
  options: Readonly<{
    allowedPackages?: readonly string[];
    prerenderContent?: NativePrerenderContent;
    /**
     * This build's nonce (astro-native-prerender.ts). A runner passes the one
     * it checks the records with; absent — a plan made only to see whether
     * the project can be built — a fresh one nobody holds, so records made
     * from it can never be accepted.
     */
    nonce?: string;
  }> = {},
): NativeThemeBuildPlan {
  const byPath = new Map(files.map((file) => [file.path, file.content]));

  const configs = ASTRO_CONFIG_FILES.filter((path) => byPath.has(path));
  if (configs.length !== 1) {
    return refuseNativeBuild(
      "NATIVE_ASTRO_CONFIG",
      configs.length === 0
        ? "The project has no astro.config.mjs."
        : `The project has more than one Astro config (${configs.join(", ")}).`,
    );
  }
  const config = byPath.get(configs[0]!)!;
  // A config path passed to the adapter wins over the environment variable
  // Morph supplies its own copy through; the build would ignore Morph's.
  if (/\bconfigPath\s*:/.test(config)) {
    return refuseNativeBuild(
      "NATIVE_CUSTOM_CONFIG_PATH",
      `${configs[0]} passes configPath to the Cloudflare adapter; Morph cannot supply its deployment config to that build yet.`,
    );
  }

  const reserved = refuseNativeReservedPaths(files);
  if (reserved) return reserved;

  // The adapter reads a wrangler.toml as readily as a .jsonc, and Morph reads
  // no TOML: its bindings would reach the build unchecked.
  if (byPath.has("wrangler.toml")) {
    return refuseNativeBuild(
      "NATIVE_WRANGLER_CONFIG",
      "The project has a wrangler.toml, which Morph cannot read; write it as wrangler.jsonc, or remove it to use the adapter's defaults.",
    );
  }
  // A Wrangler config is optional for Astro: without one the adapter writes
  // its own defaults, as it does outside Morph. Either way the Worker config
  // the build writes is held to the same rules (collectNativeAstroArtifact).
  const hasOwnWranglerConfig =
    byPath.has("wrangler.jsonc") || byPath.has("wrangler.json");
  const wrangler = hasOwnWranglerConfig
    ? planNativeWranglerConfig(byPath)
    : null;
  if (wrangler && !wrangler.ok) return wrangler;

  const workspaceFiles: SourceFile[] = files.filter(
    (file) => !MORPH_OWNED.has(file.path),
  );
  if (wrangler) workspaceFiles.push(wrangler.file);
  workspaceFiles.push(
    ...astroPrerenderWorkspaceFiles({
      themeConfigPath: configs[0]!,
      prerenderContent: options.prerenderContent,
      nonce: options.nonce ?? freshNonce(),
      allowedPackages: options.allowedPackages ?? nativeAstroAllowedPackages(),
    }),
  );
  workspaceFiles.push({
    path: NATIVE_BUILD_HOOKS_PATH,
    content: nativeBuildHooksSource(),
  });
  workspaceFiles.push({
    path: NATIVE_BUILD_LOADER_PATH,
    content: nativeBuildLoaderSource(),
  });

  return {
    ok: true,
    workspaceFiles,
    env: {
      ...(wrangler
        ? { CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: NATIVE_WRANGLER_CONFIG_PATH }
        : {}),
      NODE_OPTIONS: NATIVE_BUILD_NODE_OPTIONS,
      ASTRO_TELEMETRY_DISABLED: "1",
    },
    command: ["astro", "build", "--config", ASTRO_WRAPPER_CONFIG_PATH],
  };
}

function freshNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const text = (content: Uint8Array | string) =>
  typeof content === "string" ? content : new TextDecoder().decode(content);

type WorkerConfig = Record<string, unknown> & {
  kv_namespaces?: unknown;
  images?: unknown;
  cache?: unknown;
  previews?: Record<string, unknown>;
};

/**
 * The 5.2 refusals, read from the Worker config the build wrote. Each names
 * the author's setting and how to change it. Top level and `previews` are
 * both read: both come from the same author setting, and reading one would
 * rely on the adapter always writing both.
 */
function refuseAstroWorkerConfig(worker: WorkerConfig): void {
  const sections: WorkerConfig[] = [
    worker,
    ...(worker.previews && typeof worker.previews === "object"
      ? [worker.previews as WorkerConfig]
      : []),
  ];
  for (const section of sections) {
    const kv = Array.isArray(section.kv_namespaces) ? section.kv_namespaces : [];
    if (
      kv.some(
        (namespace) =>
          namespace &&
          typeof namespace === "object" &&
          (namespace as { binding?: unknown }).binding === "SESSION",
      )
    ) {
      throw new Error(
        'ASTRO_SESSION_BINDING_UNSUPPORTED: The build adds a SESSION KV binding for Astro sessions, which Morph cannot provide yet. Set `session: false` in astro.config if the Theme does not use sessions.',
      );
    }
    if (section.images !== undefined && section.images !== null) {
      throw new Error(
        'ASTRO_IMAGES_BINDING_UNSUPPORTED: The build adds an Images binding (the adapter\'s default imageService "cloudflare-binding"), which Morph cannot provide. Set `imageService: "passthrough"` or `"compile"` in the cloudflare() options.',
      );
    }
    if (
      section.cache &&
      typeof section.cache === "object" &&
      (section.cache as { enabled?: unknown }).enabled === true
    ) {
      throw new Error(
        "ASTRO_WORKER_CACHE_UNSUPPORTED: The build turns on the Worker's own cache (cache.provider cacheCloudflare()), which is not keyed by release, so a rollback could serve another release's pages. Remove the cache provider from astro.config.",
      );
    }
  }
}

/**
 * An Astro build's artifact: the 5.2 refusals, nothing of the prerender
 * machinery, then the Cloudflare plugin's Worker and assets by the shared
 * rule.
 */
export function collectNativeAstroArtifact(
  outputs: ReadonlyMap<string, Uint8Array | string>,
): NativeThemeArtifact {
  const deploy = outputs.get(NATIVE_DEPLOY_CONFIG_PATH);
  if (deploy !== undefined) {
    const configPath = (JSON.parse(text(deploy)) as { configPath?: unknown })
      .configPath;
    const serverConfig =
      typeof configPath === "string"
        ? outputs.get(
            `.wrangler/deploy/${configPath}`
              .split("/")
              .reduce<string[]>((parts, part) => {
                if (part === "..") parts.pop();
                else if (part && part !== ".") parts.push(part);
                return parts;
              }, [])
              .join("/"),
          )
        : undefined;
    if (serverConfig !== undefined) {
      const worker = parseJsonc(text(serverConfig));
      if (worker && typeof worker === "object" && !Array.isArray(worker)) {
        refuseAstroWorkerConfig(worker as WorkerConfig);
        // Whatever wrote it — the project's config, or the adapter's defaults
        // when there is none — the Worker config the build produced declares
        // no binding Morph cannot map. Checked here, on the build's output,
        // because the adapter can add bindings the project never wrote.
        const bindings = unmappedBindings(worker as WorkerConfig);
        if (bindings.length > 0) {
          throw new Error(
            `NATIVE_BINDINGS_UNMAPPED: The Worker config the build wrote declares ${bindings.join(", ")}, which Morph cannot map to its own resources yet.`,
          );
        }
      }
    }
  }
  const artifact = collectNativeCloudflareArtifact(outputs);
  for (const [path, content] of artifact.files) {
    if (path.includes("/.prerender/")) {
      throw new Error(
        `NATIVE_PRERENDER_SHIM_LEAKED: the prerender bundle is in the artifact (${path}).`,
      );
    }
    if (path.startsWith("runtime/server/") && text(content).includes(ASTRO_PRERENDER_SHIM_MARKER)) {
      throw new Error(
        `NATIVE_PRERENDER_SHIM_LEAKED: Morph's prerender wrapper is in the deployable Worker (${path}).`,
      );
    }
    if (path.includes(".wrangler/")) {
      throw new Error(
        `NATIVE_ARTIFACT_TOOL_STATE: the build's tool state is in the artifact (${path}).`,
      );
    }
    if (path.includes(".morph/")) {
      throw new Error(
        `NATIVE_PRERENDER_SHIM_LEAKED: a Morph build record is in the artifact (${path}).`,
      );
    }
  }
  return artifact;
}
