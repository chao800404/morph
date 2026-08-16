import { materializeThemeBuildInput } from "@/lib/storefront/compiler/theme-build-materializer";
import type { ThemeBuildRunner } from "@/lib/storefront/compiler/theme-build-runner.types";
import { storefrontThemeBuildDal } from "@/lib/storefront/dal/storefront-theme-build.dal";
import type {
  StorefrontThemeBuildDTO,
  StorefrontThemeBuildInput,
} from "@/lib/storefront/dto/storefront-theme-build.dto";

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
};

export class ThemeBuildService {
  constructor(
    private readonly dal: typeof storefrontThemeBuildDal = storefrontThemeBuildDal,
    private readonly defaultRunner?: ThemeBuildRunner,
    private readonly materializer: typeof materializeThemeBuildInput = materializeThemeBuildInput,
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

    // 1. Identity-based reuse check
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

        const revision = await this.dal.getRevision(
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
        // If materialization or query fails during reuse check, continue to standard creation
      }
    }

    // 2. Create a queued build permanently bound to the immutable sourceRevisionId
    const build = await this.dal.createBuild(
      options.storefrontId,
      options.themeId,
      {
        sourceRevisionId: options.sourceRevisionId,
        createdBy: options.createdBy,
      },
    );

    const runner = options.runner ?? this.defaultRunner;

    // 3. If no runner is provided (e.g. production pre-Sandbox), return queued record without fake build
    if (!runner) {
      return build;
    }

    // 4. Orchestrate execution with runner
    return this.executeBuildOrchestration({
      storefrontId: options.storefrontId,
      themeId: options.themeId,
      buildId: build.id,
      compilerIdentity: options.compilerIdentity,
      runner,
    });
  }

  /**
   * Orchestrates the complete build lifecycle with stage-specific error handling:
   * 1. Retrieve source from DAL
   * 2. Pure Materialization
   * 3. Atomic CAS Start Transition (Start loser does NOT fail winner)
   * 4. Runner execution
   * 5. Finalize state
   */
  async executeBuildOrchestration(params: {
    storefrontId: string;
    themeId: string;
    buildId: string;
    compilerIdentity?: { compilerId?: string; compilerVersion?: string };
    runner: ThemeBuildRunner;
  }): Promise<StorefrontThemeBuildDTO> {
    const { runner } = params;

    // Stage 1: Retrieve Build and Revision records strictly via DAL
    let source: {
      build: StorefrontThemeBuildDTO;
      revision: any;
    };
    try {
      source = await this.dal.getBuildMaterializationSource(
        params.storefrontId,
        params.themeId,
        params.buildId,
      );
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

    // Stage 2: Pure Materialization
    let buildInput: StorefrontThemeBuildInput;
    try {
      buildInput = this.materializer({
        build: source.build,
        revision: source.revision,
        compilerIdentity: params.compilerIdentity,
      });
    } catch (materializerError) {
      const errMessage =
        materializerError instanceof Error
          ? materializerError.message
          : String(materializerError);

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

    // Stage 3: Transition queued -> building with atomic identity freeze
    try {
      await this.dal.markBuildStarted(
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
      // DO NOT markBuildFailed! Re-read current build state.
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

    // Stage 4: Run Build via Runner
    let runnerResult: {
      success: boolean;
      artifactPrefix?: string;
      manifestJson?: any;
      diagnosticsJson?: any;
      errorMessage?: string;
    };
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
            runnerResult.errorMessage ??
            "Theme build failed during runner execution",
          diagnosticsJson: runnerResult.diagnosticsJson,
        },
      );
    }

    // Stage 5: Finalize state
    return await this.dal.markBuildSucceeded(
      params.storefrontId,
      params.themeId,
      params.buildId,
      {
        artifactPrefix: runnerResult.artifactPrefix,
        manifestJson: runnerResult.manifestJson,
        diagnosticsJson: runnerResult.diagnosticsJson,
      },
    );
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
