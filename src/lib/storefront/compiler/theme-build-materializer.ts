import type {
  StorefrontThemeBuildDTO,
  StorefrontThemeBuildInput,
} from "@/lib/storefront/dto/storefront-theme-build.dto";
import type { StorefrontThemeRevisionDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import { safeThemeFilePathSchema } from "@/lib/validations/storefront-theme-file";
import { TAILWIND_VERSION } from "./tailwind-builtin-stylesheets";
import { computeThemeInputHash } from "./theme-compiler-hasher";
import type { ThemeCompilerFile } from "./theme-compiler.types";

export type MaterializeThemeBuildInputParams = {
  build: StorefrontThemeBuildDTO;
  revision: StorefrontThemeRevisionDTO;
  compilerIdentity?: {
    compilerId?: string;
    compilerVersion?: string;
  };
};

/**
 * Normalizes snapshot raw entries into a sorted, unique ThemeCompilerFile array with fail-closed security checks.
 */
export function normalizeRevisionSnapshot(
  snapshot: unknown,
  sourceRevisionId: string,
): { files: ThemeCompilerFile[]; entry: string } {
  if (!snapshot || !Array.isArray(snapshot) || snapshot.length === 0) {
    throw new Error(
      `EMPTY_OR_CORRUPT_REVISION_SNAPSHOT: Source revision ${sourceRevisionId} snapshot is empty or invalid. Zero files found.`,
    );
  }

  const fileMap = new Map<string, ThemeCompilerFile>();
  let detectedEntry: string | undefined;

  for (const raw of snapshot) {
    if (
      !raw ||
      typeof raw.path !== "string" ||
      typeof raw.content !== "string"
    ) {
      throw new Error(
        `CORRUPT_REVISION_FILE_ENTRY: Invalid file entry in source revision ${sourceRevisionId}. Missing path or content.`,
      );
    }

    const normalizedPath = raw.path.replace(/\\/g, "/").trim();
    const parseResult = safeThemeFilePathSchema.safeParse(normalizedPath);
    if (!parseResult.success) {
      throw new Error(
        `CORRUPT_REVISION_FILE_PATH: Unsafe file path "${raw.path}" in source revision ${sourceRevisionId}: ${parseResult.error.issues[0]?.message}`,
      );
    }
    const path = parseResult.data;

    if (fileMap.has(path)) {
      throw new Error(
        `CORRUPT_REVISION_SNAPSHOT: Duplicate file path found in source revision ${sourceRevisionId}: "${path}".`,
      );
    }

    if (raw.isEntry) {
      if (detectedEntry) {
        throw new Error(
          `CORRUPT_REVISION_SNAPSHOT: Multiple entry files declared in source revision ${sourceRevisionId}: "${detectedEntry}" and "${path}".`,
        );
      }
      detectedEntry = path;
    }

    const file: ThemeCompilerFile = {
      path,
      content: raw.content,
      mimeType: raw.mimeType,
      isEntry: Boolean(raw.isEntry),
    };

    fileMap.set(path, file);
  }

  if (fileMap.size === 0) {
    throw new Error(
      `EMPTY_OR_CORRUPT_REVISION_SNAPSHOT: Source revision ${sourceRevisionId} produced zero valid files.`,
    );
  }

  // Sort files deterministically by path
  const sortedFiles = Array.from(fileMap.values()).sort((a, b) =>
    a.path.localeCompare(b.path),
  );

  const entry =
    detectedEntry ??
    (fileMap.has("src/pages/index.tsx")
      ? "src/pages/index.tsx"
      : sortedFiles[0].path);

  return {
    files: sortedFiles,
    entry,
  };
}

/**
 * Pure Materializer Function:
 * Reconstructs the complete, immutable virtual filesystem and compiler input strictly from the provided Build and Revision DTOs.
 *
 * Identity Invariants:
 * 1. If build already has frozen compilerId / compilerVersion (e.g. status !== "queued" or already set),
 *    and caller passes conflicting compilerIdentity, it throws COMPILER_IDENTITY_MISMATCH.
 * 2. If build is queued and has no compilerId / compilerVersion set, it uses provided compilerIdentity or defaults.
 * 3. Pure function: performs ZERO database queries or side effects.
 */
export function materializeThemeBuildInput({
  build,
  revision,
  compilerIdentity,
}: MaterializeThemeBuildInputParams): StorefrontThemeBuildInput {
  // Validate ownership match between Build and Revision
  if (
    build.sourceRevisionId !== revision.id ||
    build.storefrontId !== revision.storefrontId ||
    build.themeId !== revision.themeId
  ) {
    throw new Error(
      `SOURCE_REVISION_MISMATCH: Build "${build.id}" bound revision "${build.sourceRevisionId}" does not match provided revision "${revision.id}" or storefront/theme ownership mismatch.`,
    );
  }

  // Determine compiler identity & guard against identity drift
  let compilerId: string;
  let compilerVersion: string;

  if (build.compilerId || build.compilerVersion || build.status !== "queued") {
    // Identity is already bound / frozen on build
    const boundCompilerId = build.compilerId ?? "tailwind-v4-build";
    const boundCompilerVersion = build.compilerVersion ?? TAILWIND_VERSION;

    if (
      compilerIdentity?.compilerId &&
      compilerIdentity.compilerId !== boundCompilerId
    ) {
      throw new Error(
        `COMPILER_IDENTITY_MISMATCH: Cannot override compilerId for build "${build.id}" with status "${build.status}". Expected "${boundCompilerId}", got "${compilerIdentity.compilerId}".`,
      );
    }

    if (
      compilerIdentity?.compilerVersion &&
      compilerIdentity.compilerVersion !== boundCompilerVersion
    ) {
      throw new Error(
        `COMPILER_IDENTITY_MISMATCH: Cannot override compilerVersion for build "${build.id}" with status "${build.status}". Expected "${boundCompilerVersion}", got "${compilerIdentity.compilerVersion}".`,
      );
    }

    compilerId = boundCompilerId;
    compilerVersion = boundCompilerVersion;
  } else {
    // Build is queued and not yet bound
    compilerId = compilerIdentity?.compilerId ?? "tailwind-v4-build";
    compilerVersion = compilerIdentity?.compilerVersion ?? TAILWIND_VERSION;
  }

  // Normalize files strictly from revision snapshot
  const { files, entry } = normalizeRevisionSnapshot(
    revision.snapshot,
    revision.id,
  );

  // Compute deterministic SHA-256 hash
  const inputHash = computeThemeInputHash(
    { files, entry },
    { id: compilerId, version: compilerVersion },
  );

  // Verify hash matches build.inputHash if already set
  if (build.inputHash && build.inputHash !== inputHash) {
    throw new Error(
      `INPUT_HASH_MISMATCH: Computed inputHash "${inputHash}" does not match recorded build inputHash "${build.inputHash}".`,
    );
  }

  return {
    buildId: build.id,
    storefrontId: build.storefrontId,
    themeId: build.themeId,
    sourceRevisionId: build.sourceRevisionId,
    revisionNumber: revision.revisionNumber,
    files,
    entry,
    inputHash,
    compilerId,
    compilerVersion,
  };
}
