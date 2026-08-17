import type {
  StorefrontThemeBuildDTO,
  StorefrontThemeBuildInput,
} from "@/lib/storefront/dto/storefront-theme-build.dto";
import {
  buildThemeArtifactPrefix,
  calculateArtifactSha256,
  validateAndCanonicalizeArtifactPath,
} from "./cloudflare-r2-theme-build-artifact-store";
import type {
  CanonicalThemeBuildManifest,
  CanonicalThemeBuildManifestFile,
  ThemeBuildArtifactStore,
  ThemeBuildArtifactStoreResult,
} from "./theme-build-artifact-store.types";
import type { ThemeBuildArtifactFile } from "./theme-build-runner.types";

export type FakeArtifactStoreOptions = {
  shouldFail?: boolean;
  failAtFileIndex?: number;
  failAtManifest?: boolean;
  onPersist?: (params: {
    build: StorefrontThemeBuildDTO;
    buildInput: StorefrontThemeBuildInput;
    artifacts: ThemeBuildArtifactFile[];
  }) => Promise<void> | void;
};

/**
 * In-memory Mock Theme Build Artifact Store for fast, isolated lifecycle testing.
 */
export class FakeThemeBuildArtifactStore implements ThemeBuildArtifactStore {
  readonly id = "fake-theme-build-artifact-store";
  readonly storedObjects = new Map<
    string,
    { content: string | Uint8Array; mimeType: string; sha256: string; sizeBytes: number }
  >();

  constructor(private readonly options: FakeArtifactStoreOptions = {}) {}

