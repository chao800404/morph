import { cn, formatDate, getFileExtension } from "@/lib/utils";
import { getConfig } from "@/server/get-config";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useMemo } from "react";

import { AssetPropertyCard } from "@/routes/_backend/dashboard/-components/assets-card/asset-property-card";
import { AssetsDataProvider } from "@/routes/_backend/dashboard/-components/assets-card/assets-data-provider";
import { assetQueries } from "@queries/asset.queries";
import { AssetsExplorerCard } from "./component/assets-explorer-card";
import { AssetDraggableProvider } from "./component/draggable-provider";
// import { AssetsExplorerCard } from "./_component/assets-explorer-card";
// import { AssetDraggableProvider } from "./_component/draggable-provider";

const routeApi = getRouteApi("/_backend/dashboard/$slug");
const DEFAULT_PAGINATION = {
  page: 1,
  limit: 20,
  totalAssets: 0,
  totalPages: 1,
};

export const Assets = () => {
  const config = getConfig().client;
  const search = routeApi.useSearch();

  const folderId = search.folderId || null;
  const query = search.q;
  const sortBy = (search.sortBy || "createdAt") as
    | "name"
    | "createdAt"
    | "updatedAt";
  const sortOrder = (search.sortOrder || "desc") as "asc" | "desc";
  const page = Number(search.page) || 1;
  const limit = Number(search.limit) || 15;

  const { data: queryAssets } = useSuspenseQuery(
    assetQueries.list({
      folderId,
      query,
      sortBy,
      sortOrder,
      page,
      limit,
    }),
  );
  const responseData = queryAssets?.data;

  const foldersData = useMemo(
    () =>
      responseData?.folders?.map((folder: any) => ({
        id: folder.id,
        name: folder.name,
        description: folder.description,
        createdAt: formatDate(folder.createdAt),
        updatedAt: formatDate(folder.updatedAt),
        createdBy: folder.createdBy || undefined,
        updatedBy: folder.updatedBy || undefined,
        path: folder.path || undefined,
        parentId: folder.parentId || undefined,
        idPath: folder.idPath || undefined,
        assetCount: folder.assetCount ?? 0,
        folderCount: folder.folderCount ?? 0,
        itemCount: folder.itemCount ?? 0,
        empty: false,
      })) || [],
    [responseData?.folders],
  );

  const assetsData = useMemo(
    () =>
      responseData?.assets?.map((asset: any) => ({
        id: asset.id,
        name: asset.name,
        url: asset.url.startsWith("http") ? asset.url : `${asset.url}`,
        createdAt: formatDate(new Date(asset.createdAt || new Date())),
        updatedAt: formatDate(new Date(asset.updatedAt || new Date())),
        size: asset.size,
        type: asset.mimeType,
        extension: getFileExtension(asset.name) || getFileExtension(asset.url),
        alt: asset.alt || undefined,
        caption: asset.caption || undefined,
        tags: asset.tags.length > 0 ? asset.tags : undefined,
        uploadedBy: asset.uploadedBy || undefined,
        duration: asset.duration || undefined,
      })) || [],
    [responseData?.assets],
  );

  const pagination = responseData?.pagination || DEFAULT_PAGINATION;

  const currentFolder = useMemo(
    () =>
      responseData?.currentFolder
        ? {
            id: responseData.currentFolder.id,
            name: responseData.currentFolder.name,
            createdAt: formatDate(responseData.currentFolder.createdAt),
            updatedAt: formatDate(responseData.currentFolder.updatedAt),
            createdBy: responseData.currentFolder.createdBy || undefined,
            updatedBy: responseData.currentFolder.updatedBy || undefined,
            empty: false,
            idPath: responseData.currentFolder.idPath,
            path: responseData.currentFolder.path,
            parentId: responseData.currentFolder.parentId,
            description: responseData.currentFolder.description,
          }
        : undefined,
    [responseData?.currentFolder],
  );

  const assetsCardData = useMemo(
    () => ({
      folders: foldersData,
      assets: assetsData,
      currentFolder,
      pagination,
    }),
    [assetsData, currentFolder, foldersData, pagination],
  );

  if (!queryAssets?.success || !responseData) {
    return (
      <div className="flex h-[calc(100svh-56px)] items-center justify-center">
        <p className="text-muted-foreground">
          Failed to load assets or no assets found.
        </p>
      </div>
    );
  }

  return (
    <>
      <section className={cn("w-[calc(100%-24rem)] h-full overflow-hidden flex flex-col", "max-xl:w-full")}>
        <div className="px-2 py-3 flex-1 min-h-0 overflow-hidden flex flex-col">
          <AssetsDataProvider data={assetsCardData} folderId={folderId}>
            <AssetDraggableProvider>
              <AssetsExplorerCard
                slug="assets"
                label="Assets"
                description="Manage your media and files"
                query={query}
                data={assetsCardData}
                uploadConfig={config.upload}
              />
            </AssetDraggableProvider>
          </AssetsDataProvider>
        </div>
      </section>
      <div className="bottom-0 w-sm fixed top-14 pt-3 pr-2 pl-0.5 right-0  max-xl:hidden">
        <div className="h-full">
          <AssetPropertyCard />
        </div>
      </div>
    </>
  );
};

export default Assets;
