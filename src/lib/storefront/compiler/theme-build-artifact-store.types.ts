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
