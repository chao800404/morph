export type StorefrontThemeFileDTO = {
  id: string;
  storefrontId: string;
  themeId: string;
  path: string;
  content: string;
  mimeType: string;
  isEntry: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type StorefrontThemeFileTreeNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: StorefrontThemeFileTreeNode[];
  size?: number;
  mimeType?: string;
};

export type ThemeSourceRevisionManifestFile = {
  path: string;
  digest: string;
  sizeBytes: number;
  mimeType: string;
  isEntry: boolean;
};

/**
 * D1-resident manifest for immutable source blobs stored in R2.
 *
 * `snapshot` remains on the revision DTO for the explicit legacy fallback
 * path while existing revisions are migrated. New revisions should carry
 * this manifest and materialize their bytes from the content-addressed blobs.
 */
export type ThemeSourceRevisionManifest = {
  version: 1;
  algorithm: "sha256";
  files: ThemeSourceRevisionManifestFile[];
};

export type StorefrontThemeRevisionDTO = {
  id: string;
  storefrontId: string;
  themeId: string;
  revisionNumber: number;
  sourceGeneration?: number | null;
  message: string | null;
  source: "manual" | "ai" | "publish" | "rollback";
  sourceManifest?: ThemeSourceRevisionManifest | null;
  snapshot: Array<{
    path: string;
    content: string;
    mimeType: string;
    isEntry: boolean;
  }>;
  createdBy: string | null;
  createdAt: string;
};
