import { getDb } from "@/db";
import { assetFolders } from "@/db/asset.schema";
import { users } from "@/db/auth.schema";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lt,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type {
  AssetFolderDTO,
  AssetFolderInsertDTO,
} from "../dto/asset-folder.dto";
import { containsPattern } from "@/lib/db/like-pattern";
import {
  toAssetFolderDTO,
  type AssetFolderRow,
} from "../mappers/asset-folder.mapper";

const mapFirst = (rows: AssetFolderRow[]): AssetFolderDTO | null =>
  rows.length > 0 ? toAssetFolderDTO(rows[0]) : null;

/**
 * Prefix match over a subtree, without LIKE.
 *
 * SQLite caps patterns at SQLITE_MAX_LIKE_PATTERN_LENGTH (50 bytes on D1), so
 * `like(idPath, "/uuid/uuid/%")` throws `LIKE or GLOB pattern too complex` as
 * soon as a folder is nested — two UUIDs plus separators is already 76
 * characters. A half-open range matches the same rows with no length limit and
 * can use the column's index.
 *
 * Relies on the column's default BINARY collation, which the schema does not
 * override.
 */
const startsWithPrefix = (
  column: typeof assetFolders.idPath | typeof assetFolders.path,
  prefix: string,
) => {
  const lastChar = prefix.charCodeAt(prefix.length - 1);
  const upperBound = prefix.slice(0, -1) + String.fromCharCode(lastChar + 1);
  return and(gte(column, prefix), lt(column, upperBound));
};

