import { assets } from "@/db/asset.schema";
import type { AssetDTO } from "../dto/asset.dto";

export type AssetRow = typeof assets.$inferSelect;

export const formatAssetSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

export const toAssetDTO = (row: AssetRow): AssetDTO => ({
  id: row.id,
  folderId: row.folderId ?? null,
  type: row.type,
  name: row.name,
  originalName: row.originalName,
  alt: row.alt ?? null,
  caption: row.caption ?? null,
  tags: row.tags,
  mimeType: row.mimeType ?? null,
  size: row.size,
  sizeFormatted: formatAssetSize(row.size),
  url: row.url,
  width: row.width ?? null,
  height: row.height ?? null,
  duration: row.duration ?? null,
  thumbnailUrl: row.thumbnailUrl ?? null,
  metadata: row.metadata,
  uploadedBy: row.uploadedBy,
  updatedBy: row.updatedBy,
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
});
