import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

import { AssetsCardHeader } from "@/routes/_backend/dashboard/-components/assets-card/assets-card-header";
import { AssetsContent } from "@/routes/_backend/dashboard/-components/assets-card/assets-content";
import { FoldersContent } from "@/routes/_backend/dashboard/-components/assets-card/folders-content";
import { BreadcrumbCollapse } from "@/routes/_backend/dashboard/-components/breadcrumb/breadcrumb-collapse";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import type { AssetsCardComponentProps } from "../config/assets-card.types";
import { AssetEmptyCard } from "./asset-empty-card";

export const AssetsExplorerCard = ({
  slug,
  label,
  description,
  data,
  query,
  uploadConfig,
}: AssetsCardComponentProps) => {
  const [foldersCollapsed, setFoldersCollapsed] = useState(false);
  const [assetsCollapsed, setAssetsCollapsed] = useState(false);
  const [evenSplitResetKey, setEvenSplitResetKey] = useState(0);
  const { folders = [], assets = [], currentFolder } = data;
  const hasFolders = folders.length > 0;
  const hasAssets = assets.length > 0;
  const breadCrumb = currentFolder?.idPath?.split("/").filter(Boolean);

  const resetToEvenSplit = useCallback(() => {
    setEvenSplitResetKey((key) => key + 1);
  }, []);

  const handleToggleFolders = useCallback(() => {
    if (!hasAssets) return;

    if (foldersCollapsed) {
      setFoldersCollapsed(false);
      setAssetsCollapsed(false);
      resetToEvenSplit();
      return;
    }

    setFoldersCollapsed(true);
    setAssetsCollapsed(false);
  }, [foldersCollapsed, hasAssets, resetToEvenSplit]);

  const handleToggleAssets = useCallback(() => {
    if (!hasFolders) return;

    if (assetsCollapsed) {
      setFoldersCollapsed(false);
      setAssetsCollapsed(false);
      resetToEvenSplit();
      return;
    }

    setFoldersCollapsed(false);
    setAssetsCollapsed(true);
  }, [assetsCollapsed, hasFolders, resetToEvenSplit]);

  const handleSetFoldersCollapsed = useCallback(
    (collapsed: boolean) => {
      if (collapsed) {
        if (!hasAssets) return;
        setFoldersCollapsed(true);
        setAssetsCollapsed(false);
        return;
      }
      setFoldersCollapsed(false);
    },
    [hasAssets],
  );

  const handleSetAssetsCollapsed = useCallback(
    (collapsed: boolean) => {
      if (collapsed) {
        if (!hasFolders) return;
        setFoldersCollapsed(false);
        setAssetsCollapsed(true);
        return;
      }
      setAssetsCollapsed(false);
    },
    [hasFolders],
  );

  useEffect(() => {
    if (!hasAssets) setFoldersCollapsed(false);
    if (!hasFolders) setAssetsCollapsed(false);
  }, [hasAssets, hasFolders]);

  const rootBreadcrumb = [{ label, href: "/dashboard/assets" }];
  let breadcrumbs = rootBreadcrumb;

  if (breadCrumb && breadCrumb?.length > 0) {
    const namePath = currentFolder?.path?.split("/").filter(Boolean);
    const filteredBreadCrumb = breadCrumb.filter(Boolean);

    breadcrumbs = [
      ...rootBreadcrumb,
      ...filteredBreadCrumb.map((item, idx) => ({
        label: namePath?.[idx] || "Unknown",
        href: `/dashboard/assets?folderId=${item}`,
      })),
    ];
  }

  if (folders?.length <= 0 && assets?.length <= 0 && !currentFolder && !query)
    return (
      <div id={slug}>
        <CardWrapper
          classNames={{
            cardWrapper: "h-[calc(100svh-5rem)]",
            contentWrapper: "h-full w-full relative",
          }}
          label={<BreadcrumbCollapse breadcrumbs={breadcrumbs} />}
          description={description}
        >
          <AssetEmptyCard showButton uploadConfig={uploadConfig} />
        </CardWrapper>
      </div>
    );

  return (
    <CardWrapper
      classNames={{
        cardWrapper: "h-[calc(100vh-4.75rem)] flex flex-col overflow-hidden",
        contentWrapper: cn(
          "w-full relative flex-1 flex flex-col min-h-0 overflow-hidden",
        ),
        headerWrapper: cn("max-md:flex-col"),
      }}
      label={<BreadcrumbCollapse breadcrumbs={breadcrumbs} />}
      description={description}
      headerButton={
        <AssetsCardHeader
          className="max-md:w-full max-md:flex-1"
          id="assets-card-header"
          data={data}
          uploadConfig={uploadConfig}
        />
      }
    >
      <div className="w-full flex-1 flex flex-col min-h-0 overflow-hidden">
        {folders?.length <= 0 && assets?.length <= 0 && (
          <div className="h-full w-full flex items-center gap-4 justify-center flex-col">
            <AssetEmptyCard className="h-fit" showButton={false} />
            <p className="text-center">No assets found</p>
          </div>
        )}
        {folders && folders?.length > 0 && (
          <FoldersContent
            folders={folders}
            isCollapsed={foldersCollapsed}
            isAssetsCollapsed={assetsCollapsed}
            canCollapse={hasAssets}
            evenSplitResetKey={evenSplitResetKey}
            onToggleCollapse={handleToggleFolders}
            onSetFoldersCollapsed={handleSetFoldersCollapsed}
            onSetAssetsCollapsed={handleSetAssetsCollapsed}
          />
        )}
        <AssetsContent
          assets={assets}
          pagination={data.pagination}
          isCollapsed={assetsCollapsed}
          canCollapse={hasFolders}
          onToggleCollapse={handleToggleAssets}
        />
      </div>
    </CardWrapper>
  );
};