export const assetFolderDal = {
  async findById(id: string): Promise<AssetFolderDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(assetFolders)
      .where(and(eq(assetFolders.id, id), isNull(assetFolders.deletedAt)))
      .limit(1);
    return mapFirst(rows);
  },

  async findByIds(ids: string[]): Promise<AssetFolderDTO[]> {
    if (ids.length === 0) return [];
    const db = await getDb();
    const rows = await db
      .select()
      .from(assetFolders)
      .where(
        and(inArray(assetFolders.id, ids), isNull(assetFolders.deletedAt)),
      );
    return rows.map(toAssetFolderDTO);
  },

  async findByPath(path: string): Promise<AssetFolderDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(assetFolders)
      .where(and(eq(assetFolders.path, path), isNull(assetFolders.deletedAt)))
      .limit(1);
    return mapFirst(rows);
  },

  async findChildrenByIdPath(idPath: string): Promise<AssetFolderDTO[]> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(assetFolders)
      .where(
        and(
          startsWithPrefix(assetFolders.idPath, `${idPath}/`),
          isNull(assetFolders.deletedAt),
        ),
      );
    return rows.map(toAssetFolderDTO);
  },

  async findChildrenByPath(path: string): Promise<AssetFolderDTO[]> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(assetFolders)
      .where(
        and(
          startsWithPrefix(assetFolders.path, `${path}/`),
          isNull(assetFolders.deletedAt),
        ),
      );
    return rows.map(toAssetFolderDTO);
  },

  async listOptionsPage(options: {
    query?: string;
    page: number;
    limit: number;
    selectedIds?: string[];
  }): Promise<{
    folders: AssetFolderDTO[];
    selected: AssetFolderDTO[];
    total: number;
  }> {
    const db = await getDb();
    const conditions = [isNull(assetFolders.deletedAt)];
    if (options.query?.trim()) {
      conditions.push(
        like(assetFolders.name, containsPattern(options.query.trim())),
      );
    }
    const where = and(...conditions);
    const [totals, rows, selectedRows] = await Promise.all([
      db
        .select({ value: sql<number>`count(*)` })
        .from(assetFolders)
        .where(where),
      db
        .select()
        .from(assetFolders)
        .where(where)
        .orderBy(asc(assetFolders.name), asc(assetFolders.id))
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
      options.selectedIds?.length
        ? db
            .select()
            .from(assetFolders)
            .where(
              and(
                inArray(assetFolders.id, options.selectedIds),
                isNull(assetFolders.deletedAt),
              ),
            )
        : Promise.resolve([]),
    ]);
    return {
      folders: rows.map(toAssetFolderDTO),
      selected: selectedRows.map(toAssetFolderDTO),
      total: Number(totals[0]?.value ?? 0),
    };
  },

  /** Cross-tree folder search used by the dashboard's global search. */
  async search(options: {
    query: string;
    limit: number;
  }): Promise<{ folders: AssetFolderDTO[]; total: number }> {
    const db = await getDb();
    const pattern = containsPattern(options.query.trim());
    const condition = and(
      isNull(assetFolders.deletedAt),
      like(assetFolders.name, pattern),
    );
    const [totals, rows] = await Promise.all([
      db
        .select({ value: sql<number>`count(*)` })
        .from(assetFolders)
        .where(condition),
      db
        .select()
        .from(assetFolders)
        .where(condition)
        .orderBy(desc(assetFolders.updatedAt), asc(assetFolders.id))
        .limit(options.limit),
    ]);
    return {
      folders: rows.map(toAssetFolderDTO),
      total: Number(totals[0]?.value ?? 0),
    };
  },

  async listChildrenWithActors(options: {
    parentId: string | null;
    query?: string | null;
    sorts: Array<{
      sortBy: "name" | "createdAt" | "updatedAt";
      sortOrder: "asc" | "desc";
    }>;
  }): Promise<AssetFolderDTO[]> {
    const db = await getDb();
    const creator = alias(users, "asset_folder_creator");
    const updater = alias(users, "asset_folder_updater");
    const conditions = [
      options.parentId
        ? eq(assetFolders.parentId, options.parentId)
        : isNull(assetFolders.parentId),
      isNull(assetFolders.deletedAt),
    ];
    if (options.query?.trim()) {
      conditions.push(
        like(assetFolders.name, containsPattern(options.query.trim())),
      );
    }
    const orderBy = options.sorts.map(({ sortBy, sortOrder }) => {
      const sortColumn =
        sortBy === "name"
          ? assetFolders.name
          : sortBy === "updatedAt"
            ? assetFolders.updatedAt
            : assetFolders.createdAt;

      return sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    });

    const rows = await db
      .select({
        folder: assetFolders,
        creatorName: creator.name,
        updaterName: updater.name,
        assetCount: sql<number>`(SELECT COUNT(*) FROM assets WHERE assets.folder_id = ${assetFolders.id} AND assets.deleted_at IS NULL)`,
        folderCount: sql<number>`(SELECT COUNT(*) FROM asset_folders AS child WHERE child.parent_id = ${assetFolders.id} AND child.deleted_at IS NULL)`,
      })
      .from(assetFolders)
      .leftJoin(creator, eq(assetFolders.createdBy, creator.id))
      .leftJoin(updater, eq(assetFolders.updatedBy, updater.id))
      .where(and(...conditions))
      .orderBy(...orderBy, asc(assetFolders.id));

    return rows.map(
      ({ folder, creatorName, updaterName, assetCount, folderCount }) => {
        const aCount = Number(assetCount) || 0;
        const fCount = Number(folderCount) || 0;
        return {
          ...toAssetFolderDTO(folder),
          createdBy: creatorName || folder.createdBy,
          updatedBy: updaterName || folder.updatedBy,
          assetCount: aCount,
          folderCount: fCount,
          itemCount: aCount + fCount,
        };
      },
    );
  },

  async create(data: AssetFolderInsertDTO): Promise<AssetFolderDTO> {
    const db = await getDb();
    const createdAt = data.createdAt ?? new Date();
    const updatedAt = data.updatedAt ?? createdAt;

    await db.insert(assetFolders).values({
      id: data.id,
      name: data.name,
      parentId: data.parentId,
      path: data.path,
      idPath: data.idPath,
      description: data.description,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      createdBy: data.createdBy,
      updatedBy: data.createdBy,
    });

    const created = await this.findById(data.id);
    if (!created) throw new Error("Failed to fetch created asset folder");
    return created;
  },

  async findAllDescendantIds(rootFolderId: string): Promise<string[]> {
    const root = await this.findById(rootFolderId);
    if (!root) return [];
    const descendants = await this.findChildrenByIdPath(root.idPath);
    return [rootFolderId, ...descendants.map((folder) => folder.id)];
  },
};
