import { env } from "cloudflare:workers";
import type { R2BucketLike } from "@/lib/storefront/compiler/cloudflare-r2-theme-build-artifact-store";
import { storefrontThemeBuildDal } from "@/lib/storefront/dal/storefront-theme-build.dal";
import {
  buildFileTree,
  storefrontThemeFileDal,
} from "@/lib/storefront/dal/storefront-theme-file.dal";
import type {
  StorefrontThemeFileDTO,
  StorefrontThemeRevisionDTO,
  ThemeSourceRevisionManifest,
} from "@/lib/storefront/dto/storefront-theme-file.dto";
import { safeThemeFilePathSchema } from "@/lib/validations/storefront-theme-file";
import { CloudflareR2ThemeSourceBlobStore } from "./cloudflare-r2-theme-source-blob-store";
import { persistThemeSourceRevisionBlobs } from "./theme-source-revision-manifest";
import type {
  ThemeSourceBlobStore,
  ThemeRevisionStore,
  ThemeSourceStore,
} from "./theme-storage.types";

const runtimeR2Bucket = (env as unknown as { R2_BUCKET?: R2BucketLike })
  .R2_BUCKET;
const runtimeThemeSourceBlobStore = runtimeR2Bucket
  ? new CloudflareR2ThemeSourceBlobStore(runtimeR2Bucket)
  : undefined;

function nextWorkspaceFilesForRevision(
  storefrontId: string,
  themeId: string,
  currentFiles: readonly StorefrontThemeFileDTO[],
  files: readonly {
    path: string;
    content: string;
    mimeType?: string;
  }[],
  deletions: readonly { path: string }[],
): StorefrontThemeFileDTO[] {
  const byPath = new Map(currentFiles.map((file) => [file.path, file]));
  for (const deletion of deletions) byPath.delete(deletion.path);
  for (const file of files) {
    const previous = byPath.get(file.path);
    byPath.set(file.path, {
      ...(previous ?? {
        id: `pending:${file.path}`,
        storefrontId,
        themeId,
        path: file.path,
        isEntry: file.path === "src/pages/index.tsx",
        version: 1,
        createdAt: "",
        updatedAt: "",
      }),
      path: file.path,
      content: file.content,
      mimeType: file.mimeType ?? previous?.mimeType ?? "text/plain",
    });
  }
  return [...byPath.values()];
}

async function manifestForWorkspaceMutation(args: {
  storefrontId: string;
  themeId: string;
  files: readonly { path: string; content: string; mimeType?: string }[];
  deletions: readonly { path: string }[];
}): Promise<ThemeSourceRevisionManifest> {
  if (!runtimeThemeSourceBlobStore) {
    throw new Error(
      "R2_BUCKET_UNAVAILABLE: New Theme source revisions require immutable R2 source blob storage.",
    );
  }
  const currentFiles = await storefrontThemeFileDal.listFiles(
    args.storefrontId,
    args.themeId,
  );
  const nextFiles = nextWorkspaceFilesForRevision(
    args.storefrontId,
    args.themeId,
    currentFiles,
    args.files,
    args.deletions,
  );
  if (nextFiles.length === 0) {
    throw new Error(
      "EMPTY_THEME_WORKSPACE: Initialize starter theme files before creating a source revision.",
    );
  }
  return persistThemeSourceRevisionBlobs(
    nextFiles,
    runtimeThemeSourceBlobStore,
  );
}

/**
 * Current D1-backed implementation of the mutable theme workspace boundary.
 *
 * This intentionally delegates to the existing DAL so source-generation and
 * file-version OCC semantics remain unchanged while callers stop depending on
 * the concrete D1 representation.
 */
export const d1ThemeSourceStore: ThemeSourceStore = {
  initStarterTheme: (...args) => storefrontThemeFileDal.initStarterTheme(...args),
  listFiles: (...args) => storefrontThemeFileDal.listFiles(...args),
  getWorkspaceSnapshot: (...args) => storefrontThemeFileDal.listFiles(...args),
  getFileByPath: (...args) => storefrontThemeFileDal.getFileByPath(...args),
  async saveFile(storefrontId, themeId, path, content, mimeType, options) {
    const sourceManifest = options.createRevision
      ? await manifestForWorkspaceMutation({
          storefrontId,
          themeId,
          files: [{ path, content, mimeType }],
          deletions: [],
        })
      : undefined;
    return storefrontThemeFileDal.saveFile(
      storefrontId,
      themeId,
      path,
      content,
      mimeType,
      { ...options, sourceManifest },
    );
  },
  async saveFilesBatch(storefrontId, themeId, files, options) {
    const sourceManifest =
      options.createRevision && (files.length > 0 || (options.deletions?.length ?? 0) > 0)
        ? await manifestForWorkspaceMutation({
            storefrontId,
            themeId,
            files,
            deletions: options.deletions ?? [],
          })
        : undefined;
    return storefrontThemeFileDal.saveFilesBatch(
      storefrontId,
      themeId,
      files,
      { ...options, sourceManifest },
    );
  },
  deleteFile: (...args) => storefrontThemeFileDal.deleteFile(...args),
  getSourceGeneration: (...args) =>
    storefrontThemeFileDal.getSourceGeneration(...args),
};

/**
 * Pure presentation helper exposed from the storage composition module so
 * server functions do not need to import the concrete D1 DAL directly.
 */
export function buildThemeSourceFileTree(files: StorefrontThemeFileDTO[]) {
  return buildFileTree(files);
}

