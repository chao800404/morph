import { env } from "cloudflare:workers";
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
import { and, asc, desc, eq, isNull } from "drizzle-orm";

function detectThemeMimeType(path: string, mimeType?: string | null) {
  if (mimeType) return mimeType;
  if (path.endsWith(".tsx") || path.endsWith(".ts")) return "text/typescript";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".json")) return "application/json";
  return "text/plain";
}

function prepareThemeOwnershipGuard(
  storefrontId: string,
  themeId: string,
  expectedSourceGeneration?: number,
) {
  if (expectedSourceGeneration !== undefined) {
    return env.DATABASE.prepare(`
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM storefront_themes
        WHERE id = ?1
          AND storefront_id = ?2
          AND source_generation = ?3
          AND deleted_at IS NULL
      ) THEN 1 ELSE json('') END AS ok
    `).bind(themeId, storefrontId, expectedSourceGeneration);
  }

  return env.DATABASE.prepare(`
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM storefront_themes
      WHERE id = ?1 AND storefront_id = ?2 AND deleted_at IS NULL
    ) THEN 1 ELSE json('') END AS ok
  `).bind(themeId, storefrontId);
}

function prepareIncrementThemeSourceGeneration(
  storefrontId: string,
  themeId: string,
  now: string,
) {
  return env.DATABASE.prepare(`
    UPDATE storefront_themes
    SET source_generation = source_generation + 1, updated_at = ?1
    WHERE id = ?2 AND storefront_id = ?3 AND deleted_at IS NULL
  `).bind(now, themeId, storefrontId);
}

