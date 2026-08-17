import type {
  ThemeBuildArtifactFile,
  ThemeBuildArtifactManifest,
  ThemeBuildRunner,
  ThemeBuildRunnerInput,
  ThemeBuildRunnerResult,
} from "./theme-build-runner.types";

export type FakeThemeBuildRunnerOptions = {
  id?: string;
  version?: string;
  shouldSucceed?: boolean;
  shouldThrow?: boolean;
  delayMs?: number;
  errorMessage?: string;
  artifacts?: ThemeBuildArtifactFile[];
  manifest?: ThemeBuildArtifactManifest;
  diagnostics?: any;
  onRun?: (input: ThemeBuildRunnerInput) => void | Promise<void>;
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

  async run(input: ThemeBuildRunnerInput): Promise<ThemeBuildRunnerResult> {
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

    const htmlContent = `<!DOCTYPE html><html><head><title>Theme Preview</title><link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div><script type="module" src="/assets/index.js"></script></body></html>`;
    const jsContent = `// Compiled Theme Bundle for ${input.buildId}\nconsole.log("Theme loaded");`;
    const cssContent = `/* Compiled Tailwind CSS for ${input.buildId} */\n@layer base, components, utilities;`;

    const defaultArtifacts: ThemeBuildArtifactFile[] = [
      {
        path: "index.html",
        content: htmlContent,
        mimeType: "text/html",
        sizeBytes: Buffer.byteLength(htmlContent, "utf8"),
      },
      {
        path: "assets/index.js",
        content: jsContent,
        mimeType: "application/javascript",
        sizeBytes: Buffer.byteLength(jsContent, "utf8"),
      },
      {
        path: "assets/index.css",
        content: cssContent,
        mimeType: "text/css",
        sizeBytes: Buffer.byteLength(cssContent, "utf8"),
      },
    ];


    const artifacts = this.options.artifacts ?? defaultArtifacts;

    const manifest: ThemeBuildArtifactManifest = this.options.manifest ?? {
      entry: input.entry,
      filesCount: input.files.length,
      inputHash: input.inputHash,
      bundleFiles: artifacts.map((a) => ({
        path: a.path,
        sizeBytes: a.sizeBytes ?? (typeof a.content === "string" ? a.content.length : a.content.byteLength),
        mimeType: a.mimeType,
      })),
      cssChunks: ["assets/index.css"],
      jsChunks: ["assets/index.js"],
    };

    return {
      success: true,
      artifacts,
      manifestJson: manifest,
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
