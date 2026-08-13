import { getDb } from "@/db";
import { assets } from "@/db/asset.schema";
import { users } from "@/db/auth.schema";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  gte,
  or,
  SQL,
  sql,
} from "drizzle-orm";
import type { AssetDTO, AssetInsertDTO } from "../dto/asset.dto";
import { toAssetDTO, type AssetRow } from "../mappers/asset.mapper";
import { containsPattern } from "@/lib/db/like-pattern";
import type { AssetMetadata, AssetType } from "@/db/asset.schema";

const mapFirst = (rows: AssetRow[]): AssetDTO | null =>
  rows.length > 0 ? toAssetDTO(rows[0]) : null;

export const assetDal = {
  async findById(id: string): Promise<AssetDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), isNull(assets.deletedAt)))
      .limit(1);
    return mapFirst(rows);
  },

  async findByStorageKey(key: string): Promise<AssetDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(assets)
      .where(and(eq(assets.url, `/${key}`), isNull(assets.deletedAt)))
      .limit(1);
    return mapFirst(rows);
  },

  async findByIds(ids: string[]): Promise<AssetDTO[]> {
    if (ids.length === 0) return [];
    const db = await getDb();
    const rows = await db
      .select()
      .from(assets)
      .where(and(inArray(assets.id, ids), isNull(assets.deletedAt)));
    return rows.map(toAssetDTO);
  },

  async findByFolderIds(folderIds: string[]): Promise<AssetDTO[]> {
    if (folderIds.length === 0) return [];
    const db = await getDb();
    const rows: AssetRow[] = [];
    const batchSize = 50;

    for (let index = 0; index < folderIds.length; index += batchSize) {
      const ids = folderIds.slice(index, index + batchSize);
      rows.push(
        ...(await db
          .select()
          .from(assets)
          .where(and(inArray(assets.folderId, ids), isNull(assets.deletedAt)))),
      );
    }
    return rows.map(toAssetDTO);
  },

  async listPage(options: {
    folderId?: string | null;
    query?: string | null;
    type?: AssetType;
    size?: "under-1mb" | "1mb-10mb" | "over-10mb";
    createdWithin?: "24h" | "7d" | "30d" | "90d";
    sorts: Array<{
      sortBy: "name" | "extension" | "size" | "createdAt" | "updatedAt";
      sortOrder: "asc" | "desc";
    }>;
    page: number;
    limit: number;
  }): Promise<{ assets: AssetDTO[]; total: number }> {
    const db = await getDb();
    const folderCondition =
      options.folderId && options.folderId !== "root"
        ? eq(assets.folderId, options.folderId)
        : isNull(assets.folderId);
    const conditions: SQL[] = [folderCondition, isNull(assets.deletedAt)];

    if (options.type) {
      conditions.push(eq(assets.type, options.type));
    }

    if (options.size === "under-1mb") {
      conditions.push(lt(assets.size, 1024 * 1024));
    } else if (options.size === "1mb-10mb") {
      conditions.push(
        and(
          gte(assets.size, 1024 * 1024),
          lt(assets.size, 10 * 1024 * 1024),
        ) as SQL,
      );
    } else if (options.size === "over-10mb") {
      conditions.push(gte(assets.size, 10 * 1024 * 1024));
    }

    if (options.createdWithin) {
      const hours = { "24h": 24, "7d": 168, "30d": 720, "90d": 2160 }[
        options.createdWithin
      ];
      const createdAfter = new Date(Date.now() - hours * 60 * 60 * 1000);
      conditions.push(gte(assets.createdAt, createdAfter.toISOString()));
    }

    if (options.query?.trim()) {
      const pattern = containsPattern(options.query.trim());
      conditions.push(
        or(
          like(assets.name, pattern),
          like(assets.originalName, pattern),
          like(assets.caption, pattern),
          like(assets.alt, pattern),
          sql`${assets.tags} LIKE ${pattern}`,
          like(assets.mimeType, pattern),
        ) as SQL,
      );
    }

    const extensionColumn = sql<string>`
      lower(
        substr(
          ${assets.originalName},
          length(
            rtrim(
              ${assets.originalName},
              replace(${assets.originalName}, '.', '')
            )
          ) + 1
        )
      )
    `;

    const orderBy = options.sorts.map(({ sortBy, sortOrder }) => {
      const sortColumn =
        sortBy === "name"
          ? assets.name
          : sortBy === "extension"
            ? extensionColumn
            : sortBy === "size"
              ? assets.size
              : sortBy === "updatedAt"
                ? assets.updatedAt
                : assets.createdAt;

      return sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    });
    const condition = and(...conditions);

    const [countRows, rows] = await Promise.all([
      db.select({ value: count() }).from(assets).where(condition),
      db
        .select({ asset: assets, uploaderName: users.name })
        .from(assets)
        .leftJoin(users, eq(assets.uploadedBy, users.id))
        .where(condition)
        .orderBy(...orderBy, asc(assets.id))
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);

    return {
      assets: rows.map(({ asset, uploaderName }) => ({
        ...toAssetDTO(asset),
        uploadedBy: uploaderName || asset.uploadedBy,
      })),
      total: Number(countRows[0]?.value ?? 0),
    };
  },

  async searchPage(options: {
    query: string;
    type?: "all" | "image" | "video" | "rive" | "model";
    folderId?: string;
    sortBy: "createdAt" | "updatedAt" | "originalName" | "size" | "type";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }): Promise<{ assets: AssetDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(assets.deletedAt)];
    if (options.query) {
      const pattern = containsPattern(options.query);
      conditions.push(
        or(
          like(assets.originalName, pattern),
          and(isNotNull(assets.alt), like(assets.alt, pattern)),
          and(isNotNull(assets.caption), like(assets.caption, pattern)),
          sql`${assets.tags} LIKE ${pattern}`,
        ) as SQL,
      );
    }
    if (options.type && options.type !== "all") {
      conditions.push(eq(assets.type, options.type));
    }
    if (options.folderId) {
      conditions.push(eq(assets.folderId, options.folderId));
    }

    const sortColumn = {
      createdAt: assets.createdAt,
      updatedAt: assets.updatedAt,
      originalName: assets.originalName,
      size: assets.size,
      type: assets.type,
    }[options.sortBy];
    const orderBy =
      options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    const condition = and(...conditions);

    const [countRows, rows] = await Promise.all([
      db.select({ value: count() }).from(assets).where(condition),
      db
        .select()
        .from(assets)
        .where(condition)
        .orderBy(orderBy)
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);

    return {
      assets: rows.map(toAssetDTO),
      total: Number(countRows[0]?.value ?? 0),
    };
  },

  async createMany(dataList: AssetInsertDTO[]): Promise<void> {
    if (dataList.length === 0) return;
    const db = await getDb();
    const now = new Date().toISOString();
    const batchSize = 5;

    for (let index = 0; index < dataList.length; index += batchSize) {
      const chunk = dataList.slice(index, index + batchSize);
      await db.insert(assets).values(
        chunk.map((data) => ({
          id: data.id,
          folderId: data.folderId,
          type: data.type,
          name: data.name,
          originalName: data.originalName,
          alt: data.alt,
          caption: data.caption,
          tags: data.tags ?? [],
          mimeType: data.mimeType,
          size: data.size,
          url: data.url,
          width: data.width,
          height: data.height,
          duration: data.duration,
          thumbnailUrl: data.thumbnailUrl,
          metadata: data.metadata,
          uploadedBy: data.uploadedBy,
          updatedBy: data.updatedBy,
          createdAt: data.createdAt?.toISOString() ?? now,
          updatedAt: data.updatedAt?.toISOString() ?? now,
        })),
      );
    }
  },

  async updateProcessedImage(
    id: string,
    data: {
      url: string;
      size: number;
      mimeType: string;
      metadata: AssetMetadata;
      updatedBy: string;
    },
  ): Promise<void> {
    const db = await getDb();
    await db
      .update(assets)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(and(eq(assets.id, id), isNull(assets.deletedAt)));
  },

  async delete(id: string): Promise<void> {
    const db = await getDb();
    await db.delete(assets).where(eq(assets.id, id));
  },
};
