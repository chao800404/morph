export interface CreateAssetFolderDTO {
    name: string;
    parentId: string | null;
    createdBy: string;
    description?: string | null;
}

export interface AssetFolderDTO {
    id: string;
    name: string;
    parentId: string | null;
    path: string;
    idPath: string;
    createdBy: string;
    updatedBy: string;
    createdAt: Date;
    updatedAt: Date;
    description?: string | null;
    assetCount?: number;
    folderCount?: number;
    itemCount?: number;
}

export interface AssetFolderInsertDTO extends CreateAssetFolderDTO {
    id: string;
    path: string;
    idPath: string;
    description?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
}
