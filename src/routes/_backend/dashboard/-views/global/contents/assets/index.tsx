import { cn, formatDate, getFileExtension } from "@/lib/utils";
import { getConfig } from "@/server/get-config";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";

import { AssetPropertyCard } from "@/routes/_backend/dashboard/-components/assets-card/asset-property-card";
import { assetQueries } from "@queries/asset.queries";
import { AssetsExplorerCard } from "./component/assets-explorer-card";
import { AssetDraggableProvider } from "./component/draggable-provider";
// import { AssetsExplorerCard } from "./_component/assets-explorer-card";
// import { AssetDraggableProvider } from "./_component/draggable-provider";

const routeApi = getRouteApi("/_backend/dashboard/$slug");

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

  if (!queryAssets?.success || !queryAssets.data) {
    return (
      <div className="flex h-[calc(100svh-56px)] items-center justify-center">
        <p className="text-muted-foreground">
          Failed to load assets or no assets found.
        </p>
      </div>
    );
  }

  const foldersData =
    queryAssets.data.folders?.map((folder: any) => ({
      id: folder.id,
      name: folder.name,
      description: folder.description,
      createdAt: formatDate(folder.createdAt),
      updatedAt: formatDate(folder.updatedAt),
      createdBy: folder.createdBy || undefined,
      updatedBy: folder.updatedBy || undefined,
      empty: false,
    })) || [];

  const assetsData =
    queryAssets.data.assets?.map((asset: any) => ({
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
      tags: asset.tags
        ? asset.tags.split(",").map((t: string) => t.trim())
        : undefined,
      uploadedBy: asset.uploadedBy || undefined,
      duration: asset.duration || undefined,
    })) || [];

  const pagination = queryAssets.data.pagination || {
    page: 1,
    limit: 20,
    totalAssets: 0,
    totalPages: 1,
  };

  const currentFolder = queryAssets.data.currentFolder
    ? {
        id: queryAssets.data.currentFolder.id,
        name: queryAssets.data.currentFolder.name,
        createdAt: formatDate(queryAssets.data.currentFolder.createdAt),
        updatedAt: formatDate(queryAssets.data.currentFolder.updatedAt),
        createdBy: queryAssets.data.currentFolder.createdBy || undefined,
        updatedBy: queryAssets.data.currentFolder.updatedBy || undefined,
        empty: false,
        idPath: queryAssets.data.currentFolder.idPath,
        path: queryAssets.data.currentFolder.path,
        parentId: queryAssets.data.currentFolder.parentId,
        description: queryAssets.data.currentFolder.description,
      }
    : undefined;

  return (
    <>
      <section className={cn("w-[calc(100%-24rem)]", "max-xl:w-full")}>
        <div className="px-2 py-3">
          <AssetDraggableProvider>
            <AssetsExplorerCard
              slug="assets"
              label="Assets"
              description="Manage your media and files"
              query={query}
              data={{
                folders: foldersData,
                assets: assetsData,
                currentFolder,
                pagination,
              }}
              uploadConfig={config.upload}
            />
          </AssetDraggableProvider>
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
