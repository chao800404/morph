import type {
  StorefrontThemeBuildDTO,
  StorefrontThemeBuildInput,
} from "@/lib/storefront/dto/storefront-theme-build.dto";
import type { ThemeBuildArtifactFile } from "./theme-build-runner.types";

/**
 * Manifest file entry representing a single persisted artifact.
 */
export type CanonicalThemeBuildManifestFile = {
  path: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  r2Etag?: string;
};

/**
 * A page this build serves as static HTML, registered by the artifact store
 * from the build's immutable input (theme-static-pages.ts). `sha256` is the
 * uploaded HTML's, so a response can name exactly the bytes it carries.
 */
export type CanonicalThemeStaticPage = {
  /** The page's URL path, e.g. `/` or `/about`. */
  path: string;
  /** The HTML file in this artifact, e.g. `runtime/client/about/index.html`. */
  artifactPath: string;
  sha256: string;
};

/**
 * Canonical Theme Build Manifest stored in R2 as manifest.json.
 * Serves as the authoritative, verified provenance metadata for an immutable build.
 */
export type CanonicalThemeBuildManifest = {
  buildId: string;
  storefrontId: string;
  themeId: string;
  sourceRevisionId: string;
  revisionNumber: number;
  inputHash: string;
  compilerId: string;
  compilerVersion: string;
  sourceEntry: string;
  entry?: string;
  artifactEntry: string;
  runtime?: {
    kind: "static" | "cloudflare-worker";
    workerEntry?: string;
    clientAssetsDirectory?: string;
    previewEntry?: string;
    /**
     * Registered static pages. Absent when there are none, so a manifest
     * without SSG pages is byte-identical to one written before they existed.
     */
    staticPages?: CanonicalThemeStaticPage[];
  };

  filesCount: number;
  totalSizeBytes: number;
  files: CanonicalThemeBuildManifestFile[];
  cssChunks: string[];
  jsChunks: string[];
  createdAt: string;
};

/**
 * Result returned by ThemeBuildArtifactStore after successful artifact persistence.
 */
export type ThemeBuildArtifactStoreResult = {
  artifactPrefix: string;
  manifest: CanonicalThemeBuildManifest;
};

/**
 * Interface for Theme Build Artifact Stores.
 * Responsible for validating, hashing, persisting, and verifying immutable build artifacts.
 */
export interface ThemeBuildArtifactStore {
  readonly id: string;

  /**
   * Persists all artifacts produced by the runner into immutable storage,
   * performs SHA-256 verification, and commits the canonical manifest.json.
   */
  persistBuildArtifacts(params: {
    build: StorefrontThemeBuildDTO;
    buildInput: StorefrontThemeBuildInput;
    artifacts: ThemeBuildArtifactFile[];
    runnerManifest?: any;
  }): Promise<ThemeBuildArtifactStoreResult>;

  /**
   * Reads a single artifact file from the immutable build prefix.
   */
  getArtifact(params: {
    storefrontId: string;
    themeId: string;
    buildId: string;
    path: string;
  }): Promise<ThemeBuildArtifactFile | null>;
}
