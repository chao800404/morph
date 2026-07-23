import type { AssetMetadata, AssetType } from "@/db/asset.schema";

export interface CreateAssetDTO {
  folderId: string | null;
  type: AssetType;
  name: string;
  originalName: string;
  alt?: string;
  caption?: string;
  tags?: string[];
  mimeType?: string;
  size: number;
  url: string;
  width?: number;
  height?: number;
  duration?: number;
  thumbnailUrl?: string;
  metadata: AssetMetadata;
  uploadedBy: string;
  updatedBy: string;
}

export interface AssetDTO {
  id: string;
  folderId: string | null;
  type: AssetType;
  name: string;
  originalName: string;
  alt: string | null;
  caption: string | null;
  tags: string[];
  mimeType: string | null;
  size: number;
  sizeFormatted: string;
  url: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  thumbnailUrl: string | null;
  metadata: AssetMetadata;
  uploadedBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssetInsertDTO extends CreateAssetDTO {
  id: string;
  createdAt?: Date;
  updatedAt?: Date;
}
