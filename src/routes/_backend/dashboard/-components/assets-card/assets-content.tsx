import { memo, useCallback, useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Asset } from "@/routes/_backend/dashboard/-views/global/contents/assets/config/assets-card.types";
import { useAssetsStore } from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";
import { AssetFooter } from "./asset-footer";
import { AssetsTable } from "./assets-table";
import TypeHeadClient from "./type-head";

const TABLE_HEADS = [
  "Name",
  "Extension",
  "Size",
  "Created At",
  "Updated At",
  "",
];

type Props = {
  assets?: Asset[];
  pagination?: {
    page: number;
    limit: number;
    totalAssets: number;
    totalPages: number;
  };
  isCollapsed?: boolean;
  canCollapse?: boolean;
  onToggleCollapse?: () => void;
};

type AssetsTypeHeadProps = {
  collapsible: boolean;
  isCollapsed: boolean;
  controlsId: string;
  onToggleCollapse: () => void;
};

const AssetsTypeHead = memo(function AssetsTypeHead({
  collapsible,
  isCollapsed,
  controlsId,
  onToggleCollapse,
}: AssetsTypeHeadProps) {
  const selectedAssetsCount = useAssetsStore((state) => {
    let count = 0;
    for (const item of state.selectedItems.values()) {
      if (item.type === "asset") count += 1;
    }
    return count;
  });

  return (
    <TypeHeadClient
      title="Assets"
      size={selectedAssetsCount}
      collapsible={collapsible}
      isCollapsed={isCollapsed}
      controlsId={controlsId}
      onToggleCollapse={onToggleCollapse}
    />
  );
});

export const AssetsContent = memo(function AssetsContent({
  assets,
  pagination,
  isCollapsed: controlledIsCollapsed,
  canCollapse = true,
  onToggleCollapse,
}: Props) {
  const [internalIsCollapsed, setInternalIsCollapsed] = useState(false);
  const isCollapsed = controlledIsCollapsed ?? internalIsCollapsed;
  const contentId = useId();
  const handleToggleCollapse = useCallback(() => {
    if (onToggleCollapse) {
      onToggleCollapse();
      return;
    }
    setInternalIsCollapsed((previous) => !previous);
  }, [onToggleCollapse]);

  const tableContent = useMemo(
    () =>
      assets?.map((asset) => ({
        id: String(asset.id),
        name: asset.name,
        url: asset.url,
        type: asset.type,
        createdAt: asset.createdAt,
        size: asset.size,
        alt: asset.alt || undefined,
        caption: asset.caption || undefined,
        tags: asset.tags?.join(",") || undefined,
        extension: asset.extension,
        updatedAt: asset.updatedAt,
      })),
    [assets],
  );

  if (!assets || assets.length === 0) {
    return null;
  }

  return (
    <div
      data-asset-split-motion
      className={cn(
        "grid min-h-10 shrink-0 overflow-hidden transition-[flex-grow,grid-template-rows] duration-150 ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none",
        isCollapsed && "pointer-events-auto",
      )}
      style={{
        flexBasis: 0,
        flexGrow: isCollapsed ? 0 : 1,
        gridTemplateRows: isCollapsed ? "40px 0fr" : "40px 1fr",
      }}
    >
      <AssetsTypeHead
        collapsible={canCollapse}
        isCollapsed={isCollapsed}
        controlsId={contentId}
        onToggleCollapse={handleToggleCollapse}
      />
      <div
        id={contentId}
        aria-hidden={isCollapsed}
        data-asset-split-motion
        className={cn(
          "flex min-h-0 flex-col overflow-hidden transition-opacity duration-150 ease-out motion-reduce:transition-none",
          isCollapsed ? "pointer-events-none opacity-0" : "opacity-100",
        )}
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AssetsTable
            tableHeads={TABLE_HEADS}
            tableContent={tableContent}
          />
        </div>
        <div
          data-asset-split-motion
          className={cn(
            "shrink-0 transition-opacity motion-reduce:transition-none",
            isCollapsed
              ? "pointer-events-none opacity-0 delay-0 duration-75"
              : "opacity-100 delay-150 duration-100 ease-out",
          )}
        >
          <AssetFooter pagination={pagination} />
        </div>
      </div>
    </div>
  );
});
