import { getDb } from "@/db";
import { assets } from "@/db/asset.schema";
import { and, eq, inArray, isNull, like, or } from "drizzle-orm";
import type { AssetDTO, AssetInsertDTO } from "../dto/asset.dto";
import { toAssetDTO, type AssetRow } from "../mappers/asset.mapper";

const mapFirst = (rows: AssetRow[]): AssetDTO | null => {
  if (!rows.length) return null;
  return toAssetDTO(rows[0]);
};

export const assetDal = {
  async findById(id: string): Promise<AssetDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(assets)
      .where(eq(assets.id, id))
      .limit(1);
    return mapFirst(rows);
  },

  async findByIdAndOwner(id: string, userId: string): Promise<AssetDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), eq(assets.uploadedBy, userId)))
      .limit(1);
    return mapFirst(rows);
  },

  async findByIds(ids: string[], userId?: string): Promise<AssetDTO[]> {
    const db = await getDb();
    const condition = userId
      ? and(inArray(assets.id, ids), eq(assets.uploadedBy, userId))
      : inArray(assets.id, ids);
    const rows = await db.select().from(assets).where(condition);
    return rows.map(toAssetDTO);
  },

  async findByFolderId(folderId: string | null): Promise<AssetDTO[]> {
    const db = await getDb();
    const condition =
      folderId === null
        ? isNull(assets.folderId)
        : eq(assets.folderId, folderId);
    const rows = await db.select().from(assets).where(condition);
    return rows.map(toAssetDTO);
  },

  async listAll(): Promise<AssetDTO[]> {
    const db = await getDb();
    const rows = await db.select().from(assets);
    return rows.map(toAssetDTO);
  },

  async findByFolderIdLightweight(
    folderId: string | null,
    searchQuery?: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      mimeType: string | null;
      url: string;
      alt: string | null;
    }>
  > {
    const db = await getDb();
    const folderCondition = folderId
      ? eq(assets.folderId, folderId)
      : isNull(assets.folderId);

    if (searchQuery && searchQuery.trim()) {
      const searchPattern = `%${searchQuery.trim()}%`;
      const searchCondition = or(
        like(assets.name, searchPattern),
        like(assets.originalName, searchPattern),
        like(assets.caption, searchPattern),
        like(assets.alt, searchPattern),
        like(assets.tags, searchPattern),
        like(assets.mimeType, searchPattern),
      );

      const rows = await db
        .select({
          id: assets.id,
          name: assets.name,
          mimeType: assets.mimeType,
          url: assets.url,
          alt: assets.alt,
        })
        .from(assets)
        .where(and(folderCondition, searchCondition));
      return rows;
    } else {
      const rows = await db
        .select({
          id: assets.id,
          name: assets.name,
          mimeType: assets.mimeType,
          url: assets.url,
          alt: assets.alt,
        })
        .from(assets)
        .where(folderCondition);
      return rows;
    }
  },

  async create(data: AssetInsertDTO): Promise<AssetDTO> {
    const db = await getDb();
    const createdAt = data.createdAt ?? new Date();
    const updatedAt = data.updatedAt ?? createdAt;

    await db.insert(assets).values({
      id: data.id,
      folderId: data.folderId,
      type: data.type,
      name: data.name,
      originalName: data.originalName,
      alt: data.alt,
      caption: data.caption,
      tags: data.tags,
      mimeType: data.mimeType,
      size: data.size,
      sizeFormatted: data.sizeFormatted,
      url: data.url,
      width: data.width,
      height: data.height,
      duration: data.duration,
      thumbnailUrl: data.thumbnailUrl,
      metadata: data.metadata,
      customMetadata: data.customMetadata,
      uploadedBy: data.uploadedBy,
      updatedBy: data.updatedBy,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    });

    const created = await this.findById(data.id);
    if (!created) {
      throw new Error("Failed to fetch created asset");
    }
    return created;
  },

  async createMany(dataList: AssetInsertDTO[]): Promise<void> {
    if (dataList.length === 0) return;

    const db = await getDb();
    const now = new Date().toISOString();

    // SQLite has a limit on the number of variables in a single query.
    // With ~23 columns per row, a batch size of 10 would be ~230 variables.
    // However, to be safe and avoid "too many SQL variables" or packet size limits,
    // we'll process in smaller chunks.
    const BATCH_SIZE = 5;

    // Process in chunks
    for (let i = 0; i < dataList.length; i += BATCH_SIZE) {
      const chunk = dataList.slice(i, i + BATCH_SIZE);

      await db.insert(assets).values(
        chunk.map((data) => ({
          id: data.id,
          folderId: data.folderId,
          type: data.type,
          name: data.name,
          originalName: data.originalName,
          alt: data.alt,
          caption: data.caption,
          tags: data.tags,
          mimeType: data.mimeType,
          size: data.size,
          sizeFormatted: data.sizeFormatted,
          url: data.url,
          width: data.width,
          height: data.height,
          duration: data.duration,
          thumbnailUrl: data.thumbnailUrl,
          metadata: data.metadata,
          customMetadata: data.customMetadata,
          uploadedBy: data.uploadedBy,
          updatedBy: data.updatedBy,
          createdAt: data.createdAt ? data.createdAt.toISOString() : now,
          updatedAt: data.updatedAt ? data.updatedAt.toISOString() : now,
        })),
      );
    }
  },

  async updateFields(
    id: string,
    data: {
      name?: string;
      originalName?: string;
      alt?: string;
      caption?: string;
      tags?: string;
      customMetadata?: string;
      metadata?: string;
      updatedBy?: string;
    },
  ): Promise<void> {
    const db = await getDb();
    await db
      .update(assets)
      .set({
        ...data,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(assets.id, id));
  },

  async updateFolderId(
    assetIds: string[],
    folderId: string | null,
    updatedBy?: string,
  ): Promise<void> {
    const db = await getDb();
    await db
      .update(assets)
      .set({
        folderId,
        updatedBy,
        updatedAt: new Date().toISOString(),
      })
      .where(inArray(assets.id, assetIds));
  },

  async updateProcessedImage(
    id: string,
    data: {
      size: number;
      sizeFormatted: string;
      updatedBy: string;
      name?: string;
      mimeType?: string;
      url?: string;
      width?: number;
      height?: number;
      metadata?: string;
    },
  ): Promise<void> {
    const db = await getDb();
    await db
      .update(assets)
      .set({
        ...data,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(assets.id, id));
  },

  async delete(id: string): Promise<void> {
    const db = await getDb();
    await db.delete(assets).where(eq(assets.id, id));
  },

  async deleteByFolderId(folderId: string): Promise<void> {
    const db = await getDb();
    await db.delete(assets).where(eq(assets.folderId, folderId));
  },

  async findByFolderIds(folderIds: string[]): Promise<AssetDTO[]> {
    if (folderIds.length === 0) return [];
    const db = await getDb();

    // Batch query to avoid SQLite limits
    const BATCH_SIZE = 50;
    let allRows: any[] = [];

    for (let i = 0; i < folderIds.length; i += BATCH_SIZE) {
      const chunk = folderIds.slice(i, i + BATCH_SIZE);
      const rows = await db
        .select()
        .from(assets)
        .where(inArray(assets.folderId, chunk));
      allRows = allRows.concat(rows);
    }

    return allRows.map(toAssetDTO);
  },

  async softDeleteBatch(assetIds: string[], userId: string): Promise<void> {
    if (assetIds.length === 0) return;
    const db = await getDb();

    const BATCH_SIZE = 50;

    for (let i = 0; i < assetIds.length; i += BATCH_SIZE) {
      const chunk = assetIds.slice(i, i + BATCH_SIZE);
      await db
        .update(assets)
        .set({
          deletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          updatedBy: userId,
        })
        .where(inArray(assets.id, chunk));
    }
  },
};
