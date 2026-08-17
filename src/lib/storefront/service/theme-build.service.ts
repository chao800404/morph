import type {
  ThemeBuildArtifactStore,
  ThemeBuildArtifactStoreResult,
} from "@/lib/storefront/compiler/theme-build-artifact-store.types";
import { materializeThemeBuildInput } from "@/lib/storefront/compiler/theme-build-materializer";
import type {
  ThemeBuildRunner,
  ThemeBuildRunnerResult,
} from "@/lib/storefront/compiler/theme-build-runner.types";
import { storefrontThemeBuildDal } from "@/lib/storefront/dal/storefront-theme-build.dal";
import type {
  StorefrontThemeBuildDTO,
  StorefrontThemeBuildInput,
} from "@/lib/storefront/dto/storefront-theme-build.dto";
import { themeRevisionStore } from "@/lib/storefront/storage/theme-storage.server";
import type { ThemeRevisionStore } from "@/lib/storefront/storage/theme-storage.types";

export type RequestPreviewBuildOptions = {
  storefrontId: string;
  themeId: string;
  sourceRevisionId: string;
  createdBy?: string;
  compilerIdentity?: {
    compilerId?: string;
    compilerVersion?: string;
  };
  reuseExisting?: boolean;
  runner?: ThemeBuildRunner;
  artifactStore?: ThemeBuildArtifactStore;
};

export class ThemeBuildService {
  constructor(
    private readonly dal: typeof storefrontThemeBuildDal = storefrontThemeBuildDal,
    private readonly defaultRunner?: ThemeBuildRunner,
    private readonly materializer: typeof materializeThemeBuildInput = materializeThemeBuildInput,
    private readonly defaultArtifactStore?: ThemeBuildArtifactStore,
    private readonly revisionStore: ThemeRevisionStore = themeRevisionStore,
  ) {}

