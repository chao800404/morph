import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { deleteItems } from "@/server/asset/delete-items.serverFn";
import { moveItems } from "@/server/asset/move-items.serverFn";
import { updateItems } from "@/server/asset/update-items.serverFn";
import { toast } from "sonner";
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
  pagination?: {
    page: number;
    limit: number;
    totalAssets: number;
    totalPages: number;
  };
}

export const AssetsTable = ({
  tableHeads,
  tableContent = [],
  pagination,
}: AssetsTableProps) => {
  const { handleEditOpenChange, setAssetEditData } = useAssetEditStore(
    useShallow((state) => ({
      handleEditOpenChange: state.handleOpenChange,
      setAssetEditData: state.setAssetEditData,
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
    isSelected,
    selectAllItems,
    selectedItems,
    clearAllSelectedItems,
  } = useAssetsStore(
    useShallow((state) => ({
      toggleSelectItem: state.toggleSelectItem,
      isSelected: state.isSelected,
      selectAllItems: state.selectAllItems,
      selectedItems: state.selectedItems,
      clearAllSelectedItems: state.clearAllSelectedItems,
    })),
  );

  const handleCheckedChange = (id: string) => {
    const asset = tableContent.find((a) => a.id === id);
    if (asset) {
      const fileType = getFileType(asset.type);

      const extension = asset.extension || "";

      toggleSelectItem({
        type: "asset",
        id,
        name: asset.name,
        fileType,
        extension,
        src: asset.url,
        alt: asset.alt,
        caption: asset.caption,
        tags: asset.tags ? [asset.tags] : undefined,
        size: asset.size,
      });
    }
  };

  // Calculate selection state for current page
  // Use tableContent directly as it is now the current page items
  const currentPageAssets = tableContent;
  const allCurrentPageSelected =
    currentPageAssets.length > 0 &&
    currentPageAssets.every((asset) => isSelected(asset.id));
  const someCurrentPageSelected =
    currentPageAssets.some((asset) => isSelected(asset.id)) &&
    !allCurrentPageSelected;
  const checkboxState: boolean | "indeterminate" = allCurrentPageSelected
    ? true
    : someCurrentPageSelected
      ? "indeterminate"
      : false;

  // Handle select all/deselect all for current page
  const handleSelectAllCurrentPage = () => {
    if (allCurrentPageSelected) {
      // Deselect all on current page
      currentPageAssets.forEach((asset) => {
        if (isSelected(asset.id)) {
          const assetData = tableContent.find((a) => a.id === asset.id);
          if (assetData) {
            const fileType = getFileType(assetData.type);

            const extension = assetData.extension || "";

            toggleSelectItem({
              type: "asset",
              id: asset.id,
              name: assetData.name,
              fileType,
              extension,
              src: assetData.url,
              alt: assetData.name,
              caption: assetData.caption,
              tags: assetData.tags ? [assetData.tags] : undefined,
              size: assetData.size,
            });
          }
        }
      });
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
  };

  const handleEdit = (id: string) => {
    const asset = tableContent.find((item) => item.id === id);
    if (asset) {
      // Determine the actual fileType based on the asset's type
      const actualFileType = getFileType(asset.type);

      // Extract file extension from name
      const extension = asset.extension || "";

      const editItem = {
        id,
        type: "asset" as const,
        name: asset.name,
        fileType: actualFileType,
        extension,
        src: asset.url,
        alt: asset.alt,
        caption: asset.caption,
        tags: asset.tags,
        size: asset.size,
      };

      setAssetEditData({
        title: generateEditTitle("asset", 1),
        description: "Modify asset information",
        fields: generateEditFields(editItem),
        items: [editItem],
        action: updateItems,
        onSuccess: () => {
          clearAllSelectedItems();
        },
      });
    }
    handleEditOpenChange(true);
  };

  const handleDownload = async (id: string) => {
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
  };

  const handleDelete = (id: string) => {
    const item = tableContent.find((a) => a.id === id);
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
      onSuccess: () => {
        clearAllSelectedItems();
      },
    });
    setInfoOpen(true);
  };

  const handleMove = (id: string) => {
    const asset = tableContent.find((a) => a.id === id);
    if (!asset) return;

    // Determine the actual fileType based on the asset's type
    const actualFileType = getFileType(asset.type);

    const extension = asset.extension || "";

    const moveItem = {
      id,
      type: "asset" as const,
      name: asset.name,
      fileType: actualFileType,
      extension,
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
      onSuccess: () => {
        clearAllSelectedItems();
      },
    });
    handleMoveOpenChange(true);
  };

  const handlePreview = (id: string) => {
    const asset = tableContent.find((a) => a.id === id);
    if (asset) {
      const fileType = getFileType(asset.type);

      const extension = asset.extension || "";

      // Convert all tableContent to PreviewItem format
      const allItems = tableContent.map((a) => {
        const itemFileType = getFileType(a.type);
        const itemExtension = a.extension || "";

        return {
          id: a.id,
          type: "asset" as const,
          name: a.name,
          fileType: itemFileType,
          extension: itemExtension,
          src: a.url,
          alt: a.alt,
          caption: a.caption,
          tags: a.tags ? [a.tags] : undefined,
          size: a.size,
        };
      });

      setPreviewData({
        item: {
          id: asset.id,
          type: "asset",
          name: asset.name,
          fileType,
          extension,
          src: asset.url,
          alt: asset.alt,
          caption: asset.caption,
          tags: asset.tags ? [asset.tags] : undefined,
          size: asset.size,
        },
        items: allItems,
      });
      handleOpenChange(true);
    }
  };

  const handleCopyURL = async (id: string) => {
    const asset = tableContent.find((a) => a.id === id);
    if (asset?.url) {
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
    }
  };

  const handleKeyDown = (
    id: string,
    e: React.KeyboardEvent<HTMLTableRowElement>,
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCheckedChange(id);
    } else if (e.key === " ") {
      // 阻止空白鍵觸發拖曳操作
      e.preventDefault();
      handlePreview(id);
    }
  };

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
            checked={isSelected(asset.id)}
            onCheckedChange={handleCheckedChange}
            onDelete={handleDelete}
            onEdit={handleEdit}
            onDownload={handleDownload}
            onMove={handleMove}
            onDoubleClick={handlePreview}
            onCopyURL={handleCopyURL}
            onKeyDown={(e) => {
              handleKeyDown(asset.id, e);
            }}
          />
        ))}
      </TableBody>
    </Table>
  );
};
