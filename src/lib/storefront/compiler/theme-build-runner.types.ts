import type { StorefrontThemeBuildInput } from "@/lib/storefront/dto/storefront-theme-build.dto";

export type ThemeBuildDiagnosticSeverity = "info" | "warning" | "error";

export type ThemeBuildDiagnostic = {
  severity: ThemeBuildDiagnosticSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
};

export type ThemeBuildRunnerLog = {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
};

export type ThemeBuildArtifactFile = {
  /** Relative path in dist bundle, e.g. "index.html", "assets/index.js", "assets/index.css" */
  path: string;
  /** File contents in raw string or binary buffer */
  content: string | Uint8Array;
  /** Standard MIME type (e.g. "text/html", "application/javascript", "text/css") */
  mimeType: string;
  /** Size in bytes */
  sizeBytes?: number;
};

export type ThemeBuildArtifactManifest = {
  entry: string;
  filesCount: number;
  inputHash: string;
  bundleFiles?: Array<{
    path: string;
    sizeBytes: number;
    mimeType: string;
  }>;
  cssChunks?: string[];
  jsChunks?: string[];
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ThemeBuildRunnerSuccessResult = {
  success: true;
  artifacts: ThemeBuildArtifactFile[];
  manifestJson: ThemeBuildArtifactManifest;
  diagnosticsJson?: {
    errors?: ThemeBuildDiagnostic[];
    warnings?: ThemeBuildDiagnostic[];
    diagnostics?: ThemeBuildDiagnostic[];
    stage?: string;
    [key: string]: unknown;
  };
  logs?: ThemeBuildRunnerLog[];
  durationMs: number;
};

export type ThemeBuildRunnerFailureResult = {
  success: false;
  errorMessage: string;
  diagnosticsJson?: {
    errors?: ThemeBuildDiagnostic[];
    warnings?: ThemeBuildDiagnostic[];
    diagnostics?: ThemeBuildDiagnostic[];
    stage?: string;
    [key: string]: unknown;
  };
  logs?: ThemeBuildRunnerLog[];
  durationMs?: number;
};

/**
 * Discriminated union for theme build runner results.
 *
 * Separation of Responsibility:
 * - Runner = Compile & Bundle (produces dist artifacts, manifest, diagnostics, logs)
 * - Artifact Storage (Phase 4B-6) = Persist artifacts to R2 (produces immutable artifactPrefix)
 */
export type ThemeBuildRunnerResult =
  | ThemeBuildRunnerSuccessResult
  | ThemeBuildRunnerFailureResult;

/**
 * Immutable, deep readonly input passed to the runner.
 * The runner must never mutate the canonical build input.
 */
export type ThemeBuildRunnerInput = Readonly<{
  buildId: string;
  storefrontId: string;
  themeId: string;
  sourceRevisionId: string;
  revisionNumber: number;
  entry: string;
  inputHash: string;
  compilerId: string;
  compilerVersion: string;
  files: ReadonlyArray<Readonly<StorefrontThemeBuildInput["files"][number]>>;
}>;

/**
 * Formal contract for theme build runners (e.g. SandboxViteThemeBuildRunner in Phase 4B-5).
 *
 * Security Invariant:
 * Theme and customer source files MUST NOT be evaluated (via eval, new Function, dynamic import,
 * or direct worker execution) in the Morph Core request runtime.
 * Execution must remain isolated within a sandbox process or container without access
 * to Morph Core secrets, database bindings, or production credentials.
 */
export interface ThemeBuildRunner {
  readonly id: string;
  readonly version: string;
  readonly isolation: "local-in-process" | "sandbox-container" | "fake-mock";
  run(input: ThemeBuildRunnerInput): Promise<ThemeBuildRunnerResult>;
}

