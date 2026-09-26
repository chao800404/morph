import {
  planThemeBinaryCopies,
  type ResolvedThemeBinaryCopy,
} from "./theme-binary-copies";
import { env } from "cloudflare:workers";
import type { R2BucketLike } from "@/lib/storefront/compiler/cloudflare-r2-theme-build-artifact-store";
import { storefrontThemeBuildDal } from "@/lib/storefront/dal/storefront-theme-build.dal";
import {
  buildFileTree,
  storefrontThemeFileDal,
} from "@/lib/storefront/dal/storefront-theme-file.dal";
import {
  isBinaryThemeFile,
  type StorefrontThemeBinaryFileDTO,
  type StorefrontThemeFileDTO,
  type StorefrontThemeRevisionDTO,
  type StorefrontThemeWorkspaceEntryDTO,
  type ThemeSourceRevisionManifest,
} from "@/lib/storefront/dto/storefront-theme-file.dto";
import { calculateThemeSourceSha256 } from "./cloudflare-r2-theme-source-blob-store";
import { buildThemeRouteRegistry } from "@/lib/storefront/compiler/theme-route-registry";
import {
  checkThemePublicFiles,
  checkThemePublicPath,
  describeThemePublicProblem,
  isThemePublicPath,
  themePublicBytesMatch,
} from "@/lib/storefront/theme-public-files";
import { safeThemeFilePathSchema } from "@/lib/validations/storefront-theme-file";
import { CloudflareR2ThemeSourceBlobStore } from "./cloudflare-r2-theme-source-blob-store";
import {
  parseRevisionTimestamp,
  shouldRecordThemeRevision,
  type ThemeRevisionReason,
} from "@/lib/storefront/editor/theme-revision-policy";
import { persistThemeSourceRevisionBlobs } from "./theme-source-revision-manifest";
import { deriveThemeSourceIndex } from "../theme-source-index";
import type {
  SaveThemeBinaryFileInput,
  SaveThemeBinaryFileOptions,
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
  currentFiles: readonly StorefrontThemeWorkspaceEntryDTO[],
  files: readonly {
    path: string;
    content: string;
    mimeType?: string;
  }[],
  deletions: readonly { path: string }[],
  binaryCopies: readonly ResolvedThemeBinaryCopy[] = [],
): StorefrontThemeWorkspaceEntryDTO[] {
  const byPath = new Map<string, StorefrontThemeWorkspaceEntryDTO>(
    currentFiles.map((file) => [file.path, file]),
  );
  for (const deletion of deletions) byPath.delete(deletion.path);
  for (const copy of binaryCopies) {
    byPath.set(copy.to, {
      id: `pending:${copy.to}`,
      storefrontId,
      themeId,
      path: copy.to,
      encoding: "binary",
      blobDigest: copy.blobDigest,
      sizeBytes: copy.sizeBytes,
      mimeType: copy.mimeType,
      isEntry: false,
      version: 1,
      createdAt: "",
      updatedAt: "",
    });
  }
  for (const file of files) {
    const found = byPath.get(file.path);
    // A source write cannot land on a binary file's path; the guard refuses
    // it. Only a source file is carried over as the one being replaced.
    const previous = found && !isBinaryThemeFile(found) ? found : undefined;
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
  binaryCopies?: readonly ResolvedThemeBinaryCopy[];
}): Promise<ThemeSourceRevisionManifest> {
  if (!runtimeThemeSourceBlobStore) {
    throw new Error(
      "R2_BUCKET_UNAVAILABLE: New Theme source revisions require immutable R2 source blob storage.",
    );
  }
  // The whole workspace: a revision written from source files alone would
  // leave every binary file out of it.
  const currentFiles = await storefrontThemeFileDal.listWorkspaceEntries(
    args.storefrontId,
    args.themeId,
  );
  const nextFiles = nextWorkspaceFilesForRevision(
    args.storefrontId,
    args.themeId,
    currentFiles,
    args.files,
    args.deletions,
    args.binaryCopies,
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

async function sourceIndexForWorkspaceMutation(args: {
  storefrontId: string;
  themeId: string;
  expectedSourceGeneration: number;
  files: readonly { path: string; content: string; mimeType?: string }[];
  deletions: readonly { path: string }[];
}) {
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
  return deriveThemeSourceIndex({
    files: nextFiles,
    scope: "workspace",
    sourceGeneration: args.expectedSourceGeneration + 1,
  });
}

/**
 * Whether this mutation should leave a revision behind.
 *
 * Decided here rather than taken from the caller: history is what makes a
 * deletion survivable, and a client that never asked for a revision would
 * leave a workspace with no way back. `createRevision: true` still forces one
 * — a rename or an upgrade knows it is a landmark — but declining is not the
 * caller's to decide.
 */
async function shouldRecordRevision(args: {
  storefrontId: string;
  themeId: string;
  reason: ThemeRevisionReason;
}): Promise<boolean> {
  if (args.reason !== "save") return true;
  const lastRevisionAt = await storefrontThemeFileDal.getLatestRevisionAt(
    args.storefrontId,
    args.themeId,
  );
  return shouldRecordThemeRevision({
    reason: "save",
    now: Date.now(),
    lastRevisionAt: parseRevisionTimestamp(lastRevisionAt),
  });
}

/**
 * Current D1-backed implementation of the mutable theme workspace boundary.
 *
 * This intentionally delegates to the existing DAL so source-generation and
 * file-version OCC semantics remain unchanged while callers stop depending on
 * the concrete D1 representation.
 */
/**
 * The revision and source index a write of `files` would record, decided as a
 * save through this store decides them.
 *
 * For writes that change source together with something else in one batch,
 * and so cannot go through `saveFilesBatch`, yet must leave the same history
 * and index behind as any other save.
 */
export async function recordsForWorkspaceSave(args: {
  storefrontId: string;
  themeId: string;
  expectedSourceGeneration: number;
  files: readonly { path: string; content: string; mimeType?: string }[];
}) {
  const createRevision = await shouldRecordRevision({
    storefrontId: args.storefrontId,
    themeId: args.themeId,
    reason: "save",
  });
  const sourceManifest = createRevision
    ? await manifestForWorkspaceMutation({ ...args, deletions: [] })
    : undefined;
  const sourceIndex = await sourceIndexForWorkspaceMutation({
    ...args,
    deletions: [],
  });
  return { createRevision, sourceManifest, sourceIndex };
}

/**
 * Stores a file served as it is from `public/`: bytes into the immutable
 * blob store, then the workspace row that names them.
 *
 * Everything the contract says is checked here, on the server, against the
 * workspace as it stands: the path, that the bytes are the format the name
 * says, and the whole directory's limits with this file in it. The served
 * type is the contract's, from the verified format, never a caller's.
 *
 * The bytes are written first. If the row's guards then refuse the write,
 * they stay behind unreferenced — harmless, since they are immutable and
 * content-addressed, and never collected on the strength of the workspace
 * alone (see `theme-public-dir-plan`).
 */
export async function saveThemeBinaryFile(
  blobStore: ThemeSourceBlobStore,
  args: {
    storefrontId: string;
    themeId: string;
    file: SaveThemeBinaryFileInput;
    options: SaveThemeBinaryFileOptions;
  },
): Promise<StorefrontThemeBinaryFileDTO & { sourceGeneration: number }> {
  const { storefrontId, themeId, file, options } = args;
  const entries = await storefrontThemeFileDal.listWorkspaceEntries(
    storefrontId,
    themeId,
  );
  const sourceFiles = entries.filter(
    (entry): entry is StorefrontThemeFileDTO => !isBinaryThemeFile(entry),
  );
  const routePaths = buildThemeRouteRegistry(sourceFiles).routes.map(
    (route) => route.path,
  );

  const pathCheck = checkThemePublicPath(file.path, routePaths);
  if (!pathCheck.ok) {
    throw new Error(
      `THEME_PUBLIC_FILE_REFUSED: ${file.path}: ${describeThemePublicProblem(pathCheck.reason)}`,
    );
  }
  if (!themePublicBytesMatch(file.path, file.bytes)) {
    throw new Error(
      `THEME_PUBLIC_FILE_REFUSED: ${file.path}: The file's content is not the format its name says.`,
    );
  }
  const setCheck = checkThemePublicFiles(
    [
      ...entries
        .filter(
          (entry) =>
            isBinaryThemeFile(entry) &&
            isThemePublicPath(entry.path) &&
            entry.path !== file.path,
        )
        .map((entry) => ({
          path: entry.path,
          size: isBinaryThemeFile(entry) ? entry.sizeBytes : 0,
        })),
      { path: file.path, size: file.bytes.byteLength },
    ],
    routePaths,
  );
  if (!setCheck.ok) {
    throw new Error(
      `THEME_PUBLIC_FILE_REFUSED: ${setCheck.problems
        .map(
          (problem) =>
            `${problem.path}: ${describeThemePublicProblem(problem.reason)}`,
        )
        .join(" ")}`,
    );
  }

  const blobDigest = calculateThemeSourceSha256(file.bytes);
  const sizeBytes = file.bytes.byteLength;
  await blobStore.putImmutable({
    digest: blobDigest,
    content: file.bytes,
    mimeType: pathCheck.mimeType,
  });

  const now = new Date().toISOString();
  const stored: StorefrontThemeBinaryFileDTO = {
    id: `pending:${file.path}`,
    storefrontId,
    themeId,
    path: file.path,
    encoding: "binary",
    blobDigest,
    sizeBytes,
    mimeType: pathCheck.mimeType,
    isEntry: false,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const createRevision = await shouldRecordRevision({
    storefrontId,
    themeId,
    reason: "save",
  });
  const sourceManifest = createRevision
    ? await persistThemeSourceRevisionBlobs(
        [...entries.filter((entry) => entry.path !== file.path), stored],
        blobStore,
      )
    : undefined;

  return storefrontThemeFileDal.saveBinaryFile(
    storefrontId,
    themeId,
    {
      path: file.path,
      blobDigest,
      sizeBytes,
      mimeType: pathCheck.mimeType,
      expectedFileId: file.expectedFileId,
      expectedVersion: file.expectedVersion,
      expectMissing: file.expectMissing,
    },
    {
      expectedSourceGeneration: options.expectedSourceGeneration,
      createRevision,
      revisionMessage: `Upload ${file.path}`,
      createdBy: options.createdBy,
      sourceManifest,
      sourceIndex: deriveThemeSourceIndex({
        files: sourceFiles,
        scope: "workspace",
        sourceGeneration: options.expectedSourceGeneration + 1,
      }),
    },
  );
}

/** See `ThemeSourceStore.readBinaryFile`; the blob store is a parameter for tests. */
export async function readThemeBinaryFile(
  blobStore: ThemeSourceBlobStore,
  digest: string,
): Promise<Uint8Array> {
  const bytes = await blobStore.getImmutable(digest);
  if (!bytes) {
    throw new Error(
      `SOURCE_BLOB_NOT_FOUND: Binary Theme file blob "${digest}" is missing.`,
    );
  }
  return bytes;
}

export const d1ThemeSourceStore: ThemeSourceStore = {
  initStarterTheme: (...args) =>
    storefrontThemeFileDal.initStarterTheme(...args),
  listFiles: (...args) => storefrontThemeFileDal.listFiles(...args),
  getWorkspaceSnapshot: (...args) =>
    storefrontThemeFileDal.listWorkspaceEntries(...args),
  getFileByPath: (...args) => storefrontThemeFileDal.getFileByPath(...args),
  async saveFile(storefrontId, themeId, path, content, mimeType, options) {
    const createRevision = await shouldRecordRevision({
      storefrontId,
      themeId,
      reason: options.createRevision ? "explicit" : "save",
    });
    const sourceManifest = createRevision
      ? await manifestForWorkspaceMutation({
          storefrontId,
          themeId,
          files: [{ path, content, mimeType }],
          deletions: [],
        })
      : undefined;
    const sourceIndex = await sourceIndexForWorkspaceMutation({
      storefrontId,
      themeId,
      expectedSourceGeneration: options.expectedSourceGeneration,
      files: [{ path, content, mimeType }],
      deletions: [],
    });
    return storefrontThemeFileDal.saveFile(
      storefrontId,
      themeId,
      path,
      content,
      mimeType,
      { ...options, createRevision, sourceManifest, sourceIndex },
    );
  },
  async saveFilesBatch(storefrontId, themeId, files, options) {
    // Copies are checked against the workspace as it is and the set the
    // whole batch leaves; the DAL then holds the sources to the ids and
    // versions read here, in the same transaction as every other change.
    let binaryCopies: ResolvedThemeBinaryCopy[] = [];
    if ((options.binaryCopies?.length ?? 0) > 0) {
      const planned = planThemeBinaryCopies({
        entries: await storefrontThemeFileDal.listWorkspaceEntries(
          storefrontId,
          themeId,
        ),
        copies: options.binaryCopies ?? [],
        writes: files,
        deletions: options.deletions ?? [],
      });
      if (!planned.ok) throw new Error(planned.message);
      binaryCopies = planned.copies;
    }
    const changesSomething =
      files.length > 0 ||
      (options.deletions?.length ?? 0) > 0 ||
      binaryCopies.length > 0;
    const createRevision =
      changesSomething &&
      (await shouldRecordRevision({
        storefrontId,
        themeId,
        // A batch that removes anything is a deletion, whatever else it does.
        reason:
          (options.deletions?.length ?? 0) > 0
            ? "delete"
            : options.createRevision
              ? "explicit"
              : "save",
      }));
    const sourceManifest = createRevision
      ? await manifestForWorkspaceMutation({
          storefrontId,
          themeId,
          files,
          deletions: options.deletions ?? [],
          binaryCopies,
        })
      : undefined;
    const sourceIndex = await sourceIndexForWorkspaceMutation({
      storefrontId,
      themeId,
      expectedSourceGeneration: options.expectedSourceGeneration,
      files,
      deletions: options.deletions ?? [],
    });
    return storefrontThemeFileDal.saveFilesBatch(storefrontId, themeId, files, {
      ...options,
      binaryCopies,
      createRevision,
      sourceManifest,
      sourceIndex,
    });
  },
  async deleteFile(
    storefrontId,
    themeId,
    path,
    expectedFileId,
    expectedVersion,
    options,
  ) {
    // The workspace as it stands, with the file still in it: that is the state
    // worth returning to, and the only one that can bring the file back.
    let sourceManifest: ThemeSourceRevisionManifest | undefined;
    try {
      sourceManifest = await manifestForWorkspaceMutation({
        storefrontId,
        themeId,
        files: [],
        deletions: [],
      });
    } catch {
      // A workspace that cannot be snapshotted — no R2 binding, or already
      // empty — must not block the deletion itself. The delete is what the
      // author asked for; the history is what this layer adds on top.
      sourceManifest = undefined;
    }
    const sourceIndex = await sourceIndexForWorkspaceMutation({
      storefrontId,
      themeId,
      expectedSourceGeneration: options.expectedSourceGeneration,
      files: [],
      deletions: [{ path }],
    });
    return storefrontThemeFileDal.deleteFile(
      storefrontId,
      themeId,
      path,
      expectedFileId,
      expectedVersion,
      {
        ...options,
        createRevision: sourceManifest !== undefined,
        revisionMessage: `Before deleting ${path}`,
        sourceManifest,
        sourceIndex,
      },
    );
  },
  async saveBinaryFile(storefrontId, themeId, file, options) {
    if (!runtimeThemeSourceBlobStore) {
      throw new Error(
        "R2_BUCKET_UNAVAILABLE: Binary Theme files require immutable R2 source blob storage.",
      );
    }
    return saveThemeBinaryFile(runtimeThemeSourceBlobStore, {
      storefrontId,
      themeId,
      file,
      options,
    });
  },
  async readBinaryFile(digest) {
    if (!runtimeThemeSourceBlobStore) {
      throw new Error(
        "R2_BUCKET_UNAVAILABLE: Binary Theme files require immutable R2 source blob storage.",
      );
    }
    return readThemeBinaryFile(runtimeThemeSourceBlobStore, digest);
  },
  prepareSourceRevisionManifest: async (files) => {
    if (!runtimeThemeSourceBlobStore) {
      throw new Error(
        "R2_BUCKET_UNAVAILABLE: Manifest removal requires immutable R2 source blob storage.",
      );
    }
    return persistThemeSourceRevisionBlobs(files, runtimeThemeSourceBlobStore);
  },
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
    if (file.encoding === "binary") {
      // Carried by reference, as the workspace holds it. The bytes are
      // checked against the digest here, so a revision can only name bytes
      // that are actually the file it recorded.
      if (calculateThemeSourceSha256(bytes) !== file.digest) {
        throw new Error(
          `SOURCE_BLOB_DIGEST_MISMATCH: Immutable source blob "${file.digest}" for "${file.path}" does not hash to its digest.`,
        );
      }
      snapshot.push({
        path: file.path,
        encoding: "binary",
        blobDigest: file.digest,
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
        isEntry: file.isEntry,
      });
      continue;
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
      const sourceIndex = deriveThemeSourceIndex({
        files: files.filter((file) => !isBinaryThemeFile(file)),
        scope: "revision",
        sourceManifest,
      });
      return storefrontThemeFileDal.createRevision(storefrontId, themeId, {
        ...createOptions,
        sourceManifest,
        sourceIndex,
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
    async materializeRevisionByNumber(storefrontId, themeId, revisionNumber) {
      const target = await storefrontThemeFileDal.findRevisionByNumber(
        storefrontId,
        themeId,
        revisionNumber,
      );
      if (!target) {
        throw new Error(`Revision #${revisionNumber} not found`);
      }
      if (target.sourceManifest && !blobStore) {
        throw new Error(
          "R2_BUCKET_UNAVAILABLE: This source revision references immutable R2 blobs, but the source blob storage binding is not configured.",
        );
      }
      return target.sourceManifest
        ? await materializeR2SourceRevision(target, blobStore!)
        : target;
    },
    async planRouteDocumentRollback(storefrontId, themeId, revision) {
      if (
        !(await storefrontThemeFileDal.verifyOwnership(storefrontId, themeId))
      ) {
        throw new Error("Theme not found or does not belong to storefront");
      }
      return storefrontThemeFileDal.planRouteDocumentRollback(
        themeId,
        revision,
      );
    },
    async rollbackToRevision(
      storefrontId,
      themeId,
      revisionNumber,
      rollbackOptions,
    ) {
      // Read through the same call the preview uses, so what an author agreed
      // to and what is applied cannot describe two different revisions.
      const target = await this.materializeRevisionByNumber(
        storefrontId,
        themeId,
        revisionNumber,
      );
      return storefrontThemeFileDal.rollbackToRevision(
        storefrontId,
        themeId,
        revisionNumber,
        {
          ...rollbackOptions,
          sourceManifest: target.sourceManifest ?? undefined,
          sourceSnapshot: target.snapshot,
          sourceIndex: deriveThemeSourceIndex({
            files: target.snapshot.filter((file) => !isBinaryThemeFile(file)),
            scope: "workspace",
            sourceGeneration: rollbackOptions.expectedSourceGeneration + 1,
            sourceManifest: target.sourceManifest,
          }),
        },
      );
    },
    /**
     * Reads the published revision with its file contents actually present.
     *
     * A revision written against R2 stores `snapshot` as `[]` and keeps the
     * files behind `source_manifest`, so returning the row as-is hands back a
     * revision that looks like a theme with no files. The editor compares the
     * working tree against that to decide whether anything is unpublished, and
     * against an empty snapshot every file reads as newly added — which left
     * Publish enabled on a store where nothing had changed.
     */
    async getLatestPublishedRevision(storefrontId, themeId) {
      const revision = await storefrontThemeFileDal.getLatestPublishedRevision(
        storefrontId,
        themeId,
      );
      if (!revision?.sourceManifest) return revision;
      if (!blobStore) {
        throw new Error(
          "R2_BUCKET_UNAVAILABLE: This source revision references immutable R2 blobs, but the source blob storage binding is not configured.",
        );
      }
      return materializeR2SourceRevision(revision, blobStore);
    },
  };
}

export const d1ThemeRevisionStore = createD1ThemeRevisionStore({
  blobStore: runtimeThemeSourceBlobStore,
});
