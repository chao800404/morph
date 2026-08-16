import { getDb } from "@/db";
import {
  storefrontThemeFiles,
  storefrontThemeRevisions,
  storefrontThemes,
} from "@/db/storefront.schema";
import type {
  StorefrontThemeFileDTO,
  StorefrontThemeFileTreeNode,
  StorefrontThemeRevisionDTO,
} from "@/lib/storefront/dto/storefront-theme-file.dto";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { and, asc, desc, eq, isNull, max } from "drizzle-orm";

export function buildFileTree(
  files: StorefrontThemeFileDTO[],
): StorefrontThemeFileTreeNode[] {
  const root: StorefrontThemeFileTreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split("/");
    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const currentPath = parts.slice(0, i + 1).join("/");

      let existing = currentLevel.find((node) => node.name === part);

      if (!existing) {
        existing = {
          name: part,
          path: currentPath,
          isDirectory: !isFile,
          mimeType: isFile ? file.mimeType : undefined,
          size: isFile ? file.content.length : undefined,
          children: isFile ? undefined : [],
        };
        currentLevel.push(existing);
      }

      if (!isFile && existing.children) {
        currentLevel = existing.children;
      }
    }
  }

  // Sort: directories first, then alphabetical
  const sortNodes = (nodes: StorefrontThemeFileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) {
        sortNodes(node.children);
      }
    }
  };

  sortNodes(root);
  return root;
}

