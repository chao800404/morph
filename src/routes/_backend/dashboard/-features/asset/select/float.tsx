"use client";

import { deleteItems } from "@/actions/asset";
import { moveItems } from "@/actions/asset/move-items";
import { updateItems } from "@/actions/asset/update-items";
import { AssetsSelectContent } from "@/app/(backend)/dashboard/_components/card/assets-card/client/assets-select-content.client";
import {
    generateEditFields,
    generateEditTitle,
} from "@/app/(backend)/dashboard/_features/asset/edit/edit-fields-utils";
import { useAssetEditStore } from "@/app/(backend)/dashboard/_features/asset/edit/use-asset-edit-store";
import {
    generateMoveDescription,
    generateMoveFields,
    generateMoveTitle,
} from "@/app/(backend)/dashboard/_features/asset/move/move-fields-utils";
import { useAssetMoveStore, type MoveItem } from "@/app/(backend)/dashboard/_features/asset/move/use-asset-move-store";
import { useInfoStore, type ServerAction } from "@/app/(backend)/dashboard/_features/global-info/use-info-store";
import { Button } from "@/components/ui/button";
import { MoveFolderIcon } from "@/components/ui/icons/move-folder-icon";
import { useMediaQuery } from "@/hooks/use-media-query";
import { downloadMixed } from "@/lib/asset/download-utils";
import { cn } from "@/lib/utils";
import { Download, Edit, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useAssetsStore } from "../../../_views/global/contents/assets/_stores/assets.store";

const AssetSelectFloat = () => {
    const isLargeScreen = useMediaQuery("(min-width: 1024px)");

    const { selectedItems, clearAllSelectedItems, isActionMenuOpen } = useAssetsStore(
        useShallow(state => ({
            selectedItems: state.selectedItems,
            clearAllSelectedItems: state.clearAllSelectedItems,
            isActionMenuOpen: state.isActionMenuOpen,
        }))
    );

    const { handleMoveOpenChange, setAssetMoveData } = useAssetMoveStore(
        useShallow(state => ({
            handleMoveOpenChange: state.handleOpenChange,
            setAssetMoveData: state.setAssetMoveData,
        }))
    );

    const { handleEditOpenChange, setAssetEditData } = useAssetEditStore(
        useShallow(state => ({
            handleEditOpenChange: state.handleOpenChange,
            setAssetEditData: state.setAssetEditData,
        }))
    );

    const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
        useShallow(state => ({
            setInfoData: state.setInfoData,
            setOpen: state.setOpen,
        }))
    );

    // Helper to get selected items separated by type
    const getSelectedItemsByType = () => {
        const selectedFolderIds = Array.from(selectedItems.values())
            .filter(item => item.type === "folder")
            .map(item => item.id);

        const selectedAssetIds = Array.from(selectedItems.values())
            .filter(item => item.type === "asset")
            .map(item => item.id);

        return { selectedFolderIds, selectedAssetIds };
    };

    const handleEdit = () => {
        const items = Array.from(selectedItems.values()).map(item => {
            if (item.type === "folder") {
                return {
                    id: item.id,
                    type: "folder" as const,
                    name: item.name,
                    description: item.description,
                };
            }
            return {
                id: item.id,
                type: "asset" as const,
                name: item.name,
                fileType: item.fileType,
                extension: item.extension,
                src: item.src,
                alt: item.alt,
                caption: item.caption,
                tags: item.tags?.join(", "),
            };
        });

        if (items.length === 0) return;

        // Default to the first item
        const firstItem = items[0];

        setAssetEditData({
            title: generateEditTitle(firstItem.type, items.length),
            description: "Modify item details",
            fields: generateEditFields(firstItem),
            action: updateItems,
            items: items,
            onSuccess: () => {
                clearAllSelectedItems();
            },
        });
        handleEditOpenChange(true);
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
            success: result => {
                return result.message || "Download started";
            },
            error: err => {
                const errorMessage = err instanceof Error ? err.message : "Failed to download";
                return errorMessage;
            },
            position: "top-center",
        });
    };

    const handleMove = () => {
        // Get all selected items directly from the store
        const allSelectedItems = Array.from(selectedItems.values());

        // Separate into folders and assets for excludedIds
        const selectedFolderIds = allSelectedItems.filter(item => item.type === "folder").map(item => item.id);

        // Convert SelectedItem[] to MoveItem[]
        const itemsToMove: MoveItem[] = allSelectedItems.map(item => {
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
        <AnimatePresence>
            {selectedItems.size > 0 && !isActionMenuOpen && (
                <motion.div
                    key="asset-select-float"
                    whileHover="hover"
                    initial={{ opacity: 0, y: 100, x: "-50%" }}
                    animate={{ opacity: 1, y: 0, x: "-50%" }}
                    exit={{ opacity: 0, y: 200, x: "-50%" }}
                    transition={{ type: "tween" }}
                    className={cn(
                        "bg-card pl-4 h-11 pr-2 text-zinc-400 text-xs border-t border-x border-zinc-300 dark:border-zinc-950 shadow-sm/20 dark:shadow-elevation-modal flex items-center fixed bottom-3 left-1/2 z-50 rounded-full cursor-pointer pointer-events-auto"
                    )}
                >
                    <div className="overflow-hidden h-full" onClick={clearAllSelectedItems}>
                        {isLargeScreen ? (
                            <motion.div
                                transition={{ type: "tween" }}
                                variants={{ hover: { y: "-100%" } }}
                                className="relative h-full flex items-center w-28 justify-center"
                            >
                                <span>{selectedItems.size} Selected</span>
                                <div className="absolute -bottom-full left-0 w-full h-full flex justify-center text-destructive z-10">
                                    <span className="group w-full flex items-center justify-around">
                                        <span className="group-hover:bg-destructive/10 gap-1 px-3 py-1 rounded-full flex items-center justify-center">
                                            <X className="size-3" />
                                            Deselect {selectedItems.size}
                                        </span>
                                    </span>
                                </div>
                            </motion.div>
                        ) : (
                            <div className="h-full flex items-center justify-center text-destructive">
                                <span className="w-full flex items-center justify-around">
                                    <span className="gap-1 px-3 py-1 whitespace-nowrap rounded-full flex items-center justify-center">
                                        <X className="size-3" />
                                        Deselect {selectedItems.size}
                                    </span>
                                </span>
                            </div>
                        )}
                    </div>
                    <span className="px-2 opacity-20 ml-1">|</span>
                    <div className="flex gap-0.5 items-center">
                        <Button variant="none" size="icon" onClick={handleDelete}>
                            <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                        <Button variant="none" size="icon" onClick={handleDownload}>
                            <Download className="size-3.5" />
                        </Button>
                        <Button variant="none" size="icon" onClick={handleMove}>
                            <MoveFolderIcon className="size-3.5" />
                        </Button>
                    </div>
                    <span className="px-2 opacity-20 mr-1">|</span>
                    <Button variant="form" rounded="full" onClick={handleEdit}>
                        <Edit className="size-3.5" />
                        <span className="max-sm:hidden">Edit</span>
                    </Button>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default AssetSelectFloat;
