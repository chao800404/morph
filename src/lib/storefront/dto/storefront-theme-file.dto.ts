import type { ThemeSourceIndex } from "../theme-source-index";

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
  /** Source text; absent on every reader that predates binary files. */
  encoding?: "utf8";
};

/**
 * A file whose bytes live in the immutable blob store — an image or font
 * under `public/`.
 *
 * It has no `content`, on purpose: the row in D1 keeps an empty string there
 * only because the column is NOT NULL, and a reader that took it for the
 * file would build, digest or restore an empty file without any error.
 * Whatever needs the bytes reads them from the blob store by `blobDigest`.
 */
export type StorefrontThemeBinaryFileDTO = {
  id: string;
  storefrontId: string;
  themeId: string;
  path: string;
  encoding: "binary";
  /** SHA-256 of the bytes, which is also their address in the blob store. */
  blobDigest: string;
  sizeBytes: number;
  mimeType: string;
  isEntry: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Everything a workspace holds. Source readers list text only
 * (`StorefrontThemeFileDTO`); what must see the whole workspace — a revision,
 * a rollback, a build — takes this and handles each kind.
 */
export type StorefrontThemeWorkspaceEntryDTO =
  StorefrontThemeFileDTO | StorefrontThemeBinaryFileDTO;

export function isBinaryThemeFile<T extends { encoding?: string }>(
  entry: T,
): entry is Extract<T, { encoding: "binary" }> {
  return entry.encoding === "binary";
}

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
  /**
   * `binary` for bytes served as they are. Absent means UTF-8 source, which
   * is what every manifest written before binary files existed holds.
   */
  encoding?: "binary";
};

/** A source file of a revision, as its text. */
export type ThemeRevisionTextFile = {
  path: string;
  content: string;
  mimeType: string;
  isEntry: boolean;
  encoding?: undefined;
};

/** A binary file of a revision, by reference; see `StorefrontThemeBinaryFileDTO`. */
export type ThemeRevisionBinaryFile = {
  path: string;
  encoding: "binary";
  blobDigest: string;
  sizeBytes: number;
  mimeType: string;
  isEntry: boolean;
};

export type ThemeRevisionFile = ThemeRevisionTextFile | ThemeRevisionBinaryFile;

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
  sourceIndex?: ThemeSourceIndex | null;
  snapshot: ThemeRevisionFile[];
  createdBy: string | null;
  createdAt: string;
};
