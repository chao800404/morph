import {
  NATIVE_PRERENDER_REFUSED_READS_PATH,
  NATIVE_PRERENDER_WITHOUT_SNAPSHOT,
  THEME_PRERENDER_CONTENT_FILE,
  type NativePrerenderContent,
} from "../compiler/theme-prerender-content";
import { GENERATED_SANDBOX_DEPENDENCY_VERSIONS } from "../compiler/theme-sandbox-dependencies.generated";
import { prepareSourcesForBuild } from "../source-language/tsx-source-language";
import {
  NATIVE_PROOF_VERSION,
  NATIVE_RESOLUTION_PLUGIN_PATH,
  nativeHtmlAssets,
  nativeResolutionPluginSource,
  nativeStartSdkFiles,
  verifyNativeStartSdkProof,
  type NativeBuildProof,
} from "./native-start-proof";
import {
  NATIVE_EMITTED_WORKER_CONFIG_LABEL,
  NATIVE_WRANGLER_CONFIG_PATH,
  checkNativeWranglerConfig,
  collectNativeCloudflareArtifact,
  planNativeWranglerConfig,
  refuseNativeBuild,
  refuseNativeProjectFiles,
  refuseNativeReservedPaths,
  type NativeThemeArtifact,
  type NativeThemeBuildPlan,
} from "./cloudflare-native-build";
import {
  NATIVE_ADAPTER_CALLS_PATH,
  NATIVE_ADAPTER_REFUSAL_PATH,
  NATIVE_BUILD_HOOKS_PATH,
  NATIVE_BUILD_LOADER_PATH,
  NATIVE_BUILD_NODE_OPTIONS,
  NATIVE_WRAPPER_CONFIG_PATH,
  nativeBuildHooksSource,
  nativeBuildLoaderSource,
  nativeWrapperConfigSource,
} from "./tanstack-start-native-wrapper";

/**
 * The compiler identity of a native Start build: the pinned Start version.
 *
 * Also the admission boundary of the Wrangler key contract
 * (cloudflare-native-build.ts): an artifact whose immutable
 * `manifest.compilerId` is this one is held to the contract when it is
 * collected and deployed; every other artifact keeps the checks it was built
 * under (theme-worker-deployment-plan.ts).
 */
export const NATIVE_START_COMPILER_ID = "tanstack-start-native";

export {
  NATIVE_DEPLOY_CONFIG_PATH,
  NATIVE_WRANGLER_CONFIG_PATH,
} from "./cloudflare-native-build";

/**
 * Building a TanStack Start project with its own configuration.
 *
 * docs/start-native-import-plan.md, step 1b. The project's `vite.config.ts`
 * and `wrangler.jsonc` are used as written and never rewritten. Morph supplies
 * what differs by deployment target — the Wrangler config the Cloudflare
 * plugin reads, through `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH` — builds
 * through a wrapper config that imports the project's own and adds only an
 * import guard and the frozen-content prerender plugin, with a module hook
 * that turns the Cloudflare plugin's debugger port off for the build
 * (tanstack-start-native-wrapper.ts), and normalises the output into
 * the artifact layout the artifact store and release already read.
 *
 * The Wrangler config copy, the binding check and the artifact collection are
 * the deployment target's, not Start's, and live in cloudflare-native-build.ts.
 *
 * Behind a server switch (theme-build-service.factory): a native build has no
 * client-only `preview/index.html`, so it is previewed only by running the
 * built Worker (isolated Build Preview).
 */

const VITE_CONFIG_FILES = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
] as const;

type SourceFile = Readonly<{ path: string; content: string }>;

/** A native Start build's plan; its shape is every native build's. */
export type NativeStartBuildPlan = NativeThemeBuildPlan;

/**
 * Packages a native build may import: the packages installed in the pinned
 * Sandbox toolchain — the only ones a build in the container can resolve at
 * all — plus `extra`.
 */
export function nativeAllowedPackages(
  extra: Iterable<string> = [],
): readonly string[] {
  return [
    ...new Set([
      ...Object.keys(GENERATED_SANDBOX_DEPENDENCY_VERSIONS),
      ...extra,
    ]),
  ].sort();
}