export const storefrontThemeFileDal = {
  /**
   * Strictly verify that the theme belongs to the given storefront.
   */
  async verifyOwnership(
    storefrontId: string,
    themeId: string,
  ): Promise<boolean> {
    const db = await getDb();
    const [theme] = await db
      .select({ id: storefrontThemes.id })
      .from(storefrontThemes)
      .where(
        and(
          eq(storefrontThemes.id, themeId),
          eq(storefrontThemes.storefrontId, storefrontId),
          isNull(storefrontThemes.deletedAt),
        ),
      )
      .limit(1);

    return Boolean(theme);
  },

  /**
   * Explicitly initialize starter theme workspace files.
   */
  async initStarterTheme(
    storefrontId: string,
    themeId: string,
    createdBy?: string,
  ): Promise<StorefrontThemeFileDTO[]> {
    const isOwner = await this.verifyOwnership(storefrontId, themeId);
    if (!isOwner) throw new Error("Theme not found or does not belong to storefront");

    const db = await getDb();
    const now = new Date().toISOString();

    const insertValues = STARTER_THEME_FILES.map((f) => ({
      id: crypto.randomUUID(),
      storefrontId,
      themeId,
      path: f.path,
      content: f.content,
      mimeType: f.mimeType,
      isEntry: f.isEntry ?? false,
      createdAt: now,
      updatedAt: now,
    }));

    for (const val of insertValues) {
      await db.insert(storefrontThemeFiles).values(val).onConflictDoNothing();
    }

    // Create initial revision #1
    await this.createRevision(storefrontId, themeId, {
      message: "Initialize starter theme files",
      source: "manual",
      createdBy,
    });

    return this.listFiles(storefrontId, themeId);
  },

  /**
   * List files without any auto-seed side effects.
   */
  async listFiles(
    storefrontId: string,
    themeId: string,
  ): Promise<StorefrontThemeFileDTO[]> {
    const isOwner = await this.verifyOwnership(storefrontId, themeId);
    if (!isOwner) return [];

    const db = await getDb();
    const rows = await db
      .select()
      .from(storefrontThemeFiles)
      .where(
        and(
          eq(storefrontThemeFiles.storefrontId, storefrontId),
          eq(storefrontThemeFiles.themeId, themeId),
          isNull(storefrontThemeFiles.deletedAt),
        ),
      )
      .orderBy(asc(storefrontThemeFiles.path));

    return rows.map((row) => ({
      id: row.id,
      storefrontId: row.storefrontId,
      themeId: row.themeId,
      path: row.path,
      content: row.content,
      mimeType: row.mimeType ?? "text/plain",
      isEntry: Boolean(row.isEntry),
      version: row.version ?? 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  },

  async getFileByPath(
    storefrontId: string,
    themeId: string,
    path: string,
  ): Promise<StorefrontThemeFileDTO | null> {
    const isOwner = await this.verifyOwnership(storefrontId, themeId);
    if (!isOwner) return null;

    const db = await getDb();
    const [row] = await db
      .select()
      .from(storefrontThemeFiles)
      .where(
        and(
          eq(storefrontThemeFiles.storefrontId, storefrontId),
          eq(storefrontThemeFiles.themeId, themeId),
          eq(storefrontThemeFiles.path, path),
          isNull(storefrontThemeFiles.deletedAt),
        ),
      )
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      storefrontId: row.storefrontId,
      themeId: row.themeId,
      path: row.path,
      content: row.content,
      mimeType: row.mimeType ?? "text/plain",
      isEntry: Boolean(row.isEntry),
      version: row.version ?? 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },

  async saveFile(
    storefrontId: string,
    themeId: string,
    path: string,
    content: string,
    mimeType?: string,
    options?: {
      expectedVersion?: number;
      createRevision?: boolean;
      revisionMessage?: string;
      createdBy?: string;
    },
  ): Promise<StorefrontThemeFileDTO> {
    const isOwner = await this.verifyOwnership(storefrontId, themeId);
    if (!isOwner) throw new Error("Theme not found or does not belong to storefront");

    const db = await getDb();
    const now = new Date().toISOString();

    const [existing] = await db
      .select()
      .from(storefrontThemeFiles)
      .where(
        and(
          eq(storefrontThemeFiles.storefrontId, storefrontId),
          eq(storefrontThemeFiles.themeId, themeId),
          eq(storefrontThemeFiles.path, path),
          isNull(storefrontThemeFiles.deletedAt),
        ),
      )
      .limit(1);

    let savedFile: StorefrontThemeFileDTO;

    if (existing) {
      const currentVersion = existing.version ?? 1;
      if (
        options?.expectedVersion !== undefined &&
        options.expectedVersion !== currentVersion
      ) {
        throw new Error(
          `CONFLICT_VERSION_MISMATCH: file "${path}" was modified elsewhere (expected v${options.expectedVersion}, currently v${currentVersion})`,
        );
      }

      const nextVersion = currentVersion + 1;
      const updateResult = await db
        .update(storefrontThemeFiles)
        .set({
          content,
          version: nextVersion,
          mimeType: mimeType ?? existing.mimeType,
          updatedAt: now,
        })
        .where(
          and(
            eq(storefrontThemeFiles.id, existing.id),
            eq(storefrontThemeFiles.version, currentVersion),
          ),
        )
        .returning();

      if (!updateResult || updateResult.length === 0) {
        throw new Error(
          `CONFLICT_VERSION_MISMATCH: Atomic update failed for file "${path}". The file was modified by another concurrent operation.`,
        );
      }

      const updatedRow = updateResult[0];
      savedFile = {
        id: updatedRow.id,
        storefrontId,
        themeId,
        path,
        content: updatedRow.content,
        mimeType: updatedRow.mimeType ?? "text/plain",
        isEntry: Boolean(updatedRow.isEntry),
        version: updatedRow.version ?? nextVersion,
        createdAt: updatedRow.createdAt,
        updatedAt: updatedRow.updatedAt ?? now,
      };
    } else {
      const newId = crypto.randomUUID();
      const isEntry = path === "src/pages/index.tsx";
      const detectedMime =
        mimeType ??
        (path.endsWith(".tsx") || path.endsWith(".ts")
          ? "text/typescript"
          : path.endsWith(".css")
            ? "text/css"
            : path.endsWith(".json")
              ? "application/json"
              : "text/plain");

      await db.insert(storefrontThemeFiles).values({
        id: newId,
        storefrontId,
        themeId,
        path,
        content,
        mimeType: detectedMime,
        isEntry,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });

      savedFile = {
        id: newId,
        storefrontId,
        themeId,
        path,
        content,
        mimeType: detectedMime,
        isEntry,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
    }

    if (options?.createRevision) {
      await this.createRevision(storefrontId, themeId, {
        message: options.revisionMessage ?? `Update ${path}`,
        source: "manual",
        createdBy: options.createdBy,
      });
    }

    return savedFile;
  },

  async deleteFile(
    storefrontId: string,
    themeId: string,
    path: string,
  ): Promise<boolean> {
    const isOwner = await this.verifyOwnership(storefrontId, themeId);
    if (!isOwner) return false;

    const db = await getDb();
    const now = new Date().toISOString();

    const result = await db
      .update(storefrontThemeFiles)
      .set({
        deletedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(storefrontThemeFiles.storefrontId, storefrontId),
          eq(storefrontThemeFiles.themeId, themeId),
          eq(storefrontThemeFiles.path, path),
          isNull(storefrontThemeFiles.deletedAt),
        ),
      );

    return (result.meta?.changes ?? 1) > 0;
  },

  /**
   * Create an immutable snapshot revision of the theme's source code.
   */
  async createRevision(
    storefrontId: string,
    themeId: string,
    options: {
      message?: string;
      source?: "manual" | "ai" | "publish" | "rollback";
      createdBy?: string;
    } = {},
  ): Promise<StorefrontThemeRevisionDTO> {
    const isOwner = await this.verifyOwnership(storefrontId, themeId);
    if (!isOwner) throw new Error("Theme not found or does not belong to storefront");

    const db = await getDb();
    const now = new Date().toISOString();

    // 1. Get current active files
    const currentFiles = await this.listFiles(storefrontId, themeId);

    // 2. Find next revision number
    const [latestRev] = await db
      .select({ maxRev: max(storefrontThemeRevisions.revisionNumber) })
      .from(storefrontThemeRevisions)
      .where(
        and(
          eq(storefrontThemeRevisions.storefrontId, storefrontId),
          eq(storefrontThemeRevisions.themeId, themeId),
        ),
      );

    const nextRevNumber = (latestRev?.maxRev ?? 0) + 1;
    const newId = crypto.randomUUID();

    const snapshot = currentFiles.map((f) => ({
      path: f.path,
      content: f.content,
      mimeType: f.mimeType,
      isEntry: Boolean(f.isEntry),
    }));

    await db.insert(storefrontThemeRevisions).values({
      id: newId,
      storefrontId,
      themeId,
      revisionNumber: nextRevNumber,
      message: options.message ?? `Revision ${nextRevNumber}`,
      source: options.source ?? "manual",
      snapshot,
      createdBy: options.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id: newId,
      storefrontId,
      themeId,
      revisionNumber: nextRevNumber,
      message: options.message ?? `Revision ${nextRevNumber}`,
      source: options.source ?? "manual",
      snapshot,
      createdBy: options.createdBy ?? null,
      createdAt: now,
    };
  },

  /**
   * List historical revisions for a theme.
   */
  async listRevisions(
    storefrontId: string,
    themeId: string,
  ): Promise<StorefrontThemeRevisionDTO[]> {
    const isOwner = await this.verifyOwnership(storefrontId, themeId);
    if (!isOwner) return [];

    const db = await getDb();
    const rows = await db
      .select()
      .from(storefrontThemeRevisions)
      .where(
        and(
          eq(storefrontThemeRevisions.storefrontId, storefrontId),
          eq(storefrontThemeRevisions.themeId, themeId),
          isNull(storefrontThemeRevisions.deletedAt),
        ),
      )
      .orderBy(desc(storefrontThemeRevisions.revisionNumber));

    return rows.map((row) => ({
      id: row.id,
      storefrontId: row.storefrontId,
      themeId: row.themeId,
      revisionNumber: row.revisionNumber,
      message: row.message,
      source: row.source as "manual" | "ai" | "publish" | "rollback",
      snapshot: (row.snapshot ?? []) as Array<{
        path: string;
        content: string;
        mimeType: string;
        isEntry: boolean;
      }>,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    }));
  },

  /**
   * Rollback workspace files to a specific historical revision.
   */
  async rollbackToRevision(
    storefrontId: string,
    themeId: string,
    revisionNumber: number,
    createdBy?: string,
  ): Promise<StorefrontThemeFileDTO[]> {
    const isOwner = await this.verifyOwnership(storefrontId, themeId);
    if (!isOwner) throw new Error("Theme not found or does not belong to storefront");

    const db = await getDb();
    const [rev] = await db
      .select()
      .from(storefrontThemeRevisions)
      .where(
        and(
          eq(storefrontThemeRevisions.storefrontId, storefrontId),
          eq(storefrontThemeRevisions.themeId, themeId),
          eq(storefrontThemeRevisions.revisionNumber, revisionNumber),
          isNull(storefrontThemeRevisions.deletedAt),
        ),
      )
      .limit(1);

    if (!rev) throw new Error(`Revision #${revisionNumber} not found`);

    const snapshot = rev.snapshot as Array<{
      path: string;
      content: string;
      mimeType: string;
      isEntry?: boolean;
    }>;

    const now = new Date().toISOString();

    // Soft delete all existing files
    await db
      .update(storefrontThemeFiles)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(storefrontThemeFiles.storefrontId, storefrontId),
          eq(storefrontThemeFiles.themeId, themeId),
          isNull(storefrontThemeFiles.deletedAt),
        ),
      );

    // Restore snapshot files
    for (const f of snapshot) {
      await db.insert(storefrontThemeFiles).values({
        id: crypto.randomUUID(),
        storefrontId,
        themeId,
        path: f.path,
        content: f.content,
        mimeType: f.mimeType,
        isEntry:
          typeof f.isEntry === "boolean"
            ? f.isEntry
            : f.path === "src/pages/index.tsx",
        createdAt: now,
        updatedAt: now,
      });
    }

    // Record rollback revision
    await this.createRevision(storefrontId, themeId, {
      message: `Rollback to revision #${revisionNumber}`,
      source: "rollback",
      createdBy,
    });

    return this.listFiles(storefrontId, themeId);
  },
};
