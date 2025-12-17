import { assetFolders } from "@/db/asset.schema";
import type { AssetFolderDTO } from "../dto/asset-folder.dto";

export type AssetFolderRow = typeof assetFolders.$inferSelect;

export const toAssetFolderDTO = (row: AssetFolderRow): AssetFolderDTO => ({
    id: row.id,
    name: row.name,
    parentId: row.parentId ?? null,
    path: row.path,
    idPath: row.idPath,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    description: row.description,
});
