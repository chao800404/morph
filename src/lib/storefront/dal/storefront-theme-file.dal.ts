import { getDb } from "@/db";
import { storefrontThemeFiles } from "@/db/storefront.schema";
import type {
  StorefrontThemeFileDTO,
  StorefrontThemeFileTreeNode,
} from "@/lib/storefront/dto/storefront-theme-file.dto";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { and, asc, eq, isNull } from "drizzle-orm";

export function buildFileTree(files: StorefrontThemeFileDTO[]): StorefrontThemeFileTreeNode[] {
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
  async listFiles(
    storefrontId: string,
    themeId: string,
  ): Promise<StorefrontThemeFileDTO[]> {
    const db = await getDb();

    // 1. Check if files exist. If none, auto-seed with STARTER_THEME_FILES
    const existing = await db
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

    if (existing.length === 0) {
      // Auto-initialize theme files
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

      const freshlyInserted = await db
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

      return freshlyInserted.map((row) => ({
        id: row.id,
        storefrontId: row.storefrontId,
        themeId: row.themeId,
        path: row.path,
        content: row.content,
        mimeType: row.mimeType ?? "text/plain",
        isEntry: Boolean(row.isEntry),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
    }

    return existing.map((row) => ({
      id: row.id,
      storefrontId: row.storefrontId,
      themeId: row.themeId,
      path: row.path,
      content: row.content,
      mimeType: row.mimeType ?? "text/plain",
      isEntry: Boolean(row.isEntry),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  },

  async getFileByPath(
    storefrontId: string,
    themeId: string,
    path: string,
  ): Promise<StorefrontThemeFileDTO | null> {
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
  ): Promise<StorefrontThemeFileDTO> {
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

    if (existing) {
      await db
        .update(storefrontThemeFiles)
        .set({
          content,
          mimeType: mimeType ?? existing.mimeType,
          updatedAt: now,
        })
        .where(eq(storefrontThemeFiles.id, existing.id));

      return {
        id: existing.id,
        storefrontId,
        themeId,
        path,
        content,
        mimeType: mimeType ?? existing.mimeType ?? "text/plain",
        isEntry: Boolean(existing.isEntry),
        createdAt: existing.createdAt,
        updatedAt: now,
      };
    }

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
      createdAt: now,
      updatedAt: now,
    });

    return {
      id: newId,
      storefrontId,
      themeId,
      path,
      content,
      mimeType: detectedMime,
      isEntry,
      createdAt: now,
      updatedAt: now,
    };
  },

  async deleteFile(
    storefrontId: string,
    themeId: string,
    path: string,
  ): Promise<boolean> {
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
};
