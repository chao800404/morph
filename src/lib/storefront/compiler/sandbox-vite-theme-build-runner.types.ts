import { GENERATED_THEME_DEPENDENCY_VERSIONS } from "./theme-sandbox-dependencies.generated";

export type SandboxViteThemeBuildRunnerOptions = {
  id?: string;
  version?: string;
  /** Maximum execution time before aborting build in milliseconds (default: 30_000ms) */
  maxDurationMs?: number;
  /** Maximum number of virtual source files allowed (default: 200) */
  maxSourceFiles?: number;
  /** Maximum total size of input source files in bytes (default: 5MB) */
  maxSourceSizeBytes?: number;
  /** Maximum number of output dist files allowed (default: 200) */
  maxOutputFiles?: number;
  /** Maximum total size of output dist artifacts in bytes (default: 20MB) */
  maxOutputSizeBytes?: number;

  /** Maximum number of log lines captured (default: 500) */
  maxLogLines?: number;
  /** Custom directory prefix for temp build workspaces */
  workDirPrefix?: string;
  /** Whitelist of approved module names that themes are permitted to import */
  approvedDependencies?: readonly string[];
};

/**
 * Default allowlist for local builds and isolated runner callers. It is
 * generated from cms.config.ts so tests and development use the same policy
 * as the server-side Theme build factory.
 */
export const DEFAULT_APPROVED_DEPENDENCIES: readonly string[] = Object.freeze(
  Object.keys(GENERATED_THEME_DEPENDENCY_VERSIONS),
);
