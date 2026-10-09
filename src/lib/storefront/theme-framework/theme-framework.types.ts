import type { ThemeBuildContentSnapshot } from "../dto/storefront-theme-build.dto";
import type { NativePrerenderContent } from "../compiler/theme-prerender-content";
import type { ThemeRouteRegistry } from "../compiler/theme-route-registry";
import type {
  NativeThemeArtifact,
  NativeThemeBuildPlan,
} from "./cloudflare-native-build";
import type {
  PlanThemeWorkspaceInput,
  PrepareThemeWorkspaceResult,
  ThemePreviewRuntime,
} from "../compiler/theme-sandbox-workspace";

/**
 * Every framework id Morph knows of. Knowing an id is not supporting it: an
 * id is available only when `THEME_FRAMEWORKS` has an adapter for it
 * (theme-framework/index.ts), and selecting one that has none is refused with
 * `THEME_FRAMEWORK_UNAVAILABLE`, never served by another framework.
 *
 * `astro` is named ahead of its adapter (docs/astro-theme-plan.md, A1) so a
 * build can record it and be refused for it; nothing offers it to anyone yet.
 */
export const THEME_FRAMEWORK_IDS = ["tanstack-start", "astro"] as const;

export type ThemeFrameworkId = (typeof THEME_FRAMEWORK_IDS)[number];

/**
 * The framework a record that names none is: every build, preview and
 * release from before frameworks were recorded is TanStack Start, the only
 * framework there was.
 */
export const UNRECORDED_THEME_FRAMEWORK: ThemeFrameworkId = "tanstack-start";

/**
 * A framework's own dev server for its Live Preview: `astro dev` with the
 * wrapper config at `configPath` (workspace-relative), in the workspace
 * root, with `env` added to the process's otherwise empty environment.
 */
export type ThemePreviewDevServer = Readonly<{
  kind: "astro-dev";
  configPath: string;
  env: Readonly<Record<string, string>>;
}>;

export type ThemeFrameworkSourceFile = Readonly<{
  path: string;
  content?: string | null;
}>;

/**
 * What a front-end framework contributes to Morph, and nothing else.
 *
 * docs/multi-runtime-theme-plan.md, step 2. A framework adapter owns how a
 * project of that framework is laid out, previewed, built and shipped:
 *
 * - detection: whether a Theme's source is written for it;
 * - the workspace a preview or a build runs in (generated config, bridge,
 *   entry files);
 * - where its preview is framed;
 * - which build outputs make a complete artifact, and how they are described.
 *
 * It owns no part of the shared core. Authorization, optimistic concurrency,
 * content documents, publish, release, rollback and the preview write fence
 * stay in the services that already hold them, so there is no method here for
 * any of them — and theme-framework.test.ts fails if an adapter module starts
 * importing them. File-language work (parse, source locations, content
 * fields, rewrite) is a separate layer: src/lib/storefront/source-language/.
 */
export type ThemeFrameworkAdapter = Readonly<{
  id: ThemeFrameworkId;
  /** Whether these source files are a project written for this framework. */
  detect(files: readonly ThemeFrameworkSourceFile[]): boolean;
  /**
   * The exact workspace a Live Preview or a build runs in: authored files
   * after the file-language passes, plus everything the framework needs
   * generated around them.
   */
  planWorkspace(input: PlanThemeWorkspaceInput): PrepareThemeWorkspaceResult;
  preview: Readonly<{
    /** Path on the preview's own origin where the editor frames it. */
    framePath(runtime: ThemePreviewRuntime | undefined): string;
    /**
     * How the dev server is started, when it is not Vite reading the
     * workspace's generated `vite.config.ts` (the default). Both transports
     * read it, so a container and the local sidecar start the same server.
     */
    devServer?: ThemePreviewDevServer;
  }>;
  build: Readonly<{
    /** The artifact file a preview of the build opens. */
    artifactEntry(routeRegistry: ThemeRouteRegistry | null): string;
    /** Refuses a build whose outputs do not make a complete artifact. */
    verifyArtifact(input: {
      artifactPaths: ReadonlySet<string>;
      routeRegistry: ThemeRouteRegistry | null;
      contentSnapshot: ThemeBuildContentSnapshot | undefined;
    }): void;
    /** How the artifact describes itself to the artifact store and release. */
    manifestMetadata(
      routeRegistry: ThemeRouteRegistry | null,
    ): Record<string, unknown> | undefined;
    /**
     * Building the project with its own configuration (start-native-import-plan
     * step 1b): the workspace and environment, then the output moved into the
     * artifact layout above, and that artifact's own entry, completeness rule
     * and description. A native artifact has no client-only preview page; it
     * is previewed by running its Worker.
     */
    native: Readonly<{
      /** The compiler identity a native build of this framework records. */
      compilerIdentity(): Readonly<{ id: string; version: string }>;
      /** The project's routes, or null if they cannot be read. */
      routeRegistry(
        files: readonly Readonly<{ path: string; content: string }>[],
      ): ThemeRouteRegistry | null;
      /** Packages a build may import: its toolchain's, plus `extra`. */
      allowedPackages(extra?: Iterable<string>): readonly string[];
      plan(
        files: readonly Readonly<{ path: string; content: string }>[],
        options?: Readonly<{
          allowedPackages?: readonly string[];
          prerenderContent?: NativePrerenderContent;
          /** The build pass's nonce, for frameworks whose records carry one. */
          nonce?: string;
        }>,
      ): NativeThemeBuildPlan;
      /**
       * Whether the prerender read only sealed content, from the records a
       * finished build left; null if it did. A framework whose prerender
       * records only refused reads (Start) has none.
       */
      prerenderRecordsFailure?(
        outputs: ReadonlyMap<string, Uint8Array | string>,
        nonce: string,
      ): Readonly<{ stage: string; message: string }> | null;
      /**
       * Why a build that exited non-zero failed, when its records say: a
       * refused content read is `prerender-content`, which the build passes
       * act on. Null when the records say nothing.
       */
      failedBuildCause?(
        outputs: ReadonlyMap<string, Uint8Array | string>,
        nonce: string,
      ): Readonly<{ stage: string; message: string }> | null;
      collect(
        outputs: ReadonlyMap<string, Uint8Array | string>,
      ): NativeThemeArtifact;
      artifactEntry: string;
      verifyArtifact(input: {
        artifactPaths: ReadonlySet<string>;
        routeRegistry: ThemeRouteRegistry | null;
        contentSnapshot: ThemeBuildContentSnapshot | undefined;
      }): void;
      manifestMetadata(
        routeRegistry: ThemeRouteRegistry | null,
      ): Record<string, unknown>;
    }>;
  }>;
}>;
