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

export type ThemeBuildRunnerResult = {
  success: boolean;
  artifactPrefix?: string;
  manifestJson?: ThemeBuildArtifactManifest | Record<string, unknown>;
  diagnosticsJson?: {
    errors?: ThemeBuildDiagnostic[];
    warnings?: ThemeBuildDiagnostic[];
    diagnostics?: ThemeBuildDiagnostic[];
    stage?: string;
    [key: string]: unknown;
  };
  errorMessage?: string;
  logs?: ThemeBuildRunnerLog[];
  durationMs?: number;
};

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
  readonly isolation: "isolated-process" | "sandbox-container" | "fake-mock";
  run(input: StorefrontThemeBuildInput): Promise<ThemeBuildRunnerResult>;
}
