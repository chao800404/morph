import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useMediaQuery } from "@/hooks/use-media-query";
import { downloadAsset } from "@/lib/asset/download-utils";
// import { copyPath } from "@/lib/shared/copy-path";
import { cn, getFileType } from "@/lib/utils";
import {
  generateEditFields,
  generateEditTitle,
} from "@/routes/_backend/dashboard/-views/features/asset/edit/edit-fields-utils";
import { useAssetEditStore } from "@/routes/_backend/dashboard/-views/features/asset/edit/use-asset-edit-store";
import {
  generateMoveDescription,
  generateMoveFields,
  generateMoveTitle,
} from "@/routes/_backend/dashboard/-views/features/asset/move/move-fields-utils";
import { useAssetMoveStore } from "@/routes/_backend/dashboard/-views/features/asset/move/use-asset-move-store";
import { useAssetPreviewStore } from "@/routes/_backend/dashboard/-views/features/asset/preview/use-asset-preview-store";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import { useAssetsStore } from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";
import { deleteItems, moveItems, updateItems } from "@/server/asset";
import { toast } from "sonner";
import { memo, useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { AssetTableRow } from "./asset-table-row";

interface AssetsTableProps {
  tableHeads: string[];
  tableContent?: {
    id: string;
    name: string;
    url: string;
    createdAt: string;
    type: string | null;
    size: number;
    alt?: string;
    caption?: string;
    tags?: string;
    extension?: string;
    updatedAt?: string;
  }[];
}

export const AssetsTable = memo(function AssetsTable({
  tableHeads,
  tableContent = [],
}: AssetsTableProps) {
  const isLargeScreen = useMediaQuery("(min-width: 1024px)");
  const { openAssetEdit } = useAssetEditStore(
    useShallow((state) => ({
      openAssetEdit: state.openAssetEdit,
    })),
  );

  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );

  const { handleMoveOpenChange, setAssetMoveData } = useAssetMoveStore(
    useShallow((state) => ({
      handleMoveOpenChange: state.handleOpenChange,
      setAssetMoveData: state.setAssetMoveData,
    })),
  );

  const { setPreviewData, handleOpenChange } = useAssetPreviewStore(
    useShallow((state) => ({
      setPreviewData: state.setAssetPreviewData,
      handleOpenChange: state.handleOpenChange,
    })),
  );

  const {
    toggleSelectItem,
    selectAllItems,
    selectedItems,
    clearAllSelectedItems,
  } = useAssetsStore(
    useShallow((state) => ({
      toggleSelectItem: state.toggleSelectItem,
      selectAllItems: state.selectAllItems,
      selectedItems: state.selectedItems,
      clearAllSelectedItems: state.clearAllSelectedItems,
    })),
  );

  const selectedAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of selectedItems.values()) {
      if (item.type === "asset") ids.add(item.id);
    }
    return ids;
  }, [selectedItems]);

  const handleCheckedChange = useCallback(
    (id: string) => {
      const asset = tableContent.find((item) => item.id === id);
      if (!asset) return;

      toggleSelectItem({
        type: "asset",
        id,
        name: asset.name,
        fileType: getFileType(asset.type),
        extension: asset.extension || "",
        src: asset.url,
        alt: asset.alt,
        caption: asset.caption,
        tags: asset.tags ? [asset.tags] : undefined,
        size: asset.size,
      });
    },
    [tableContent, toggleSelectItem],
  );

  // Calculate selection state for current page
  // Use tableContent directly as it is now the current page items
  const currentPageAssets = tableContent;
  const allCurrentPageSelected =
    currentPageAssets.length > 0 &&
    currentPageAssets.every((asset) => selectedAssetIds.has(asset.id));
  const someCurrentPageSelected =
    currentPageAssets.some((asset) => selectedAssetIds.has(asset.id)) &&
    !allCurrentPageSelected;
  const checkboxState: boolean | "indeterminate" = allCurrentPageSelected
    ? true
    : someCurrentPageSelected
      ? "indeterminate"
      : false;

  // Handle select all/deselect all for current page
  const handleSelectAllCurrentPage = useCallback(() => {
    if (allCurrentPageSelected) {
      const currentPageIds = new Set(
        currentPageAssets.map((asset) => asset.id),
      );
      selectAllItems(
        Array.from(selectedItems.values()).filter(
          (item) =>
            item.type !== "asset" || !currentPageIds.has(String(item.id)),
        ),
      );
    } else {
      // Select all on current page
      const existingItems = Array.from(selectedItems.values());
      const itemsToSelect = currentPageAssets.map((asset) => {
        const fileType = getFileType(asset.type);

        const extension = asset.extension || "";

        return {
          type: "asset" as const,
          id: asset.id,
          name: asset.name,
          fileType,
          extension,
          src: asset.url,
          alt: asset.alt,
          caption: asset.caption,
          tags: asset.tags ? [asset.tags] : undefined,
          size: asset.size,
        };
      });
      selectAllItems([...existingItems, ...itemsToSelect]);
    }
  }, [
    allCurrentPageSelected,
    currentPageAssets,
    selectAllItems,
    selectedItems,
  ]);

  const handleEdit = useCallback(
    (id: string) => {
      const asset = tableContent.find((item) => item.id === id);
      if (asset) {
        const editItem = {
          id,
          type: "asset" as const,
          name: asset.name,
          fileType: getFileType(asset.type),
          extension: asset.extension || "",
          src: asset.url,
          alt: asset.alt,
          caption: asset.caption,
          tags: asset.tags,
          size: asset.size,
        };

        openAssetEdit({
          title: generateEditTitle("asset", 1),
          description: "Modify asset information",
          fields: generateEditFields(editItem),
          items: [editItem],
          action: updateItems,
          onSuccess: clearAllSelectedItems,
        });
      }
    },
    [
      clearAllSelectedItems,
      openAssetEdit,
      tableContent,
    ],
  );

  const handleDownload = useCallback(async (id: string) => {
    toast.promise(
      downloadAsset({ ids: [id] }).then((result) => {
        if (!result.success) {
          throw new Error(result.message || "Failed to download folder");
        }
        return { message: result.message };
      }),
      {
        loading: "Preparing download...",
        success: (data) => data.message || "Download started",
        error: (err) => err.message || "Failed to download folder",
        position: "top-center",
      },
    );
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      const item = tableContent.find((asset) => asset.id === id);
      const name = item?.name || "this asset";

      setInfoData({
        title: "Delete Asset",
        description: `Are you sure you want to delete "${name}"? This action cannot be undone.`,
        fields: [
          {
            type: "hidden",
            name: "assetIds",
            value: JSON.stringify([id]),
          },
        ],
        action: deleteItems,
        confirmLabel: "Delete",
        confirmVariant: "destructive",
        onSuccess: clearAllSelectedItems,
      });
      setInfoOpen(true);
    },
    [clearAllSelectedItems, setInfoData, setInfoOpen, tableContent],
  );

  const handleMove = useCallback(
    (id: string) => {
      const asset = tableContent.find((item) => item.id === id);
      if (!asset) return;

      const moveItem = {
        id,
        type: "asset" as const,
        name: asset.name,
        fileType: getFileType(asset.type),
        extension: asset.extension || "",
        src: asset.url,
        alt: asset.alt || undefined,
        size: asset.size,
      };

      setAssetMoveData({
        title: generateMoveTitle("asset", 1),
        description: generateMoveDescription("asset", 1),
        fields: generateMoveFields(),
        action: moveItems,
        items: [moveItem],
        onSuccess: clearAllSelectedItems,
      });
      handleMoveOpenChange(true);
    },
    [
      clearAllSelectedItems,
      handleMoveOpenChange,
      setAssetMoveData,
      tableContent,
    ],
  );

  const previewItems = useMemo(
    () =>
      tableContent.map((asset) => ({
        id: asset.id,
        type: "asset" as const,
        name: asset.name,
        fileType: getFileType(asset.type),
        extension: asset.extension || "",
        src: asset.url,
        alt: asset.alt,
        caption: asset.caption,
        tags: asset.tags ? [asset.tags] : undefined,
        size: asset.size,
      })),
    [tableContent],
  );

  const handlePreview = useCallback(
    (id: string) => {
      const item = previewItems.find((asset) => asset.id === id);
      if (!item) return;

      setPreviewData({ item, items: previewItems });
      handleOpenChange(true);
    },
    [handleOpenChange, previewItems, setPreviewData],
  );

  const handleCopyURL = useCallback(
    async (id: string) => {
      const asset = tableContent.find((item) => item.id === id);
      if (!asset?.url) return;

      // await copyPath(asset.url, {
      //   onSuccess: () =>
      //     toast.success("Copied to clipboard", { position: "top-center" }),
      //   onError: () =>
      //     toast.error("Failed to copy to clipboard", {
      //       position: "top-center",
      //     }),
      // });
      navigator.clipboard
        .writeText(asset.url)
        .then(() => {
          toast.success("Copied to clipboard", { position: "top-center" });
        })
        .catch(() => {
          toast.error("Failed to copy to clipboard", {
            position: "top-center",
          });
        });
    },
    [tableContent],
  );

  const handleKeyDown = useCallback(
    (id: string, event: React.KeyboardEvent<HTMLTableRowElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleCheckedChange(id);
      } else if (event.key === " ") {
        event.preventDefault();
        handlePreview(id);
      }
    },
    [handleCheckedChange, handlePreview],
  );

  if (tableContent.length === 0) {
    return (
      <div className="px-6 py-8 text-center text-muted-foreground">
        <p>No assets found</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead
            className={cn(
              "pl-6 w-14 whitespace-nowrap sticky left-0 z-20",
              "group-data-[scrolled=true]:bg-accent",
              'after:content-[""] after:opacity-0 after:absolute after:top-0 after:left-0 after:right-0 after:bottom-0 after:border-r after:z-10 after:border-border',
              "group-data-[scrolled=true]:after:opacity-100",
            )}
          >
            <div className="flex items-center justify-start relative z-30">
              <Checkbox
                checked={checkboxState}
                isIndeterminate={someCurrentPageSelected}
                onCheckedChange={handleSelectAllCurrentPage}
              />
            </div>
          </TableHead>
          {tableHeads.map((head, idx) => (
            <TableHead key={idx} className="whitespace-nowrap">
              {head}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {tableContent.map((asset) => (
          <AssetTableRow
            {...asset}
            key={asset.id}
            checked={selectedAssetIds.has(asset.id)}
            isDraggableEnabled={isLargeScreen}
            onCheckedChange={handleCheckedChange}
            onDelete={handleDelete}
            onEdit={handleEdit}
            onDownload={handleDownload}
            onMove={handleMove}
            onDoubleClick={handlePreview}
            onCopyURL={handleCopyURL}
            onKeyDown={handleKeyDown}
          />
        ))}
      </TableBody>
    </Table>
  );
});
