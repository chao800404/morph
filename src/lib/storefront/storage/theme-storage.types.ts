import type {
  StorefrontThemeFileDTO,
  StorefrontThemeRevisionDTO,
} from "@/lib/storefront/dto/storefront-theme-file.dto";

export type SaveThemeSourceFileOptions = {
  expectedSourceGeneration: number;
  expectedFileId?: string;
  expectedVersion?: number;
  expectMissing?: boolean;
  createRevision?: boolean;
  revisionMessage?: string;
  createdBy?: string;
};

export type SaveThemeSourceFilesBatchItem = {
  path: string;
  content: string;
  expectedFileId?: string;
  expectedVersion?: number;
  expectMissing?: boolean;
  mimeType?: string;
};

export type SaveThemeSourceFilesBatchOptions = {
  expectedSourceGeneration: number;
  /**
   * Paths to remove once the writes land, in the same transaction.
   *
   * Moving a file is a write at its new path and a removal at the old one.
   * Splitting those into two calls would leave the Theme duplicated or missing
   * a file for as long as the gap lasts, and permanently if the second fails.
   */
  deletions?: Array<{
    path: string;
    expectedFileId: string;
    expectedVersion: number;
  }>;
  createRevision?: boolean;
  revisionMessage?: string;
  createdBy?: string;
};

export type CreateThemeRevisionOptions = {
  expectedSourceGeneration: number;
  message?: string;
  source?: "manual" | "ai" | "publish" | "rollback";
  createdBy?: string;
};

export type RollbackThemeRevisionOptions = {
  expectedSourceGeneration: number;
  createdBy?: string;
};

/**
 * Storage boundary for the mutable, editor-facing theme workspace.
 *
 * Callers depend on this contract rather than on D1/Drizzle rows so the
 * implementation can later move to a workspace/filesystem backend without
 * changing Monaco, Visual Editor, or AI authoring call sites.
 */
export interface ThemeSourceStore {
  initStarterTheme(
    storefrontId: string,
    themeId: string,
    createdBy?: string,
  ): Promise<StorefrontThemeFileDTO[]>;

  listFiles(
    storefrontId: string,
    themeId: string,
  ): Promise<StorefrontThemeFileDTO[]>;

  getWorkspaceSnapshot(
    storefrontId: string,
    themeId: string,
  ): Promise<StorefrontThemeFileDTO[]>;

  getFileByPath(
    storefrontId: string,
    themeId: string,
    path: string,
  ): Promise<StorefrontThemeFileDTO | null>;

  saveFile(
    storefrontId: string,
    themeId: string,
    path: string,
    content: string,
    mimeType: string | undefined,
    options: SaveThemeSourceFileOptions,
  ): Promise<StorefrontThemeFileDTO & { sourceGeneration?: number }>;

  saveFilesBatch(
    storefrontId: string,
    themeId: string,
    files: SaveThemeSourceFilesBatchItem[],
    options: SaveThemeSourceFilesBatchOptions,
  ): Promise<StorefrontThemeFileDTO[] & { sourceGeneration?: number }>;

  deleteFile(
    storefrontId: string,
    themeId: string,
    path: string,
    expectedFileId: string,
    expectedVersion: number,
    options: { expectedSourceGeneration: number },
  ): Promise<boolean>;

  getSourceGeneration(
    storefrontId: string,
    themeId: string,
  ): Promise<number | null>;
}

/**
 * Storage boundary for immutable theme source revisions.
 *
 * `materializeRevision` returns the complete immutable revision snapshot used
 * by the build pipeline. The caller does not need to know whether that
 * snapshot came from a D1 JSON column, R2 objects, Cloudflare Artifacts, etc.
 */
export interface ThemeRevisionStore {
  createRevision(
    storefrontId: string,
    themeId: string,
    options: CreateThemeRevisionOptions,
  ): Promise<StorefrontThemeRevisionDTO>;

  getRevision(
    storefrontId: string,
    themeId: string,
    revisionId: string,
  ): Promise<StorefrontThemeRevisionDTO | null>;

  materializeRevision(
    storefrontId: string,
    themeId: string,
    revisionId: string,
  ): Promise<StorefrontThemeRevisionDTO>;

  listRevisions(
    storefrontId: string,
    themeId: string,
  ): Promise<StorefrontThemeRevisionDTO[]>;

  rollbackToRevision(
    storefrontId: string,
    themeId: string,
    revisionNumber: number,
    options: RollbackThemeRevisionOptions,
  ): Promise<StorefrontThemeFileDTO[]>;

  getLatestPublishedRevision(
    storefrontId: string,
    themeId: string,
  ): Promise<StorefrontThemeRevisionDTO | null>;
}
