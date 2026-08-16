import { getDb } from "@/db";
import {
  storefrontThemeBuilds,
  storefrontThemeRevisions,
} from "@/db/storefront.schema";
import type { StorefrontThemeBuildInput } from "@/lib/storefront/dto/storefront-theme-build.dto";
import { and, eq, isNull } from "drizzle-orm";
import { TAILWIND_VERSION } from "./tailwind-builtin-stylesheets";
import { computeThemeInputHash } from "./theme-compiler-hasher";
import type { ThemeCompilerFile } from "./theme-compiler.types";

/**
 * Normalizes snapshot raw entries into a sorted, unique ThemeCompilerFile array.
 */
export function normalizeRevisionSnapshot(
  snapshot: any,
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

    const path = raw.path.replace(/\\/g, "/").trim();
    if (!path) continue;

    const file: ThemeCompilerFile = {
      path,
      content: raw.content,
      mimeType: raw.mimeType,
      isEntry: Boolean(raw.isEntry),
    };

    if (raw.isEntry) {
      detectedEntry = path;
    }

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

export const themeBuildMaterializer = {
  /**
   * Materializes an immutable StorefrontThemeBuildInput strictly from the Build's bound sourceRevisionId.
   *
   * STRICT INVARIANTS:
   * 1. Reads ONLY from storefront_theme_revisions.snapshot.
   * 2. NEVER reads from or falls back to storefront_theme_files working tree.
   * 3. Deterministic file sorting and SHA-256 input hashing via computeThemeInputHash.
   * 4. Updates build record's inputHash/compiler metadata if status is non-terminal.
   */
  async materializeThemeBuildInput(
    storefrontId: string,
    themeId: string,
    buildId: string,
    options?: {
      compilerId?: string;
      compilerVersion?: string;
    },
  ): Promise<StorefrontThemeBuildInput> {
    const db = await getDb();

    // 1. Fetch Build Record
    const [build] = await db
      .select()
      .from(storefrontThemeBuilds)
      .where(
        and(
          eq(storefrontThemeBuilds.id, buildId),
          eq(storefrontThemeBuilds.storefrontId, storefrontId),
          eq(storefrontThemeBuilds.themeId, themeId),
          isNull(storefrontThemeBuilds.deletedAt),
        ),
      )
      .limit(1);

    if (!build) {
      throw new Error(
        `BUILD_NOT_FOUND: Theme build "${buildId}" not found for storefront "${storefrontId}" and theme "${themeId}".`,
      );
    }

    // 2. Fetch Bound Immutable Source Revision Record (strictly from storefront_theme_revisions)
    const [revision] = await db
      .select()
      .from(storefrontThemeRevisions)
      .where(
        and(
          eq(storefrontThemeRevisions.id, build.sourceRevisionId),
          eq(storefrontThemeRevisions.storefrontId, storefrontId),
          eq(storefrontThemeRevisions.themeId, themeId),
          isNull(storefrontThemeRevisions.deletedAt),
        ),
      )
      .limit(1);

    if (!revision) {
      throw new Error(
        `SOURCE_REVISION_NOT_FOUND: Immutable source revision "${build.sourceRevisionId}" bound to build "${buildId}" was not found or was deleted.`,
      );
    }

    // 3. Materialize and validate files strictly from revision.snapshot
    const { files, entry } = normalizeRevisionSnapshot(
      revision.snapshot,
      build.sourceRevisionId,
    );

    // 4. Compute single identity SHA-256 hash
    const compilerId =
      options?.compilerId ?? build.compilerId ?? "tailwind-v4-build";
    const compilerVersion =
      options?.compilerVersion ?? build.compilerVersion ?? TAILWIND_VERSION;

    const inputHash = computeThemeInputHash(
      { files, entry },
      { id: compilerId, version: compilerVersion },
    );

    // 5. Persist inputHash / compiler metadata to build record if queued/building and not yet set
    if (
      (build.status === "queued" || build.status === "building") &&
      (build.inputHash !== inputHash ||
        build.compilerId !== compilerId ||
        build.compilerVersion !== compilerVersion)
    ) {
      const now = new Date().toISOString();
      await db
        .update(storefrontThemeBuilds)
        .set({
          inputHash,
          compilerId,
          compilerVersion,
          updatedAt: now,
        })
        .where(
          and(
            eq(storefrontThemeBuilds.id, buildId),
            eq(storefrontThemeBuilds.status, build.status),
          ),
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
  },
};
