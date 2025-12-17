import { assets } from "@/db/asset.schema";
import type { AssetDTO } from "../dto/asset.dto";

export type AssetRow = typeof assets.$inferSelect;

export const toAssetDTO = (row: AssetRow): AssetDTO => ({
    id: row.id,
    folderId: row.folderId ?? null,
    type: row.type,
    name: row.name,
    originalName: row.originalName,
    alt: row.alt ?? null,
    caption: row.caption ?? null,
    tags: row.tags ?? null,
    mimeType: row.mimeType ?? null,
    size: row.size,
    sizeFormatted: row.sizeFormatted,
    url: row.url,
    width: row.width ?? null,
    height: row.height ?? null,
    duration: row.duration ?? null,
    thumbnailUrl: row.thumbnailUrl ?? null,
    metadata: row.metadata ?? null,
    customMetadata: row.customMetadata ?? null,
    uploadedBy: row.uploadedBy,
    updatedBy: row.updatedBy ?? row.uploadedBy,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
});
