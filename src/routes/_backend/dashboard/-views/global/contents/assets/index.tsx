import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getRouteApi, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { AssetPropertiesResponsive } from "@/routes/_backend/dashboard/-components/assets-card/asset-properties-responsive";
import { AssetsDataProvider } from "@/routes/_backend/dashboard/-components/assets-card/assets-data-provider";
import { PageSplitLayout } from "@/routes/_backend/dashboard/-components/layout/page-split-layout";
import AssetSelectFloat from "@/routes/_backend/dashboard/-views/features/asset/select/float";
import { assetQueries, normalizeAssetListParams } from "@queries/asset.queries";
import { toAssetCardAsset, toAssetCardFolder } from "./asset-view-model";
import { AssetsExplorerCard } from "./component/assets-explorer-card";
import { AssetDraggableProvider } from "./component/draggable-provider";
import { useAssetsStore } from "./stores/assets.store";

const routeApi = getRouteApi("/_backend/dashboard/$slug");
const DEFAULT_PAGINATION = {
  page: 1,
  limit: 15,
  totalAssets: 0,
  totalPages: 1,
};

export const Assets = () => {
  const search = routeApi.useSearch();
  const isAssetsIndex = useLocation({
    select: (location) =>
      location.pathname === "/dashboard/assets" ||
      location.pathname === "/dashboard/assets/",
  });

  useEffect(
    () => () => {
      // Search-param navigation (page, sort, filters and folders) keeps this
      // view mounted, so the selection survives. A real route change unmounts
      // the Assets view and must not leak its selection into another feature.
      useAssetsStore.getState().clearAllSelectedItems();
    },
    [],
  );

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
    () => responseData?.folders?.map(toAssetCardFolder) || [],
    [responseData?.folders],
  );

  const assetsData = useMemo(
    () => responseData?.assets?.map(toAssetCardAsset) || [],
    [responseData?.assets],
  );

  const pagination = responseData?.pagination || DEFAULT_PAGINATION;

  const currentFolder = useMemo(
    () =>
      responseData?.currentFolder
        ? toAssetCardFolder(responseData.currentFolder)
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
    <PageSplitLayout
      sidebar={<AssetPropertiesResponsive />}
      sidebarClassName="max-xl:hidden"
    >
      <div className="flex-1 min-h-0 flex flex-col">
        <AssetsDataProvider data={assetsCardData} folderId={folderId}>
          <AssetDraggableProvider>
            <AssetsExplorerCard
              label="Assets"
              description="Manage your media and files"
              query={query}
              data={assetsCardData}
              isLoading={isInitialLoading}
              errorMessage={errorMessage}
              folderId={folderId}
              hasActiveFilter={Boolean(
                search.assetType ||
                  search.assetSize ||
                  search.assetCreatedWithin,
              )}
            />
          </AssetDraggableProvider>
        </AssetsDataProvider>
      </div>
      <AssetSelectFloat active={isAssetsIndex} />
    </PageSplitLayout>
  );
};

export default Assets;
