import type { ThemeBinaryCopyRequest } from "./theme-binary-copies";
import type { RouteDocumentRollbackPlan } from "../route-document-moves";
import type {
  StorefrontThemeBinaryFileDTO,
  StorefrontThemeFileDTO,
  StorefrontThemeWorkspaceEntryDTO,
  ThemeSourceRevisionManifest,
  StorefrontThemeRevisionDTO,
} from "@/lib/storefront/dto/storefront-theme-file.dto";
import type { ThemeSourceIndex } from "../theme-source-index";
import type { Pagination } from "@/lib/db/server-result";

export type ThemeSourceBlob = {
  digest: string;
  content: string | Uint8Array;
  mimeType: string;
};

/** Backend-neutral storage contract for immutable content-addressed source bytes. */
export interface ThemeSourceBlobStore {
  putImmutable(blob: ThemeSourceBlob): Promise<void>;
  getImmutable(digest: string): Promise<Uint8Array | null>;
}

export type SaveThemeSourceFileOptions = {
  expectedSourceGeneration: number;
  expectedFileId?: string;
  expectedVersion?: number;
  expectMissing?: boolean;
  createRevision?: boolean;
  revisionMessage?: string;
  createdBy?: string;
  /** Internal R2 manifest prepared before an OCC-protected atomic batch. */
  sourceManifest?: ThemeSourceRevisionManifest;
  sourceIndex?: ThemeSourceIndex;
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
  /** Route source moves; the DAL derives paths and verifies both file changes. */
  routePathMoves?: ReadonlyArray<{
    fromSourcePath: string;
    toSourcePath: string;
  }>;
  /**
   * Binary files placed at new paths in the same transaction; see
   * `planThemeBinaryCopies`. A move adds the source to `deletions`.
   */
  binaryCopies?: ReadonlyArray<ThemeBinaryCopyRequest>;
  createRevision?: boolean;
  revisionMessage?: string;
  createdBy?: string;
  /** Internal R2 manifest prepared before an OCC-protected atomic batch. */
  sourceManifest?: ThemeSourceRevisionManifest;
  sourceIndex?: ThemeSourceIndex;
};

export type CreateThemeRevisionOptions = {
  expectedSourceGeneration: number;
  message?: string;
  source?: "manual" | "ai" | "publish" | "rollback";
  createdBy?: string;
  sourceManifest?: ThemeSourceRevisionManifest;
  sourceIndex?: ThemeSourceIndex;
};

export type RollbackThemeRevisionOptions = {
  expectedSourceGeneration: number;
  createdBy?: string;
  sourceManifest?: ThemeSourceRevisionManifest;
  sourceIndex?: ThemeSourceIndex;
};

/**
 * Storage boundary for the mutable, editor-facing theme workspace.
 *
 * Callers depend on this contract rather than on D1/Drizzle rows so the
 * implementation can later move to a workspace/filesystem backend without
 * changing Monaco, Visual Editor, or AI authoring call sites.
 */
/** A file served as it is from `public/`, as its bytes. */
export type SaveThemeBinaryFileInput = Readonly<{
  path: string;
  bytes: Uint8Array;
  expectedFileId?: string;
  expectedVersion?: number;
  expectMissing?: boolean;
}>;

export type SaveThemeBinaryFileOptions = Readonly<{
  expectedSourceGeneration: number;
  createdBy?: string;
}>;

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

  /** Every file the workspace holds, source and binary. */
  getWorkspaceSnapshot(
    storefrontId: string,
    themeId: string,
  ): Promise<StorefrontThemeWorkspaceEntryDTO[]>;

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
    options: {
      expectedSourceGeneration: number;
      sourceIndex?: ThemeSourceIndex;
    },
  ): Promise<boolean>;

  /**
   * Persist immutable blobs for a server-owned multi-boundary migration.
   * The caller still performs the OCC-protected D1 transaction afterwards.
   */
  prepareSourceRevisionManifest(
    files: readonly StorefrontThemeWorkspaceEntryDTO[],
  ): Promise<ThemeSourceRevisionManifest>;

  /**
   * Stores bytes under `public/` after checking them against the public
   * file contract. The one write path for binary files: the development
   * upload entry (`theme-binary-upload.ts`) reaches it today, and the
   * editor's upload must reach it the same way.
   */
  saveBinaryFile(
    storefrontId: string,
    themeId: string,
    file: SaveThemeBinaryFileInput,
    options: SaveThemeBinaryFileOptions,
  ): Promise<StorefrontThemeBinaryFileDTO & { sourceGeneration: number }>;

  /**
   * A binary file's bytes, by digest. The blob store's read checks them
   * against it, so what comes back is the file the workspace names or an
   * error — never other bytes.
   */
  readBinaryFile(digest: string): Promise<Uint8Array>;

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
    options?: { limit?: number; offset?: number },
  ): Promise<{
    revisions: StorefrontThemeRevisionDTO[];
    pagination: Pagination;
  }>;

  /**
   * One revision by its number, with its file contents actually present.
   *
   * Shared by the rollback preview and the rollback itself: describing a
   * rollback with one read and performing it with another is how a preview
   * comes to promise something the apply does not do.
   */
  materializeRevisionByNumber(
    storefrontId: string,
    themeId: string,
    revisionNumber: number,
  ): Promise<StorefrontThemeRevisionDTO>;

  /**
   * The route-owned documents rolling back to a revision would carry back to
   * the paths their routes had then, or why it cannot.
   */
  planRouteDocumentRollback(
    storefrontId: string,
    themeId: string,
    revision: Readonly<{
      sourceGeneration: number | null;
      paths: readonly string[];
    }>,
  ): Promise<RouteDocumentRollbackPlan>;

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