function validateManifest(manifest: ThemeSourceRevisionManifest): void {
  if (
    !manifest ||
    manifest.version !== 1 ||
    manifest.algorithm !== "sha256" ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0
  ) {
    throw new Error(
      "CORRUPT_THEME_SOURCE_MANIFEST: Immutable source manifest is invalid.",
    );
  }

  const paths = new Set<string>();
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      !safeThemeFilePathSchema.safeParse(file.path).success ||
      paths.has(file.path) ||
      !/^[a-f0-9]{64}$/.test(file.digest) ||
      !Number.isSafeInteger(file.sizeBytes) ||
      file.sizeBytes < 0 ||
      typeof file.mimeType !== "string" ||
      typeof file.isEntry !== "boolean"
    ) {
      throw new Error(
        "CORRUPT_THEME_SOURCE_MANIFEST: Immutable source manifest contains an invalid or duplicate file entry.",
      );
    }
    paths.add(file.path);
  }
}

async function materializeR2SourceRevision(
  revision: StorefrontThemeRevisionDTO,
  blobStore: ThemeSourceBlobStore,
): Promise<StorefrontThemeRevisionDTO> {
  const manifest = revision.sourceManifest;
  if (!manifest) return revision;

  validateManifest(manifest);
  const snapshot: StorefrontThemeRevisionDTO["snapshot"] = [];
  for (const file of manifest.files) {
    const bytes = await blobStore.getImmutable(file.digest);
    if (!bytes) {
      throw new Error(
        `SOURCE_BLOB_NOT_FOUND: Immutable source blob "${file.digest}" for "${file.path}" is missing.`,
      );
    }
    if (bytes.byteLength !== file.sizeBytes) {
      throw new Error(
        `SOURCE_BLOB_SIZE_MISMATCH: Immutable source blob "${file.digest}" for "${file.path}" has size ${bytes.byteLength}, expected ${file.sizeBytes}.`,
      );
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error(
        `SOURCE_BLOB_NOT_TEXT: Immutable Theme source blob "${file.digest}" for "${file.path}" is not valid UTF-8 text.`,
      );
    }
    snapshot.push({
      path: file.path,
      content,
      mimeType: file.mimeType,
      isEntry: file.isEntry,
    });
  }

  return { ...revision, snapshot };
}

export type D1ThemeRevisionStoreOptions = {
  blobStore?: ThemeSourceBlobStore;
};

/**
 * Current D1-backed implementation of immutable theme revisions.
 *
 * `materializeRevision` is the storage seam used by the build pipeline. New
 * revisions reconstruct their source from R2 blobs, while revisions without a
 * manifest use the explicit legacy D1 snapshot compatibility path.
 */
export function createD1ThemeRevisionStore(
  options: D1ThemeRevisionStoreOptions = {},
): ThemeRevisionStore {
  const blobStore = options.blobStore;

  return {
    async createRevision(storefrontId, themeId, createOptions) {
      if (!blobStore) {
        throw new Error(
          "R2_BUCKET_UNAVAILABLE: New Theme source revisions require immutable R2 source blob storage.",
        );
      }
      const files = await d1ThemeSourceStore.getWorkspaceSnapshot(
        storefrontId,
        themeId,
      );
      if (files.length === 0) {
        throw new Error(
          "EMPTY_THEME_WORKSPACE: Initialize starter theme files before creating a source revision.",
        );
      }
      const sourceManifest = await persistThemeSourceRevisionBlobs(
        files,
        blobStore,
      );
      return storefrontThemeFileDal.createRevision(storefrontId, themeId, {
        ...createOptions,
        sourceManifest,
      });
    },
    getRevision: (...args) => storefrontThemeBuildDal.getRevision(...args),
    async materializeRevision(storefrontId, themeId, revisionId) {
      const revision = await storefrontThemeBuildDal.getRevision(
        storefrontId,
        themeId,
        revisionId,
      );
      if (!revision) {
        throw new Error(
          `SOURCE_REVISION_NOT_FOUND: Immutable source revision "${revisionId}" was not found for storefront "${storefrontId}" and theme "${themeId}".`,
        );
      }
      if (!revision.sourceManifest) {
        // Explicit compatibility path for revisions created before R2 source
        // blobs were introduced. Never read mutable workspace files here.
        return revision;
      }
      if (!blobStore) {
        throw new Error(
          "R2_BUCKET_UNAVAILABLE: This source revision references immutable R2 blobs, but the source blob storage binding is not configured.",
        );
      }
      return materializeR2SourceRevision(revision, blobStore);
    },
    listRevisions: (...args) => storefrontThemeFileDal.listRevisions(...args),
    async rollbackToRevision(storefrontId, themeId, revisionNumber, rollbackOptions) {
      const revisions = await storefrontThemeFileDal.listRevisions(
        storefrontId,
        themeId,
      );
      const target = revisions.find(
        (revision) => revision.revisionNumber === revisionNumber,
      );
      if (!target) {
        throw new Error(`Revision #${revisionNumber} not found`);
      }
      if (target.sourceManifest && !blobStore) {
        throw new Error(
          "R2_BUCKET_UNAVAILABLE: This source revision references immutable R2 blobs, but the source blob storage binding is not configured.",
        );
      }
      const targetSnapshot = target.sourceManifest
        ? await materializeR2SourceRevision(target, blobStore!)
        : target;
      return storefrontThemeFileDal.rollbackToRevision(
        storefrontId,
        themeId,
        revisionNumber,
        {
          ...rollbackOptions,
          sourceManifest: target.sourceManifest ?? undefined,
          sourceSnapshot: targetSnapshot.snapshot,
        },
      );
    },
    getLatestPublishedRevision: (...args) =>
      storefrontThemeFileDal.getLatestPublishedRevision(...args),
  };
}

export const d1ThemeRevisionStore = createD1ThemeRevisionStore({
  blobStore: runtimeThemeSourceBlobStore,
});
