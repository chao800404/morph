export interface CreateAssetDTO {
    folderId: string | null;
    type: "image" | "video" | "rive" | "model";
    name: string;
    originalName: string;
    alt?: string;
    caption?: string;
    tags?: string;
    mimeType?: string;
    size: number;
    sizeFormatted: string;
    url: string;
    width?: number;
    height?: number;
    duration?: number;
    thumbnailUrl?: string;
    metadata?: string;
    customMetadata?: string;
    uploadedBy: string;
    updatedBy: string;
}

export interface AssetDTO {
    id: string;
    folderId: string | null;
    type: string;
    name: string;
    originalName: string;
    alt: string | null;
    caption: string | null;
    tags: string | null;
    mimeType: string | null;
    size: number;
    sizeFormatted: string;
    url: string;
    width: number | null;
    height: number | null;
    duration: number | null;
    thumbnailUrl: string | null;
    metadata: string | null;
    customMetadata: string | null;
    uploadedBy: string;
    updatedBy: string;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface AssetInsertDTO extends CreateAssetDTO {
    id: string;
    createdAt?: Date;
    updatedAt?: Date;
}
