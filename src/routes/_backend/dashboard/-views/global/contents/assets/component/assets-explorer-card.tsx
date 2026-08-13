import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";

import { AssetsCardSkeleton } from "./assets-card-skeleton";
import { AssetsCardHeader } from "@/routes/_backend/dashboard/-components/assets-card/assets-card-header";
import { AssetsCardToolbar } from "@/routes/_backend/dashboard/-components/assets-card/assets-card-toolbar";
import { AssetsContent } from "@/routes/_backend/dashboard/-components/assets-card/assets-content";
import { FoldersContent } from "@/routes/_backend/dashboard/-components/assets-card/folders-content";
import { BreadcrumbCollapse } from "@/components/dashboard/breadcrumb-collapse";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { useShallow } from "zustand/react/shallow";
import type { AssetsExplorerData } from "../assets.types";
import { useCollapseState } from "../hooks/use-collapse-state";
import { useSuppressTransition } from "../hooks/use-suppress-transition";
import { useAssetsStore } from "../stores/assets.store";
import { AssetEmptyCard } from "./asset-empty-card";

interface AssetsExplorerCardProps {
  label: string;
  description?: string;
  data: AssetsExplorerData;
  query?: string;
  isLoading?: boolean;
  errorMessage?: string;
  folderId?: string | null;
  hasActiveFilter?: boolean;
}

export const AssetsExplorerCard = ({
  label,
  description,
  data,
  query,
  isLoading = false,
  errorMessage,
  folderId,
  hasActiveFilter = false,
}: AssetsExplorerCardProps) => {
  const {
    foldersCollapsed,
    assetsCollapsed,
    setFoldersCollapsed,
    setAssetsCollapsed,
  } = useCollapseState(folderId ?? null);
  // Snap the saved collapse/split state into place when switching folders,
  // without any expand/collapse animation. Manual toggles still animate.
  const suppressTransition = useSuppressTransition(folderId ?? null);
  const [evenSplitResetKey, setEvenSplitResetKey] = useState(0);

  const { clearAllSelectedItems, selectedCount } = useAssetsStore(
    useShallow((state) => ({
      clearAllSelectedItems: state.clearAllSelectedItems,
      selectedCount: state.selectedItems.size,
    })),
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedCount > 0) {
        const activeEl = document.activeElement;
        const isInput =
          activeEl &&
          (activeEl.tagName === "INPUT" ||
            activeEl.tagName === "TEXTAREA" ||
            (activeEl as HTMLElement).isContentEditable);
        if (isInput) return;

        e.preventDefault();
        clearAllSelectedItems();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearAllSelectedItems, selectedCount]);

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
  }, [
    foldersCollapsed,
    hasAssets,
    resetToEvenSplit,
    setFoldersCollapsed,
    setAssetsCollapsed,
  ]);

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
  }, [
    assetsCollapsed,
    hasFolders,
    resetToEvenSplit,
    setFoldersCollapsed,
    setAssetsCollapsed,
  ]);

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
    [hasAssets, setFoldersCollapsed, setAssetsCollapsed],
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
    [hasFolders, setFoldersCollapsed, setAssetsCollapsed],
  );

  useEffect(() => {
    if (!hasAssets) setFoldersCollapsed(false);
    if (!hasFolders) setAssetsCollapsed(false);
  }, [hasAssets, hasFolders, setFoldersCollapsed, setAssetsCollapsed]);

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

  return (
    <CardWrapper
      classNames={{
        cardWrapper: "h-content flex flex-col",
        contentWrapper: cn("w-full relative flex-1 flex flex-col min-h-0"),
        headerWrapper: cn("max-md:flex-col"),
      }}
      label={<BreadcrumbCollapse breadcrumbs={breadcrumbs} />}
      description={description}
      headerButton={
        <AssetsCardHeader
          id="assets-card-header"
          currentFolder={currentFolder}
        />
      }
    >
      <AssetsCardToolbar />
      {isLoading ? (
        <AssetsCardSkeleton />
      ) : errorMessage ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-muted-foreground">{errorMessage}</p>
        </div>
      ) : folders.length <= 0 &&
        assets.length <= 0 &&
        !currentFolder &&
        !query &&
        !hasActiveFilter ? (
        <AssetEmptyCard showButton />
      ) : (
        <div className="w-full flex-1 flex flex-col min-h-0 overflow-hidden relative select-none">
          {folders.length <= 0 && assets.length <= 0 && (
            <div className="h-full w-full flex items-center gap-4 justify-center flex-col">
              <AssetEmptyCard className="h-fit" showButton={false} />
              <p className="text-center">No assets found</p>
            </div>
          )}
          {folders.length > 0 && (
            <FoldersContent
              folders={folders}
              isCollapsed={foldersCollapsed}
              isAssetsCollapsed={assetsCollapsed}
              canCollapse={hasAssets}
              evenSplitResetKey={evenSplitResetKey}
              folderId={
                data.currentFolder?.id ? String(data.currentFolder.id) : null
              }
              suppressTransition={suppressTransition}
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
            suppressTransition={suppressTransition}
            onToggleCollapse={handleToggleAssets}
          />
        </div>
      )}
    </CardWrapper>
  );
};