export function planNativeStartBuild(
  files: readonly SourceFile[],
  options: Readonly<{
    /** Packages the build may import; the pinned toolchain when absent. */
    allowedPackages?: readonly string[];
    /**
     * What the prerender may read (theme-prerender-content); absent, every
     * content read is refused, as for a build with no sealed content.
     */
    prerenderContent?: NativePrerenderContent;
    /** The build pass's nonce (native-start-proof.ts). */
    nonce?: string;
  }> = {},
): NativeStartBuildPlan {
  const byPath = new Map(files.map((file) => [file.path, file.content]));

  const viteConfigs = VITE_CONFIG_FILES.filter((path) => byPath.has(path));
  if (viteConfigs.length !== 1) {
    return refuseNativeBuild(
      "NATIVE_VITE_CONFIG",
      viteConfigs.length === 0
        ? "The project has no vite.config.ts."
        : `The project has more than one Vite config (${viteConfigs.join(", ")}).`,
    );
  }
  // The Cloudflare plugin's options (`configPath`, `config`, auxiliary
  // Workers, `remoteBindings`, ...) are checked where the project calls the
  // plugin, by the loader shim (`nativeBuildLoaderSource`), not here: only
  // the call sees the options as the plugin would.

  const reserved = refuseNativeReservedPaths(files);
  if (reserved) return reserved;

  // The Wrangler key contract, author shape. The copy the plugin reads
  // carries only what the contract keeps (no `dev`), its paths rebased.
  const wrangler = planNativeWranglerConfig(byPath, { contract: "start-ssr" });
  if (!wrangler.ok) return wrangler;

  const stripped = prepareSourcesForBuild(files);
  // Morph's paths: whatever the project has there is replaced, never used.
  const morphOwned = new Set<string>([
    NATIVE_WRANGLER_CONFIG_PATH,
    NATIVE_WRAPPER_CONFIG_PATH,
    NATIVE_BUILD_HOOKS_PATH,
    NATIVE_BUILD_LOADER_PATH,
    NATIVE_RESOLUTION_PLUGIN_PATH,
    THEME_PRERENDER_CONTENT_FILE,
    NATIVE_PRERENDER_REFUSED_READS_PATH,
  ]);
  const workspaceFiles: SourceFile[] = stripped.files.filter(
    (file) => !morphOwned.has(file.path),
  );
  // The pass's own nonce, carried by the SDK sentinels and the resolution
  // records (native-start-proof.ts). A plan made only to see whether the
  // project can be built (the materializer's) has none and is not built.
  const nonce = options.nonce ?? "";
  workspaceFiles.push(wrangler.file);
  workspaceFiles.push({
    path: NATIVE_WRAPPER_CONFIG_PATH,
    content: nativeWrapperConfigSource({
      themeConfigPath: viteConfigs[0]!,
      allowedPackages: options.allowedPackages ?? nativeAllowedPackages(),
      resolutionNonce: nonce,
    }),
  });
  workspaceFiles.push({
    path: NATIVE_RESOLUTION_PLUGIN_PATH,
    content: nativeResolutionPluginSource(),
  });
  workspaceFiles.push({
    path: NATIVE_BUILD_HOOKS_PATH,
    content: nativeBuildHooksSource(),
  });
  workspaceFiles.push({
    path: NATIVE_BUILD_LOADER_PATH,
    content: nativeBuildLoaderSource({
      adapterOptions: { configFile: viteConfigs[0]!, nonce },
    }),
  });
  // The Morph SDK the wrapper resolves `@morph/sdk` and `@morph/sdk/start` to,
  // each entry carrying this pass's sentinel. Under .morph/, which a project
  // cannot carry (refuseNativeReservedPaths).
  workspaceFiles.push(...nativeStartSdkFiles(nonce));
  workspaceFiles.push({
    path: THEME_PRERENDER_CONTENT_FILE,
    content: JSON.stringify(
      options.prerenderContent ?? NATIVE_PRERENDER_WITHOUT_SNAPSHOT,
    ),
  });

  return {
    ok: true,
    workspaceFiles,
    env: {
      CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: NATIVE_WRANGLER_CONFIG_PATH,
      NODE_OPTIONS: NATIVE_BUILD_NODE_OPTIONS,
    },
    command: ["vite", "build", "--config", NATIVE_WRAPPER_CONFIG_PATH],
  };
}

const UNCHECKED_CALL =
  'builds the Cloudflare plugin without calling cloudflare() from an import of @cloudflare/vite-plugin, so Morph cannot check its options. Import cloudflare from "@cloudflare/vite-plugin" and call it in the config.';

/** The options a checked call may have passed (the shim's own table). */
const CHECKED_OPTION_KEYS = new Set([
  "viteEnvironment",
  "inspectorPort",
  "persistState",
  "remoteBindings",
  "tunnel",
]);

/**
 * Why the shim's record of checked `cloudflare()` calls does not vouch for
 * this build, or null: written by this pass, at least one call, each with
 * only options the check accepts, and one of them naming the environment
 * that built the Worker (or naming none, the plugin's default).
 */
export function nativeAdapterCallsRefusal(
  content: Uint8Array | string | undefined,
  nonce: string,
  workerEnvironment: string | null,
): string | null {
  if (content === undefined) return UNCHECKED_CALL;
  let record: unknown;
  try {
    record = JSON.parse(
      typeof content === "string" ? content : new TextDecoder().decode(content),
    );
  } catch {
    return UNCHECKED_CALL;
  }
  const calls = (record as { calls?: unknown } | null)?.calls;
  if (
    !record ||
    typeof record !== "object" ||
    (record as { nonce?: unknown }).nonce !== nonce ||
    !Array.isArray(calls) ||
    calls.length === 0
  ) {
    return UNCHECKED_CALL;
  }
  for (const call of calls as unknown[]) {
    const keys = (call as { keys?: unknown } | null)?.keys;
    if (
      !Array.isArray(keys) ||
      keys.some((key) => typeof key !== "string" || !CHECKED_OPTION_KEYS.has(key))
    ) {
      return UNCHECKED_CALL;
    }
  }
  const names = (calls as Array<{ environment?: unknown }>).map(
    (call) => call.environment,
  );
  if (
    workerEnvironment !== null &&
    !names.includes(workerEnvironment) &&
    !names.includes(null)
  ) {
    return `builds its Worker in the "${workerEnvironment}" environment, which no checked cloudflare() call names, so Morph cannot check the options it was built with. Call cloudflare() once, from an import of @cloudflare/vite-plugin.`;
  }
  return null;
}

