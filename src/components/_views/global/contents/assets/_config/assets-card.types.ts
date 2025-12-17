import type { ComponentType } from "react";

export interface AssetFolder {
    id: number | string;
    name: string;
    createdAt: string;
    updatedAt: string;
    empty: boolean;
    idPath?: string;
    path?: string;
    parentId?: string | null;
    description?: string | null;
    createdBy?: string;
    updatedBy?: string;
}

export interface Asset {
    id: number | string;
    name: string;
    createdAt: string;
    updatedAt: string;
    size: number;
    type: string | null;
    url: string;
    alt?: string | null;
    caption?: string | null;
    tags?: string[] | null;
    uploadedBy?: string;
    duration?: number | null;
    extension?: string;
}

export interface AssetsCardData {
    folders?: AssetFolder[];
    assets?: Asset[];
    currentFolder?: AssetFolder;
    pagination?: {
        page: number;
        limit: number;
        totalAssets: number;
        totalPages: number;
    };
}

export interface AssetsCardComponentProps {
    slug: string;
    label: string;
    description?: string;
    data: AssetsCardData;
    query?: string;
    uploadConfig: {
        maxFileSize: number;
        minFiles: number;
        maxFiles: number;
        allowedTypes: string[];
        allowedExtensions: string[];
    };
}

export interface AssetsCardSection {
    slug: string;
    label: string;
    description?: string;
    component: ComponentType<AssetsCardComponentProps>;
}

export interface AssetsCardConfig {
    sections: AssetsCardSection[];
}
