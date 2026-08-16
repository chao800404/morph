/**
 * Morph Theme Compiler Contracts & Types (Phase 4A)
 *
 * Establishes a unified compiler interface shared across Preview,
 * Local Dev, and future Cloudflare Sandbox / Production compilation pipelines.
 */

export type ThemeCompilerFile = {
  path: string;
  content: string;
  mimeType?: string;
  isEntry?: boolean;
};

export type ThemeCompilerInput = {
  files: ThemeCompilerFile[];
  entry?: string;
  sourceGeneration?: number;
  compilerVersion?: string;
  themeId?: string;
  storefrontId?: string;
};

export type ThemeCompilerDiagnostic = {
  level: "warning" | "error";
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
};

export type ThemeCompilerResult = {
  success: boolean;
  inputHash: string;
  css?: string;
  js?: string;
  diagnostics: ThemeCompilerDiagnostic[];
  sourceGeneration?: number;
  compiledAt: string;
  tokensCount?: number;
};

export interface ThemeCompiler {
  compile(input: ThemeCompilerInput): Promise<ThemeCompilerResult>;
}

export type ThemeCompilerCacheEntry = {
  result: ThemeCompilerResult;
  timestamp: number;
  sourceGeneration?: number;
};
