import type { StorefrontThemeBuildInput } from "@/lib/storefront/dto/storefront-theme-build.dto";

export type ThemeBuildRunnerResult = {
  success: boolean;
  artifactPrefix?: string;
  manifestJson?: any;
  diagnosticsJson?: any;
  errorMessage?: string;
};

export interface ThemeBuildRunner {
  readonly id: string;
  run(input: StorefrontThemeBuildInput): Promise<ThemeBuildRunnerResult>;
}

/**
 * Fake/Test Runner used for Theme Build orchestration in Phase 4B-3 before Cloudflare Sandbox Runner.
 */
export class FakeThemeBuildRunner implements ThemeBuildRunner {
  readonly id = "fake-theme-build-runner";

  constructor(
    private readonly behavior: {
      shouldSucceed?: boolean;
      shouldThrow?: boolean;
      errorMessage?: string;
      artifactPrefix?: string;
      manifest?: any;
      diagnostics?: any;
      onRun?: (input: StorefrontThemeBuildInput) => void | Promise<void>;
    } = {},
  ) {}

  async run(input: StorefrontThemeBuildInput): Promise<ThemeBuildRunnerResult> {
    if (this.behavior.onRun) {
      await this.behavior.onRun(input);
    }


    if (this.behavior.shouldThrow) {
      throw new Error(
        this.behavior.errorMessage ?? "Fake runner execution exception",
      );
    }

    if (this.behavior.shouldSucceed === false) {
      return {
        success: false,
        errorMessage: this.behavior.errorMessage ?? "Fake runner build failed",
        diagnosticsJson: this.behavior.diagnostics ?? {
          errors: ["Build syntax error"],
        },
      };
    }

    return {
      success: true,
      artifactPrefix:
        this.behavior.artifactPrefix ?? `artifacts/${input.buildId}`,
      manifestJson: this.behavior.manifest ?? {
        entry: input.entry,
        filesCount: input.files.length,
        inputHash: input.inputHash,
      },
      diagnosticsJson: this.behavior.diagnostics ?? { warnings: [] },
    };
  }
}