  /**
   * High-level entry point: requests or orchestrates a theme preview build.
   *
   * Idempotency & Reuse Policy:
   * 1. Default: reuseExisting = false (conservative, prevents stale identity reuse).
   * 2. If reuseExisting === true, performs full 4-tuple identity match:
   *    (sourceRevisionId + inputHash + compilerId + compilerVersion).
   * 3. If a runner is configured or provided, orchestrates the build.
   *    If no runner is configured (e.g. production before Sandbox runner), creates and returns the queued build record.
   */
  async requestPreviewBuild(
    options: RequestPreviewBuildOptions,
  ): Promise<StorefrontThemeBuildDTO> {
    const reuseExisting = options.reuseExisting ?? false;

    // 1. Identity-based reuse check. Revision bytes are obtained through the
    // storage boundary, never from a D1-specific build DAL representation.
    if (reuseExisting) {
      try {
        const dummyBuild: StorefrontThemeBuildDTO = {
          id: "temp",
          storefrontId: options.storefrontId,
          themeId: options.themeId,
          sourceRevisionId: options.sourceRevisionId,
          status: "queued",
          inputHash: null,
          compilerId: options.compilerIdentity?.compilerId ?? null,
          compilerVersion: options.compilerIdentity?.compilerVersion ?? null,
          artifactPrefix: null,
          manifestJson: null,
          diagnosticsJson: null,
          errorMessage: null,
          startedAt: null,
          completedAt: null,
          createdBy: options.createdBy ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const revision = await this.revisionStore.getRevision(
          options.storefrontId,
          options.themeId,
          options.sourceRevisionId,
        );

        if (revision) {
          const computed = this.materializer({
            build: dummyBuild,
            revision,
            compilerIdentity: options.compilerIdentity,
          });

          const existingSuccess = await this.dal.findSucceededBuildByIdentity({
            storefrontId: options.storefrontId,
            themeId: options.themeId,
            sourceRevisionId: options.sourceRevisionId,
            inputHash: computed.inputHash,
            compilerId: computed.compilerId,
            compilerVersion: computed.compilerVersion,
          });

          if (existingSuccess) {
            return existingSuccess;
          }
        }
      } catch {
        // If materialization or query fails during reuse check, continue to standard creation.
      }
    }

    // 2. Create a queued build permanently bound to the immutable sourceRevisionId.
    const build = await this.dal.createBuild(
      options.storefrontId,
      options.themeId,
      {
        sourceRevisionId: options.sourceRevisionId,
        createdBy: options.createdBy,
      },
    );

    // 3. Fallback to default runner.
    const runner = options.runner ?? this.defaultRunner;
    if (!runner) {
      return build;
    }

    // 4. Orchestrate execution with runner.
    return this.executeBuildOrchestration({
      storefrontId: options.storefrontId,
      themeId: options.themeId,
      buildId: build.id,
      compilerIdentity: options.compilerIdentity,
      runner,
      artifactStore: options.artifactStore ?? this.defaultArtifactStore,
    });
  }

  /**
   * Orchestrates the complete build lifecycle with stage-specific error handling:
   * 1. Retrieve build metadata from the Build DAL and immutable source from ThemeRevisionStore
   * 2. Pure Materialization
   * 3. Atomic CAS Start Transition (Start loser does NOT fail winner)
   * 4. Runner execution
   * 5. Artifact persistence via ThemeBuildArtifactStore
   * 6. Finalize state
   */
  async executeBuildOrchestration(params: {
    storefrontId: string;
    themeId: string;
    buildId: string;
    compilerIdentity?: { compilerId?: string; compilerVersion?: string };
    runner: ThemeBuildRunner;
    artifactStore?: ThemeBuildArtifactStore;
  }): Promise<StorefrontThemeBuildDTO> {
    const { runner } = params;
    const artifactStore = params.artifactStore ?? this.defaultArtifactStore;

    // Stage 1a: Retrieve build metadata only. Build lifecycle state remains a
    // responsibility of the build DAL.
    let build: StorefrontThemeBuildDTO;
    try {
      const found = await this.dal.getBuild(
        params.storefrontId,
        params.themeId,
        params.buildId,
      );
      if (!found) {
        throw new Error(
          `BUILD_NOT_FOUND: Theme build "${params.buildId}" not found for storefront "${params.storefrontId}" and theme "${params.themeId}".`,
        );
      }
      build = found;
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      try {
        return await this.dal.markBuildFailed(
          params.storefrontId,
          params.themeId,
          params.buildId,
          { errorMessage: errMessage },
        );
      } catch {
        throw error;
      }
    }

    // Lifecycle ownership gate: Only queued builds are eligible for source
    // materialization and runner start. Another orchestrator owns all other states.
    if (build.status !== "queued") {
      return build;
    }

    // Stage 1b: Materialize the immutable bound revision through the storage
    // abstraction. There is deliberately no fallback to mutable working files.
    let revision;
    try {
      revision = await this.revisionStore.materializeRevision(
        params.storefrontId,
        params.themeId,
        build.sourceRevisionId,
      );
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      const current = await this.dal.getBuild(
        params.storefrontId,
        params.themeId,
        params.buildId,
      );
      if (current && current.status !== "queued") {
        return current;
      }
      return await this.dal.markBuildFailed(
        params.storefrontId,
        params.themeId,
        params.buildId,
        {
          errorMessage: errMessage,
          diagnosticsJson: {
            stage: "source-revision-storage",
            error: errMessage,
          },
        },
      );
    }

    // Stage 2: Pure materialization from build identity + immutable revision DTO.
    let buildInput: StorefrontThemeBuildInput;
    try {
      buildInput = this.materializer({
        build,
        revision,
        compilerIdentity: params.compilerIdentity,
      });
    } catch (materializerError) {
      const errMessage =
        materializerError instanceof Error
          ? materializerError.message
          : String(materializerError);

      // Guard: If another worker started the build concurrently, return current state without failing winner.
      const current = await this.dal.getBuild(
        params.storefrontId,
        params.themeId,
        params.buildId,
      );
      if (current && current.status !== "queued") {
        return current;
      }

      return await this.dal.markBuildFailed(
        params.storefrontId,
        params.themeId,
        params.buildId,
        {
          errorMessage: errMessage,
          diagnosticsJson: {
            stage: "materializer",
            error: errMessage,
          },
        },
      );
    }

    // Stage 3: Transition queued -> building with atomic identity freeze.
    let startedBuild: StorefrontThemeBuildDTO;
    try {
      startedBuild = await this.dal.markBuildStarted(
        params.storefrontId,
        params.themeId,
        params.buildId,
        {
          inputHash: buildInput.inputHash,
          compilerId: buildInput.compilerId,
          compilerVersion: buildInput.compilerVersion,
        },
      );
    } catch (startError) {
      // Start CAS loser: another worker took lifecycle ownership of this build.
      // DO NOT markBuildFailed. Re-read current build state.
      const current = await this.dal.getBuild(
        params.storefrontId,
        params.themeId,
        params.buildId,
      );
      if (
        current &&
        (current.status === "building" ||
          current.status === "succeeded" ||
          current.status === "failed")
      ) {
        return current;
      }
      throw startError;
    }

    // Stage 4: Run Build via Runner.
    let runnerResult: ThemeBuildRunnerResult;
    try {
      runnerResult = await runner.run(buildInput);
    } catch (runnerException) {
      const exceptionMessage =
        runnerException instanceof Error
          ? runnerException.message
          : String(runnerException);

      return await this.dal.markBuildFailed(
        params.storefrontId,
        params.themeId,
        params.buildId,
        {
          errorMessage: `Runner exception: ${exceptionMessage}`,
          diagnosticsJson: {
            stage: "runner",
            exception: exceptionMessage,
          },
        },
      );
    }

    if (!runnerResult.success) {
      return await this.dal.markBuildFailed(
        params.storefrontId,
        params.themeId,
        params.buildId,
        {
          errorMessage:
            runnerResult.errorMessage ||
            "Theme build failed during runner execution",
          diagnosticsJson: runnerResult.diagnosticsJson,
        },
      );
    }

    // Stage 5: Persist Artifacts via ThemeBuildArtifactStore.
    if (!artifactStore) {
      return await this.dal.markBuildFailed(
        params.storefrontId,
        params.themeId,
        params.buildId,
        {
          errorMessage:
            "NO_ARTIFACT_STORE_CONFIGURED: ThemeBuildArtifactStore is required to persist build artifacts and obtain a verified artifactPrefix.",
          diagnosticsJson: {
            stage: "artifact-storage",
            error: "Missing artifactStore dependency",
          },
        },
      );
    }

    let storeResult: ThemeBuildArtifactStoreResult;
    try {
      storeResult = await artifactStore.persistBuildArtifacts({
        build: startedBuild,
        buildInput,
        artifacts: runnerResult.artifacts ?? [],
        runnerManifest: runnerResult.manifestJson,
      });
    } catch (storeException) {
      const exceptionMessage =
        storeException instanceof Error
          ? storeException.message
          : String(storeException);

      return await this.dal.markBuildFailed(
        params.storefrontId,
        params.themeId,
        params.buildId,
        {
          errorMessage: `Artifact persistence failed: ${exceptionMessage}`,
          diagnosticsJson: {
            stage: "artifact-storage",
            error: exceptionMessage,
          },
        },
      );
    }

    // Stage 6: Finalize state.
    try {
      return await this.dal.markBuildSucceeded(
        params.storefrontId,
        params.themeId,
        params.buildId,
        {
          artifactPrefix: storeResult.artifactPrefix,
          manifestJson: storeResult.manifest,
          diagnosticsJson: runnerResult.diagnosticsJson,
        },
      );
    } catch (finalizeError) {
      const finalizeMessage =
        finalizeError instanceof Error
          ? finalizeError.message
          : String(finalizeError);

      return await this.dal.markBuildFailed(
        params.storefrontId,
        params.themeId,
        params.buildId,
        {
          errorMessage: `DB finalize failed: ${finalizeMessage}`,
          diagnosticsJson: {
            stage: "finalize",
            error: finalizeMessage,
          },
        },
      );
    }
  }

  async getThemeBuild(params: {
    storefrontId: string;
    themeId: string;
    buildId: string;
  }): Promise<StorefrontThemeBuildDTO | null> {
    return this.dal.getBuild(
      params.storefrontId,
      params.themeId,
      params.buildId,
    );
  }

  async listThemeBuilds(params: {
    storefrontId: string;
    themeId: string;
    limit?: number;
    offset?: number;
  }): Promise<StorefrontThemeBuildDTO[]> {
    return this.dal.listBuilds(params.storefrontId, params.themeId, {
      limit: params.limit,
      offset: params.offset,
    });
  }
}

export const themeBuildService = new ThemeBuildService();
