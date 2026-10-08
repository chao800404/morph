import type {
  StorefrontThemeBuildContentDependency,
  StorefrontThemeBuildStatus,
  StorefrontPageDocument,
} from "@/db/storefront.schema";
import type { StorefrontContentPublicationItemDTO } from "./storefront-content-publication.dto";
import type { ThemeCompilerFile } from "@/lib/storefront/compiler/theme-compiler.types";
import type { ThemeDependencyMap } from "@/lib/storefront/compiler/theme-dependency-policy";
import type { ThemeFrameworkId } from "@/lib/storefront/theme-framework/theme-framework.types";

export type StorefrontThemeBuildDTO = {
  id: string;
  storefrontId: string;
  themeId: string;
  sourceRevisionId: string;
  status: StorefrontThemeBuildStatus;
  inputHash: string | null;
  compilerId: string | null;
  compilerVersion: string | null;
  /**
   * The framework this build was made for, as recorded; absent or null is a
   * build from before the framework was recorded and reads as TanStack Start.
   * A string, not `ThemeFrameworkId`: what a row holds is checked where it is
   * used (`resolveThemeFramework`), and an unknown value is refused there.
   */
  framework?: string | null;
  /** Exact package versions frozen into this immutable build request. */
  dependencies?: ThemeDependencyMap | null;
  /** Null/absent keeps legacy source-only builds content-independent. */
  contentPublicationId?: string | null;
  /**
   * Whether the artifact carries CMS content, as this build proved it; null
   * is unknown and counts as dependent (StorefrontThemeBuildContentDependency).
   */
  contentDependency?: StorefrontThemeBuildContentDependency | null;
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
  /**
   * The framework the build runs through, from the build's record; part of
   * `inputHash` whenever it is not TanStack Start (theme-compiler-hasher).
   * The materializer always sets it; absent reads as TanStack Start.
   */
  framework?: ThemeFrameworkId;
  dependencies?: ThemeDependencyMap;
  contentSnapshot?: ThemeBuildContentSnapshot;
  /**
   * Present only for a build of a native TanStack Start project, built with
   * its own `vite.config.*` and `wrangler.json(c)`, which are then part of
   * `files`. Absent for every platform build, whose input is unchanged.
   */
  buildMode?: "native";
};

/** Only sealed publication references are accepted; never current drafts. */
export type ThemeBuildContentSnapshot = {
  publicationId: string;
  storefrontId: string;
  themeId: string;
  documents: Array<{
    item: StorefrontContentPublicationItemDTO;
    document: StorefrontPageDocument;
  }>;
};
