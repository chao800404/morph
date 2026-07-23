import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

import { AssetsCardHeader } from "@/routes/_backend/dashboard/-components/assets-card/assets-card-header";
import { AssetsContent } from "@/routes/_backend/dashboard/-components/assets-card/assets-content";
import { FoldersContent } from "@/routes/_backend/dashboard/-components/assets-card/folders-content";
import { BreadcrumbCollapse } from "@/routes/_backend/dashboard/-components/breadcrumb/breadcrumb-collapse";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { Skeleton } from "@/components/ui/skeleton";
import type { AssetsCardComponentProps } from "../config/assets-card.types";
import { AssetEmptyCard } from "./asset-empty-card";
import { useAssetsStore, type SelectedItem } from "../stores/assets.store";
import { useShallow } from "zustand/react/shallow";

type AssetsExplorerCardProps = AssetsCardComponentProps & {
  isLoading?: boolean;
  errorMessage?: string;
};

export const AssetsExplorerCard = ({
  label,
  description,
  data,
  query,
  uploadConfig,
  isLoading = false,
  errorMessage,
}: AssetsExplorerCardProps) => {
  const [foldersCollapsed, setFoldersCollapsed] = useState(false);
  const [assetsCollapsed, setAssetsCollapsed] = useState(false);
  const [evenSplitResetKey, setEvenSplitResetKey] = useState(0);
  const marqueeBoxRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number | null>(null);

  const { selectAllItems, clearAllSelectedItems, selectedCount } =
    useAssetsStore(
      useShallow((state) => ({
        selectAllItems: state.selectAllItems,
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

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;

    if (
      target.closest(
        "button, input, select, a, [role='checkbox'], [data-slot='checkbox'], [data-no-marquee='true'], .cursor-row-resize, [data-radix-collection-item], [role='menuitem']",
      )
    ) {
      return;
    }

    // If pointer down started directly on an item (folder/asset) without Shift/Ctrl/Alt modifier, yield to DND item movement!
    const isItem = target.closest(
      '[data-type="asset-folder"], [data-type="asset-asset"], [draggable="true"]',
    );
    const hasModifier = e.shiftKey || e.ctrlKey || e.metaKey || e.altKey;

    if (isItem && !hasModifier) {
      return;
    }

    const startX = e.clientX;
    const startY = e.clientY;
    let isDragging = false;
    const isAppendMode = e.shiftKey || e.ctrlKey || e.metaKey;

    const container = containerRef.current;
    if (!container) return;

    const selectableElements = Array.from(
      container.querySelectorAll(
        '[data-type="asset-folder"], [data-type="asset-asset"]',
      ),
    ) as HTMLElement[];

    const itemCache = selectableElements.map((el) => {
      const typeAttr = el.getAttribute("data-type");
      const isFolder = typeAttr === "asset-folder";
      const id = el.getAttribute("id") || "";

      return {
        id,
        type: isFolder ? ("folder" as const) : ("asset" as const),
        rect: el.getBoundingClientRect(),
      };
    });

    const onPointerMove = (moveEvent: PointerEvent) => {
      const currentX = moveEvent.clientX;
      const currentY = moveEvent.clientY;
      const dx = Math.abs(currentX - startX);
      const dy = Math.abs(currentY - startY);

      if (!isDragging && (dx > 4 || dy > 4)) {
        isDragging = true;
        if (marqueeBoxRef.current) {
          marqueeBoxRef.current.style.display = "block";
        }
      }

      if (!isDragging || !marqueeBoxRef.current) return;

      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = dx;
      const height = dy;

      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(() => {
        if (marqueeBoxRef.current) {
          marqueeBoxRef.current.style.left = `${left}px`;
          marqueeBoxRef.current.style.top = `${top}px`;
          marqueeBoxRef.current.style.width = `${width}px`;
          marqueeBoxRef.current.style.height = `${height}px`;
        }
      });
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);

      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);

      if (marqueeBoxRef.current) {
        marqueeBoxRef.current.style.display = "none";
      }

      if (!isDragging) return;

      const endX = upEvent.clientX;
      const endY = upEvent.clientY;
      const boxRect = {
        left: Math.min(startX, endX),
        top: Math.min(startY, endY),
        right: Math.max(startX, endX),
        bottom: Math.max(startY, endY),
      };

      const intersected = itemCache.filter((item) => {
        const r = item.rect;
        return !(
          r.right < boxRect.left ||
          r.left > boxRect.right ||
          r.bottom < boxRect.top ||
          r.top > boxRect.bottom
        );
      });

      if (intersected.length > 0) {
        const selectedItems: SelectedItem[] = intersected
          .map((item) => {
            if (item.type === "folder") {
              const folderObj = folders.find(
                (f) => String(f.id) === String(item.id),
              );
              if (!folderObj) return null;
              return {
                type: "folder" as const,
                id: String(item.id),
                name: folderObj.name,
                createdAt: folderObj.createdAt,
                updatedAt: folderObj.updatedAt,
                createdBy: folderObj.createdBy,
                updatedBy: folderObj.updatedBy,
                path: folderObj.path,
                parentId: folderObj.parentId,
                assetCount: folderObj.assetCount,
                folderCount: folderObj.folderCount,
                itemCount: folderObj.itemCount,
              };
            } else {
              const assetObj = assets.find(
                (a) => String(a.id) === String(item.id),
              );
              if (!assetObj) return null;
              return {
                type: "asset" as const,
                id: String(item.id),
                name: assetObj.name,
                fileType: assetObj.type?.startsWith("image")
                  ? "image"
                  : assetObj.type?.startsWith("video")
                    ? "video"
                    : "file",
                extension: assetObj.extension,
                src: assetObj.url,
                alt: assetObj.alt || undefined,
                caption: assetObj.caption || undefined,
                tags: assetObj.tags,
                createdAt: assetObj.createdAt,
                updatedAt: assetObj.updatedAt,
                size: assetObj.size,
              };
            }
          })
          .filter(Boolean) as SelectedItem[];

        selectAllItems(selectedItems, isAppendMode);
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

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
      {isLoading ? (
        <div className="flex h-full flex-col gap-4 p-6">
          <div className="grid grid-cols-4 gap-3">
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
          </div>
          <Skeleton className="h-6 w-24" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-10 rounded" />
            <Skeleton className="h-10 rounded" />
            <Skeleton className="h-10 rounded" />
            <Skeleton className="h-10 rounded" />
          </div>
        </div>
      ) : errorMessage ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-muted-foreground">{errorMessage}</p>
        </div>
      ) : folders.length <= 0 && assets.length <= 0 && !currentFolder && !query ? (
        <AssetEmptyCard showButton uploadConfig={uploadConfig} />
      ) : (
        <div
          ref={containerRef}
          onPointerDown={handlePointerDown}
          className="w-full flex-1 flex flex-col min-h-0 overflow-hidden relative select-none"
        >
          <div
            ref={marqueeBoxRef}
            style={{ display: "none" }}
            className="pointer-events-none fixed border border-blue-500/70 bg-blue-500/15 z-50 rounded shadow-xs"
          />
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
      )}
    </CardWrapper>
  );
};