function prepareRevisionInsert(args: {
  storefrontId: string;
  themeId: string;
  revisionId: string;
  message: string;
  source: "manual" | "ai" | "publish" | "rollback";
  createdBy?: string | null;
  now: string;
}) {
  return env.DATABASE.prepare(`
    INSERT INTO storefront_theme_revisions (
      id, storefront_id, theme_id, revision_number, message, source,
      snapshot, created_by, created_at, updated_at
    )
    SELECT
      ?1, ?2, ?3,
      COALESCE((
        SELECT MAX(revision_number) + 1
        FROM storefront_theme_revisions
        WHERE theme_id = ?3 AND deleted_at IS NULL
      ), 1),
      ?4, ?5,
      COALESCE((
        SELECT json_group_array(
          json_object(
            'path', path,
            'content', content,
            'mimeType', COALESCE(mime_type, 'text/plain'),
            'isEntry', json(CASE WHEN is_entry = 1 THEN 'true' ELSE 'false' END)
          )
        )
        FROM (
          SELECT path, content, mime_type, is_entry
          FROM storefront_theme_files
          WHERE storefront_id = ?2 AND theme_id = ?3 AND deleted_at IS NULL
          ORDER BY path
        )
      ), json('[]')),
      ?6, ?7, ?7
  `).bind(
    args.revisionId,
    args.storefrontId,
    args.themeId,
    args.message,
    args.source,
    args.createdBy ?? null,
    args.now,
  );
}

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

    const now = new Date().toISOString();
    const revisionId = crypto.randomUUID();

    const statements = [
      prepareThemeOwnershipGuard(storefrontId, themeId),
      env.DATABASE.prepare(`
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM storefront_theme_files
          WHERE storefront_id = ?1 AND theme_id = ?2 AND deleted_at IS NULL
        ) THEN 1 ELSE json('') END AS ok
      `).bind(storefrontId, themeId),
    ];

    for (const f of STARTER_THEME_FILES) {
      statements.push(
        env.DATABASE.prepare(`
          INSERT INTO storefront_theme_files (
            id, storefront_id, theme_id, path, content, mime_type,
            is_entry, version, created_at, updated_at
          )
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8)
        `).bind(
          crypto.randomUUID(),
          storefrontId,
          themeId,
          f.path,
          f.content,
          f.mimeType,
          f.isEntry ? 1 : 0,
          now,
        ),
      );
    }

    statements.push(
      prepareRevisionInsert({
        storefrontId,
        themeId,
        revisionId,
        message: "Initialize starter theme files",
        source: "manual",
        createdBy,
        now,
      }),
    );

    statements.push(
      prepareIncrementThemeSourceGeneration(storefrontId, themeId, now),
    );

    try {
      await env.DATABASE.batch(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("malformed JSON") || message.includes("constraint")) {
        const existing = await this.listFiles(storefrontId, themeId);
        if (existing.length > 0) {
          return existing;
        }
        throw new Error("CONFLICT_OWNERSHIP_MISMATCH: Theme does not exist or was deleted.");
      }
      throw error;
    }

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
      expectedFileId?: string;
      expectedVersion?: number;
      expectMissing?: boolean;
      expectedSourceGeneration?: number;
      createRevision?: boolean;
      revisionMessage?: string;
      createdBy?: string;
    },
  ): Promise<StorefrontThemeFileDTO & { sourceGeneration?: number }> {
    const saved = await this.saveFilesBatch(
      storefrontId,
      themeId,
      [{
        path,
        content,
        mimeType,
        expectedFileId: options?.expectedFileId,
        expectedVersion: options?.expectedVersion,
        expectMissing: options?.expectMissing,
      }],
      {
        expectedSourceGeneration: options?.expectedSourceGeneration,
        createRevision: options?.createRevision,
        revisionMessage: options?.revisionMessage,
        createdBy: options?.createdBy,
      },
    );
    const first = saved[0];
    if (!first) throw new Error(`Failed to save theme file "${path}"`);
    return Object.assign(first, { sourceGeneration: saved.sourceGeneration });
  },

  async saveFilesBatch(
    storefrontId: string,
    themeId: string,
    files: Array<{
      path: string;
      content: string;
      expectedFileId?: string;
      expectedVersion?: number;
      expectMissing?: boolean;
      mimeType?: string;
    }>,
    options?: {
      expectedSourceGeneration?: number;
      createRevision?: boolean;
      revisionMessage?: string;
      createdBy?: string;
    },
  ): Promise<StorefrontThemeFileDTO[] & { sourceGeneration?: number }> {
    if (files.length === 0) {
      const empty: StorefrontThemeFileDTO[] & { sourceGeneration?: number } = [];
      return empty;
    }

    const now = new Date().toISOString();
    const statements = [
      prepareThemeOwnershipGuard(
        storefrontId,
        themeId,
        options?.expectedSourceGeneration,
      ),
    ];

    for (const item of files) {
      const expectsExisting =
        Boolean(item.expectedFileId) && item.expectedVersion !== undefined;

      if (item.expectMissing && expectsExisting) {
        throw new Error(
          `INVALID_WRITE_PRECONDITION: "${item.path}" cannot expect both existing and missing state.`,
        );
      }
      if (!item.expectMissing && !expectsExisting) {
        throw new Error(
          `MISSING_WRITE_PRECONDITION: "${item.path}" requires expectedFileId+expectedVersion or expectMissing=true.`,
        );
      }

      if (expectsExisting) {
        statements.push(
          env.DATABASE.prepare(`
            SELECT CASE WHEN EXISTS (
              SELECT 1 FROM storefront_theme_files
              WHERE storefront_id = ?1
                AND theme_id = ?2
                AND path = ?3
                AND id = ?4
                AND version = ?5
                AND deleted_at IS NULL
            ) THEN 1 ELSE json('') END AS ok
          `).bind(
            storefrontId, themeId, item.path,
            item.expectedFileId!, item.expectedVersion!,
          ),
        );
        statements.push(
          env.DATABASE.prepare(`
            UPDATE storefront_theme_files
            SET content = ?1,
                mime_type = ?2,
                version = version + 1,
                updated_at = ?3
            WHERE storefront_id = ?4
              AND theme_id = ?5
              AND path = ?6
              AND id = ?7
              AND version = ?8
              AND deleted_at IS NULL
          `).bind(
            item.content,
            detectThemeMimeType(item.path, item.mimeType),
            now,
            storefrontId,
            themeId,
            item.path,
            item.expectedFileId!,
            item.expectedVersion!,
          ),
        );
      } else {
        statements.push(
          env.DATABASE.prepare(`
            SELECT CASE WHEN NOT EXISTS (
              SELECT 1 FROM storefront_theme_files
              WHERE storefront_id = ?1
                AND theme_id = ?2
                AND path = ?3
                AND deleted_at IS NULL
            ) THEN 1 ELSE json('') END AS ok
          `).bind(storefrontId, themeId, item.path),
        );
        statements.push(
          env.DATABASE.prepare(`
            INSERT INTO storefront_theme_files (
              id, storefront_id, theme_id, path, content, mime_type,
              is_entry, version, created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8)
          `).bind(
            crypto.randomUUID(),
            storefrontId,
            themeId,
            item.path,
            item.content,
            detectThemeMimeType(item.path, item.mimeType),
            item.path === "src/pages/index.tsx" ? 1 : 0,
            now,
          ),
        );
      }
    }

    if (options?.createRevision) {
      statements.push(
        prepareRevisionInsert({
          storefrontId,
          themeId,
          revisionId: crypto.randomUUID(),
          message: options.revisionMessage ?? `Batch save of ${files.length} files`,
          source: "manual",
          createdBy: options.createdBy,
          now,
        }),
      );
    }

    statements.push(
      prepareIncrementThemeSourceGeneration(storefrontId, themeId, now),
    );

    statements.push(
      env.DATABASE.prepare(`
        SELECT source_generation
        FROM storefront_themes
        WHERE id = ?1 AND storefront_id = ?2 AND deleted_at IS NULL
      `).bind(themeId, storefrontId),
    );

    let batchResults: unknown[] = [];
    try {
      batchResults = (await env.DATABASE.batch(statements)) as unknown[];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("malformed JSON") ||
        message.includes("constraint") ||
        message.includes("UNIQUE")
      ) {
        if (options?.expectedSourceGeneration !== undefined) {
          const currentGen = await this.getSourceGeneration(storefrontId, themeId);
          if (
            currentGen !== null &&
            currentGen !== options.expectedSourceGeneration
          ) {
            throw new Error(
              `CONFLICT_SOURCE_GENERATION_MISMATCH: Server source generation is ${currentGen}, but expected ${options.expectedSourceGeneration}.`,
            );
          }
        }
        throw new Error(
          `CONFLICT_VERSION_MISMATCH: batch precondition failed. ${message}`,
        );
      }
      throw error;
    }

    const lastResult = batchResults[batchResults.length - 1] as any;
    const sourceGeneration = Number(
      lastResult?.results?.[0]?.source_generation ??
      lastResult?.[0]?.source_generation ??
      lastResult?.source_generation ??
      1,
    );

    const current = await this.listFiles(storefrontId, themeId);
    const byPath = new Map(current.map((file) => [file.path, file]));
    const resultFiles = files.map((item) => {
      const saved = byPath.get(item.path);
      if (!saved) {
        throw new Error(`SAVE_FAILED: "${item.path}" missing after atomic batch.`);
      }
      return Object.assign(saved, { sourceGeneration });
    });

    return Object.assign(resultFiles, { sourceGeneration });
  },

  async deleteFile(
    storefrontId: string,
    themeId: string,
    path: string,
    expectedFileId: string,
    expectedVersion: number,
    options?: {
      expectedSourceGeneration?: number;
    },
  ): Promise<boolean> {
    const isOwner = await this.verifyOwnership(storefrontId, themeId);
    if (!isOwner) return false;

    const now = new Date().toISOString();
    const statements = [
      prepareThemeOwnershipGuard(
        storefrontId,
        themeId,
        options?.expectedSourceGeneration,
      ),
      env.DATABASE.prepare(`
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM storefront_theme_files
          WHERE storefront_id = ?1
            AND theme_id = ?2
            AND path = ?3
            AND id = ?4
            AND version = ?5
            AND deleted_at IS NULL
        ) THEN 1 ELSE json('') END AS ok
      `).bind(storefrontId, themeId, path, expectedFileId, expectedVersion),
      env.DATABASE.prepare(`
        UPDATE storefront_theme_files
        SET deleted_at = ?1, updated_at = ?1
        WHERE storefront_id = ?2
          AND theme_id = ?3
          AND path = ?4
          AND id = ?5
          AND version = ?6
          AND deleted_at IS NULL
      `).bind(now, storefrontId, themeId, path, expectedFileId, expectedVersion),
      prepareIncrementThemeSourceGeneration(storefrontId, themeId, now),
    ];

    try {
      await env.DATABASE.batch(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("malformed JSON") ||
        message.includes("constraint")
      ) {
        if (options?.expectedSourceGeneration !== undefined) {
          const currentGen = await this.getSourceGeneration(storefrontId, themeId);
          if (
            currentGen !== null &&
            currentGen !== options.expectedSourceGeneration
          ) {
            throw new Error(
              `CONFLICT_SOURCE_GENERATION_MISMATCH: Server source generation is ${currentGen}, but expected ${options.expectedSourceGeneration}.`,
            );
          }
        }
        throw new Error(
          `CONFLICT_VERSION_MISMATCH: "${path}" changed, was deleted, or was replaced.`,
        );
      }
      throw error;
    }

    return true;
  },

  /**
   * Create an immutable snapshot revision of the theme's source code.
   * NOTE: Creating a snapshot revision does NOT mutate working files,
   * so it does not increment source_generation.
   */
  async createRevision(
    storefrontId: string,
    themeId: string,
    options: {
      expectedSourceGeneration: number;
      message?: string;
      source?: "manual" | "ai" | "publish" | "rollback";
      createdBy?: string;
    },
  ): Promise<StorefrontThemeRevisionDTO> {
    const isOwner = await this.verifyOwnership(storefrontId, themeId);
    if (!isOwner) {
      throw new Error("Theme not found or does not belong to storefront");
    }

    const now = new Date().toISOString();
    const revisionId = crypto.randomUUID();

    const statements = [
      prepareThemeOwnershipGuard(
        storefrontId,
        themeId,
        options.expectedSourceGeneration,
      ),
      prepareRevisionInsert({
        storefrontId,
        themeId,
        revisionId,
        message: options.message ?? "Manual checkpoint",
        source: options.source ?? "manual",
        createdBy: options.createdBy,
        now,
      }),
    ];

    try {
      await env.DATABASE.batch(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("malformed JSON") ||
        message.includes("constraint")
      ) {
        throw new Error(
          "CONFLICT_SOURCE_GENERATION_MISMATCH: Theme source was modified concurrently. Refresh files to continue.",
        );
      }
      throw error;
    }

    const db = await getDb();
    const [created] = await db
      .select()
      .from(storefrontThemeRevisions)
      .where(eq(storefrontThemeRevisions.id, revisionId))
      .limit(1);

    if (!created) {
      throw new Error("REVISION_FAILED: Revision not found after atomic batch.");
    }

    return {
      id: created.id,
      storefrontId: created.storefrontId,
      themeId: created.themeId,
      revisionNumber: created.revisionNumber,
      message: created.message,
      source: created.source as "manual" | "ai" | "publish" | "rollback",
      snapshot: (created.snapshot ?? []) as Array<{
        path: string;
        content: string;
        mimeType: string;
        isEntry: boolean;
      }>,
      createdBy: created.createdBy,
      createdAt: created.createdAt,
    };
  },

  async getSourceGeneration(
    storefrontId: string,
    themeId: string,
  ): Promise<number | null> {
    const db = await getDb();
    const [theme] = await db
      .select({ sourceGeneration: storefrontThemes.sourceGeneration })
      .from(storefrontThemes)
      .where(
        and(
          eq(storefrontThemes.id, themeId),
          eq(storefrontThemes.storefrontId, storefrontId),
          isNull(storefrontThemes.deletedAt),
        ),
      )
      .limit(1);

    return theme?.sourceGeneration ?? null;
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
      snapshot: (row.snapshot ?? []) as StorefrontThemeRevisionDTO["snapshot"],
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
    options: {
      expectedSourceGeneration: number;
      createdBy?: string;
    },
  ): Promise<StorefrontThemeFileDTO[]> {
    const isOwner = await this.verifyOwnership(storefrontId, themeId);
    if (!isOwner) {
      throw new Error("Theme not found or does not belong to storefront");
    }

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

    const snapshot =
      (rev.snapshot ?? []) as StorefrontThemeRevisionDTO["snapshot"];
    const now = new Date().toISOString();
    const statements = [
      prepareThemeOwnershipGuard(
        storefrontId,
        themeId,
        options.expectedSourceGeneration,
      ),
      env.DATABASE.prepare(`
        UPDATE storefront_theme_files
        SET deleted_at = ?1, updated_at = ?1
        WHERE storefront_id = ?2 AND theme_id = ?3 AND deleted_at IS NULL
      `).bind(now, storefrontId, themeId),
    ];

    for (const file of snapshot) {
      statements.push(
        env.DATABASE.prepare(`
          INSERT INTO storefront_theme_files (
            id, storefront_id, theme_id, path, content, mime_type,
            is_entry, version, created_at, updated_at
          )
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8)
        `).bind(
          crypto.randomUUID(),
          storefrontId,
          themeId,
          file.path,
          file.content,
          file.mimeType,
          file.isEntry ? 1 : 0,
          now,
        ),
      );
    }

    statements.push(
      prepareRevisionInsert({
        storefrontId,
        themeId,
        revisionId: crypto.randomUUID(),
        message: `Rollback to revision #${revisionNumber}`,
        source: "rollback",
        createdBy: options?.createdBy,
        now,
      }),
    );

    statements.push(
      prepareIncrementThemeSourceGeneration(storefrontId, themeId, now),
    );

    try {
      await env.DATABASE.batch(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("malformed JSON") || message.includes("constraint")) {
        throw new Error(
          options?.expectedSourceGeneration !== undefined
            ? "CONFLICT_SOURCE_GENERATION_MISMATCH: Theme files changed concurrently before rollback."
            : "CONFLICT_OWNERSHIP_MISMATCH: Theme not found or was modified.",
        );
      }
      throw error;
    }

    return this.listFiles(storefrontId, themeId);
  },

  /**
   * Get the latest published revision for a theme.
   */
  async getLatestPublishedRevision(
    storefrontId: string,
    themeId: string,
  ): Promise<StorefrontThemeRevisionDTO | null> {
    const isOwner = await this.verifyOwnership(storefrontId, themeId);
    if (!isOwner) return null;

    const db = await getDb();
    const [row] = await db
      .select({ revision: storefrontThemeRevisions })
      .from(storefrontThemes)
      .innerJoin(
        storefrontThemeRevisions,
        eq(
          storefrontThemes.publishedSourceRevisionId,
          storefrontThemeRevisions.id,
        ),
      )
      .where(
        and(
          eq(storefrontThemes.id, themeId),
          eq(storefrontThemes.storefrontId, storefrontId),
          isNull(storefrontThemes.deletedAt),
          isNull(storefrontThemeRevisions.deletedAt),
        ),
      )
      .limit(1);

    if (!row?.revision) return null;
    const revision = row.revision;
    return {
      id: revision.id,
      storefrontId: revision.storefrontId,
      themeId: revision.themeId,
      revisionNumber: revision.revisionNumber,
      message: revision.message,
      source: revision.source as "manual" | "ai" | "publish" | "rollback",
      snapshot: (revision.snapshot ?? []) as StorefrontThemeRevisionDTO["snapshot"],
      createdBy: revision.createdBy,
      createdAt: revision.createdAt,
    };
  },
};