/**
 * The adapter-option refusal the loader shim recorded
 * (`NATIVE_ADAPTER_REFUSAL_PATH`), as the build's message.
 */
export function nativeAdapterRefusalMessage(
  content: Uint8Array | string,
): string {
  try {
    const value = JSON.parse(
      typeof content === "string" ? content : new TextDecoder().decode(content),
    ) as { message?: unknown };
    if (
      typeof value.message === "string" &&
      /^NATIVE_(ADAPTER_OPTION|REMOTE_BINDING): /.test(value.message)
    ) {
      return value.message;
    }
  } catch {
    // Reported below.
  }
  return "NATIVE_ADAPTER_OPTION: vite.config passes an option to cloudflare() that Morph refuses. Remove it; keep wrangler.jsonc at the project root.";
}

/** A native Start build's artifact, collected by the shared Cloudflare rule. */
export type NativeStartArtifact = NativeThemeArtifact;

/**
 * Start's artifact is wherever the Cloudflare plugin put it, collected by the
 * shared rule, then held to the Wrangler key contract in its emitted shape:
 * the Worker config the plugin wrote declares nothing the contract does not
 * keep, and no local variables file was written beside the Worker. The same
 * check runs again at deploy (theme-worker-deployment-plan.ts).
 *
 * Then the SDK resolution proof (native-start-proof.ts), checked here, in
 * Morph's process, against the bytes the build wrote; the verified result,
 * with the artifact's static HTML, is the manifest's `nativeProof`.
 * `nonce` is the pass's own, the one its plan was made with.
 */
export function collectNativeStartArtifact(
  outputs: ReadonlyMap<string, Uint8Array | string>,
  nonce = "",
  /**
   * The build's input files, as the plan was given them: the Worker-graph
   * source check reads them after the same preparation the plan applied,
   * never the workspace the build could change.
   */
  files: ReadonlyArray<Readonly<{ path: string; content: string }>> = [],
): NativeStartArtifact {
  const artifact = collectNativeCloudflareArtifact(outputs);
  const config = artifact.files.get("runtime/server/wrangler.json");
  let worker: unknown = null;
  try {
    worker = JSON.parse(
      typeof config === "string"
        ? config
        : new TextDecoder().decode(config ?? new Uint8Array()),
    );
  } catch {
    // Refused below as not a JSON object.
  }
  const refused = checkNativeWranglerConfig(worker, {
    shape: "emitted",
    file: NATIVE_EMITTED_WORKER_CONFIG_LABEL,
  });
  if (refused) throw new Error(refused.message);
  const leaked = refuseNativeProjectFiles([...artifact.files.keys()]);
  if (leaked) {
    throw new Error(
      `${leaked.message} (The build wrote it into the artifact.)`,
    );
  }
  // A config that catches the adapter-option refusal and calls the plugin
  // again still built with an option Morph refused.
  const adapterRefusal = outputs.get(NATIVE_ADAPTER_REFUSAL_PATH);
  if (adapterRefusal !== undefined) {
    throw new Error(nativeAdapterRefusalMessage(adapterRefusal));
  }
  const configFile = VITE_CONFIG_FILES.find((path) => outputs.has(path));
  const sdk = verifyNativeStartSdkProof({
    outputs,
    directories: artifact.sourceDirectories,
    nonce,
    configFile,
    workerEntry: `${artifact.sourceDirectories.server}/${artifact.workerEntry.slice("runtime/server/".length)}`,
    sources: new Map(
      prepareSourcesForBuild(files).files.map((file) => [file.path, file.content]),
    ),
  });
  // The Worker was built by a checked cloudflare() call of this pass, whose
  // options Morph holds to the table again here, and whose environment is
  // the one that built the Worker.
  const unchecked = nativeAdapterCallsRefusal(
    outputs.get(NATIVE_ADAPTER_CALLS_PATH),
    nonce,
    sdk.environments.find((environment) => environment.output === "server")
      ?.name ?? null,
  );
  if (unchecked) {
    throw new Error(
      `NATIVE_ADAPTER_OPTION: ${configFile ?? "vite.config.ts"} ${unchecked}`,
    );
  }
  const nativeProof: NativeBuildProof = {
    version: NATIVE_PROOF_VERSION,
    sdk: { environments: sdk.environments },
    toolchain: { vite: sdk.vite },
    html: nativeHtmlAssets({
      artifactFiles: artifact.files,
      outputs,
      publicDir: sdk.publicDir,
    }),
  };
  return { ...artifact, metadata: { nativeProof } };
}
