import { cn, formatDate, getFileExtension } from "@/lib/utils";
import { getConfig } from "@/server/get-config";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useMemo } from "react";

import { AssetPropertyCard } from "@/routes/_backend/dashboard/-components/assets-card/asset-property-card";
import { AssetsDataProvider } from "@/routes/_backend/dashboard/-components/assets-card/assets-data-provider";
import { assetQueries, normalizeAssetListParams } from "@queries/asset.queries";
import { AssetsExplorerCard } from "./component/assets-explorer-card";
import { AssetDraggableProvider } from "./component/draggable-provider";

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

  // Must match the loader's params exactly (same query key) so the loader's
  // prefetch primes the cache this query reads — avoids a redundant fetch and
  // the loading flash on navigation.
  const listParams = normalizeAssetListParams(search);
  const folderId = listParams.folderId;
  const query = listParams.query;

  const { data: queryAssets, status } = useQuery({
    ...assetQueries.list(listParams),
    placeholderData: keepPreviousData,
  });

  const isInitialLoading = status === "pending" && !queryAssets;
  const errorMessage =
    queryAssets?.success === false
      ? queryAssets.message || "Failed to load assets."
      : status === "error"
        ? "Failed to load assets."
        : undefined;
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

  return (
    <div className="flex w-full gap-4">
      <section className={cn("flex-1")}>
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <AssetsDataProvider data={assetsCardData} folderId={folderId}>
            <AssetDraggableProvider>
              <AssetsExplorerCard
                slug="assets"
                label="Assets"
                description="Manage your media and files"
                query={query}
                data={assetsCardData}
                uploadConfig={config.upload}
                isLoading={isInitialLoading}
                errorMessage={errorMessage}
                folderId={folderId}
              />
            </AssetDraggableProvider>
          </AssetsDataProvider>
        </div>
      </section>
      <div className="h-full w-md">
        <AssetPropertyCard />
      </div>
    </div>
  );
};

export default Assets;
