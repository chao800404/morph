import { materializeThemeBuildInput } from "@/lib/storefront/compiler/theme-build-materializer";
import {
  FakeThemeBuildRunner,
  type ThemeBuildRunner,
} from "@/lib/storefront/compiler/theme-build-runner.types";
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
    private readonly defaultRunner: ThemeBuildRunner = new FakeThemeBuildRunner(),
    private readonly materializer: typeof materializeThemeBuildInput = materializeThemeBuildInput,
  ) {}

  /**
   * High-level entry point: requests or orchestrates a theme preview build.
   *
   * Idempotency & Reuse Strategy:
   * 1. If reuseExisting === true (default), checks if a successful build already exists for this exact revision.
   *    If found, returns the existing successful build directly (0 duplicate builds).
   * 2. Otherwise creates a new Build in "queued" status and orchestrates it through the materializer and runner.
   */
  async requestPreviewBuild(
    options: RequestPreviewBuildOptions,
  ): Promise<StorefrontThemeBuildDTO> {
    const reuseExisting = options.reuseExisting ?? true;

    if (reuseExisting) {
      const existingSuccess = await this.dal.findLatestBuildByRevision(
        options.storefrontId,
        options.themeId,
        options.sourceRevisionId,
        { status: "succeeded" },
      );

      if (existingSuccess) {
        return existingSuccess;
      }
    }

    // 1. Create a queued build permanently bound to the immutable sourceRevisionId
    const build = await this.dal.createBuild(
      options.storefrontId,
      options.themeId,
      {
        sourceRevisionId: options.sourceRevisionId,
        createdBy: options.createdBy,
      },
    );

    // 2. Orchestrate execution
    return this.executeBuildOrchestration({
      storefrontId: options.storefrontId,
      themeId: options.themeId,
      buildId: build.id,
      compilerIdentity: options.compilerIdentity,
      runner: options.runner,
    });
  }

  /**
   * Orchestrates the complete build lifecycle:
   * DAL source fetch -> pure materializer -> atomic CAS start -> runner -> mark succeeded/failed
   */
  async executeBuildOrchestration(params: {
    storefrontId: string;
    themeId: string;
    buildId: string;
    compilerIdentity?: { compilerId?: string; compilerVersion?: string };
    runner?: ThemeBuildRunner;
  }): Promise<StorefrontThemeBuildDTO> {
    const runner = params.runner ?? this.defaultRunner;

    // 1. Retrieve Build and Revision records strictly via DAL
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

    // 2. Pure Materialization
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

    // 3. Transition: queued -> building with atomic identity freeze
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
      const errMessage =
        startError instanceof Error ? startError.message : String(startError);
      try {
        return await this.dal.markBuildFailed(
          params.storefrontId,
          params.themeId,
          params.buildId,
          {
            errorMessage: `Failed to transition build to building: ${errMessage}`,
          },
        );
      } catch {
        throw startError;
      }
    }

    // 4. Run Build via Runner
    try {
      const runnerResult = await runner.run(buildInput);

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
