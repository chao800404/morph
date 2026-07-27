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
  assetCount?: number;
  folderCount?: number;
  itemCount?: number;
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

export interface AssetsExplorerData {
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
