import { getDb } from "@/db";
import { assetFolders, assets } from "@/db/asset.schema";
import { users } from "@/db/auth.schema";
import { assetFolderDal } from "@/lib/asset/dal/asset-folder.dal";
import { toAssetDTO } from "@/lib/asset/mappers/asset.mapper";
import { createServerFn } from "@tanstack/react-start";
import { and, asc, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { validateSession } from "./utils";

type SortByField = "name" | "createdAt" | "updatedAt";
type SortOrder = "asc" | "desc";

interface ListItemsInput {
    folderId?: string | null;
    query?: string | null;
    sortBy?: SortByField;
    sortOrder?: SortOrder;
    page?: number;
    limit?: number;
}

export const listItems = createServerFn({ method: "POST" }).handler(
    async (ctx) => {
        const {
            folderId,
            query,
            sortBy = "createdAt",
            sortOrder = "desc",
            page = 1,
            limit = 50,
        } = (ctx.data || {}) as ListItemsInput;
            try {
                const { success, user } = await validateSession();

                if (!success || !user) {
                    return {
                        success: false,
                        message: "Unauthorized",
                        data: null,
                        error: "UNAUTHORIZED",
                    };
                }

                // Verify admin role
                if ((user as any).role !== "admin") {
                    return {
                        success: false,
                        message: "Access denied. Administrator privileges required.",
                        data: null,
                        error: "FORBIDDEN",
                    };
                }

                const db = await getDb();

                // Parallel queries for better performance
                const [currentFolder, childFolders, { assets: childAssets, totalAssets }] = await Promise.all([
                    // Get current folder if folderId is provided and not null (and not "root" if passed as string)
                    folderId && folderId !== "root" ? assetFolderDal.findById(folderId) : Promise.resolve(null),

                    // Get child folders (ALL folders, no pagination)
                    (async () => {
                        const parentCondition =
                            folderId && folderId !== "root"
                                ? eq(assetFolders.parentId, folderId)
                                : isNull(assetFolders.parentId);

                        const sortField =
                            sortBy === "createdAt"
                                ? assetFolders.createdAt
                                : sortBy === "updatedAt"
                                  ? assetFolders.updatedAt
                                  : assetFolders.name;
                        const orderBy = sortOrder === "desc" ? desc(sortField) : asc(sortField);

                        const creator = alias(users, "creator");
                        const updater = alias(users, "updater");

                        if (query && query.trim()) {
                            const searchPattern = `%${query.trim()}%`;
                            return db
                                .select({
                                    folder: assetFolders,
                                    creatorName: creator.name,
                                    updaterName: updater.name,
                                })
                                .from(assetFolders)
                                .leftJoin(creator, eq(assetFolders.createdBy, creator.id))
                                .leftJoin(updater, eq(assetFolders.updatedBy, updater.id))
                                .where(
                                    and(parentCondition, like(assetFolders.name, searchPattern), isNull(assetFolders.deletedAt))
                                )
                                .orderBy(orderBy);
                        } else {
                            return db
                                .select({
                                    folder: assetFolders,
                                    creatorName: creator.name,
                                    updaterName: updater.name,
                                })
                                .from(assetFolders)
                                .leftJoin(creator, eq(assetFolders.createdBy, creator.id))
                                .leftJoin(updater, eq(assetFolders.updatedBy, updater.id))
                                .where(and(parentCondition, isNull(assetFolders.deletedAt)))
                                .orderBy(orderBy);
                        }
                    })(),

                    // Get child assets (WITH pagination)
                    (async () => {
                        const sortField =
                            sortBy === "createdAt" ? assets.createdAt : sortBy === "updatedAt" ? assets.updatedAt : assets.name;
                        const orderBy = sortOrder === "desc" ? desc(sortField) : asc(sortField);
                        const offset = (page - 1) * limit;

                        let condition;

                        if (query && query.trim()) {
                            const searchPattern = `%${query.trim()}%`;
                            const searchCondition = or(
                                like(assets.name, searchPattern),
                                like(assets.originalName, searchPattern),
                                like(assets.caption, searchPattern),
                                like(assets.alt, searchPattern),
                                like(assets.tags, searchPattern),
                                like(assets.mimeType, searchPattern)
                            );

                            if (folderId !== undefined) {
                                const folderCondition =
                                    folderId && folderId !== "root" ? eq(assets.folderId, folderId) : isNull(assets.folderId);
                                condition = and(folderCondition, searchCondition, isNull(assets.deletedAt));
                            } else {
                                condition = and(searchCondition, isNull(assets.deletedAt));
                            }
                        } else {
                            const folderCondition =
                                folderId && folderId !== "root" ? eq(assets.folderId, folderId) : isNull(assets.folderId);
                            condition = and(folderCondition, isNull(assets.deletedAt));
                        }

                        // Get total count and paginated assets in parallel
                        const [countResult, paginatedAssets] = await Promise.all([
                            // Count query using SQL COUNT(*)
                            db
                                .select({ count: sql<number>`count(*)` })
                                .from(assets)
                                .where(condition),

                            // Paginated assets query
                            db
                                .select({
                                    asset: assets,
                                    uploaderName: users.name,
                                })
                                .from(assets)
                                .leftJoin(users, eq(assets.uploadedBy, users.id))
                                .where(condition)
                                .orderBy(orderBy)
                                .limit(limit)
                                .offset(offset),
                        ]);

                        const totalAssets = Number(countResult[0]?.count ?? 0);

                        return { assets: paginatedAssets, totalAssets };
                    })(),
                ]);

                // Convert to DTOs
                const foldersDTO = childFolders.map(({ folder, creatorName, updaterName }) => ({
                    id: folder.id,
                    name: folder.name,
                    parentId: folder.parentId ?? null,
                    path: folder.path,
                    idPath: folder.idPath,
                    createdBy: creatorName || folder.createdBy,
                    updatedBy: updaterName || folder.updatedBy,
                    createdAt: new Date(folder.createdAt),
                    updatedAt: new Date(folder.updatedAt),
                    description: folder.description,
                }));

                const assetsDTO = childAssets.map(({ asset, uploaderName }) => ({
                    ...toAssetDTO(asset),
                    uploadedBy: uploaderName || asset.uploadedBy,
                }));

                return {
                    success: true,
                    message: "Items fetched successfully",
                    data: {
                        currentFolder,
                        folders: foldersDTO,
                        assets: assetsDTO,
                        pagination: {
                            page,
                            limit,
                            totalAssets,
                            totalPages: Math.ceil(totalAssets / limit),
                        },
                    },
                };
            } catch (error) {
                console.error("List items error:", error);
                return {
                    success: false,
                    message: error instanceof Error ? error.message : "Failed to fetch items",
                    data: null,
                    error: "LIST_FAILED",
                };
            }
        }
    );

export const listAllFolders = createServerFn({ method: "POST" }).handler(async () => {
    try {
        const { success, user } = await validateSession();

        if (!success || !user) {
            return {
                success: false,
                message: "Unauthorized",
                data: null,
                error: "UNAUTHORIZED",
            };
        }

        // Verify admin role
        if ((user as any).role !== "admin") {
            return {
                success: false,
                message: "Access denied. Administrator privileges required.",
                data: null,
                error: "FORBIDDEN",
            };
        }

        const db = await getDb();
        const folders = await db
            .select()
            .from(assetFolders)
            .where(isNull(assetFolders.deletedAt))
            .orderBy(asc(assetFolders.path));

        return {
            success: true,
            message: "All folders fetched successfully",
            data: folders,
        };
    } catch (error) {
        console.error("Folder list error:", error);
        const message = error instanceof Error ? error.message : "Failed to fetch folders";
        return {
            success: false,
            message,
            data: null,
            error: "LIST_FAILED",
        };
    }
});
