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
  approvedDependencies?: string[];
};

export const DEFAULT_APPROVED_DEPENDENCIES: string[] = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom",
  "react-dom/client",
  "clsx",
  "tailwind-merge",
  "lucide-react",
  "class-variance-authority",
  "tailwindcss",
  "@tailwindcss/vite",
  "@vitejs/plugin-react",
  "vite",
  "vite/modulepreload-polyfill",
];