  async persistBuildArtifacts(params: {
    build: StorefrontThemeBuildDTO;
    buildInput: StorefrontThemeBuildInput;
    artifacts: ThemeBuildArtifactFile[];
    runnerManifest?: any;
  }): Promise<ThemeBuildArtifactStoreResult> {
    if (this.options.shouldFail) {
      throw new Error("FAKE_STORE_FAILURE: Simulated artifact store persistence failure.");
    }

    if (this.options.onPersist) {
      await this.options.onPersist(params);
    }

    const { build, buildInput, artifacts } = params;

    if (!artifacts || artifacts.length === 0) {
      throw new Error("EMPTY_ARTIFACTS: Cannot persist build with zero artifact files.");
    }

    // Provenance verification against frozen started build record
    if (build.status !== "building") {
      throw new Error(
        `BUILD_PROVENANCE_MISMATCH: Build must be in "building" status when persisting artifacts (current: "${build.status}").`,
      );
    }
    if (build.id !== buildInput.buildId) {
      throw new Error(
        `BUILD_PROVENANCE_MISMATCH: Build ID mismatch between build record (${build.id}) and buildInput (${buildInput.buildId}).`,
      );
    }
    if (build.storefrontId !== buildInput.storefrontId || build.themeId !== buildInput.themeId) {
      throw new Error("BUILD_PROVENANCE_MISMATCH: Tenant scope mismatch between build and buildInput.");
    }
    if (build.sourceRevisionId !== buildInput.sourceRevisionId) {
      throw new Error("BUILD_PROVENANCE_MISMATCH: Source revision mismatch between build and buildInput.");
    }
    if (build.inputHash !== buildInput.inputHash) {
      throw new Error("BUILD_PROVENANCE_MISMATCH: Input hash mismatch between build record and buildInput.");
    }

    const artifactPrefix = buildThemeArtifactPrefix(
      buildInput.storefrontId,
      buildInput.themeId,
      buildInput.buildId,
    );

    const manifestFiles: CanonicalThemeBuildManifestFile[] = [];
    let totalSizeBytes = 0;

    for (let i = 0; i < artifacts.length; i++) {
      if (this.options.failAtFileIndex === i) {
        throw new Error(
          `FAKE_UPLOAD_FAILURE: Simulated failure during upload of artifact index ${i}.`,
        );
      }

      const artifact = artifacts[i];
      const relPath = validateAndCanonicalizeArtifactPath(artifact.path);
      const fullKey = `${artifactPrefix}/${relPath}`;

      // Authoritative byte size calculation
      const actualSizeBytes =
        typeof artifact.content === "string"
          ? Buffer.byteLength(artifact.content, "utf8")
          : artifact.content.byteLength;

      if (artifact.sizeBytes !== undefined && artifact.sizeBytes !== actualSizeBytes) {
        throw new Error(
          `ARTIFACT_SIZE_MISMATCH: Declared sizeBytes (${artifact.sizeBytes}) does not match actual byte count (${actualSizeBytes}) for artifact "${artifact.path}".`,
        );
      }

      const sha256 = calculateArtifactSha256(artifact.content);

      const existing = this.storedObjects.get(fullKey);
      if (existing) {
        if (existing.sha256 !== sha256) {
          throw new Error(
            `IMMUTABLE_ARTIFACT_OVERWRITE_FORBIDDEN: Artifact "${fullKey}" already exists with different hash.`,
          );
        }
      } else {
        this.storedObjects.set(fullKey, {
          content: artifact.content,
          mimeType: artifact.mimeType || "application/octet-stream",
          sha256,
          sizeBytes: actualSizeBytes,
        });
      }

      totalSizeBytes += actualSizeBytes;
      manifestFiles.push({
        path: relPath,
        contentType: artifact.mimeType || "application/octet-stream",
        sizeBytes: actualSizeBytes,
        sha256,
        r2Etag: `fake-etag-${sha256.slice(0, 8)}`,
      });
    }

    if (this.options.failAtManifest) {
      throw new Error("FAKE_MANIFEST_FAILURE: Simulated failure during manifest write.");
    }

    const cssChunks = manifestFiles
      .filter((f) => f.contentType === "text/css" || f.path.endsWith(".css"))
      .map((f) => f.path);
    const jsChunks = manifestFiles
      .filter(
        (f) =>
          f.contentType === "application/javascript" ||
          f.path.endsWith(".js") ||
          f.path.endsWith(".mjs"),
      )
      .map((f) => f.path);

    const artifactEntry =
      manifestFiles.find((f) => f.path === "index.html")?.path ??
      manifestFiles[0]?.path ??
      "index.html";

    const manifestCreatedAt =
      build.startedAt ?? build.createdAt ?? new Date().toISOString();

    const manifest: CanonicalThemeBuildManifest = {
      buildId: buildInput.buildId,
      storefrontId: buildInput.storefrontId,
      themeId: buildInput.themeId,
      sourceRevisionId: buildInput.sourceRevisionId,
      revisionNumber: buildInput.revisionNumber,
      inputHash: buildInput.inputHash,
      compilerId: buildInput.compilerId,
      compilerVersion: buildInput.compilerVersion,
      sourceEntry: buildInput.entry,
      entry: buildInput.entry,
      artifactEntry,
      filesCount: manifestFiles.length,
      totalSizeBytes,
      files: manifestFiles,
      cssChunks,
      jsChunks,
      createdAt: manifestCreatedAt,
    };

    const manifestKey = `${artifactPrefix}/manifest.json`;
    const manifestJsonString = JSON.stringify(manifest, null, 2);
    const manifestSha = calculateArtifactSha256(manifestJsonString);

    const existingManifest = this.storedObjects.get(manifestKey);
    if (existingManifest) {
      if (existingManifest.sha256 !== manifestSha) {
        throw new Error(
          `IMMUTABLE_MANIFEST_OVERWRITE_FORBIDDEN: Manifest "${manifestKey}" already exists with different hash.`,
        );
      }
    } else {
      this.storedObjects.set(manifestKey, {
        content: manifestJsonString,
        mimeType: "application/json",
        sha256: manifestSha,
        sizeBytes: Buffer.byteLength(manifestJsonString, "utf8"),
      });
    }

    return {
      artifactPrefix,
      manifest,
    };
  }

  async getArtifact(params: {
    storefrontId: string;
    themeId: string;
    buildId: string;
    path: string;
  }): Promise<ThemeBuildArtifactFile | null> {
    const relPath = validateAndCanonicalizeArtifactPath(params.path);
    const prefix = buildThemeArtifactPrefix(params.storefrontId, params.themeId, params.buildId);
    const key = `${prefix}/${relPath}`;
    const stored = this.storedObjects.get(key);
    if (!stored) return null;

    return {
      path: relPath,
      content: stored.content,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
    };
  }
}
