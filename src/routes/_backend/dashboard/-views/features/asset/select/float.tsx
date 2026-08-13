"use client";

import { AssetsSelectContent } from "@/routes/_backend/dashboard/-components/assets-card/assets-select-content";
import {
  generateMoveDescription,
  generateMoveFields,
  generateMoveTitle,
} from "../move/move-fields-utils";
import {
  useAssetMoveStore,
  type MoveItem,
} from "@/lib/asset/store/use-asset-move-store";
import {
  useInfoStore,
  type ServerAction,
} from "../../global-info/use-info-store";
import { CommandBar } from "@/components/ui/command-bar";
import { MoveFolderIcon } from "@/components/ui/icons/move-folder-icon";
import { downloadMixed } from "@/lib/asset/download-utils";
import { deleteItems } from "@/server/asset/delete-items.serverFn";
import { moveItems } from "@/server/asset/move-items.serverFn";
import { Download, Edit, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useAssetsStore } from "../../../global/contents/assets/stores/assets.store";
import { useAssetRouteActions } from "../../../global/contents/assets/hooks/use-asset-route-actions";

interface AssetSelectFloatProps {
  active?: boolean;
}

const AssetSelectFloat = ({ active = true }: AssetSelectFloatProps) => {
  const { openEditItems } = useAssetRouteActions();

  const { selectedItems, clearAllSelectedItems, isActionMenuOpen } =
    useAssetsStore(
      useShallow((state) => ({
        selectedItems: state.selectedItems,
        clearAllSelectedItems: state.clearAllSelectedItems,
        isActionMenuOpen: state.isActionMenuOpen,
      })),
    );

  const { handleMoveOpenChange, setAssetMoveData } = useAssetMoveStore(
    useShallow((state) => ({
      handleMoveOpenChange: state.handleOpenChange,
      setAssetMoveData: state.setAssetMoveData,
    })),
  );

  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );

  // Helper to get selected items separated by type
  const getSelectedItemsByType = () => {
    const selectedFolderIds = Array.from(selectedItems.values())
      .filter((item) => item.type === "folder")
      .map((item) => item.id);

    const selectedAssetIds = Array.from(selectedItems.values())
      .filter((item) => item.type === "asset")
      .map((item) => item.id);

    return { selectedFolderIds, selectedAssetIds };
  };

  const handleEdit = () => {
    const selected = Array.from(selectedItems.values());
    openEditItems(
      selected.map((item) => ({
        id: item.id,
        itemType: item.type,
      })),
    );
  };

  const handleDownload = async () => {
    const { selectedFolderIds, selectedAssetIds } = getSelectedItemsByType();

    // Use the mixed download function
    const downloadPromise = downloadMixed({
      assetIds: selectedAssetIds,
      folderIds: selectedFolderIds,
    });

    toast.promise(downloadPromise, {
      loading: "Preparing download...",
      success: (result) => {
        return result.message || "Download started";
      },
      error: (err) => {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to download";
        return errorMessage;
      },
      position: "top-center",
    });
  };

  const handleMove = () => {
    // Get all selected items directly from the store
    const allSelectedItems = Array.from(selectedItems.values());

    // Separate into folders and assets for excludedIds
    const selectedFolderIds = allSelectedItems
      .filter((item) => item.type === "folder")
      .map((item) => item.id);

    // Convert SelectedItem[] to MoveItem[]
    const itemsToMove: MoveItem[] = allSelectedItems.map((item) => {
      if (item.type === "folder") {
        return {
          id: item.id,
          type: "folder",
          name: item.name,
        };
      } else {
        return {
          id: item.id,
          type: "asset",
          name: item.name,
          fileType: item.fileType,
          extension: item.extension,
          src: item.src,
          alt: item.alt,
        };
      }
    });

    setAssetMoveData({
      title: generateMoveTitle(undefined, allSelectedItems.length),
      description: generateMoveDescription(undefined, allSelectedItems.length),
      fields: generateMoveFields(),
      action: moveItems,
      items: itemsToMove,
      excludedIds: selectedFolderIds,
      onSuccess: () => {
        // Clear selections after successful move
        clearAllSelectedItems();
      },
    });
    handleMoveOpenChange(true);
  };

  const handleDelete = () => {
    const { selectedFolderIds, selectedAssetIds } = getSelectedItemsByType();
    const selectedFoldersCount = selectedFolderIds.length;
    const selectedAssetsCount = selectedAssetIds.length;
    const totalCount = selectedAssetsCount + selectedFoldersCount;

    if (totalCount === 0) return;

    // Use the unified delete action for mixed types
    let action: ServerAction = deleteItems;

    setInfoData({
      title: "Delete Items",
      description: `Are you sure you want to delete ${totalCount} item(s)? This action cannot be undone.`,
      action,
      reactNode: <AssetsSelectContent />,
      confirmLabel: "Delete",
      confirmVariant: "destructive",
      onSuccess: () => {
        clearAllSelectedItems();
      },
    });
    setInfoOpen(true);
  };

  return (
    <CommandBar
      open={active && selectedItems.size > 0 && !isActionMenuOpen}
      value={`${selectedItems.size} selected`}
      onClear={clearAllSelectedItems}
      actions={[
        {
          id: "delete",
          label: "Delete",
          icon: <Trash2 className="size-3.5" />,
          destructive: true,
          iconOnly: true,
          onAction: handleDelete,
        },
        {
          id: "download",
          label: "Download",
          icon: <Download className="size-3.5" />,
          iconOnly: true,
          onAction: handleDownload,
        },
        {
          id: "move",
          label: "Move",
          icon: <MoveFolderIcon className="size-3.5" />,
          iconOnly: true,
          onAction: handleMove,
        },
      ]}
      primaryAction={{
        id: "edit",
        label: "Edit",
        icon: <Edit className="size-3.5" />,
        onAction: handleEdit,
      }}
    />
  );
};

export default AssetSelectFloat;
