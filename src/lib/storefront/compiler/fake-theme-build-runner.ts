import type { StorefrontThemeBuildInput } from "@/lib/storefront/dto/storefront-theme-build.dto";
import type {
  ThemeBuildArtifactManifest,
  ThemeBuildRunner,
  ThemeBuildRunnerResult,
} from "./theme-build-runner.types";

export type FakeThemeBuildRunnerOptions = {
  id?: string;
  version?: string;
  shouldSucceed?: boolean;
  shouldThrow?: boolean;
  delayMs?: number;
  errorMessage?: string;
  artifactPrefix?: string;
  manifest?: ThemeBuildArtifactManifest | Record<string, unknown>;
  diagnostics?: any;
  onRun?: (input: StorefrontThemeBuildInput) => void | Promise<void>;
};

/**
 * Test/Fake Runner implementation of ThemeBuildRunner.
 * Strictly used in test suites and orchestration verification prior to SandboxViteThemeBuildRunner in Phase 4B-5.
 */
export class FakeThemeBuildRunner implements ThemeBuildRunner {
  readonly id: string;
  readonly version: string;
  readonly isolation = "fake-mock" as const;

  constructor(private readonly options: FakeThemeBuildRunnerOptions = {}) {
    this.id = options.id ?? "fake-theme-build-runner";
    this.version = options.version ?? "1.0.0-test";
  }

  async run(input: StorefrontThemeBuildInput): Promise<ThemeBuildRunnerResult> {
    const startTime = Date.now();

    if (this.options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
    }

    if (this.options.onRun) {
      await this.options.onRun(input);
    }

    if (this.options.shouldThrow) {
      throw new Error(
        this.options.errorMessage ?? "Fake runner execution exception",
      );
    }

    const durationMs = Date.now() - startTime;

    if (this.options.shouldSucceed === false) {
      return {
        success: false,
        errorMessage: this.options.errorMessage ?? "Fake runner build failed",
        diagnosticsJson: this.options.diagnostics ?? {
          errors: [
            {
              severity: "error",
              message: this.options.errorMessage ?? "Fake runner build failed",
            },
          ],
        },
        logs: [
          {
            timestamp: new Date().toISOString(),
            level: "error",
            message: this.options.errorMessage ?? "Fake runner build failed",
          },
        ],
        durationMs,
      };
    }

    return {
      success: true,
      artifactPrefix:
        this.options.artifactPrefix ?? `artifacts/${input.buildId}`,
      manifestJson: this.options.manifest ?? {
        entry: input.entry,
        filesCount: input.files.length,
        inputHash: input.inputHash,
        bundleFiles: [
          {
            path: "index.js",
            sizeBytes: 1024,
            mimeType: "application/javascript",
          },
          {
            path: "index.css",
            sizeBytes: 512,
            mimeType: "text/css",
          },
        ],
      },
      diagnosticsJson: this.options.diagnostics ?? { warnings: [] },
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: "info",
          message: `Theme build succeeded for buildId ${input.buildId}`,
        },
      ],
      durationMs,
    };
  }
}
