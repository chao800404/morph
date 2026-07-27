import type { AssetFolderDTO } from "@/lib/asset/dto/asset-folder.dto";
import type { AssetDTO } from "@/lib/asset/dto/asset.dto";
import { formatDate, getFileExtension, getFileType } from "@/lib/utils";
import type { PreviewAsset } from "./asset-preview.types";
import type { Asset, AssetFolder } from "./assets.types";
import type { SelectedItem } from "./stores/assets.store";
import type { AssetEditItem } from "@/routes/_backend/dashboard/-views/features/asset/edit/asset-edit.types";

export type AssetRouteItem =
  | { itemType: "asset"; item: AssetDTO }
  | { itemType: "folder"; item: AssetFolderDTO };

const MIME_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogg",
  "video/quicktime": "mov",
};

const getAssetExtension = (asset: AssetDTO): string =>
  getFileExtension(asset.originalName) ||
  getFileExtension(asset.url) ||
  (asset.mimeType
    ? (MIME_TYPE_EXTENSIONS[asset.mimeType.toLowerCase()] ?? "")
    : "") ||
  getFileExtension(asset.name);

export const toSelectedAssetItem = (data: AssetRouteItem): SelectedItem => {
  if (data.itemType === "folder") {
    return {
      type: "folder",
      id: data.item.id,
      name: data.item.name,
      description: data.item.description ?? undefined,
      parentId: data.item.parentId,
      path: data.item.path,
      createdBy: data.item.createdBy,
      updatedBy: data.item.updatedBy,
      createdAt: formatDate(data.item.createdAt),
      updatedAt: formatDate(data.item.updatedAt),
      assetCount: data.item.assetCount,
      folderCount: data.item.folderCount,
      itemCount: data.item.itemCount,
    };
  }

  return {
    type: "asset",
    id: data.item.id,
    name: data.item.name,
    fileType: getFileType(data.item.mimeType),
    extension: getAssetExtension(data.item),
    src: data.item.url,
    alt: data.item.alt ?? undefined,
    caption: data.item.caption ?? undefined,
    tags: data.item.tags.length > 0 ? data.item.tags : undefined,
    uploadedBy: data.item.uploadedBy,
    duration: data.item.duration ?? undefined,
    size: data.item.size,
    createdAt: formatDate(data.item.createdAt),
    updatedAt: formatDate(data.item.updatedAt),
  };
};

export const toAssetEditItem = (data: AssetRouteItem): AssetEditItem => {
  const selected = toSelectedAssetItem(data);

  if (data.itemType === "folder" && selected.type === "folder") {
    return {
      id: selected.id,
      type: "folder",
      name: selected.name,
      description: selected.description ?? "",
      locationId: data.item.parentId,
    };
  }

  if (data.itemType === "asset" && selected.type === "asset") {
    return {
      id: selected.id,
      type: "asset",
      name: selected.name,
      fileType: selected.fileType,
      extension: selected.extension,
      src: selected.src,
      alt: selected.alt ?? "",
      caption: selected.caption ?? "",
      tags: selected.tags?.join(", ") ?? "",
      size: selected.size,
      locationId: data.item.folderId,
    };
  }

  throw new Error("Asset item type mismatch");
};

export const toAssetCardAsset = (item: AssetDTO): Asset => ({
  id: item.id,
  name: item.name,
  url: item.url,
  createdAt: formatDate(item.createdAt),
  updatedAt: formatDate(item.updatedAt),
  size: item.size,
  type: item.mimeType,
  extension: getAssetExtension(item),
  alt: item.alt ?? undefined,
  caption: item.caption ?? undefined,
  tags: item.tags.length > 0 ? item.tags : undefined,
  uploadedBy: item.uploadedBy || undefined,
  duration: item.duration ?? undefined,
});

export const toAssetCardFolder = (item: AssetFolderDTO): AssetFolder => ({
  id: item.id,
  name: item.name,
  description: item.description,
  createdAt: formatDate(item.createdAt),
  updatedAt: formatDate(item.updatedAt),
  createdBy: item.createdBy || undefined,
  updatedBy: item.updatedBy || undefined,
  path: item.path || undefined,
  parentId: item.parentId || undefined,
  idPath: item.idPath || undefined,
  assetCount: item.assetCount ?? 0,
  folderCount: item.folderCount ?? 0,
  itemCount: item.itemCount ?? 0,
  empty: false,
});

export interface AssetTableItem {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  updatedAt?: string;
  type: string | null;
  size: number;
  alt?: string;
  caption?: string;
  tags?: string[];
  extension?: string;
}

export const toAssetTableItem = (asset: Asset): AssetTableItem => ({
  id: String(asset.id),
  name: asset.name,
  url: asset.url,
  type: asset.type,
  createdAt: asset.createdAt,
  updatedAt: asset.updatedAt,
  size: asset.size,
  alt: asset.alt || undefined,
  caption: asset.caption || undefined,
  tags: asset.tags || undefined,
  extension: asset.extension,
});

export const toSelectedAssetFromTable = (
  asset: AssetTableItem,
): Extract<SelectedItem, { type: "asset" }> => ({
  type: "asset",
  id: asset.id,
  name: asset.name,
  fileType: getFileType(asset.type),
  extension: asset.extension || "",
  src: asset.url,
  alt: asset.alt,
  caption: asset.caption,
  tags: asset.tags,
  createdAt: asset.createdAt,
  updatedAt: asset.updatedAt,
  size: asset.size,
});

export const toSelectedAssetFromCard = (
  asset: Asset,
): Extract<SelectedItem, { type: "asset" }> =>
  toSelectedAssetFromTable(toAssetTableItem(asset));

export const toSelectedFolderFromCard = (
  folder: AssetFolder,
): Extract<SelectedItem, { type: "folder" }> => ({
  type: "folder",
  id: String(folder.id),
  name: folder.name,
  createdAt: folder.createdAt,
  updatedAt: folder.updatedAt,
  createdBy: folder.createdBy,
  updatedBy: folder.updatedBy,
  description: folder.description || undefined,
  path: folder.path,
  parentId: folder.parentId,
  assetCount: folder.assetCount,
  folderCount: folder.folderCount,
  itemCount: folder.itemCount,
});

export const toPreviewAsset = (asset: AssetDTO): PreviewAsset => ({
  id: asset.id,
  name: asset.name,
  fileType: getFileType(asset.mimeType),
  extension: getAssetExtension(asset),
  src: asset.url,
  alt: asset.alt ?? undefined,
});
