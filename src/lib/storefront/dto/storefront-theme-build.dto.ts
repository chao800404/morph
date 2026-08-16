import type { StorefrontThemeBuildStatus } from "@/db/storefront.schema";
import type { ThemeCompilerFile } from "@/lib/storefront/compiler/theme-compiler.types";

export type StorefrontThemeBuildDTO = {
  id: string;
  storefrontId: string;
  themeId: string;
  sourceRevisionId: string;
  status: StorefrontThemeBuildStatus;
  inputHash: string | null;
  compilerId: string | null;
  compilerVersion: string | null;
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

export type StorefrontThemeBuildInput = {
  buildId: string;
  storefrontId: string;
  themeId: string;
  sourceRevisionId: string;
  revisionNumber: number;
  files: ThemeCompilerFile[];
  entry: string;
  inputHash: string;
  compilerId: string;
  compilerVersion: string;
};
