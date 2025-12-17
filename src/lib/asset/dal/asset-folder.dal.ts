import { getDb } from "@/db";
import { assetFolders } from "@/db/asset.schema";
import { and, eq, inArray, isNull, like } from "drizzle-orm";
import type { AssetFolderDTO, AssetFolderInsertDTO } from "../dto/asset-folder.dto";
import { toAssetFolderDTO, type AssetFolderRow } from "../mappers/asset-folder.mapper";

const mapFirst = (rows: AssetFolderRow[]): AssetFolderDTO | null => {
    if (!rows.length) return null;
    return toAssetFolderDTO(rows[0]);
};

export const assetFolderDal = {
    async findById(id: string): Promise<AssetFolderDTO | null> {
        const db = await getDb();
        const rows = await db.select().from(assetFolders).where(eq(assetFolders.id, id)).limit(1);
        return mapFirst(rows);
    },

    async findByIdAndOwner(id: string, userId: string): Promise<AssetFolderDTO | null> {
        const db = await getDb();
        const rows = await db
            .select()
            .from(assetFolders)
            .where(and(eq(assetFolders.id, id), eq(assetFolders.createdBy, userId)))
            .limit(1);
        return mapFirst(rows);
    },

    async findByIds(ids: string[], userId?: string): Promise<AssetFolderDTO[]> {
        const db = await getDb();
        const condition = userId
            ? and(inArray(assetFolders.id, ids), eq(assetFolders.createdBy, userId))
            : inArray(assetFolders.id, ids);
        const rows = await db.select().from(assetFolders).where(condition);
        return rows.map(toAssetFolderDTO);
    },

    async findByPath(path: string): Promise<AssetFolderDTO | null> {
        const db = await getDb();
        const rows = await db.select().from(assetFolders).where(eq(assetFolders.path, path)).limit(1);
        return mapFirst(rows);
    },

    async findByPathAndOwner(path: string, userId: string): Promise<AssetFolderDTO | null> {
        const db = await getDb();
        const rows = await db
            .select()
            .from(assetFolders)
            .where(and(eq(assetFolders.path, path), eq(assetFolders.createdBy, userId)))
            .limit(1);
        return mapFirst(rows);
    },

    async findChildrenByIdPath(idPath: string): Promise<AssetFolderDTO[]> {
        const db = await getDb();
        const rows = await db
            .select()
            .from(assetFolders)
            .where(like(assetFolders.idPath, `${idPath}/%`));
        return rows.map(toAssetFolderDTO);
    },

    async findChildrenByPath(path: string): Promise<AssetFolderDTO[]> {
        const db = await getDb();
        const rows = await db
            .select()
            .from(assetFolders)
            .where(like(assetFolders.path, `${path}/%`));
        return rows.map(toAssetFolderDTO);
    },

    async findChildren(parentId: string): Promise<AssetFolderDTO[]> {
        const db = await getDb();
        const rows = await db.select().from(assetFolders).where(eq(assetFolders.parentId, parentId));
        return rows.map(toAssetFolderDTO);
    },

    async listAll(): Promise<AssetFolderDTO[]> {
        const db = await getDb();
        const rows = await db.select().from(assetFolders);
        return rows.map(toAssetFolderDTO);
    },

    async findChildrenLightweight(
        parentId: string | null,
        searchQuery?: string
    ): Promise<Array<{ id: string; name: string }>> {
        const db = await getDb();
        const parentCondition = parentId ? eq(assetFolders.parentId, parentId) : isNull(assetFolders.parentId);

        if (searchQuery && searchQuery.trim()) {
            const searchPattern = `%${searchQuery.trim()}%`;
            const rows = await db
                .select({
                    id: assetFolders.id,
                    name: assetFolders.name,
                })
                .from(assetFolders)
                .where(and(parentCondition, like(assetFolders.name, searchPattern)));
            return rows;
        } else {
            const rows = await db
                .select({
                    id: assetFolders.id,
                    name: assetFolders.name,
                })
                .from(assetFolders)
                .where(parentCondition);
            return rows;
        }
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
        if (!created) {
            throw new Error("Failed to fetch created asset folder");
        }
        return created;
    },

    async update(
        id: string,
        data: {
            parentId?: string | null;
            path?: string;
            idPath?: string;
            updatedBy?: string;
        }
    ): Promise<void> {
        const db = await getDb();
        await db
            .update(assetFolders)
            .set({
                ...data,
                updatedAt: new Date().toISOString(),
            })
            .where(eq(assetFolders.id, id));
    },

    async updateFields(
        id: string,
        data: {
            name?: string;
            description?: string;
            updatedBy?: string;
        }
    ): Promise<void> {
        const db = await getDb();
        await db
            .update(assetFolders)
            .set({
                ...data,
                updatedAt: new Date().toISOString(),
            })
            .where(eq(assetFolders.id, id));
    },

    async updateName(id: string, name: string, newPath: string): Promise<void> {
        const db = await getDb();
        await db
            .update(assetFolders)
            .set({
                name,
                path: newPath,
                updatedAt: new Date().toISOString(),
            })
            .where(eq(assetFolders.id, id));
    },

    async updatePathRecursively(oldPath: string, newPath: string): Promise<void> {
        const db = await getDb();
        const childFolders = await this.findChildrenByPath(oldPath);

        for (const child of childFolders) {
            const updatedPath = child.path.replace(oldPath, newPath);
            await db
                .update(assetFolders)
                .set({
                    path: updatedPath,
                    updatedAt: new Date().toISOString(),
                })
                .where(eq(assetFolders.id, child.id));
        }
    },

    async updateBatch(
        updates: Array<{
            id: string;
            path?: string;
            idPath?: string;
        }>
    ): Promise<void> {
        const db = await getDb();
        // Use Promise.all for parallel execution
        await Promise.all(
            updates.map(update =>
                db
                    .update(assetFolders)
                    .set({
                        path: update.path,
                        idPath: update.idPath,
                        updatedAt: new Date().toISOString(),
                    })
                    .where(eq(assetFolders.id, update.id))
            )
        );
    },

    async delete(id: string): Promise<void> {
        const db = await getDb();
        await db.delete(assetFolders).where(eq(assetFolders.id, id));
    },

    async deleteRecursively(id: string): Promise<void> {
        const db = await getDb();
        // Get all child folders
        const childFolders = await db
            .select({ id: assetFolders.id })
            .from(assetFolders)
            .where(eq(assetFolders.parentId, id));

        // Recursively delete children
        for (const child of childFolders) {
            await this.deleteRecursively(child.id);
        }

        // Delete the folder itself
        await this.delete(id);
    },

    async findAllDescendantIds(rootFolderId: string): Promise<string[]> {
        const db = await getDb();
        const root = await this.findById(rootFolderId);
        if (!root) return [];

        // Use idPath to find all descendants efficiently
        // idPath format: /id1/id2/id3
        // We want to find idPath like '/id1/id2/id3/%'
        const descendants = await db
            .select({ id: assetFolders.id })
            .from(assetFolders)
            .where(like(assetFolders.idPath, `${root.idPath}/%`));

        return [rootFolderId, ...descendants.map(d => d.id)];
    },

    async softDeleteBatch(ids: string[], userId: string): Promise<void> {
        if (ids.length === 0) return;
        const db = await getDb();

        // Chunking to avoid SQLite variable limits
        const BATCH_SIZE = 50;

        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
            const chunk = ids.slice(i, i + BATCH_SIZE);
            await db
                .update(assetFolders)
                .set({
                    deletedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    updatedBy: userId,
                })
                .where(inArray(assetFolders.id, chunk));
        }
    },
};
