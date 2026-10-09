import {
  NATIVE_PRERENDER_REFUSED_READS_PATH,
  NATIVE_PRERENDER_WITHOUT_SNAPSHOT,
  THEME_PRERENDER_CONTENT_FILE,
  type NativePrerenderContent,
} from "../compiler/theme-prerender-content";
import { GENERATED_SANDBOX_DEPENDENCY_VERSIONS } from "../compiler/theme-sandbox-dependencies.generated";
import { prepareSourcesForBuild } from "../source-language/tsx-source-language";
import {
  NATIVE_WRANGLER_CONFIG_PATH,
  collectNativeCloudflareArtifact,
  planNativeWranglerConfig,
  refuseNativeBuild,
  refuseNativeReservedPaths,
  type NativeThemeArtifact,
  type NativeThemeBuildPlan,
} from "./cloudflare-native-build";
import {
  NATIVE_BUILD_HOOKS_PATH,
  NATIVE_BUILD_LOADER_PATH,
  NATIVE_BUILD_NODE_OPTIONS,
  NATIVE_WRAPPER_CONFIG_PATH,
  nativeBuildHooksSource,
  nativeBuildLoaderSource,
  nativeWrapperConfigSource,
} from "./tanstack-start-native-wrapper";

/** The compiler identity of a native Start build: the pinned Start version. */
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
  // A config path written into the plugin call takes precedence over the
  // environment variable Morph uses to supply its own copy, so the build would
  // silently ignore it. Refused until Morph maps that case too.
  if (/\bconfigPath\s*:/.test(byPath.get(viteConfigs[0]!)!)) {
    return refuseNativeBuild(
      "NATIVE_CUSTOM_CONFIG_PATH",
      `${viteConfigs[0]} passes configPath to the Cloudflare plugin; Morph cannot supply its deployment config to that build yet.`,
    );
  }

  const reserved = refuseNativeReservedPaths(files);
  if (reserved) return reserved;

  const wrangler = planNativeWranglerConfig(byPath);
  if (!wrangler.ok) return wrangler;

  const stripped = prepareSourcesForBuild(files);
  // Morph's paths: whatever the project has there is replaced, never used.
  const morphOwned = new Set<string>([
    NATIVE_WRANGLER_CONFIG_PATH,
    NATIVE_WRAPPER_CONFIG_PATH,
    NATIVE_BUILD_HOOKS_PATH,
    NATIVE_BUILD_LOADER_PATH,
    THEME_PRERENDER_CONTENT_FILE,
    NATIVE_PRERENDER_REFUSED_READS_PATH,
  ]);
  const workspaceFiles: SourceFile[] = stripped.files.filter(
    (file) => !morphOwned.has(file.path),
  );
  workspaceFiles.push(wrangler.file);
  workspaceFiles.push({
    path: NATIVE_WRAPPER_CONFIG_PATH,
    content: nativeWrapperConfigSource({
      themeConfigPath: viteConfigs[0]!,
      allowedPackages: options.allowedPackages ?? nativeAllowedPackages(),
    }),
  });
  workspaceFiles.push({
    path: NATIVE_BUILD_HOOKS_PATH,
    content: nativeBuildHooksSource(),
  });
  workspaceFiles.push({
    path: NATIVE_BUILD_LOADER_PATH,
    content: nativeBuildLoaderSource(),
  });
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

/** A native Start build's artifact, collected by the shared Cloudflare rule. */
export type NativeStartArtifact = NativeThemeArtifact;

/** Start's artifact is wherever the Cloudflare plugin put it; nothing Start-specific. */
export const collectNativeStartArtifact = collectNativeCloudflareArtifact;
