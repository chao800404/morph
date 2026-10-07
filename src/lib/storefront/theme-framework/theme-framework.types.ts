import type { ThemeBuildContentSnapshot } from "../dto/storefront-theme-build.dto";
import type { NativePrerenderContent } from "../compiler/theme-prerender-content";
import type { ThemeRouteRegistry } from "../compiler/theme-route-registry";
import type {
  NativeStartArtifact,
  NativeStartBuildPlan,
} from "./tanstack-start-native-build";
import type {
  PlanThemeWorkspaceInput,
  PrepareThemeWorkspaceResult,
  ThemePreviewRuntime,
} from "../compiler/theme-sandbox-workspace";

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
export type ThemeFrameworkId = "tanstack-start";

export type ThemeFrameworkSourceFile = Readonly<{
  path: string;
  content?: string | null;
}>;

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
      plan(
        files: readonly Readonly<{ path: string; content: string }>[],
        options?: Readonly<{
          allowedPackages?: readonly string[];
          prerenderContent?: NativePrerenderContent;
        }>,
      ): NativeStartBuildPlan;
      collect(
        outputs: ReadonlyMap<string, Uint8Array | string>,
      ): NativeStartArtifact;
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
