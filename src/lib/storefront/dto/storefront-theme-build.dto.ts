import type { StorefrontThemeBuildStatus } from "@/db/storefront.schema";
import type { ThemeCompilerFile } from "@/lib/storefront/compiler/theme-compiler.types";
import type { ThemeDependencyMap } from "@/lib/storefront/compiler/theme-dependency-policy";

export type StorefrontThemeBuildDTO = {
  id: string;
  storefrontId: string;
  themeId: string;
  sourceRevisionId: string;
  status: StorefrontThemeBuildStatus;
  inputHash: string | null;
  compilerId: string | null;
  compilerVersion: string | null;
  /** Exact package versions frozen into this immutable build request. */
  dependencies?: ThemeDependencyMap | null;
  artifactPrefix: string | null;
  manifestJson: any | null;
  diagnosticsJson: any | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StorefrontThemeBuildPreviewDTO = StorefrontThemeBuildDTO & {
  previewToken?: string | null;
};

/**
 * A file the build copies as it is, from `public/`, by reference: the bytes
 * stay in the immutable blob store until the runner writes them.
 */
export type ThemeBuildBinaryFile = {
  path: string;
  /** SHA-256 of the bytes; their address in the blob store. */
  digest: string;
  sizeBytes: number;
  mimeType: string;
};

export type StorefrontThemeBuildInput = {
  buildId: string;
  storefrontId: string;
  themeId: string;
  sourceRevisionId: string;
  revisionNumber: number;
  files: ThemeCompilerFile[];
  /** Absent or empty for a revision with no binary files. */
  binaryFiles?: ThemeBuildBinaryFile[];
  entry: string;
  inputHash: string;
  compilerId: string;
  compilerVersion: string;
  dependencies?: ThemeDependencyMap;
};
